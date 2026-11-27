const test = require('node:test');
const assert = require('node:assert');
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const makeTestEngine = require('./fixtures/makeTestEngine');
const { needsRealEngine } = require('./helpers/engine');
const { readManifest, nodeRangeOk } = require('../src/engine/manifest');
const { validateEngine } = require('../src/engine/contract');

const root = path.join(__dirname, '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rhe-'));

function hashTree(dir) {
    const h = crypto.createHash('sha256');
    (function walk(d) {
        for (const f of fs.readdirSync(d).sort()) {
            const p = path.join(d, f);
            if (fs.statSync(p).isDirectory()) walk(p); else h.update(f).update(fs.readFileSync(p));
        }
    })(dir);
    return h.digest('hex');
}
const cli = (engineDir, ...args) => spawnSync('node', ['scripts/engine.js', ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, RAMMERHEAD_ENGINE_DIR: engineDir } });

// ---- manifest + contract unit tests ----
test('manifest validation reports every problem and refuses unsupported contracts', () => {
    const d = tmp();
    assert.strictEqual(readManifest(d).code, 'missing');
    fs.writeFileSync(path.join(d, 'manifest.json'), '{nope');
    assert.strictEqual(readManifest(d).code, 'invalid-manifest');
    fs.writeFileSync(path.join(d, 'manifest.json'), JSON.stringify({ contract: 'x', id: 'Bad Id', version: '1', entry: '../evil.js' }));
    const bad = readManifest(d);
    assert.strictEqual(bad.code, 'invalid-manifest');
    assert.ok(bad.errors.length >= 4, bad.errors.join('|'));
    const d2 = makeTestEngine(tmp(), { name: 'Future', contract: 2 });
    const r = readManifest(d2);
    assert.strictEqual(r.code, 'incompatible');
    assert.match(r.errors[0], /contract v2/);
    assert.strictEqual(readManifest(makeTestEngine(tmp(), { name: 'Ok' })).ok, true);
    assert.ok(readManifest(makeTestEngine(tmp(), { name: 'N', extraManifest: { node: '>=99' } })).errors[0].match(/needs Node/));
});
test('manifest entry cannot escape the engine folder', () => {
    const d = makeTestEngine(tmp(), { name: 'Esc', extraManifest: { entry: '../../etc/passwd' } });
    const r = readManifest(d);
    assert.strictEqual(r.ok, false);
    assert.match(r.errors.join(' '), /inside the engine folder/);
});
test('node range check', () => {
    assert.ok(nodeRangeOk('>=16', '22.1.0'));
    assert.ok(!nodeRangeOk('>=23', '22.1.0'));
    assert.ok(nodeRangeOk('*', '1.0.0'));
    assert.ok(!nodeRangeOk('garbage', '22.0.0'));
});
test('contract shape check names what is missing', () => {
    assert.ok(validateEngine(null).length);
    const errs = validateEngine({ info: { id: 'a', version: '1' }, http: { servers: [] }, sessions: {} });
    assert.ok(errs.some((e) => /sessions\.create/.test(e)));
    assert.ok(errs.some((e) => /servers/.test(e)));
});

// ---- running server against swappable engines ----
const PORT = 18140;
const base = `http://127.0.0.1:${PORT}`;
let child;
async function start(engineDir) {
    child = spawn('node', ['src/server.js'], {
        cwd: root,
        env: { ...process.env, RAMMERHEAD_PORT: String(PORT), RAMMERHEAD_WORKERS: '0', RAMMERHEAD_ENGINE_DIR: engineDir, RAMMERHEAD_DATA_DIR: tmp() }
    });
    let log = '';
    child.stdout.on('data', (d) => (log += d)); child.stderr.on('data', (d) => (log += d));
    for (let i = 0; i < 60; i++) {
        try { if ((await fetch(base + '/api/engine/status')).ok) return () => log; } catch (e) { /* wait */ }
        await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('server did not start. log:\n' + log);
}
const stop = async () => { if (child) { child.kill(); await new Promise((r) => child.on('exit', r)); child = null; } };
// engine details are only given to signed-in users, so sign in with a throwaway account first
async function authedHeaders() {
    const reg = await (await fetch(base + '/api/auth/register', { method: 'POST', body: JSON.stringify({ username: 'st' + Math.random().toString(36).slice(2, 8), password: 'violet lantern harbor' }) })).json();
    return { Authorization: 'Bearer ' + reg.token };
}
const status = async () => (await fetch(base + '/api/engine/status', { headers: await authedHeaders() })).json();
async function useSession() {
    const reg = await (await fetch(base + '/api/auth/register', { method: 'POST', body: JSON.stringify({ username: 'swap' + Math.random().toString(36).slice(2, 8), password: 'violet lantern harbor' }) })).json();
    const H = { Authorization: 'Bearer ' + reg.token };
    const id = await (await fetch(base + '/newsession', { headers: H })).text();
    const edit = await (await fetch(`${base}/editsession?id=${id}&enableShuffling=0`, { headers: H })).text();
    const proxied = await (await fetch(`${base}/${id}/https://example.com/x`)).text();
    return { id, edit, proxied };
}

test('ACCEPTANCE: swap engine A for engine B through the installer; the interface files never change; roll back works', async (t) => {
    const engineDir = tmp();
    makeTestEngine(engineDir, { name: 'Alpha', version: '1.0.0' });
    const uiBefore = hashTree(path.join(root, 'public'));
    t.after(stop);

    await start(engineDir);
    let s = await status();
    assert.strictEqual(s.status, 'ready');
    assert.strictEqual(s.engine.id, 'test-engine-alpha');
    assert.strictEqual(s.app.creator, 'BlackJ');
    let r = await useSession();
    assert.strictEqual(r.edit, 'Success');
    assert.strictEqual(r.proxied, 'Alpha handled https://example.com/x');
    await stop();

    // the maintainer workflow: stop, install the new engine (the old one is backed up), start
    const incoming = makeTestEngine(tmp(), { name: 'Bravo', version: '2.3.0' });
    const inst = cli(engineDir, 'install', incoming);
    assert.strictEqual(inst.status, 0, inst.stderr + inst.stdout);
    assert.match(inst.stdout, /backed up the current engine/);
    assert.ok(fs.existsSync(engineDir), 'the engine folder itself is kept');
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(engineDir, 'manifest.json'))).version, '2.3.0');
    const backups = path.join(path.dirname(engineDir), '_backups');
    assert.ok(fs.readdirSync(backups).some((b) => /alpha-1\.0\.0/.test(b)));

    await start(engineDir);
    s = await status();
    assert.strictEqual(s.engine.id, 'test-engine-bravo');
    assert.strictEqual(s.engine.version, '2.3.0');
    r = await useSession();
    assert.strictEqual(r.proxied, 'Bravo handled https://example.com/x');
    await stop();

    // roll back
    const rb = cli(engineDir, 'rollback');
    assert.strictEqual(rb.status, 0, rb.stderr + rb.stdout);
    await start(engineDir);
    assert.strictEqual((await status()).engine.id, 'test-engine-alpha');
    await stop();

    assert.strictEqual(hashTree(path.join(root, 'public')), uiBefore, 'the interface files must not change when the engine changes');
});

test('the installer refuses invalid engines and leaves the current engine alone', () => {
    const engineDir = makeTestEngine(tmp(), { name: 'Keep' });
    const before = hashTree(engineDir);
    const bad = makeTestEngine(tmp(), { name: 'Future', contract: 9 });
    const r = cli(engineDir, 'install', bad);
    assert.notStrictEqual(r.status, 0);
    assert.strictEqual(hashTree(engineDir), before);
    // symlinks are refused
    const withLink = makeTestEngine(tmp(), { name: 'Link' });
    fs.symlinkSync('/etc/passwd', path.join(withLink, 'sneaky'));
    const r2 = cli(engineDir, 'install', withLink);
    assert.notStrictEqual(r2.status, 0);
    assert.match(r2.stderr, /symlink/);
    assert.strictEqual(hashTree(engineDir), before);
});

test('a missing, incompatible, broken or incomplete engine never takes the interface down', async (t) => {
    t.after(stop);
    const cases = [
        ['missing', fs.mkdtempSync(path.join(os.tmpdir(), 'rhe-empty-')), 'missing'],
        ['incompatible contract', makeTestEngine(tmp(), { name: 'Future', contract: 2 }), 'incompatible'],
        ['entry throws', makeTestEngine(tmp(), { name: 'Broken', brokenEntry: true }), 'failed'],
        ['no create()', makeTestEngine(tmp(), { name: 'NoCreate', noCreate: true }), 'invalid-manifest']
    ];
    for (const [label, dir, expected] of cases) {
        const getLog = await start(dir);
        const s = await status();
        assert.strictEqual(s.status, expected, label + ': ' + JSON.stringify(s));
        assert.ok(s.message && s.message.length > 10, label + ' should explain what is wrong');
        const page = await fetch(base + '/');
        assert.strictEqual(page.status, 200, label + ': the interface must still load');
        assert.match(await page.text(), /Rammerhead Stream/);
        const reg = await (await fetch(base + '/api/auth/register', { method: 'POST', body: JSON.stringify({ username: 'user' + label.length, password: 'violet lantern harbor' }) })).json();
        assert.ok(reg.token, label + ': accounts still work');
        const ns = await fetch(base + '/newsession', { headers: { Authorization: 'Bearer ' + reg.token } });
        assert.strictEqual(ns.status, 503, label + ': sessions report the engine is unavailable');
        assert.match(getLog(), /\(engine\) NOT available/);
        await stop();
    }
});

test('engine management CLI: an empty folder is reported clearly', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'rhe-empty-'));
    const st = cli(empty, 'status');
    assert.strictEqual(st.status, 1);
    assert.match(st.stdout, /NO ENGINE INSTALLED/);
});

test('engine management CLI: validate a test engine (contract shape, health, session round trip)', () => {
    const dir = makeTestEngine(tmp(), { name: 'Cli' });
    const v = cli(dir, 'validate');
    assert.strictEqual(v.status, 0, v.stdout + v.stderr);
    assert.match(v.stdout, /VALIDATION PASSED/);
});

test('engine management CLI: validate the installed engine', needsRealEngine(), () => {
    const v = spawnSync('node', ['scripts/engine.js', 'validate'], { cwd: root, encoding: 'utf8', timeout: 60000 });
    assert.strictEqual(v.status, 0, v.stdout + v.stderr);
    assert.match(v.stdout, /VALIDATION PASSED/);
});
