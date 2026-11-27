/**
 * Sliding-window failure limiter. Per process (rammerhead's sticky sessions keep one IP on one worker).
 * Keys are cleared on success. Memory is bounded by periodic cleanup.
 */
class RateLimiter {
    constructor({ maxFailures, windowMs, lockMs }) {
        this.maxFailures = maxFailures;
        this.windowMs = windowMs;
        this.lockMs = lockMs;
        this.map = new Map();
        this.timer = setInterval(() => this._sweep(), 60000);
        this.timer.unref();
    }
    _sweep() {
        const now = Date.now();
        for (const [k, v] of this.map) if (v.lockedUntil < now && now - v.first > this.windowMs) this.map.delete(k);
    }
    /** @returns {number} ms until allowed again, 0 if allowed */
    check(key) {
        const e = this.map.get(key);
        if (!e) return 0;
        const now = Date.now();
        return e.lockedUntil > now ? e.lockedUntil - now : 0;
    }
    fail(key) {
        const now = Date.now();
        let e = this.map.get(key);
        if (!e || now - e.first > this.windowMs) e = { count: 0, first: now, lockedUntil: 0 };
        e.count++;
        if (e.count >= this.maxFailures) e.lockedUntil = now + this.lockMs;
        this.map.set(key, e);
    }
    success(key) {
        this.map.delete(key);
    }
}

module.exports = RateLimiter;
