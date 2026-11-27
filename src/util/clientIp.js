const strip = (a) => String(a || '').replace(/^::ffff:/i, '');

/**
 * Client address for logging, rate limits and session IP-binding.
 * X-Forwarded-For is honoured only when the TCP peer is one of the configured trusted proxies, and the
 * right-most address that is not itself a trusted proxy is used (so a client cannot prepend a fake one).
 */
module.exports = function clientIp(req, trustedProxies = []) {
    const peer = strip(req.socket && req.socket.remoteAddress);
    if (!trustedProxies.length || !trustedProxies.map(strip).includes(peer)) return peer;
    const header = req.headers && req.headers['x-forwarded-for'];
    if (!header) return peer;
    const chain = String(header).split(',').map((s) => strip(s.trim())).filter(Boolean);
    for (let i = chain.length - 1; i >= 0; i--) if (!trustedProxies.map(strip).includes(chain[i])) return chain[i];
    return peer;
};
