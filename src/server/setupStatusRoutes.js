const packageJson = require('../../package.json');
const { TRANSPORTS, describeTransports } = require('../engine/transports');

/**
 * Engine status for the interface.
 *  - anyone gets the bare minimum (is it usable, and the product name);
 *  - signed-in users also get engine details, capabilities and the explanation of a failure.
 * Failure messages can contain file paths, so they are never given to anonymous visitors.
 */
module.exports = function setupStatusRoutes(http, getLoaded, config, auth, transports) {
    http.GET('/api/engine/status', (req, res) => {
        const l = getLoaded();
        const user = auth && auth.authenticate(req);
        const body = { status: l.status, app: { name: config.site.name, creator: 'BlackJ' } };
        if (user) {
            const caps = (l.manifest && l.manifest.capabilities) || {};
            body.app.version = packageJson.version;
            body.engine = l.manifest ? { id: l.manifest.id, name: l.manifest.name, version: l.manifest.version, capabilities: caps } : null;
            body.message = l.status === 'ready' ? null : (l.errors || []).join(' ') + (l.hint ? ' ' + l.hint : '');
            // engine health, reduced to plain numbers, short strings and booleans (an engine could return anything)
            const loadedEngine = l.status === 'ready' ? l.engine : null;
            if (loadedEngine) {
                let h;
                try { h = loadedEngine.health() || {}; } catch (e) { h = { ok: false }; }
                const details = {};
                for (const [k, v] of Object.entries(h.details || {}).slice(0, 20)) {
                    if (/^[\w.-]{1,40}$/.test(k) && (typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string' && v.length <= 80))) details[k] = v;
                }
                body.health = { ok: h.ok === true, details };
            }
            body.transports = describeTransports({ caps, engineId: l.manifest && l.manifest.id, registry: transports, config: config.transport });
            body.frontedBy = (config.network.trustProxy || []).length ? 'reverse proxy' : 'direct';
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
        res.end(JSON.stringify(body));
    });
};
module.exports.TRANSPORTS = TRANSPORTS;
