// End to end through the real engine: a page and a script from a local site are fetched through the proxy
// with a JavaScript-parser session and a WASM-parser session.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { needsRealEngine, hasRealEngine } = require('./helpers/engine');

const PORT = 18160;
const base = `http://localhost:${PORT}`;
const SCRIPT = '/* héllo ✓ */ var h = location.href; var o = {}; o[k] = window[n]; a?.[b].c; document.cookie = "x=\\u00e9";';
let origin, child;

test.before(async () => {
    if (!hasRealEngine()) return; // these tests need a real engine; they are skipped without one
    origin = http.createServer((req, res) => {
        if (req.url === '/app.js') { res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' }); return res.end(SCRIPT); }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><html><head><title>Origin Page</title></head><body><h1>Hello</h1><script src="/app.js"></script><script>var x = location.href;</script></body></html>');
    }).listen(19998, '127.0.0.1');
    child = spawn('node', ['src/server.js'], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, RAMMERHEAD_PORT: String(PORT), RAMMERHEAD_WORKERS: '0', RAMMERHEAD_ALLOW_PRIVATE: '1', RAMMERHEAD_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'rhp-')) }
    });
    for (let i = 0; i < 60; i++) {
        try { if ((await fetch(base + '/api/engine/status')).ok) return; } catch (e) { /* wait */ }
        await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('server did not start');
});
test.after(() => { child && child.kill(); origin && origin.close(); });

const counters = async (token) => {
    const st = await (await fetch(base + '/api/engine/status', { headers: { Authorization: 'Bearer ' + token } })).json();
    return st.health.details;
};

async function session(token, parser) {
    const H = { Authorization: 'Bearer ' + token };
    const id = await (await fetch(base + '/newsession', { headers: H })).text();
    assert.strictEqual(await (await fetch(`${base}/editsession?id=${id}&enableShuffling=0&scriptEngine=${parser}`, { headers: H })).text(), 'Success');
    return id;
}

test('the proxy loads a real page and rewrites its scripts identically with the JS and WASM parsers', needsRealEngine(), async () => {
    const reg = await (await fetch(base + '/api/auth/register', { method: 'POST', body: JSON.stringify({ username: 'e2e', password: 'violet lantern harbor' }) })).json();
    const results = {};
    const seen = {};
    for (const parser of ['js', 'wasm']) {
        const before = (await counters(reg.token)).scriptsParsedByWasm;
        const id = await session(reg.token, parser);
        const pageUrl = `${base}/${id}/http://127.0.0.1:19998/`;
        const page = await fetch(pageUrl, { headers: { Accept: 'text/html,application/xhtml+xml', 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate' } });
        assert.strictEqual(page.status, 200, parser + ' page status');
        const html = await page.text();
        assert.match(html, /Origin Page/);
        assert.match(html, /Hello/);
        assert.match(html, /hammerhead|rammerhead/i, 'the proxy must inject its client scripts');
        const js = await fetch(`${base}/${id}/http://127.0.0.1:19998/app.js`, { headers: { Accept: '*/*', 'Sec-Fetch-Dest': 'script', Referer: pageUrl } });
        assert.strictEqual(js.status, 200);
        const body = await js.text();
        assert.match(body, /__get\$/, parser + ': the script must really be rewritten');
        results[parser] = body;
        seen[parser] = (await counters(reg.token)).scriptsParsedByWasm - before;
    }
    // the identical output above could come from the JavaScript fallback, so prove which parser really ran
    assert.strictEqual(seen.js, 0, 'a JavaScript session must never touch the WebAssembly parser');
    assert.ok(seen.wasm >= 1, 'a WebAssembly session must really parse scripts with WebAssembly (it parsed ' + seen.wasm + ')');
    assert.strictEqual((await counters(reg.token)).wasmAvailable, true);
    assert.strictEqual(results.wasm, results.js, 'WASM and JS sessions must receive byte-identical scripts');
});
