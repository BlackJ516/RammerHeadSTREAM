const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const guard = require('../src/util/destinationGuard');
const StrShuffler = require('./helpers/shuffler');
const { needsRealEngine } = require('./helpers/engine');

test('address classification', () => {
    for (const ip of ['127.0.0.1', '127.1.2.3', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '0.0.0.0',
        '100.64.0.1', '224.0.0.1', '255.255.255.255', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '2002:7f00:1::1', 'garbage']) {
        assert.ok(guard.isBlockedAddress(ip), ip + ' should be blocked');
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
        assert.ok(!guard.isBlockedAddress(ip), ip + ' should be allowed');
    }
});

test('destination checks', () => {
    const d = (u) => guard.checkDestination(guard.parseDestination('/' + 'a'.repeat(32) + '/' + u));
    assert.ok(d('file:///etc/passwd'));
    assert.ok(d('ftp://example.com/'));
    assert.ok(d('javascript:alert(1)'));
    assert.ok(d('http://127.0.0.1/'));
    assert.ok(d('http://[::1]:8080/'));
    assert.ok(d('http://[::ffff:127.0.0.1]/'));
    assert.ok(d('http://localhost/'));
    assert.ok(d('http://example.com:25/'));
    assert.ok(d('ws://127.0.0.1/'));
    assert.ok(d('not a url'));
    assert.strictEqual(d('https://example.com/path?q=1'), null);
    assert.strictEqual(d('wss://example.com/socket'), null);
    assert.strictEqual(d('http://example.com:8080/'), null);
});

test('connect-time lookup refuses names that resolve to loopback (DNS rebinding defence)', async () => {
    const lookup = guard.makeSafeLookup();
    const err = await new Promise((resolve) => lookup('localhost', {}, (e) => resolve(e)));
    assert.ok(err && err.code === 'ENOTFOUND');
    const ok = await new Promise((resolve) => guard.makeSafeLookup()('example.com', {}, (e, a) => resolve(e || a))).catch((e) => e);
    // example.com may not resolve in a sandbox; what matters is that it is not refused as "blocked"
    assert.ok(!(ok instanceof Error) || !/blocked destination/.test(ok.message));
});

// ---- end to end ----
const PORT = 18120;
const base = `http://localhost:${PORT}`;
let internal, child;
async function startServer(extraEnv) {
    child = spawn('node', ['src/server.js'], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, RAMMERHEAD_PORT: String(PORT), RAMMERHEAD_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'rhg-')), ...extraEnv }
    });
    for (let i = 0; i < 60; i++) {
        try { if ((await fetch(base + '/api/auth/status')).ok) return; } catch (e) { /* wait */ }
        await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('server did not start');
}
async function session(shuffle) {
    const reg = await (await fetch(base + '/api/auth/register', { method: 'POST', body: JSON.stringify({ username: 'gtest', password: 'violet lantern harbor' }) })).json();
    const H = { Authorization: 'Bearer ' + reg.token };
    const id = await (await fetch(base + '/newsession', { headers: H })).text();
    await fetch(`${base}/editsession?id=${id}&enableShuffling=${shuffle ? 1 : 0}`, { headers: H });
    const dict = shuffle ? JSON.parse(await (await fetch(`${base}/api/session/shuffle-dict?id=${id}`, { headers: H })).text()) : null;
    return (url) => `${base}/${id}/${dict ? new StrShuffler(dict).shuffle(url) : url}`;
}
const get = async (u) => { const r = await fetch(u, { redirect: 'manual' }); return { status: r.status, body: await r.text() }; };

test('end to end: loopback services and local files are unreachable by default', needsRealEngine(), async (t) => {
    internal = http.createServer((q, r) => r.end('INTERNAL-SECRET-OK')).listen(19999, '127.0.0.1');
    await startServer({});
    t.after(() => { child.kill(); internal.close(); });
    for (const shuffle of [false, true]) {
        const url = await session(shuffle).catch(async () => { // second registration of same user fails; log in instead
            const l = await (await fetch(base + '/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'gtest', password: 'violet lantern harbor' }) })).json();
            const H = { Authorization: 'Bearer ' + l.token };
            const id = await (await fetch(base + '/newsession', { headers: H })).text();
            await fetch(`${base}/editsession?id=${id}&enableShuffling=${shuffle ? 1 : 0}`, { headers: H });
            const dict = shuffle ? JSON.parse(await (await fetch(`${base}/api/session/shuffle-dict?id=${id}`, { headers: H })).text()) : null;
            return (u) => `${base}/${id}/${dict ? new StrShuffler(dict).shuffle(u) : u}`;
        });
        for (const target of ['http://127.0.0.1:19999/', 'http://localhost:19999/', 'http://[::ffff:127.0.0.1]:19999/', 'http://2130706433:19999/', 'http://0x7f.1:19999/', 'file:///etc/hostname', 'http://example.com:25/']) {
            const r = await get(url(target));
            assert.ok(!r.body.includes('INTERNAL-SECRET-OK'), `shuffle=${shuffle} ${target} leaked internal content`);
            assert.ok(!/^vm\s*$/.test(r.body.trim()) && r.status !== 200, `shuffle=${shuffle} ${target} returned 200`);
        }
        assert.strictEqual((await get(url('file:///etc/hostname'))).status, 403);
        assert.strictEqual((await get(url('http://127.0.0.1:19999/'))).status, 403);
    }
});

test('control: with allowPrivateDestinations the same internal service IS reachable (so the block above is the guard)', needsRealEngine(), async (t) => {
    internal = http.createServer((q, r) => r.end('INTERNAL-SECRET-OK')).listen(19999, '127.0.0.1');
    await startServer({ RAMMERHEAD_ALLOW_PRIVATE: '1' });
    t.after(() => { child.kill(); internal.close(); });
    const url = await session(false);
    const r = await get(url('http://127.0.0.1:19999/'));
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.includes('INTERNAL-SECRET-OK'));
});
