const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * JSON file store for accounts and invite codes. Safe for rammerhead's multi-process (cluster) mode:
 *  - writes are read-modify-write under an exclusive lock file
 *  - files are written atomically (temp file + rename) with owner-only permissions
 *  - reads are cached by file mtime/size so every worker sees other workers' changes
 */
class UserStore {
    constructor(dataDir) {
        this.dir = dataDir;
        this.file = path.join(dataDir, 'auth.json');
        this.lockFile = this.file + '.lock';
        this.cache = null;
        this.cacheKey = null;
        fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    }
    _read() {
        let stat;
        try {
            stat = fs.statSync(this.file);
        } catch (e) {
            return { version: 1, users: {}, invites: {} };
        }
        const key = stat.mtimeMs + ':' + stat.size;
        if (this.cache && this.cacheKey === key) return this.cache;
        const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        data.users = data.users || {};
        data.invites = data.invites || {};
        this.cache = data;
        this.cacheKey = key;
        return data;
    }
    async _lock() {
        const deadline = Date.now() + 8000;
        for (;;) {
            try {
                const fd = await fsp.open(this.lockFile, 'wx', 0o600);
                await fd.close();
                return;
            } catch (e) {
                if (e.code !== 'EEXIST') throw e;
                try {
                    const st = await fsp.stat(this.lockFile);
                    if (Date.now() - st.mtimeMs > 15000) await fsp.unlink(this.lockFile); // stale lock from a crash
                } catch (_) { /* lock vanished between stat and unlink: fine */ }
                if (Date.now() > deadline) throw new Error('could not acquire auth store lock', { cause: e });
                await sleep(20 + Math.random() * 30);
            }
        }
    }
    /** run fn(data) under the lock; fn may mutate data and return a value. Data is saved afterwards. */
    async transaction(fn) {
        await this._lock();
        try {
            this.cacheKey = null; // force fresh read
            const data = JSON.parse(JSON.stringify(this._read()));
            const result = await fn(data);
            const tmp = this.file + '.' + process.pid + '.tmp';
            await fsp.writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
            await fsp.rename(tmp, this.file);
            this.cacheKey = null;
            return result;
        } finally {
            await fsp.unlink(this.lockFile).catch(() => {});
        }
    }
    // usernames are free-form, so never look them up on the object prototype ("constructor", "__proto__", ...)
    getUser(name) {
        const users = this._read().users;
        return Object.prototype.hasOwnProperty.call(users, name) ? { name, ...users[name] } : null;
    }
    userCount() {
        return Object.keys(this._read().users).length;
    }
    listUsers() {
        const { users } = this._read();
        return Object.keys(users).map((name) => ({ name, createdAt: users[name].createdAt, disabled: !!users[name].disabled }));
    }
    hashInvite(code) {
        return sha256(code);
    }
}

module.exports = UserStore;
