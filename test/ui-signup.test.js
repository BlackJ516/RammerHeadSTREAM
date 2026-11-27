// The sign-up screen and the engine guide page, running in jsdom against real servers.
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { testEngineDir } = require('./helpers/engine');
const { JSDOM, VirtualConsole } = require('jsdom');

const servers = [];
async function startServer(port, extraEnv) {
    const child = spawn('node', ['src/server.js'], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, RAMMERHEAD_PORT: String(port), RAMMERHEAD_WORKERS: '0', RAMMERHEAD_ENGINE_DIR: testEngineDir(), RAMMERHEAD_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'rhsu-')), ...extraEnv }
    });
    servers.push(child);
    let log = '';
    child.stdout.on('data', (d) => (log += d));
    for (let i = 0; i < 60; i++) {
        try { if ((await fetch(`http://localhost:${port}/api/engine/status`)).ok) return () => log; } catch (e) { /* wait */ }
        await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('server did not start');
}
const windows = [];
test.after(() => {
    windows.forEach((w) => { try { w.close(); } catch (e) { /* already closed */ } });
    servers.forEach((s) => s.kill());
});

async function waitFor(fn, what, ms = 8000) {
    const end = Date.now() + ms;
    for (;;) {
        const v = fn();
        if (v) return v;
        if (Date.now() > end) throw new Error('timed out waiting for ' + what);
        await new Promise((r) => setTimeout(r, 25));
    }
}
async function open(port, page = '') {
    const vc = new VirtualConsole();
    return JSDOM.fromURL(`http://localhost:${port}/${page}`, {
        runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
        beforeParse(window) { window.fetch = (u, o) => fetch(new URL(u, window.location.href), o); }
    }).then((d) => { windows.push(d.window); return d.window; });
}
const $ = (w, id) => w.document.getElementById(id);
const type = (w, id, v) => { $(w, id).value = v; $(w, id).dispatchEvent(new w.Event('input', { bubbles: true })); };
const submit = (w) => $(w, 'auth-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
const shown = (w, id) => !$(w, id).hidden;

test('open server: sign-up shows what is allowed, checks typos, and creates an account with any characters', async () => {
    await startServer(18201, {});
    const w = await open(18201);
    await waitFor(() => shown(w, 'auth-view'), 'auth view');
    $(w, 'tab-signup').click();

    // helpful wording, a repeat field and a visible character count
    assert.ok(shown(w, 'confirm-row'));
    assert.match($(w, 'auth-pass-hint').textContent, /Any characters work/);
    assert.ok(!shown(w, 'invite-row'), 'no invite box on an open server');
    type(w, 'auth-pass', 'pässwörd 😀 日本語');
    assert.match($(w, 'pw-count').textContent, /14 characters/);

    // show / hide
    assert.strictEqual($(w, 'auth-pass').type, 'password');
    $(w, 'auth-pass-toggle').click();
    assert.strictEqual($(w, 'auth-pass').type, 'text');
    assert.strictEqual($(w, 'auth-pass2').type, 'text');
    assert.strictEqual($(w, 'auth-pass-toggle').getAttribute('aria-pressed'), 'true');
    $(w, 'auth-pass-toggle').click();
    assert.strictEqual($(w, 'auth-pass').type, 'password');

    // a typo in the repeat field is caught and the right field is flagged
    type(w, 'auth-user', 'Black J \u{1F600}');
    type(w, 'auth-pass2', 'pässwörd 😀 日本');
    submit(w);
    await waitFor(() => shown(w, 'auth-error'), 'mismatch message');
    assert.match($(w, 'auth-error').textContent, /do not match/);
    assert.strictEqual($(w, 'auth-pass2').getAttribute('aria-invalid'), 'true');

    // too short: says how many were typed, flags the password
    type(w, 'auth-pass', 'abc');
    type(w, 'auth-pass2', 'abc');
    submit(w);
    assert.match($(w, 'auth-error').textContent, /at least 8 characters \(you entered 3\)/);
    assert.strictEqual($(w, 'auth-pass').getAttribute('aria-invalid'), 'true');

    // the password the user wanted works, with a username full of spaces, capitals and emoji
    type(w, 'auth-pass', 'pässwörd 😀 日本語');
    type(w, 'auth-pass2', 'pässwörd 😀 日本語');
    submit(w);
    await waitFor(() => shown(w, 'app'), 'signed in');
    assert.strictEqual($(w, 'who-name').textContent, 'black j \u{1F600}');
    assert.ok(!Object.values({ ...w.localStorage }).some((v) => v.includes('pässwörd')), 'the password must not be stored in the browser');
    w.close();

    // ... and signing in again with the same characters works
    const w2 = await open(18201);
    await waitFor(() => shown(w2, 'auth-view'), 'auth view again');
    type(w2, 'auth-user', 'BLACK J \u{1F600}');
    type(w2, 'auth-pass', 'pässwörd 😀 日本語');
    submit(w2);
    await waitFor(() => shown(w2, 'app'), 'signed back in');
    w2.close();
});

test('the server can refuse with a specific field and the screen flags it (username taken)', async () => {
    const w = await open(18201);
    await waitFor(() => shown(w, 'auth-view'), 'auth view');
    $(w, 'tab-signup').click();
    type(w, 'auth-user', 'black j \u{1F600}');
    type(w, 'auth-pass', 'a different good password');
    type(w, 'auth-pass2', 'a different good password');
    submit(w);
    await waitFor(() => shown(w, 'auth-error'), 'taken message');
    assert.match($(w, 'auth-error').textContent, /already taken/);
    assert.strictEqual($(w, 'auth-user').getAttribute('aria-invalid'), 'true');
    w.close();
});

test('invite-only server: the sign-up screen explains the invite code and flags it when missing or wrong', async () => {
    const getLog = await startServer(18205, { RAMMERHEAD_REGISTRATION: 'invite' });
    await new Promise((r) => setTimeout(r, 600));
    const w = await open(18205);
    await waitFor(() => shown(w, 'auth-view'), 'auth view');
    $(w, 'tab-signup').click();
    assert.ok(shown(w, 'invite-row'));
    assert.match($(w, 'invite-note').textContent, /invite code/i);

    type(w, 'auth-user', 'newowner');
    type(w, 'auth-pass', 'a perfectly fine password');
    type(w, 'auth-pass2', 'a perfectly fine password');
    submit(w);
    assert.match($(w, 'auth-error').textContent, /invite code/i);
    assert.strictEqual($(w, 'auth-invite').getAttribute('aria-invalid'), 'true');

    type(w, 'auth-invite', 'wrong-code');
    submit(w);
    await waitFor(() => /isn't valid|already been used|expired/.test($(w, 'auth-error').textContent), 'invalid code message');
    assert.strictEqual($(w, 'auth-invite').getAttribute('aria-invalid'), 'true');

    // the first-run code from the server console creates the first account
    const code = getLog().match(/One-time setup code: (\S+)/)[1];
    type(w, 'auth-invite', code);
    submit(w);
    await waitFor(() => shown(w, 'app'), 'signed in with the setup code');
    w.close();
});

test('engine guide page: public, explains the steps, shows live engine status, and is linked from the app', async () => {
    const res = await fetch('http://localhost:18201/engine.html');
    assert.strictEqual(res.status, 200, 'the guide must be reachable without signing in');
    const html = await res.text();
    for (const needle of ['npm run engine -- install', 'npm run engine:setup', 'npm run engine -- validate', 'npm run engine -- rollback', 'engines/active', 'manifest.json', 'invalid-manifest']) {
        assert.ok(html.includes(needle), 'the guide must mention: ' + needle);
    }
    const w = await open(18201, 'engine.html');
    await waitFor(() => /Ready/.test($(w, 'live-status').textContent), 'live engine status');
    assert.doesNotMatch($(w, 'live-status').textContent, /Fixture|\d+\.\d+\.\d+/, 'visitors who are not signed in must not see engine details');
    assert.ok(w.document.querySelectorAll('button.copy').length >= 5, 'every command has a copy button');
    w.close();

    // linked from the sign-in screen and the app navigation
    const home = await open(18201);
    await waitFor(() => shown(home, 'auth-view'), 'auth view');
    assert.ok([...home.document.querySelectorAll('a')].some((a) => a.getAttribute('href') === '/engine' && /engine/i.test(a.textContent)));
    home.close();
});

test('engine guide page tells the truth when the engine is missing', async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rhempty-'));
    await startServer(18209, { RAMMERHEAD_ENGINE_DIR: emptyDir });
    const w = await open(18209, 'engine.html');
    await waitFor(() => /Not available \(missing\)/.test($(w, 'live-status').textContent), 'missing status');
    assert.match($(w, 'live-status').textContent, /No engine is installed/i);
    assert.doesNotMatch($(w, 'live-status').textContent, /\/home|\/tmp|node_modules/, 'no server paths for visitors');
    w.close();
});
