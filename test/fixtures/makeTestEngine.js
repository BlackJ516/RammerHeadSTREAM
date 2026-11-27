// Builds a minimal TEST-ONLY engine folder that implements engine contract v1.
// It does not browse the web: it answers "<NAME> handled <url>" so tests can tell which engine served a request.
// It exists to prove that engines are interchangeable. It is never installed in a real deployment.
const fs = require('fs');
const path = require('path');

module.exports = function makeTestEngine(dir, { name, version = '1.0.0', contract = 1, brokenEntry = false, noCreate = false, transports, transportTest = false, failingTransports = [], extraManifest = {} }) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
        contract, id: 'test-engine-' + name.toLowerCase(), name: `TEST ENGINE ${name} (not for production)`, version,
        author: 'test fixture', entry: 'index.js', node: '>=16',
        capabilities: { http: true, ...(transports ? { transports } : {}), ...(transportTest ? { transportTest: true } : {}) }, ...extraManifest
    }, null, 2));
    const code = brokenEntry ? "throw new Error('boom while loading');" : noCreate ? 'module.exports = {};' : `
const http = require('http');
exports.create = async function (host) {
    const NAME = ${JSON.stringify(name)};
    const FAILING = ${JSON.stringify(failingTransports)};
    const sessions = new Map();
    const routes = new Map();
    const pipeline = [];
    const server = http.createServer((req, res) => {
        const pathname = new URL(req.url, 'http://x').pathname;
        const handler = routes.get(req.method + ' ' + pathname);
        // a conforming engine runs the host's request hooks before anything else; a hook returning true has answered the request
        for (const fn of pipeline) { if (fn(req, res, {}, !!handler) === true) return; }
        if (handler) {
            if (typeof handler === 'function') return handler(req, res);
            res.writeHead(200, { 'Content-Type': handler.contentType || 'text/plain' });
            return res.end(handler.content);
        }
        const m = req.url.match(/^\\/([a-z0-9]{32})\\/(.+)$/i);
        if (m && sessions.has(m[1])) {
            const reason = host.guard.checkDestination(host.guard.parseDestination(req.url));
            if (reason) { res.writeHead(403); return res.end('refused: ' + reason); }
            res.writeHead(200, { 'Content-Type': 'text/plain', 'X-Test-Transport': String((sessions.get(m[1]).cfg || {}).transport || '') });
            return res.end(NAME + ' handled ' + m[2]);
        }
        res.writeHead(404); res.end('not found');
    });
    if (!host.config.enableWorkers) server.listen(host.config.port, host.config.bindingAddress);
    let n = 0;
    return {
        info: { id: 'test-engine-' + NAME.toLowerCase(), name: 'TEST ENGINE ' + NAME, version: ${JSON.stringify(version)} },
        http: {
            GET: (r, h) => routes.set('GET ' + r, h), POST: (r, h) => routes.set('POST ' + r, h),
            addToOnRequestPipeline: (fn) => pipeline.push(fn), addToOnUpgradePipeline() {}, servers: [server]
        },
        sessions: {
            create: ({ owner }) => { const id = String(++n).padStart(32, '0'); sessions.set(id, { owner, shuffle: null }); return id; },
            exists: (id) => sessions.has(id),
            ownerOf: (id) => (sessions.get(id) || {}).owner || null,
            configure: async (id, o) => { sessions.get(id).cfg = o; },
            remove: (id) => sessions.delete(id),
            shuffleDict: () => null
        },
        sessionIdFromUrl: (u) => { const m = u.match(/^\\/([a-z0-9]{32})\\//i); return m ? m[1] : null; },
        ${transportTest ? "transports: { test: async (id) => (FAILING.includes(id) ? { ok: false, error: 'simulated failure of ' + id } : { ok: true }) }," : ''}
        health: () => ({ ok: true }),
        close: () => server.close()
    };
};`;
    fs.writeFileSync(path.join(dir, 'index.js'), code);
    return dir;
};
