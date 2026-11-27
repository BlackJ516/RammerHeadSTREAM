// A brand-new install on a server that requires invite codes must not be a dead end.
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 18180;
const base = `http://localhost:${PORT}`;
let child, log = '';

test.before(async () => {
    child = spawn('node', ['src/server.js'], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, RAMMERHEAD_PORT: String(PORT), RAMMERHEAD_WORKERS: '0', RAMMERHEAD_REGISTRATION: 'invite', RAMMERHEAD_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'rhfirst-')) }
    });
    child.stdout.on('data', (d) => (log += d));
    child.stderr.on('data', (d) => (log += d));
    for (let i = 0; i < 60; i++) {
        try { if ((await fetch(base + '/api/auth/status')).ok) break; } catch (e) { /* wait */ }
        await new Promise((r) => setTimeout(r, 250));
    }
    await new Promise((r) => setTimeout(r, 500));
});
test.after(() => child && child.kill());

const register = (body) => fetch(base + '/api/auth/register', { method: 'POST', body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, json: await r.json() }));

test('first run prints a one-time setup code that creates the first account, once', async () => {
    const m = log.match(/One-time setup code: (\S+)/);
    assert.ok(m, 'the console must show a setup code. log:\n' + log);
    const code = m[1];
    assert.match(log, /no accounts yet/i);

    const noCode = await register({ username: 'owner', password: 'any characters work! \u{1F600}' });
    assert.strictEqual(noCode.status, 403);
    assert.strictEqual(noCode.json.field, 'invite');
    assert.match(noCode.json.error, /invite code/i);

    const wrong = await register({ username: 'owner', password: 'any characters work! \u{1F600}', inviteCode: 'not-the-code' });
    assert.strictEqual(wrong.status, 403);
    assert.strictEqual(wrong.json.code, 'invite_invalid');

    const ok = await register({ username: 'owner', password: 'any characters work! \u{1F600}', inviteCode: code });
    assert.strictEqual(ok.status, 201, JSON.stringify(ok.json));

    const again = await register({ username: 'second', password: 'another good password', inviteCode: code });
    assert.strictEqual(again.status, 403, 'the setup code works once');
    assert.strictEqual(again.json.code, 'invite_invalid');
});

test('the status endpoint tells the interface that an invite code is needed', async () => {
    const s = await (await fetch(base + '/api/auth/status')).json();
    assert.strictEqual(s.registration, 'invite');
});
