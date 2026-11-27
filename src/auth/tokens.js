const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const b64u = (buf) => Buffer.from(buf).toString('base64url');

/**
 * Stateless signed tokens, so every worker process can verify them without shared memory.
 * A token is `payload.signature`; the signature is HMAC-SHA256 with a secret that is generated once
 * and stored (owner-only) in the data directory. Revocation works by bumping the user's `tokenVersion`.
 */
function loadSecret(dataDir) {
    const file = path.join(dataDir, 'token.secret');
    if (fs.existsSync(file)) return Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');
    const secret = crypto.randomBytes(48);
    try {
        fs.writeFileSync(file, secret.toString('base64'), { mode: 0o600, flag: 'wx' });
        return secret;
    } catch (e) {
        if (e.code === 'EEXIST') return Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64'); // another worker won the race
        throw e;
    }
}

class Tokens {
    constructor(dataDir, ttlMs) {
        this.secret = loadSecret(dataDir);
        this.ttlMs = ttlMs;
    }
    sign(payloadObj) {
        const payload = b64u(JSON.stringify(payloadObj));
        const sig = b64u(crypto.createHmac('sha256', this.secret).update(payload).digest());
        return payload + '.' + sig;
    }
    issue(username, tokenVersion) {
        const now = Date.now();
        return this.sign({ u: username, v: tokenVersion, iat: now, exp: now + this.ttlMs });
    }
    /** @returns {{u:string,v:number,iat:number,exp:number}|null} */
    verify(token) {
        if (typeof token !== 'string' || token.length > 1024) return null;
        const [payload, sig] = token.split('.');
        if (!payload || !sig) return null;
        const expected = crypto.createHmac('sha256', this.secret).update(payload).digest();
        const given = Buffer.from(sig, 'base64url');
        if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
        try {
            const obj = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
            if (typeof obj.u !== 'string' || typeof obj.exp !== 'number' || obj.exp < Date.now()) return null;
            return obj;
        } catch (e) {
            return null;
        }
    }
}

module.exports = Tokens;
