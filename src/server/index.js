const cluster = require('cluster');
const isMaster = cluster.isPrimary !== undefined ? cluster.isPrimary : cluster.isMaster;
if (isMaster) {
    try { require('dotenv-flow').config({ silent: true }); } catch (e) { /* optional */ }
}

const exitHook = require('async-exit-hook');
const sticky = require('sticky-session-custom');
const config = require('../config');
const RammerheadLogging = require('../core/logging');
const setupSiteRoutes = require('../site/setupSiteRoutes');
const guardLib = require('../util/destinationGuard');
const FallbackHttp = require('../core/FallbackHttp');
const { loadEngine } = require('../engine/EngineAdapter');
const { AuthService } = require('../auth/AuthService');
const { loadTransports, closeTransports, TransportRegistry } = require('../transports/registry');
const setupAuthRoutes = require('../auth/setupAuthRoutes');
const setupRoutes = require('./setupRoutes');
const setupStatusRoutes = require('./setupStatusRoutes');

const prefix = config.enableWorkers ? (isMaster ? '(master) ' : `(${cluster.worker.id}) `) : '';
const logger = new RammerheadLogging({
    logLevel: config.logLevel,
    generatePrefix: (level) => prefix + config.generatePrefix(level)
});
const formatUrl = (secure, hostname, port) => `${secure ? 'https' : 'http'}://${hostname}:${port}`;

async function main() {
    if (config.password) logger.warn('(server) config.password is no longer used. Users now create their own accounts; remove it from config.js.');

    // ---- the engine (replaceable) ----
    const guard = guardLib.createGuard(config.network, isMaster ? logger : null);
    // the engine gets a live handle to the transport registry; it is filled once the plug-ins have loaded
    const transportRegistry = new TransportRegistry();
    const host = {
        logger,
        guard,
        transports: { get: (id) => transportRegistry.instance(id), list: () => transportRegistry.list().map((e) => ({ id: e.id, name: e.name, version: e.version, status: e.status })) },
        config: { ...config, sessionStore: config.fileCacheSessionConfig, isMaster }
    };
    let loaded = await loadEngine(config.engine.dir, host);
    let http;
    let useWorkers = config.enableWorkers;
    if (loaded.status === 'ready') {
        http = loaded.engine.http;
        if (isMaster) logger.info(`(engine) ${loaded.engine.info.name} ${loaded.engine.info.version} is ready`);
    } else {
        // keep the interface up so the user can see what is wrong; never crash because of the engine
        useWorkers = false;
        http = new FallbackHttp({ ssl: config.ssl, bindingAddress: config.bindingAddress, port: config.port });
        logger.error(`(engine) NOT available (${loaded.status}): ${loaded.errors.join('; ')}. ${loaded.hint || ''}`);
    }

    // ---- the application core: interface, accounts, session routes ----
    const authConfig = config.auth || {};
    const auth = new AuthService({
        dataDir: authConfig.dataDir,
        registration: authConfig.registration,
        bindingAddress: config.bindingAddress,
        tokenTtlMs: (authConfig.tokenTtlDays || 30) * 24 * 3600 * 1000
    });
    if (config.publicDir) setupSiteRoutes(http, { config, reservedRoutes: loaded.engine ? loaded.engine.reservedRoutes : undefined, logger });
    // transport plug-ins (served assets and optional server parts); they get the same safety tools the engine gets
    const transportHost = {
        logger, guard, http, config: { ...config }, auth: { authenticate: (req) => auth.authenticate(req) },
        engine: loaded.manifest ? { id: loaded.manifest.id, name: loaded.manifest.name, version: loaded.manifest.version, capabilities: loaded.manifest.capabilities || {} } : null
    };
    const transports = await loadTransports(config.transport.dir, transportHost, loaded.engine ? loaded.engine.reservedRoutes : [], transportRegistry);
    if (isMaster) {
        const t = transports.list();
        logger.info(`(transports) ${t.length ? t.map((x) => `${x.id}${x.status === 'ready' ? '' : ' (' + x.status + ')'}`).join(', ') : 'none installed'} (built-in HTTP is always available)`);
    }
    setupAuthRoutes(http, auth, logger, config.getIP, (user, body) => {
        // remove the account's browsing session too, but only one that really belongs to it
        const engine = loaded.status === 'ready' ? loaded.engine : null;
        const id = body && body.sessionId;
        if (engine && typeof id === 'string' && engine.sessions.exists(id) && engine.sessions.ownerOf(id) === user.name) engine.sessions.remove(id);
    });
    setupRoutes(http, () => loaded, logger, auth, transports);
    setupStatusRoutes(http, () => loaded, config, auth, transports);
    if (isMaster) {
        logger.info(`(server) account sign-up mode: ${auth.registration}`);
        // First run on a server that needs invite codes: nobody can create the first account without one,
        // so print a one-time setup code (valid 24 hours, works once).
        if (auth.registration === 'invite' && auth.store.userCount() === 0) {
            auth.createInvite({ maxUses: 1, ttlHours: 24 })
                .then((code) => {
                    console.log('\n' + [
                        '==================================================================',
                        ' FIRST-RUN SETUP: there are no accounts yet.',
                        ` One-time setup code: ${code}`,
                        ' Open the site, choose "Create account", and enter this code in',
                        ' the "Invite code" box. It works once and expires in 24 hours.',
                        ' More codes later:  npm run auth -- invite',
                        '=================================================================='
                    ].join('\n') + '\n');
                })
                .catch((e) => logger.error('(server) could not create the first-run setup code: ' + e.message));
        }
    }

    exitHook(() => {
        logger.info('(server) Received exit signal, closing proxy server');
        closeTransports(transportRegistry);
        if (loaded.engine) loaded.engine.close();
        else http.close();
        logger.info('(server) Closed proxy server');
    });

    if (!useWorkers) {
        if (http instanceof FallbackHttp) http.listen();
        logger.info(`(server) listening on ${formatUrl(config.ssl, config.bindingAddress, config.port)}`);
        return;
    }

    // ---- multi-process mode ----
    const sessionIdFromUrl = loaded.engine.sessionIdFromUrl;
    const stickyOptions = {
        workers: config.workers,
        generatePrehashArray(req) {
            let sessionId = sessionIdFromUrl(req.url); // /sessionid/url
            if (!sessionId) {
                const parsed = new URL(req.url, 'https://a.com'); // /editsession?id=sessionid
                sessionId = parsed.searchParams.get('id') || parsed.searchParams.get('sessionId');
                if (!sessionId) {
                    for (let i = 0; i < req.headers.length; i += 2) {
                        if (req.headers[i].toLowerCase() === 'referer') {
                            sessionId = sessionIdFromUrl(req.headers[i + 1]);
                            break;
                        }
                    }
                    if (!sessionId) sessionId = ' '; // static asset: any worker will do
                }
            }
            return sessionId.split('').map((e) => e.charCodeAt());
        }
    };
    logger.info(JSON.stringify({ port: config.port, crossPort: config.crossDomainPort, master: isMaster }));
    const servers = http.servers;
    const closeMasters = [sticky.listen(servers[0], config.port, config.bindingAddress, stickyOptions)];
    if (config.crossDomainPort && servers[1]) {
        closeMasters.push(sticky.listen(servers[1], config.crossDomainPort, config.bindingAddress, stickyOptions));
    }
    if (closeMasters[0]) {
        logger.info(`Rammerhead proxy load balancer is listening on ${formatUrl(config.ssl, config.bindingAddress, config.port)}`);
        exitHook(async (done) => {
            logger.info('Master received exit signal. Shutting down workers');
            for (const closeMaster of closeMasters) await new Promise((resolve) => closeMaster(resolve));
            logger.info('Closed all workers');
            done();
        });
    } else {
        logger.info(`Worker ${cluster.worker.id} is running`);
    }
}

main().catch((e) => {
    logger.error('(server) fatal: ' + (e && e.stack ? e.stack : e));
    process.exit(1);
});
