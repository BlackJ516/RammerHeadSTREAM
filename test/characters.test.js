// Passwords and usernames may contain any characters. Each of these must be accepted AND must sign in again afterwards.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const pw = require('../src/auth/passwords');
const { AuthService } = require('../src/auth/AuthService');

const mk = () => new AuthService({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'rhchar-')), registration: 'open', bindingAddress: '127.0.0.1' });

const PASSWORDS = {
    'letters and digits': 'Blu2026ForMe',
    'symbols': 'Tr0ub4dor&3!xyz#$%^*()_+-=[]{};:,.<>?/|~`',
    'quotes and backslashes': 'p@ss"word\\with\'quotes\\\\1',
    'spaces inside': 'correct horse battery staple',
    'leading and trailing spaces': '  spaced out pass  ',
    'accents': 'pässwörd-éàçñ-ÆØÅ',
    'japanese': '日本語のパスワード',
    'chinese': '我的密码很安全啊',
    'korean': '비밀번호는안전합니다',
    'cyrillic': 'пароль-очень-длинный',
    'arabic (right to left)': 'كلمة-المرور-الطويلة',
    'hebrew': 'סיסמה-ארוכה-מאוד',
    'emoji': '😀😎🚀🔥💯🎉🌈🍕',
    'emoji with joiners': '👩‍👩‍👧‍👦👨🏽‍💻🏳️‍🌈abcdef',
    'html and script': '<script>alert("x")</script>',
    'sql-looking': "'; DROP TABLE users; --",
    'json-looking': '{"a":[1,2,3],"b":null}',
    'tabs and newlines': 'line one\nline two\ttabbed',
    'nul character': 'abc\u0000defghij',
    'percent and url chars': '100%25&a=b?c=d#e',
    'only digits': '0123456789',
    'exactly 8 characters': 'q7Lm2xZp',
    'very long (1000 characters)': 'x9'.repeat(500)
};

for (const [label, password] of Object.entries(PASSWORDS)) {
    test(`password with ${label}: accepted, and signs in again`, async () => {
        const auth = mk();
        assert.strictEqual(pw.validatePassword(password, 'someone'), null);
        const r = await auth.register({ username: 'someone', password }, '1.1.1.1');
        assert.ok(r.token);
        const l = await auth.login({ username: 'someone', password }, '1.1.1.1');
        assert.ok(l.token, 'must sign in with exactly the password it was created with');
        await assert.rejects(auth.login({ username: 'someone', password: password + 'x' }, '2.2.2.2'));
    });
}

test('the same text typed in a different Unicode form still matches (é as one character or two)', async () => {
    const auth = mk();
    await auth.register({ username: 'accent', password: 'caf\u00e9-au-lait-2026' }, '1.1.1.1');
    assert.ok((await auth.login({ username: 'accent', password: 'cafe\u0301-au-lait-2026' }, '1.1.1.1')).token);
});

test('clear messages say exactly what is wrong', () => {
    assert.match(pw.validatePassword('abc'), /at least 8 characters \(you entered 3\)/);
    assert.match(pw.validatePassword('password123'), /commonly used/);
    assert.match(pw.validatePassword('zzzzzzzzzz'), /one repeated character/);
    assert.match(pw.validatePassword('x'.repeat(1025)), /at most 1024/);
    assert.strictEqual(pw.validatePassword('an ordinary sentence'), null);
    assert.match(pw.validateUsername('ab'), /at least 3 characters \(you entered 2\)/);
});

const USERNAMES = ['BlackJ', 'Black J', 'black_j.2026', 'BlackJ!', 'blu@example.com', 'ブルー', 'Блю', 'ملك', '😀 fan', 'a-b', "o'brien"];
for (const name of USERNAMES) {
    test(`username ${JSON.stringify(name)}: accepted, case-insensitive sign-in`, async () => {
        const auth = mk();
        const r = await auth.register({ username: name, password: 'correct horse battery' }, '1.1.1.1');
        assert.strictEqual(r.username, pw.normalizeUsername(name));
        assert.ok((await auth.login({ username: name.toUpperCase(), password: 'correct horse battery' }, '1.1.1.1')).token);
        assert.ok((await auth.login({ username: '  ' + name + '  ', password: 'correct horse battery' }, '1.1.1.1')).token);
    });
}

test('names that would clash with built-in object properties are refused politely, and cannot be abused', async () => {
    const auth = mk();
    for (const bad of ['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty', 'valueOf']) {
        const e = await auth.register({ username: bad, password: 'correct horse battery' }, '3.3.3.' + bad.length).catch((x) => x);
        assert.strictEqual(e.status, 400, bad);
        assert.strictEqual(e.extra.field, 'username');
    }
    assert.strictEqual(auth.store.getUser('constructor'), null);
    assert.strictEqual(auth.store.getUser('__proto__'), null);
    assert.strictEqual(auth.store.userCount(), 0);
    // control and invisible characters are not allowed in names; whitespace (even a newline) is folded into a single space
    const bell = await auth.register({ username: 'bad\u0007name', password: 'correct horse battery' }, '4.4.4.4').catch((x) => x);
    assert.strictEqual(bell.status, 400);
    const zeroWidth = await auth.register({ username: 'bad\u200bname', password: 'correct horse battery' }, '4.4.4.5').catch((x) => x);
    assert.strictEqual(zeroWidth.status, 400);
    assert.strictEqual((await auth.register({ username: 'two\nlines', password: 'correct horse battery' }, '4.4.4.6')).username, 'two lines');
});

test('errors point at the field to fix', async () => {
    const auth = mk();
    assert.strictEqual((await auth.register({ username: 'ab', password: 'correct horse battery' }, '5.5.5.1').catch((e) => e)).extra.field, 'username');
    assert.strictEqual((await auth.register({ username: 'abcd', password: 'short' }, '5.5.5.2').catch((e) => e)).extra.field, 'password');
    await auth.register({ username: 'taken', password: 'correct horse battery' }, '5.5.5.3');
    const dup = await auth.register({ username: 'TAKEN', password: 'correct horse battery' }, '5.5.5.4').catch((e) => e);
    assert.strictEqual(dup.status, 409);
    assert.strictEqual(dup.extra.field, 'username');
});
