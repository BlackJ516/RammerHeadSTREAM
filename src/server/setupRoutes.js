const URLPath = require('../util/URLPath');
const httpResponse = require('../util/httpResponse');
const config = require('../config');
const { normalizeTransportId, usableTransports } = require('../engine/transports');

/**
 * Session-management routes. They use only the engine contract (engine.sessions), never engine internals.
 * Every route needs a signed-in user, and a session can only be managed by the account that created it.
 *
 * @param {{GET:Function, POST:Function}} http - the engine's http surface (or the fallback host)
 * @param {() => {status:string, engine?:object, manifest?:object}} getLoaded - what the engine adapter loaded
 */
module.exports = function setupRoutes(http, getLoaded, logger, auth, transports) {
    const getEngine = () => (getLoaded().status === 'ready' ? getLoaded().engine : null);
    const capabilities = () => (getLoaded().manifest && getLoaded().manifest.capabilities) || {};
    const usable = () => usableTransports({ caps: capabilities(), engineId: getLoaded().manifest && getLoaded().manifest.id, registry: transports, config: config.transport });
    const ip = (req) => config.getIP(req);
    const json = (res, status, obj) => {
        res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(obj));
    };
    const requireUser = (req, res) => {
        const user = auth.authenticate(req);
        if (!user) {
            httpResponse.accessForbidden(logger, req, res, ip(req), 'sign in required');
            return null;
        }
        return user;
    };
    // resolves { user, engine } or answers the request and returns null
    const prepare = (req, res) => {
        const user = requireUser(req, res);
        if (!user) return null;
        const engine = getEngine();
        if (!engine) {
            res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
            res.end('engine unavailable');
            return null;
        }
        return { user, engine };
    };
    const owned = (req, res, ctx, id) => {
        if (!id || !ctx.engine.sessions.exists(id)) {
            httpResponse.badRequest(logger, req, res, ip(req), 'not found');
            return false;
        }
        if (ctx.engine.sessions.ownerOf(id) !== ctx.user.name) {
            httpResponse.accessForbidden(logger, req, res, ip(req), 'not your session');
            return false;
        }
        return true;
    };

    if (process.env.DEVELOPMENT) {
        http.GET('/garbageCollect', (req, res) => {
            global.gc();
            res.end('Ok');
        });
    }
    http.GET('/newsession', (req, res) => {
        const ctx = prepare(req, res);
        if (!ctx) return;
        res.end(ctx.engine.sessions.create({ owner: ctx.user.name, ip: ip(req) }));
    });
    http.GET('/editsession', async (req, res) => {
        const ctx = prepare(req, res);
        if (!ctx) return;
        const { id, httpProxy, enableShuffling, scriptEngine, transport } = new URLPath(req.url).getParams();
        if (!owned(req, res, ctx, id)) return;
        // a transport is only accepted if the installed engine declares it (and the administrator allows it)
        let chosenTransport;
        if (transport) {
            const wanted = normalizeTransportId(transport);
            const ok = usable();
            if (!wanted || !ok.includes(wanted)) {
                return httpResponse.badRequest(logger, req, res, ip(req), `The "${wanted || 'that'}" transport cannot be used with the installed engine. Usable: ${ok.join(', ')}.`);
            }
            chosenTransport = wanted;
        }
        try {
            await ctx.engine.sessions.configure(id, {
                httpProxy: httpProxy || null,
                shuffle: enableShuffling === '1' ? true : enableShuffling === '0' ? false : undefined,
                scriptEngine: scriptEngine === 'wasm' || scriptEngine === 'js' ? scriptEngine : undefined,
                transport: chosenTransport
            });
            res.end('Success');
        } catch (e) {
            httpResponse.badRequest(logger, req, res, ip(req), e.status && e.status < 500 ? e.message : 'could not update session');
        }
    });
    http.GET('/deletesession', (req, res) => {
        const ctx = prepare(req, res);
        if (!ctx) return;
        const { id } = new URLPath(req.url).getParams();
        if (!id || !ctx.engine.sessions.exists(id)) return res.end('not found');
        if (!owned(req, res, ctx, id)) return;
        ctx.engine.sessions.remove(id);
        res.end('Success');
    });
    http.GET('/sessionexists', (req, res) => {
        const ctx = prepare(req, res);
        if (!ctx) return;
        const id = new URLPath(req.url).get('id');
        if (!id) return httpResponse.badRequest(logger, req, res, ip(req), 'Must specify id parameter');
        // sessions owned by other accounts look like they do not exist
        res.end(ctx.engine.sessions.exists(id) && ctx.engine.sessions.ownerOf(id) === ctx.user.name ? 'exists' : 'not found');
    });
    // the sign-in page uses this to build obscured addresses; owner-only
    http.GET('/api/session/shuffle-dict', (req, res) => {
        const ctx = prepare(req, res);
        if (!ctx) return;
        const id = new URLPath(req.url).get('id');
        if (!owned(req, res, ctx, id)) return;
        json(res, 200, ctx.engine.sessions.shuffleDict(id));
    });
    // Settings uses this to check a transport (and to fail over to another one). Needs an engine that can test transports.
    http.GET('/api/transport/test', async (req, res) => {
        const ctx = prepare(req, res);
        if (!ctx) return;
        const wanted = normalizeTransportId(new URLPath(req.url).get('transport') || '');
        if (!wanted || !usable().includes(wanted)) return json(res, 400, { ok: false, error: 'That transport cannot be used with the installed engine.' });
        // a transport plug-in can check itself; otherwise the engine may be able to
        const plugin = transports && transports.instance(wanted);
        const tester = plugin && typeof plugin.test === 'function' ? (id) => plugin.test(id)
            : ctx.engine.transports && typeof ctx.engine.transports.test === 'function' ? (id) => ctx.engine.transports.test(id) : null;
        if (!tester) return json(res, 501, { ok: false, error: 'This transport cannot be checked automatically.' });
        const started = Date.now();
        try {
            const result = await Promise.race([
                Promise.resolve(tester(wanted)),
                new Promise((resolve) => setTimeout(() => resolve({ ok: false, error: 'Timed out after 10 seconds.' }), 10000).unref())
            ]);
            json(res, 200, { ok: !!(result && result.ok), ms: Date.now() - started, error: result && !result.ok ? String(result.error || 'Failed.').slice(0, 200) : undefined });
        } catch (e) {
            json(res, 200, { ok: false, ms: Date.now() - started, error: 'The transport check failed.' });
        }
    });
    http.GET('/mainport', (req, res) => {
        const serverInfo = config.getServerInfo(req);
        res.end((serverInfo.port || '').toString());
    });
};
