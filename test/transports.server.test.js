// A running server with a test engine and transport plug-ins: what is offered, what is refused, and what is served.
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { testEngineDir } = require('./helpers/engine');
const makeTestTransport = require('./fixtures/makeTestTransport');

const servers = [];
async function start(port, { engine, plugins = [], env = {} }) {
    const tdir = fs.mkdtempSync(path.join(os.tmpdir(), 'rhts-'));
    for (const p of plugins) makeTestTransport(tdir, p);
    const child = spawn('node', ['src/server.js'], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, RAMMERHEAD_PORT: String(port), RAMMERHEAD_WORKERS: '0', RAMMERHEAD_ENGINE_DIR: engine, RAMMERHEAD_TRANSPORTS_DIR: tdir, RAMMERHEAD_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'rhd-')), ...env }
    });
    servers.push(child);
    const base = `http://localhost:${port}`;
    for (let i = 0; i < 60; i++) {
        try { if ((await fetch(base + '/api/engine/status')).ok) break; } catch (e) { /* wait */ }
        await new Promise((r) => setTimeout(r, 250));
    }
    const reg = await (await fetch(base + '/api/auth/register', { method: 'POST', body: JSON.stringify({ username: 'tr' + port, password: 'violet lantern harbor' }) })).json();
    const H = { Authorization: 'Bearer ' + reg.token };
    const id = await (await fetch(base + '/newsession', { headers: H })).text();
    return { base, H, id, get: (u, h = H) => fetch(base + u, { headers: h }) };
}
test.after(() => servers.forEach((s) => s.kill()));

const ENGINE = () => testEngineDir({ transports: ['node', 'libcurl', 'epoxy', 'bare', 'broken-one'], transportTest: true, failingTransports: ['epoxy'] });
const PLUGINS = [
    { id: 'libcurl', server: true, testOk: true },
    { id: 'epoxy', engines: ['some-other-engine'], server: true },
    { id: 'broken-one', throwOnLoad: true },
    { id: 'unwanted' } // installed, but the engine never lists it
];

test('status: visitors get the bare minimum; signed-in users see what is usable and why the rest is not', async () => {
    const s = await start(18330, { engine: ENGINE(), plugins: PLUGINS });
    const anon = await (await fetch(s.base + '/api/engine/status')).json();
    assert.deepStrictEqual(Object.keys(anon).sort(), ['app', 'status']);
    assert.deepStrictEqual(anon.app, { name: 'Rammerhead Stream', creator: 'BlackJ' });

    const st = await (await s.get('/api/engine/status')).json();
    assert.deepStrictEqual(st.transports.available.map((t) => t.id), ['http', 'libcurl']);
    assert.ok(st.transports.available.every((t) => t.canTest));
    const why = Object.fromEntries(st.transports.installed.map((t) => [t.id, t.reason]));
    assert.deepStrictEqual(why, { 'broken-one': 'not-loaded', epoxy: 'incompatible-engine', libcurl: null, unwanted: 'engine-does-not-declare' });
    assert.match(st.transports.installed.find((t) => t.id === 'epoxy').explanation, /not made for the installed engine/);
    assert.deepStrictEqual(st.transports.addable.map((a) => a.id), ['bare'], 'bare is not installed, so it can be added');
});

test('choosing a transport: usable ones are accepted and reach the engine; everything else is refused', async () => {
    const s = await start(18335, { engine: ENGINE(), plugins: PLUGINS });
    const edit = async (t) => { const r = await s.get(`/editsession?id=${s.id}&transport=${encodeURIComponent(t)}`); return { status: r.status, text: await r.text() }; };
    assert.strictEqual((await edit('libcurl')).status, 200);
    const proxied = await fetch(`${s.base}/${s.id}/https://example.com/x`);
    assert.strictEqual(proxied.headers.get('x-test-transport'), 'libcurl', 'the engine received the choice');
    assert.strictEqual((await edit('LibCurl')).status, 200, 'case does not matter');
    assert.strictEqual((await edit('node')).status, 200, 'the old name of the built-in method still works');
    for (const refused of ['epoxy', 'eproxy', 'bare', 'unwanted', 'broken-one', 'nothing-like-it', '../etc/passwd']) {
        const r = await edit(refused);
        assert.strictEqual(r.status, 400, refused + ' must be refused');
        assert.match(r.text, /cannot be used with the installed engine/);
    }
    // no transport named at all is fine
    assert.strictEqual((await s.get(`/editsession?id=${s.id}`)).status, 200);
});

test("a transport's files are served, but nothing else in its folder; its own server part works", async () => {
    const s = await start(18340, { engine: ENGINE(), plugins: PLUGINS });
    const ok = await fetch(s.base + '/transports/libcurl/index.mjs');
    assert.strictEqual(ok.status, 200);
    assert.match(ok.headers.get('content-type'), /javascript/);
    assert.match(await ok.text(), /export const id = "libcurl"/);
    for (const hidden of ['/transports/libcurl/_private.txt', '/transports/libcurl/.hidden', '/transports/libcurl/secret.txt', '/transports/libcurl/manifest.json', '/transports/libcurl/../manifest.json', '/transports/libcurl/index.js']) {
        assert.notStrictEqual((await fetch(s.base + hidden)).status, 200, hidden + ' must not be served');
    }
    assert.strictEqual(await (await fetch(s.base + '/transports/libcurl/ping')).text(), 'pong from libcurl');
    // the plug-in that crashed on load did not take anything else down, and its files are not published
    assert.notStrictEqual((await fetch(s.base + '/transports/broken-one/index.mjs')).status, 200);
});

test('Test button: a plug-in checks itself, otherwise the engine does; unusable ones are refused; unknowable ones say so', async () => {
    const s = await start(18345, { engine: testEngineDir({ transports: ['http', 'libcurl', 'epoxy'], transportTest: true, failingTransports: ['http'] }), plugins: [{ id: 'libcurl', server: true, testOk: true }, { id: 'epoxy', server: true, testOk: false }] });
    const t = async (id) => { const r = await s.get('/api/transport/test?transport=' + id); return { status: r.status, body: await r.json() }; };
    assert.deepStrictEqual((await t('libcurl')).body.ok, true);
    const bad = await t('epoxy');
    assert.strictEqual(bad.body.ok, false);
    assert.match(bad.body.error, /plug-in check failed/);
    const viaEngine = await t('http'); // no plug-in for the built-in method: the engine answers
    assert.strictEqual(viaEngine.body.ok, false);
    assert.match(viaEngine.body.error, /simulated failure of http/);
    assert.strictEqual((await t('bare')).status, 400);

    const noTest = await start(18350, { engine: testEngineDir({ transports: ['http'] }), plugins: [] });
    const r = await noTest.get('/api/transport/test?transport=http');
    assert.strictEqual(r.status, 501);
    assert.strictEqual((await fetch(noTest.base + '/api/transport/test?transport=http')).status, 403, 'sign-in is required');
});

test('the administrator can narrow what users may choose', async () => {
    const s = await start(18355, { engine: ENGINE(), plugins: PLUGINS, env: { RAMMERHEAD_TRANSPORTS_ALLOWED: 'http' } });
    const st = await (await s.get('/api/engine/status')).json();
    assert.deepStrictEqual(st.transports.available.map((t) => t.id), ['http']);
    assert.strictEqual(st.transports.installed.find((t) => t.id === 'libcurl').reason, 'blocked');
    assert.strictEqual((await s.get(`/editsession?id=${s.id}&transport=libcurl`)).status, 400);
});

test('no transports folder at all is fine, and without an engine only the built-in method is described', async () => {
    const s = await start(18360, { engine: fs.mkdtempSync(path.join(os.tmpdir(), 'rhnone-')), plugins: [], env: { RAMMERHEAD_TRANSPORTS_DIR: '/nonexistent/path' } });
    const st = await (await s.get('/api/engine/status')).json();
    assert.strictEqual(st.status, 'missing');
    assert.strictEqual(st.transports.available.length, 1);
    assert.strictEqual(st.transports.available[0].id, 'http');
    assert.deepStrictEqual(st.transports.installed, []);
});
