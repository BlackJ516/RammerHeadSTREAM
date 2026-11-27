const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { testEngineDir } = require('./helpers/engine');

const PORT = 18080;
const base = `http://127.0.0.1:${PORT}`;
let child, dataDir;

async function api(method, url, body, token) {
    const res = await fetch(base + url, {
        method,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch (e) { /* plain text */ }
    return { status: res.status, text, json, headers: res.headers };
}

test.before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rhint-'));
    child = spawn('node', ['src/server.js'], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, RAMMERHEAD_ENGINE_DIR: testEngineDir({ transports: ['http'] }), RAMMERHEAD_PORT: String(PORT), RAMMERHEAD_DATA_DIR: dataDir }
    });
    for (let i = 0; i < 60; i++) {
        try { if ((await fetch(base + '/api/auth/status')).ok) return; } catch (e) { /* not up yet */ }
        await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('server did not start');
});
test.after(() => child && child.kill());

test('no shared password: the old default and ?pwd= no longer open anything', async () => {
    assert.strictEqual((await api('GET', '/newsession?pwd=sharkie4life')).status, 403);
    assert.strictEqual((await api('GET', '/newsession')).status, 403);
});

test('sign up, then create/check/edit/delete your own session', async () => {
    const r = await api('POST', '/api/auth/register', { username: 'alice', password: 'correct horse battery' });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.headers.get('cache-control'), 'no-store');
    const token = r.json.token;
    assert.strictEqual((await api('GET', '/api/auth/status', null, token)).json.username, 'alice');

    const ns = await api('GET', '/newsession', null, token);
    assert.strictEqual(ns.status, 200);
    const id = ns.text;
    assert.match(id, /^[a-z0-9]{32}$/i);
    assert.strictEqual((await api('GET', '/sessionexists?id=' + id, null, token)).text, 'exists');
    assert.strictEqual((await api('GET', `/editsession?id=${id}&enableShuffling=1`, null, token)).text, 'Success');
    assert.strictEqual((await api('GET', '/deletesession?id=' + id, null, token)).text, 'Success');
});

test("another user cannot see, edit, or delete someone else's session", async () => {
    const a = (await api('POST', '/api/auth/register', { username: 'carol', password: 'correct horse battery' })).json.token;
    const b = (await api('POST', '/api/auth/register', { username: 'dave', password: 'correct horse battery' })).json.token;
    const id = (await api('GET', '/newsession', null, a)).text;
    assert.strictEqual((await api('GET', '/sessionexists?id=' + id, null, b)).text, 'not found');
    assert.strictEqual((await api('GET', `/editsession?id=${id}&enableShuffling=0`, null, b)).status, 403);
    assert.strictEqual((await api('GET', '/deletesession?id=' + id, null, b)).status, 403);
    assert.strictEqual((await api('GET', '/sessionexists?id=' + id, null, a)).text, 'exists');
});

test('weak passwords and malformed bodies are rejected cleanly', async () => {
    assert.strictEqual((await api('POST', '/api/auth/register', { username: 'erin', password: 'short' })).status, 400);
    const bad = await fetch(base + '/api/auth/login', { method: 'POST', body: '{not json' });
    assert.strictEqual(bad.status, 400);
    const huge = await fetch(base + '/api/auth/login', { method: 'POST', body: 'x'.repeat(50000) }).catch(() => ({ status: 'closed' }));
    assert.ok([413, 'closed'].includes(huge.status));
});

test('login works and a wrong password gives the generic error', async () => {
    assert.strictEqual((await api('POST', '/api/auth/login', { username: 'alice', password: 'correct horse battery' })).status, 200);
    const bad = await api('POST', '/api/auth/login', { username: 'alice', password: 'definitely wrong' });
    assert.strictEqual(bad.status, 401);
    assert.strictEqual(bad.json.error, 'incorrect username or password');
});

test('DELETE ACCOUNT over HTTP: needs the sign-in AND the password, removes the browsing session too, frees the name', async () => {
    const reg = await api('POST', '/api/auth/register', { username: 'goner', password: 'correct horse battery' });
    const token = reg.json.token;
    const id = (await api('GET', '/newsession', null, token)).text;
    assert.strictEqual((await api('GET', '/sessionexists?id=' + id, null, token)).text, 'exists');

    assert.strictEqual((await api('POST', '/api/auth/delete', { password: 'correct horse battery' })).status, 401, 'not signed in');
    const wrong = await api('POST', '/api/auth/delete', { password: 'definitely wrong', sessionId: id }, token);
    assert.strictEqual(wrong.status, 401);
    assert.strictEqual(wrong.json.field, 'current');
    assert.strictEqual((await api('GET', '/sessionexists?id=' + id, null, token)).text, 'exists', 'a wrong password deletes nothing, session included');

    // somebody else cannot use your session id to have it removed
    const other = (await api('POST', '/api/auth/register', { username: 'bystander', password: 'correct horse battery' })).json.token;
    await api('POST', '/api/auth/delete', { password: 'correct horse battery', sessionId: id }, other);
    const again = await api('POST', '/api/auth/login', { username: 'goner', password: 'correct horse battery' });
    assert.strictEqual((await api('GET', '/sessionexists?id=' + id, null, again.json.token)).text, 'exists', "another account's delete does not touch your session");

    const ok = await api('POST', '/api/auth/delete', { password: 'correct horse battery', sessionId: id }, again.json.token);
    assert.strictEqual(ok.status, 200);
    assert.strictEqual((await api('GET', '/api/auth/status', null, again.json.token)).json.authenticated, false, 'the token no longer works');
    assert.strictEqual((await api('POST', '/api/auth/login', { username: 'goner', password: 'correct horse battery' })).status, 401);
    // the name is free again; a new account with that name must not inherit the old session
    const reborn = await api('POST', '/api/auth/register', { username: 'goner', password: 'another good password' });
    assert.strictEqual((await api('GET', '/sessionexists?id=' + id, null, reborn.json.token)).text, 'not found', 'the browsing session was removed with the account');
});
