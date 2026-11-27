const http = require('http');
const https = require('https');

/**
 * Minimal HTTP host used only while no engine is available, so the interface, sign-in and the
 * "engine unavailable" explanation keep working. Implements the same GET/POST surface the core uses on an engine.
 */
class FallbackHttp {
    constructor({ ssl, bindingAddress, port }) {
        this.routes = new Map();
        this.pipeline = [];
        const handler = (req, res) => this._handle(req, res);
        this.server = ssl ? https.createServer(ssl, handler) : http.createServer(handler);
        this.bindingAddress = bindingAddress;
        this.port = port;
        this.servers = [this.server];
    }
    _add(method, route, handler) {
        this.routes.set(method + ' ' + route, handler);
    }
    GET(route, handler) { this._add('GET', route, handler); }
    POST(route, handler) { this._add('POST', route, handler); }
    addToOnRequestPipeline(fn) { this.pipeline.push(fn); }
    addToOnUpgradePipeline() {}
    listen() {
        this.server.listen(this.port, this.bindingAddress);
    }
    close() {
        this.server.close();
    }
    _handle(req, res) {
        const pathname = new URL(req.url, 'http://x').pathname;
        const handler = this.routes.get(req.method + ' ' + pathname) || (req.method === 'HEAD' && this.routes.get('GET ' + pathname));
        for (const fn of this.pipeline) fn(req, res, {}, !!handler);
        if (!handler) {
            res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
            return res.end('The browsing engine is unavailable. See the status banner on the home page.');
        }
        if (typeof handler === 'function') return handler(req, res);
        res.writeHead(200, { 'Content-Type': handler.contentType || 'application/octet-stream', 'Cache-Control': 'no-cache' });
        res.end(handler.content);
    }
}

module.exports = FallbackHttp;
