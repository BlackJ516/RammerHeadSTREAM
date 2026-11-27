const crypto = require('crypto');
const UserStore = require('./UserStore');
const Tokens = require('./tokens');
const RateLimiter = require('./RateLimiter');
const pw = require('./passwords');

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

class AuthError extends Error {
    constructor(status, message, extra = {}) {
        super(message);
        this.status = status;
        this.extra = extra;
    }
}

const isLoopback = (addr) => ['127.0.0.1', 'localhost', '::1'].includes(addr);

/**
 * Per-user accounts. There is no shared/default password: every person creates their own in the
 * browser, the server keeps only a salted scrypt hash, and the browser keeps only a revocable token.
 */
class AuthService {
    /**
     * @param {object} o
     * @param {string} o.dataDir
     * @param {'open'|'invite'|'closed'|undefined} o.registration - default: 'open' on loopback, else 'invite'
     * @param {string} o.bindingAddress
     * @param {number} o.tokenTtlMs
     */
    constructor({ dataDir, registration, bindingAddress, tokenTtlMs = 30 * 24 * 3600 * 1000 }) {
        this.store = new UserStore(dataDir);
        this.tokens = new Tokens(dataDir, tokenTtlMs);
        this.registration = registration || (isLoopback(bindingAddress) ? 'open' : 'invite');
        if (!['open', 'invite', 'closed'].includes(this.registration)) throw new TypeError('invalid auth.registration');
        this.loginIpLimiter = new RateLimiter({ maxFailures: 20, windowMs: 10 * 60e3, lockMs: 10 * 60e3 });
        this.loginUserLimiter = new RateLimiter({ maxFailures: 5, windowMs: 10 * 60e3, lockMs: 5 * 60e3 });
        this.registerLimiter = new RateLimiter({ maxFailures: 8, windowMs: 60 * 60e3, lockMs: 60 * 60e3 });
    }

    status(user) {
        return { registration: this.registration, authenticated: !!user, username: user ? user.name : null };
    }

    _publicToken(user) {
        return this.tokens.issue(user.name, user.tokenVersion || 0);
    }

    async register({ username, password, inviteCode }, ip) {
        if (this.registration === 'closed') throw new AuthError(403, 'registration is closed on this server');
        const wait = this.registerLimiter.check(ip);
        if (wait) throw new AuthError(429, 'too many sign-up attempts, try again later', { retryAfterMs: wait });
        this.registerLimiter.fail(ip); // every attempt counts; limit is per hour

        const uErr = pw.validateUsername(username);
        if (uErr) throw new AuthError(400, uErr, { field: 'username' });
        username = pw.normalizeUsername(username);
        const pErr = pw.validatePassword(password, username);
        if (pErr) throw new AuthError(400, pErr, { field: 'password' });
        if (this.registration === 'invite' && (typeof inviteCode !== 'string' || !inviteCode.trim())) {
            throw new AuthError(403, 'This server needs an invite code to create an account. Enter the code the administrator gave you.', { field: 'invite', code: 'invite_required' });
        }

        const hash = await pw.hashPassword(password);
        const user = await this.store.transaction((data) => {
            if (has(data.users, username)) throw new AuthError(409, 'that username is already taken, please pick another', { field: 'username' });
            if (this.registration === 'invite') {
                const key = this.store.hashInvite(inviteCode.trim());
                const inv = has(data.invites, key) ? data.invites[key] : null;
                if (!inv || (inv.expiresAt && inv.expiresAt < Date.now()) || inv.uses >= inv.maxUses) {
                    throw new AuthError(403, "That invite code isn't valid, has already been used, or has expired.", { field: 'invite', code: 'invite_invalid' });
                }
                inv.uses++;
            }
            data.users[username] = { pw: hash, createdAt: Date.now(), tokenVersion: 0, disabled: false };
            return { name: username, ...data.users[username] };
        });
        return { username, token: this._publicToken(user) };
    }

    async login({ username, password }, ip) {
        username = typeof username === 'string' ? pw.normalizeUsername(username) : '';
        if (typeof password !== 'string' || password.length > 4096) throw new AuthError(400, 'incorrect username or password');
        const userKey = ip + '|' + username;
        const wait = Math.max(this.loginIpLimiter.check(ip), this.loginUserLimiter.check(userKey));
        if (wait) throw new AuthError(429, 'too many failed attempts, try again later', { retryAfterMs: wait });

        const user = this.store.getUser(username);
        let ok = false;
        if (user && !user.disabled) ok = await pw.verifyPassword(password, user.pw);
        else await pw.burnVerify(password);

        if (!ok) {
            this.loginIpLimiter.fail(ip);
            this.loginUserLimiter.fail(userKey);
            throw new AuthError(401, 'incorrect username or password'); // same message for unknown user and bad password
        }
        this.loginUserLimiter.success(userKey);
        return { username, token: this._publicToken(user) };
    }

    /** @returns {{name:string, tokenVersion:number, token?:string}|null} resolved from the Authorization header */
    authenticate(req) {
        const h = req.headers['authorization'];
        if (typeof h !== 'string' || !h.startsWith('Bearer ')) return null;
        const claims = this.tokens.verify(h.slice(7).trim());
        if (!claims) return null;
        const user = this.store.getUser(claims.u);
        if (!user || user.disabled || (user.tokenVersion || 0) !== claims.v) return null;
        // sliding renewal: hand out a fresh token once more than half the lifetime is used
        if (Date.now() - claims.iat > this.tokens.ttlMs / 2) user.token = this._publicToken(user);
        return user;
    }

    async changePassword(user, { currentPassword, newPassword }, ip) {
        const wait = this.loginUserLimiter.check(ip + '|' + user.name);
        if (wait) throw new AuthError(429, 'too many failed attempts, try again later', { retryAfterMs: wait });
        if (typeof currentPassword !== 'string' || !(await pw.verifyPassword(currentPassword, user.pw))) {
            this.loginUserLimiter.fail(ip + '|' + user.name);
            throw new AuthError(401, 'current password is incorrect', { field: 'current' });
        }
        const pErr = pw.validatePassword(newPassword, user.name);
        if (pErr) throw new AuthError(400, pErr, { field: 'password' });
        const hash = await pw.hashPassword(newPassword);
        const updated = await this.store.transaction((data) => {
            if (!has(data.users, user.name)) throw new AuthError(404, 'account not found');
            const u = data.users[user.name];
            u.pw = hash;
            u.tokenVersion = (u.tokenVersion || 0) + 1; // signs out every other device
            return { name: user.name, ...u };
        });
        return { username: user.name, token: this._publicToken(updated) };
    }

    /** Permanently deletes the signed-in user's own account. Needs the password, so a stolen sign-in token is not enough. */
    async deleteAccount(user, { password }, ip) {
        const key = ip + '|' + user.name;
        const wait = this.loginUserLimiter.check(key);
        if (wait) throw new AuthError(429, 'too many failed attempts, try again later', { retryAfterMs: wait });
        if (typeof password !== 'string' || !(await pw.verifyPassword(password, user.pw))) {
            this.loginUserLimiter.fail(key);
            throw new AuthError(401, 'that password is not correct', { field: 'current' });
        }
        await this.store.transaction((data) => {
            if (!has(data.users, user.name)) throw new AuthError(404, 'account not found');
            delete data.users[user.name];
        });
        this.loginUserLimiter.success(key);
    }

    async signOutEverywhere(user) {
        await this.store.transaction((data) => {
            if (data.users[user.name]) data.users[user.name].tokenVersion = (data.users[user.name].tokenVersion || 0) + 1;
        });
    }

    // ---- administrator operations (used by `npm run auth`) ----
    async createInvite({ maxUses = 1, ttlHours = 72 } = {}) {
        const code = crypto.randomBytes(12).toString('base64url');
        await this.store.transaction((data) => {
            data.invites[this.store.hashInvite(code)] = {
                createdAt: Date.now(),
                expiresAt: ttlHours ? Date.now() + ttlHours * 3600e3 : null,
                maxUses,
                uses: 0
            };
        });
        return code;
    }
    async adminSetPassword(username, password) {
        const pErr = pw.validatePassword(password, username);
        if (pErr) throw new AuthError(400, pErr);
        const hash = await pw.hashPassword(password);
        await this.store.transaction((data) => {
            if (!has(data.users, username)) throw new AuthError(404, 'no such user');
            data.users[username].pw = hash;
            data.users[username].tokenVersion = (data.users[username].tokenVersion || 0) + 1;
        });
    }
    async adminSetDisabled(username, disabled) {
        await this.store.transaction((data) => {
            if (!has(data.users, username)) throw new AuthError(404, 'no such user');
            data.users[username].disabled = disabled;
            data.users[username].tokenVersion = (data.users[username].tokenVersion || 0) + 1;
        });
    }
    async adminDelete(username) {
        await this.store.transaction((data) => {
            if (!has(data.users, username)) throw new AuthError(404, 'no such user');
            delete data.users[username];
        });
    }
}

module.exports = { AuthService, AuthError };
