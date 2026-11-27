// Multi-process mode (load-balanced workers): this sandbox has 1 CPU, so the default run never exercised it.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { needsRealEngine, hasRealEngine } = require('./helpers/engine');

const PORT = 18170;
const base = `http://localhost:${PORT}`;
let origin, child, log = '';

test.before(async () => {
    if (!hasRealEngine()) return; // these tests need a real engine; they are skipped without one
    origin = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><html><head><title>Worker Origin</title></head><body><script>var x = location.href;</script></body></html>');
    }).listen(19997, '127.0.0.1');
    child = spawn('node', ['src/server.js'], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, RAMMERHEAD_PORT: String(PORT), RAMMERHEAD_WORKERS: '3', RAMMERHEAD_ALLOW_PRIVATE: '1', RAMMERHEAD_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'rhw-')) }
    });
    child.stdout.on('data', (d) => (log += d));
    child.stderr.on('data', (d) => (log += d));
    for (let i = 0; i < 80; i++) {
        try { if ((await fetch(base + '/api/engine/status')).ok) return; } catch (e) { /* wait */ }
        await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('server did not start. log:\n' + log);
});
test.after(() => { child && child.kill(); origin && origin.close(); });

test('3 worker processes serve accounts, sessions, and proxied pages consistently', needsRealEngine(), async () => {
    assert.match(log, /load balancer is listening|Worker \d+ is running/, 'workers must be running');
    // many requests: every one must succeed no matter which worker it lands on
    const reg = await (await fetch(base + '/api/auth/register', { method: 'POST', body: JSON.stringify({ username: 'wrk', password: 'violet lantern harbor' }) })).json();
    assert.ok(reg.token);
    const H = { Authorization: 'Bearer ' + reg.token };
    for (let i = 0; i < 12; i++) {
        const me = await (await fetch(base + '/api/auth/status', { headers: H })).json();
        assert.strictEqual(me.username, 'wrk', 'a token must verify on every worker');
    }
    const id = await (await fetch(base + '/newsession', { headers: H })).text();
    assert.strictEqual(await (await fetch(`${base}/editsession?id=${id}&enableShuffling=0`, { headers: H })).text(), 'Success');
    for (let i = 0; i < 6; i++) {
        const page = await fetch(`${base}/${id}/http://127.0.0.1:19997/`, { headers: { Accept: 'text/html', 'Sec-Fetch-Dest': 'document' } });
        assert.strictEqual(page.status, 200);
        assert.match(await page.text(), /Worker Origin/);
    }
    assert.strictEqual(await (await fetch(`${base}/sessionexists?id=${id}`, { headers: H })).text(), 'exists');
});
