const { AuthError } = require('./AuthService');

const MAX_BODY = 8 * 1024;

function readJson(req) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (c) => {
            size += c.length;
            if (size > MAX_BODY) {
                reject(new AuthError(413, 'request too large'));
                req.destroy();
            } else chunks.push(c);
        });
        req.on('end', () => {
            try {
                const obj = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
                if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) throw new Error();
                resolve(obj);
            } catch (e) {
                reject(new AuthError(400, 'body must be a JSON object'));
            }
        });
        req.on('error', reject);
    });
}

function send(res, status, obj, extraHeaders = {}) {
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        ...extraHeaders
    });
    res.end(JSON.stringify(obj));
}

/**
 * Wraps a handler so thrown AuthErrors become JSON responses, and nothing internal leaks to the client.
 */
function handle(logger, getIP, fn) {
    return async (req, res) => {
        try {
            await fn(req, res);
        } catch (e) {
            if (e instanceof AuthError) {
                const headers = e.extra.retryAfterMs ? { 'Retry-After': String(Math.ceil(e.extra.retryAfterMs / 1000)) } : {};
                return send(res, e.status, { error: e.message, ...e.extra }, headers);
            }
            logger.error(`(auth) ${getIP(req)} ${req.url} internal error: ${e && e.message}`);
            send(res, 500, { error: 'internal error' });
        }
    };
}

/**
 * @param {import('../classes/RammerheadProxy')} proxyServer
 * @param {import('./AuthService').AuthService} auth
 */
module.exports = function setupAuthRoutes(proxyServer, auth, logger, getIP, onAccountDeleted = () => {}) {
    const wrap = (fn) => handle(logger, getIP, fn);
    const requireUser = (req) => {
        const user = auth.authenticate(req);
        if (!user) throw new AuthError(401, 'sign in required', { code: 'sign_in_required' });
        return user;
    };

    proxyServer.GET('/api/auth/status', wrap(async (req, res) => {
        const user = auth.authenticate(req);
        send(res, 200, { ...auth.status(user), ...(user && user.token ? { token: user.token } : {}) });
    }));
    proxyServer.POST('/api/auth/register', wrap(async (req, res) => {
        const body = await readJson(req);
        const result = await auth.register(body, getIP(req));
        logger.info(`(auth) ${getIP(req)} registered account "${result.username}"`);
        send(res, 201, result);
    }));
    proxyServer.POST('/api/auth/login', wrap(async (req, res) => {
        const body = await readJson(req);
        try {
            const result = await auth.login(body, getIP(req));
            send(res, 200, result);
        } catch (e) {
            if (e instanceof AuthError && e.status === 401) logger.warn(`(auth) ${getIP(req)} failed login`);
            throw e;
        }
    }));
    proxyServer.POST('/api/auth/password', wrap(async (req, res) => {
        const user = requireUser(req);
        const result = await auth.changePassword(user, await readJson(req), getIP(req));
        logger.info(`(auth) ${getIP(req)} "${user.name}" changed password`);
        send(res, 200, result);
    }));
    proxyServer.POST('/api/auth/delete', wrap(async (req, res) => {
        const user = requireUser(req);
        const body = await readJson(req);
        await auth.deleteAccount(user, body, getIP(req));
        logger.info(`(auth) ${getIP(req)} deleted account "${user.name}"`);
        // let the rest of the server tidy up what belonged to this account (the browsing session)
        try { await onAccountDeleted(user, body); } catch (e) { logger.warn('(auth) cleanup after account deletion failed: ' + e.message); }
        send(res, 200, { ok: true });
    }));
    proxyServer.POST('/api/auth/signout-everywhere', wrap(async (req, res) => {
        const user = requireUser(req);
        await auth.signOutEverywhere(user);
        send(res, 200, { ok: true });
    }));

    return { requireUser };
};
module.exports.readJson = readJson;
