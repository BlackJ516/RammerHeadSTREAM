const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const pw = require('../src/auth/passwords');
const { AuthService } = require('../src/auth/AuthService');

const mk = (registration = 'open') =>
    new AuthService({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'rhauth-')), registration, bindingAddress: '127.0.0.1' });
const fakeReq = (token) => ({ headers: token ? { authorization: 'Bearer ' + token } : {} });
const GOOD = 'correct horse battery';

test('password policy', () => {
    assert.ok(pw.validatePassword('short'));
    assert.match(pw.validatePassword('short'), /you entered 5/);
    assert.ok(pw.validatePassword('sharkie4life')); // the old shared default is rejected
    assert.ok(pw.validatePassword('alice-name', 'alice-name')); // the same as the username
    assert.strictEqual(pw.validatePassword(GOOD, 'bob'), null);
    assert.ok(pw.validateUsername('Ab'));
    assert.strictEqual(pw.validateUsername('alice_1'), null);
});

test('scrypt hashes are salted and verify', async () => {
    const a = await pw.hashPassword(GOOD);
    const b = await pw.hashPassword(GOOD);
    assert.notStrictEqual(a, b);
    assert.ok(await pw.verifyPassword(GOOD, a));
    assert.ok(!(await pw.verifyPassword('wrong password!!', a)));
    assert.ok(!(await pw.verifyPassword(GOOD, 'garbage')));
});

test('register, login, authenticate, and the browser token is not the password', async () => {
    const auth = mk();
    const r = await auth.register({ username: 'Alice', password: GOOD }, '1.1.1.1');
    assert.strictEqual(r.username, 'alice');
    assert.ok(!r.token.includes(GOOD));
    assert.strictEqual(auth.authenticate(fakeReq(r.token)).name, 'alice');
    const l = await auth.login({ username: 'alice', password: GOOD }, '1.1.1.1');
    assert.strictEqual(auth.authenticate(fakeReq(l.token)).name, 'alice');
    assert.strictEqual(auth.authenticate(fakeReq('x.y')), null);
    assert.strictEqual(auth.authenticate(fakeReq(null)), null);
    // the file on disk holds a hash, never the password
    const raw = fs.readFileSync(path.join(auth.store.dir, 'auth.json'), 'utf8');
    assert.ok(!raw.includes(GOOD));
    assert.ok(raw.includes('scrypt$'));
});

test('duplicate usernames and bad logins are rejected without revealing which part was wrong', async () => {
    const auth = mk();
    await auth.register({ username: 'alice', password: GOOD }, '1.1.1.1');
    await assert.rejects(auth.register({ username: 'alice', password: GOOD }, '2.2.2.2'), (e) => e.status === 409);
    const wrongPw = await auth.login({ username: 'alice', password: 'nope nope nope' }, '3.3.3.3').catch((e) => e);
    const noUser = await auth.login({ username: 'ghost', password: 'nope nope nope' }, '3.3.3.3').catch((e) => e);
    assert.strictEqual(wrongPw.status, 401);
    assert.strictEqual(wrongPw.message, noUser.message);
});

test('login lockout after repeated failures', async () => {
    const auth = mk();
    await auth.register({ username: 'alice', password: GOOD }, '1.1.1.1');
    for (let i = 0; i < 5; i++) await auth.login({ username: 'alice', password: 'wrong password' }, '9.9.9.9').catch(() => {});
    const e = await auth.login({ username: 'alice', password: GOOD }, '9.9.9.9').catch((x) => x);
    assert.strictEqual(e.status, 429);
    // a different IP is not locked out
    assert.ok((await auth.login({ username: 'alice', password: GOOD }, '8.8.8.8')).token);
});

test('changing the password signs out older tokens', async () => {
    const auth = mk();
    const r = await auth.register({ username: 'alice', password: GOOD }, '1.1.1.1');
    const user = auth.authenticate(fakeReq(r.token));
    const changed = await auth.changePassword(user, { currentPassword: GOOD, newPassword: 'another long passphrase' }, '1.1.1.1');
    assert.strictEqual(auth.authenticate(fakeReq(r.token)), null);
    assert.strictEqual(auth.authenticate(fakeReq(changed.token)).name, 'alice');
    await assert.rejects(auth.login({ username: 'alice', password: GOOD }, '1.1.1.1'));
});

test('tampered and expired tokens are rejected', async () => {
    const auth = mk();
    const r = await auth.register({ username: 'alice', password: GOOD }, '1.1.1.1');
    const [payload, sig] = r.token.split('.');
    const forged = Buffer.from(JSON.stringify({ u: 'alice', v: 0, iat: 0, exp: Date.now() + 1e9, admin: true })).toString('base64url');
    assert.strictEqual(auth.authenticate(fakeReq(forged + '.' + sig)), null);
    const expired = auth.tokens.sign({ u: 'alice', v: 0, iat: 0, exp: Date.now() - 1 });
    assert.strictEqual(auth.authenticate(fakeReq(expired)), null);
    assert.ok(payload);
});

test('invite mode requires a valid, unused code; closed mode refuses sign-up', async () => {
    const auth = mk('invite');
    await assert.rejects(auth.register({ username: 'bob', password: GOOD }, '1.1.1.1'), (e) => e.status === 403);
    await assert.rejects(auth.register({ username: 'bob', password: GOOD, inviteCode: 'bad' }, '1.1.1.1'), (e) => e.status === 403);
    const code = await auth.createInvite({ maxUses: 1 });
    assert.ok((await auth.register({ username: 'bob', password: GOOD, inviteCode: code }, '1.1.1.1')).token);
    await assert.rejects(auth.register({ username: 'carol', password: GOOD, inviteCode: code }, '1.1.1.1'), (e) => e.status === 403);
    const closed = mk('closed');
    await assert.rejects(closed.register({ username: 'bob', password: GOOD }, '1.1.1.1'), (e) => e.status === 403);
});

test('default registration is never open on a public bind address', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rhauth-'));
    assert.strictEqual(new AuthService({ dataDir: dir, bindingAddress: '127.0.0.1' }).registration, 'open');
    assert.strictEqual(new AuthService({ dataDir: dir, bindingAddress: '0.0.0.0' }).registration, 'invite');
});

test('concurrent registrations from several store instances do not lose accounts', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rhauth-'));
    const workers = [0, 1, 2].map(() => new AuthService({ dataDir: dir, registration: 'open', bindingAddress: '127.0.0.1' }));
    await Promise.all(
        Array.from({ length: 9 }, (_, i) => workers[i % 3].register({ username: 'user' + i, password: GOOD + i }, '10.0.0.' + i))
    );
    assert.strictEqual(new AuthService({ dataDir: dir, registration: 'open', bindingAddress: '127.0.0.1' }).store.userCount(), 9);
    // a token issued by one worker is valid in another (shared secret)
    const t = (await workers[0].login({ username: 'user0', password: GOOD + '0' }, '1.2.3.4')).token;
    assert.strictEqual(workers[2].authenticate(fakeReq(t)).name, 'user0');
});

test('deleting your own account needs the password and removes the account for good', async () => {
    const auth = mk();
    const r = await auth.register({ username: 'leaving', password: GOOD }, '1.1.1.1');
    const user = auth.authenticate(fakeReq(r.token));
    // a wrong password changes nothing
    const refused = await auth.deleteAccount(user, { password: 'not the password' }, '1.1.1.1').catch((e) => e);
    assert.strictEqual(refused.status, 401);
    assert.strictEqual(refused.extra.field, 'current');
    assert.strictEqual(auth.authenticate(fakeReq(r.token)).name, 'leaving', 'the account and its token still work');
    for (const bad of [undefined, 5]) await assert.rejects(auth.deleteAccount(user, { password: bad }, '1.1.1.1'));
    // the right one deletes it
    await auth.deleteAccount(user, { password: GOOD }, '1.1.1.1');
    assert.strictEqual(auth.authenticate(fakeReq(r.token)), null, 'the old sign-in token stops working');
    assert.strictEqual(auth.store.getUser('leaving'), null);
    await assert.rejects(auth.login({ username: 'leaving', password: GOOD }, '1.1.1.1'));
    // the name can be used again, by a brand-new account with its own password
    const again = await auth.register({ username: 'leaving', password: 'a completely new password' }, '2.2.2.2');
    assert.ok(again.token);
    await assert.rejects(auth.login({ username: 'leaving', password: GOOD }, '2.2.2.2'), 'the old password does not carry over');
});

test('repeated wrong passwords on the delete form are rate limited', async () => {
    const auth = mk();
    const r = await auth.register({ username: 'guessable', password: GOOD }, '1.1.1.1');
    const user = auth.authenticate(fakeReq(r.token));
    for (let i = 0; i < 5; i++) await auth.deleteAccount(user, { password: 'wrong' + i + 'xxxx' }, '9.9.9.9').catch(() => {});
    const blocked = await auth.deleteAccount(user, { password: GOOD }, '9.9.9.9').catch((e) => e);
    assert.strictEqual(blocked.status, 429);
    assert.strictEqual(auth.store.getUser('guessable').name, 'guessable', 'and the account was not deleted');
});
