const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

// scrypt parameters (OWASP-recommended class). Stored inside each hash so they can be raised later.
const PARAMS = { N: 32768, r: 8, p: 1, keylen: 32 };
const maxmem = 128 * PARAMS.N * PARAMS.r * 2;

const MIN_PASSWORD = 8;
const MAX_PASSWORD = 1024;
const MIN_USERNAME = 3;
const MAX_USERNAME = 32;

// The most guessed passwords that are long enough to pass the length rule (compared lower-cased).
const COMMON = new Set([
    'password', 'password1', 'password12', 'password123', 'password1234', 'passw0rd', 'p@ssw0rd', 'p@ssword', 'qwerty123',
    'qwertyuiop', 'qwerty1234', '12345678', '123456789', '1234567890', '12345678910', '1q2w3e4r', '1qaz2wsx', 'iloveyou',
    'iloveyou1', 'iloveyou12', 'letmein123', 'welcome1', 'welcome123', 'admin123', 'admin1234', 'admin12345', 'abc12345',
    'abcd1234', 'monkey123', 'dragon123', 'football1', 'baseball1', 'sunshine1', 'princess1', 'trustno1', 'changeme',
    'changeme123', 'sharkie4life', 'rammerhead', 'rammerheadstream', 'minecraft', 'roblox123', 'fortnite1'
]);

// names that would collide with built-in object properties are never allowed
const RESERVED_USERNAMES = new Set(['__proto__', 'constructor', 'prototype', 'tostring', 'valueof', 'hasownproperty']);

const codePoints = (s) => [...s].length;

/** Canonical form of a username: Unicode-normalised, trimmed, single spaces, lower-case. Used for lookups and storage. */
function normalizeUsername(name) {
    return String(name).normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Any letters, numbers, spaces and symbols in any language are fine. Returns an error message or null. */
function validateUsername(name) {
    if (typeof name !== 'string') return 'enter a username';
    const n = normalizeUsername(name);
    const len = codePoints(n);
    if (len < MIN_USERNAME) return `username must be at least ${MIN_USERNAME} characters (you entered ${len})`;
    if (len > MAX_USERNAME) return `username must be at most ${MAX_USERNAME} characters (you entered ${len})`;
    if (/[\p{C}\p{Zl}\p{Zp}]/u.test(n)) return 'username cannot contain control or invisible characters';
    if (RESERVED_USERNAMES.has(n)) return 'that username is reserved, please pick another';
    return null;
}

/**
 * Passwords may contain ANY characters (letters, numbers, spaces, symbols, emoji, any language). The only rules are:
 * long enough, not absurdly long, not one of the most common passwords, and not just your username.
 */
function validatePassword(pw, username = '') {
    if (typeof pw !== 'string') return 'enter a password';
    const len = codePoints(pw);
    if (len < MIN_PASSWORD) return `password must be at least ${MIN_PASSWORD} characters (you entered ${len})`;
    if (len > MAX_PASSWORD) return `password must be at most ${MAX_PASSWORD} characters`;
    const lowered = pw.normalize('NFKC').toLowerCase().trim();
    if (COMMON.has(lowered)) return 'that password is one of the most commonly used ones, please pick another';
    const u = normalizeUsername(username);
    if (codePoints(u) >= 4 && lowered === u) return 'password must not be the same as your username';
    if (/^(.)\1+$/su.test(pw)) return 'password must not be one repeated character';
    return null;
}

async function hashPassword(pw) {
    const salt = crypto.randomBytes(16);
    const key = await scrypt(pw.normalize('NFKC'), salt, PARAMS.keylen, { N: PARAMS.N, r: PARAMS.r, p: PARAMS.p, maxmem });
    return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), key.toString('base64')].join('$');
}

async function verifyPassword(pw, stored) {
    const parts = String(stored).split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [N, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
    const salt = Buffer.from(parts[4], 'base64');
    const expected = Buffer.from(parts[5], 'base64');
    const key = await scrypt(pw.normalize('NFKC'), salt, expected.length, { N, r, p, maxmem: 128 * N * r * 2 });
    return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

// verified against when the username does not exist, so response time does not reveal which usernames exist
let dummyHash;
async function burnVerify(pw) {
    if (!dummyHash) dummyHash = await hashPassword('dummy-password-for-timing');
    await verifyPassword(pw, dummyHash);
}

module.exports = {
    MIN_PASSWORD, MAX_PASSWORD, MIN_USERNAME, MAX_USERNAME,
    normalizeUsername, validateUsername, validatePassword, hashPassword, verifyPassword, burnVerify
};
