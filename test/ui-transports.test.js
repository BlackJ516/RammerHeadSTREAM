// Settings -> Connection in the browser: choosing a transport, a fallback, the Test button, and failover when a page opens.
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { testEngineDir } = require('./helpers/engine');
const makeTestTransport = require('./fixtures/makeTestTransport');

const PORT = 18380;
const base = `http://localhost:${PORT}`;
let child;

test.before(async () => {
    const tdir = fs.mkdtempSync(path.join(os.tmpdir(), 'rhut-'));
    makeTestTransport(tdir, { id: 'libcurl', server: true, testOk: false }); // its own check fails
    makeTestTransport(tdir, { id: 'epoxy', server: true, testOk: true });
    child = spawn('node', ['src/server.js'], {
        cwd: path.join(__dirname, '..'),
        env: {
            ...process.env, RAMMERHEAD_PORT: String(PORT), RAMMERHEAD_WORKERS: '0', RAMMERHEAD_TRANSPORTS_DIR: tdir,
            RAMMERHEAD_ENGINE_DIR: testEngineDir({ transports: ['http', 'libcurl', 'epoxy', 'bare'], transportTest: true, failingTransports: ['http'] }),
            RAMMERHEAD_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'rhud-'))
        }
    });
    for (let i = 0; i < 60; i++) {
        try { if ((await fetch(base + '/api/engine/status')).ok) return; } catch (e) { /* wait */ }
        await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('server did not start');
});
const windows = [];
test.after(() => {
    windows.forEach((w) => { try { w.close(); } catch (e) { /* already closed */ } });
    if (child) child.kill();
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
const $ = (w, id) => w.document.getElementById(id);
const type = (w, id, v) => { $(w, id).value = v; $(w, id).dispatchEvent(new w.Event('input', { bubbles: true })); };
const pick = (w, id, v) => { $(w, id).value = v; $(w, id).dispatchEvent(new w.Event('change')); };
const visible = (w, id) => !$(w, id).hidden;
const options = (w, id) => [...$(w, id).options].map((o) => o.value);
const navigations = [];
let userCount = 0;

async function signedInPage() {
    const vc = new VirtualConsole();
    vc.on('jsdomError', (e) => { if (/navigation/.test(e.message)) navigations.push(e.message); });
    const dom = await JSDOM.fromURL(base + '/', {
        runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
        beforeParse(window) { window.fetch = (u, o) => fetch(new URL(u, window.location.href), o); }
    });
    const w = dom.window;
    windows.push(w);
    await waitFor(() => visible(w, 'auth-view'), 'sign-in screen');
    $(w, 'tab-signup').click();
    const username = 'transportuser' + ++userCount;
    w.__username = username;
    type(w, 'auth-user', username);
    type(w, 'auth-pass', 'violet lantern harbor');
    type(w, 'auth-pass2', 'violet lantern harbor');
    $(w, 'auth-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => visible(w, 'app'), 'signed in');
    await waitFor(() => $(w, 'fact-engine').textContent !== '-', 'the engine status to load');
    return w;
}

test('Settings lists only usable transports, explains the others, and lets you pick a fallback', async () => {
    const w = await signedInPage();
    w.document.querySelector('[data-view=settings]').click();
    assert.deepStrictEqual(options(w, 'set-transport'), ['http', 'libcurl', 'epoxy'], 'bare is declared by the engine but not installed, so it is not offered');
    assert.match($(w, 'set-transport').options[0].textContent, /Built-in HTTP/);
    assert.deepStrictEqual(options(w, 'set-fallback'), ['', 'libcurl', 'epoxy'], 'the fallback list leaves out the one already chosen');
    const list = $(w, 'transport-list').textContent;
    assert.match(list, /Built-in HTTP.*Ready to use/);
    assert.match(list, /Test libcurl.*Ready to use/);
    assert.match(list, /Not installed: Bare/);
    assert.ok(visible(w, 'transport-test-row'));
    assert.match($(w, 'fact-transport').textContent, /Built-in HTTP/);

    pick(w, 'set-transport', 'libcurl');
    assert.deepStrictEqual(options(w, 'set-fallback'), ['', 'http', 'epoxy']);
    assert.match($(w, 'fact-transport').textContent, /libcurl/);
    assert.match($(w, 'transport-hint').textContent, /test transport libcurl/);
    pick(w, 'set-fallback', 'epoxy');
    // the choice is remembered for this account
    const prefs = JSON.parse(w.localStorage.getItem('rhs.u.' + w.__username + '.prefs'));
    assert.strictEqual(prefs.transport, 'libcurl');
    assert.strictEqual(prefs.fallback, 'epoxy');
    w.close();
});

test('the Test button reports a working and a failing transport', async () => {
    const w = await signedInPage();
    w.document.querySelector('[data-view=settings]').click();
    pick(w, 'set-transport', 'epoxy');
    $(w, 'transport-test').click();
    await waitFor(() => /is working/.test($(w, 'transport-result').textContent), 'a passing result');
    assert.match($(w, 'transport-result').textContent, /Test epoxy is working|Epoxy is working/);
    pick(w, 'set-transport', 'libcurl');
    $(w, 'transport-test').click();
    await waitFor(() => /is not working/.test($(w, 'transport-result').textContent), 'a failing result');
    assert.match($(w, 'transport-result').textContent, /plug-in check failed/);
    w.close();
});

test('FAILOVER: when the chosen transport fails its check, the page opens with the fallback and says so', async () => {
    const w = await signedInPage();
    const urls = [];
    const real = w.fetch;
    w.fetch = (u, o) => { urls.push(String(u)); return real(u, o); };
    const opened = [];
    w.open = () => { const t = { closed: false, opener: 'x', location: { href: '' }, document: { title: '' }, focus() {}, close() { t.closed = true; } }; opened.push(t); return t; };

    w.document.querySelector('[data-view=settings]').click();
    pick(w, 'set-transport', 'libcurl'); // its check fails
    pick(w, 'set-fallback', 'epoxy');    // its check passes
    w.document.querySelector('[data-view=home]').click();
    type(w, 'go-input', 'https://example.com/');
    $(w, 'go-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => opened.length === 1 && opened[0].location.href, 'the tab to open');
    assert.ok(urls.some((u) => /transport\/test\?transport=libcurl/.test(u)), 'the chosen transport was checked first');
    assert.ok(urls.some((u) => /editsession\?.*transport=epoxy/.test(u)), 'the session was configured with the fallback');
    assert.ok(!urls.some((u) => /editsession\?.*transport=libcurl/.test(u)));
    assert.match($(w, 'banner').textContent, /libcurl is not responding, so Epoxy was used for this page/i);
    w.close();
});

test('FAILOVER: with no fallback the chosen transport is used as it is, and a working one is not replaced', async () => {
    const w = await signedInPage();
    const urls = [];
    const real = w.fetch;
    w.fetch = (u, o) => { urls.push(String(u)); return real(u, o); };
    const opened = [];
    w.open = () => { const t = { closed: false, opener: 'x', location: { href: '' }, document: { title: '' }, focus() {}, close() { t.closed = true; } }; opened.push(t); return t; };
    w.document.querySelector('[data-view=settings]').click();
    pick(w, 'set-transport', 'epoxy');   // passes
    pick(w, 'set-fallback', 'libcurl');  // would fail, but is never needed
    w.document.querySelector('[data-view=home]').click();
    type(w, 'go-input', 'https://example.com/a');
    $(w, 'go-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => opened.length === 1 && opened[0].location.href, 'the tab to open');
    assert.ok(urls.some((u) => /editsession\?.*transport=epoxy/.test(u)));
    assert.ok(!urls.some((u) => /transport\/test\?transport=libcurl/.test(u)), 'the fallback is only checked if the first one fails');
    w.close();
});

test('FAILOVER: when neither works, nothing opens and the reason is shown', async () => {
    const w = await signedInPage();
    const opened = [];
    w.open = () => { const t = { closed: false, opener: 'x', location: { href: '' }, document: { title: '' }, focus() {}, close() { t.closed = true; } }; opened.push(t); return t; };
    w.document.querySelector('[data-view=settings]').click();
    pick(w, 'set-transport', 'libcurl'); // fails
    pick(w, 'set-fallback', 'http');     // the engine reports http as failing too
    w.document.querySelector('[data-view=home]').click();
    type(w, 'go-input', 'https://example.com/b');
    $(w, 'go-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => /Neither libcurl nor Built-in HTTP could be reached/i.test($(w, 'banner').textContent), 'the error');
    assert.strictEqual(opened.length, 1);
    assert.ok(opened[0].closed, 'the empty tab that was opened for it is closed again');
    assert.strictEqual(opened[0].location.href, '', 'and was never sent anywhere');
    assert.ok(!$(w, 'go-btn').disabled, 'the button works again');
    w.close();
});
