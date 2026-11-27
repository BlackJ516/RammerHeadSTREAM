// Frontend behaviour tests: the real page (public/) running in jsdom against the real server.
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { testEngineDir } = require('./helpers/engine');
const { JSDOM, VirtualConsole } = require('jsdom');

const PORT = 18090;
const base = `http://127.0.0.1:${PORT}/`;
let child;
const navigations = [];

async function waitFor(fn, what, ms = 8000) {
    const end = Date.now() + ms;
    for (;;) {
        const v = fn();
        if (v) return v;
        if (Date.now() > end) throw new Error('timed out waiting for ' + what);
        await new Promise((r) => setTimeout(r, 25));
    }
}
async function openPage(storage) {
    const vc = new VirtualConsole();
    vc.on('jsdomError', (e) => { if (/navigation/.test(e.message)) navigations.push(e.message); });
    const dom = await JSDOM.fromURL(base, {
        runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
        beforeParse(window) {
            window.fetch = (u, o) => fetch(new URL(u, window.location.href), o);
            if (storage) for (const [k, v] of Object.entries(storage)) window.localStorage.setItem(k, v);
        }
    });
    windows.push(dom.window);
    return dom.window;
}
const type = (w, id, value) => { const e = w.document.getElementById(id); e.value = value; e.dispatchEvent(new w.Event('input', { bubbles: true })); };
const click = (w, id) => w.document.getElementById(id).click();
const submit = (w, id) => w.document.getElementById(id).dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
const visible = (w, id) => !w.document.getElementById(id).hidden;

test.before(async () => {
    child = spawn('node', ['src/server.js'], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, RAMMERHEAD_ENGINE_DIR: testEngineDir({ transports: ['http'] }), RAMMERHEAD_PORT: String(PORT), RAMMERHEAD_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'rhui-')) }
    });
    for (let i = 0; i < 60; i++) {
        try { if ((await fetch(base + 'api/auth/status')).ok) return; } catch (e) { /* wait */ }
        await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('server did not start');
});
const windows = [];
test.after(() => {
    windows.forEach((w) => { try { w.close(); } catch (e) { /* already closed */ } });
    if (child) child.kill();
});

let savedStorage;

test('a new visitor sees sign-in, and the old shared-password field is gone', async () => {
    const w = await openPage();
    await waitFor(() => visible(w, 'auth-view'), 'auth view');
    assert.ok(!visible(w, 'app'));
    assert.strictEqual(w.document.getElementById('session-password'), null);
    w.close();
});

test('create an account, then use bookmarks, theme, and launching', async () => {
    const w = await openPage();
    await waitFor(() => visible(w, 'auth-view'), 'auth view');
    click(w, 'tab-signup');
    assert.ok(visible(w, 'auth-pass-hint'));
    type(w, 'auth-user', 'Zoe');
    type(w, 'auth-pass', 'short');
    submit(w, 'auth-form');
    await waitFor(() => visible(w, 'auth-error'), 'weak password error');
    assert.match(w.document.getElementById('auth-error').textContent, /at least 8/);

    type(w, 'auth-pass', 'plum tree window sunrise');
    type(w, 'auth-pass2', 'plum tree window sunrise');
    submit(w, 'auth-form');
    await waitFor(() => visible(w, 'app'), 'app view');
    assert.strictEqual(w.document.getElementById('who-name').textContent, 'zoe');
    const token = JSON.parse(w.localStorage.getItem('rhs.token'));
    assert.ok(token);
    assert.ok(!Object.values({ ...w.localStorage }).some((v) => v.includes('plum tree')), 'password must never be stored in the browser');

    // bookmarks: rendered as text, never as HTML
    w.document.querySelector('[data-view=bookmarks]').click();
    type(w, 'bm-title', '<img src=x onerror="window.pwned=1">');
    type(w, 'bm-url', 'https://example.org/page');
    submit(w, 'bm-form');
    await waitFor(() => w.document.querySelectorAll('#bm-list li').length === 1, 'bookmark row');
    assert.strictEqual(w.document.querySelector('#bm-list img'), null);
    assert.ok(!w.pwned);
    // refuses non-web addresses
    type(w, 'bm-url', 'javascript:alert(1)');
    submit(w, 'bm-form');
    assert.strictEqual(w.document.querySelectorAll('#bm-list li').length, 1);

    // theme
    w.document.querySelector('[data-view=settings]').click();
    const theme = w.document.getElementById('set-theme');
    theme.value = 'dark';
    theme.dispatchEvent(new w.Event('change'));
    assert.strictEqual(w.document.documentElement.getAttribute('data-theme'), 'dark');

    // launching: bare words search, domains get https, javascript: is refused
    w.document.querySelector('[data-view=home]').click();
    type(w, 'go-input', 'javascript:alert(1)');
    submit(w, 'go-form');
    await waitFor(() => /Only http/.test(w.document.getElementById('go-status').textContent), 'refusal message');

    type(w, 'go-input', 'example.com');
    submit(w, 'go-form');
    await waitFor(() => navigations.length > 0, 'navigation to the proxied page');
    const hist = JSON.parse(w.localStorage.getItem('rhs.u.zoe.history'));
    assert.strictEqual(hist[0].url, 'https://example.com');
    const sid = JSON.parse(w.localStorage.getItem('rhs.u.zoe.sessionId'));
    assert.match(sid, /^[a-z0-9]{32}$/i);
    const exists = await fetch(base + 'sessionexists?id=' + sid, { headers: { Authorization: 'Bearer ' + token } }).then((r) => r.text());
    assert.strictEqual(exists, 'exists');

    savedStorage = Object.fromEntries(Object.entries({ ...w.localStorage }));
    w.close();
});

test('reload keeps you signed in; data is per account', async () => {
    const w = await openPage(savedStorage);
    await waitFor(() => visible(w, 'app'), 'app after reload');
    w.document.querySelector('[data-view=bookmarks]').click();
    assert.strictEqual(w.document.querySelectorAll('#bm-list li').length, 1);
    w.close();
});

test('tabs: real browser tabs, no iframes, opener cut, listed and closable; pop-up blocked falls back; parser preference is sent', async () => {
    const w = await openPage(savedStorage);
    await waitFor(() => visible(w, 'app'), 'app');
    const urls = [];
    const realFetch = w.fetch;
    w.fetch = (u, o) => { urls.push(String(u)); return realFetch(u, o); };
    const opened = [];
    w.open = (url, name) => {
        const fake = { name, closed: false, opener: 'launcher', document: { title: 'Example Domain' }, location: { href: '' }, history: { back() { fake.backed = true; }, forward() {} }, focus() { fake.focused = true; }, close() { fake.closed = true; } };
        opened.push(fake);
        return fake;
    };
    assert.strictEqual(w.document.querySelectorAll('iframe').length, 0, 'the interface must not use iframes');

    // choose the experimental parser, then open a page
    w.document.querySelector('[data-view=settings]').click();
    const parser = w.document.getElementById('set-parser');
    parser.value = 'wasm';
    parser.dispatchEvent(new w.Event('change'));
    w.document.querySelector('[data-view=home]').click();
    type(w, 'go-input', 'https://example.com/a');
    submit(w, 'go-form');
    await waitFor(() => opened.length === 1 && opened[0].location.href, 'tab navigated');
    assert.strictEqual(opened[0].opener, null, 'the new tab must not be able to reach the interface');
    assert.match(opened[0].location.href, /^\/[a-z0-9]{32}\//i);
    assert.ok(urls.some((u) => /\/editsession\?.*scriptEngine=wasm/.test(u)), 'the parser choice must reach the server');
    await waitFor(() => !w.document.getElementById('tabs-section').hidden, 'tab list shown');
    assert.match(w.document.querySelector('#tabstrip .tab-title').textContent, /Example Domain/);

    // tab controls
    w.document.querySelector('#tabstrip button[aria-label^="Back"]').click();
    assert.ok(opened[0].backed);
    w.document.querySelector('#tabstrip .tab-title').click();
    assert.ok(opened[0].focused);
    w.document.querySelector('#tabstrip button[aria-label^="Close tab"]').click();
    assert.ok(opened[0].closed);
    assert.ok(w.document.getElementById('tabs-section').hidden, 'closed tab leaves the list');

    // pop-up blocked -> falls back to this tab with a notice
    w.open = () => null;
    navigations.length = 0;
    type(w, 'go-input', 'https://example.com/b');
    submit(w, 'go-form');
    await waitFor(() => navigations.length > 0, 'same-tab fallback navigation');
    assert.match(w.document.getElementById('banner').textContent, /blocked the new tab/);
    w.close();
});

test('change password, sign out, sign back in with the new one only', async () => {
    const w = await openPage(savedStorage);
    await waitFor(() => visible(w, 'app'), 'app');
    w.document.querySelector('[data-view=settings]').click();
    type(w, 'pw-current', 'wrong password here');
    type(w, 'pw-new', 'brand new passphrase');
    type(w, 'pw-new2', 'brand new passphrase');
    submit(w, 'pw-form');
    await waitFor(() => /incorrect/.test(w.document.getElementById('pw-msg').textContent), 'wrong current password message');
    type(w, 'pw-current', 'plum tree window sunrise');
    submit(w, 'pw-form');
    await waitFor(() => /Password changed/.test(w.document.getElementById('pw-msg').textContent), 'success message');

    click(w, 'signout');
    await waitFor(() => visible(w, 'auth-view'), 'back at sign in');
    assert.strictEqual(w.localStorage.getItem('rhs.token'), null);

    type(w, 'auth-user', 'zoe');
    type(w, 'auth-pass', 'plum tree window sunrise');
    submit(w, 'auth-form');
    await waitFor(() => /incorrect/.test(w.document.getElementById('auth-error').textContent), 'old password rejected');
    type(w, 'auth-pass', 'brand new passphrase');
    submit(w, 'auth-form');
    await waitFor(() => visible(w, 'app'), 'signed in with new password');
    w.close();
});

test('Settings -> Delete my account: asks for the password, then removes the account and what this browser held for it', async () => {
    const w = await openPage();
    await waitFor(() => visible(w, 'auth-view'), 'auth view');
    click(w, 'tab-signup');
    type(w, 'auth-user', 'deleteme');
    type(w, 'auth-pass', 'a throwaway passphrase');
    type(w, 'auth-pass2', 'a throwaway passphrase');
    submit(w, 'auth-form');
    await waitFor(() => visible(w, 'app'), 'signed in');

    // give the account some data, so we can see it disappear
    w.document.querySelector('[data-view=bookmarks]').click();
    type(w, 'bm-url', 'https://example.org/keep');
    submit(w, 'bm-form');
    await waitFor(() => w.document.querySelectorAll('#bm-list li').length === 1, 'a bookmark');
    assert.ok(Object.keys({ ...w.localStorage }).some((k) => k.startsWith('rhs.u.deleteme.')));

    w.document.querySelector('[data-view=settings]').click();
    const card = w.document.getElementById('delete-form').parentElement.textContent;
    assert.match(card, /cannot be undone/);
    assert.match(card, /forgotten password cannot be recovered/);

    // nothing typed
    submit(w, 'delete-form');
    assert.match(w.document.getElementById('del-msg').textContent, /Enter your password/);
    // a wrong password leaves everything alone
    type(w, 'del-pass', 'not my password at all');
    submit(w, 'delete-form');
    await waitFor(() => /not correct/.test(w.document.getElementById('del-msg').textContent), 'wrong password message');
    assert.ok(visible(w, 'app'));
    assert.ok(w.localStorage.getItem('rhs.token'));

    // the right one deletes it
    type(w, 'del-pass', 'a throwaway passphrase');
    submit(w, 'delete-form');
    await waitFor(() => visible(w, 'auth-view'), 'back at the sign-in screen');
    assert.match(w.document.getElementById('auth-error').textContent, /account was deleted/);
    assert.strictEqual(w.localStorage.getItem('rhs.token'), null);
    assert.deepStrictEqual(Object.keys({ ...w.localStorage }).filter((k) => k.startsWith('rhs.u.deleteme.')), [], "this browser forgot the account's bookmarks, history and settings");

    // and the account is really gone
    type(w, 'auth-user', 'deleteme');
    type(w, 'auth-pass', 'a throwaway passphrase');
    submit(w, 'auth-form');
    await waitFor(() => /incorrect username or password/.test(w.document.getElementById('auth-error').textContent), 'sign-in refused');
    w.close();
});
