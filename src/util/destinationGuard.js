const net = require('net');
const dns = require('dns');

/**
 * Destination safety for the proxy: which URLs a user may ask the server to fetch.
 *  1. protocol allow-list (blocks file:, ftp:, gopher:, data:, ...)  -> no reading server files
 *  2. port deny-list (SMTP, databases, ...)                          -> no talking to non-web services
 *  3. address deny-list checked at CONNECT time (not just on the name) -> no loopback / private / metadata,
 *     and no DNS-rebinding, because the address that was checked is the address that is connected to.
 */
const DEFAULTS = {
    allowedProtocols: ['http:', 'https:', 'ws:', 'wss:'],
    blockedPorts: [22, 23, 25, 110, 135, 139, 143, 445, 465, 587, 993, 995, 1433, 2049, 3306, 3389, 5432, 5900, 6379, 9200, 11211, 27017],
    allowPrivateDestinations: false
};

const blocked = new net.BlockList();
for (const [addr, prefix] of [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
    ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
    ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]
]) blocked.addSubnet(addr, prefix, 'ipv4');
for (const [addr, prefix] of [
    ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['2001:db8::', 32],
    ['2001::', 32], ['2002::', 16], ['64:ff9b::', 96], ['100::', 64]
]) blocked.addSubnet(addr, prefix, 'ipv6');

/** @param {string} ip */
function isBlockedAddress(ip) {
    const kind = net.isIP(ip);
    if (!kind) return true; // not an address we understand: fail closed
    if (kind === 4) return blocked.check(ip, 'ipv4');
    // IPv4-mapped IPv6 (::ffff:a.b.c.d or ::ffff:7f00:1) is judged by its IPv4 address
    const m = ip.toLowerCase().match(/^::ffff:(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/);
    if (m) {
        const v4 = m[1] || [parseInt(m[2], 16) >> 8, parseInt(m[2], 16) & 255, parseInt(m[3], 16) >> 8, parseInt(m[3], 16) & 255].join('.');
        return blocked.check(v4, 'ipv4');
    }
    return blocked.check(ip, 'ipv6');
}

/**
 * Parse the destination out of a proxy request path `/<sessionId>/<destination url>` (already unshuffled).
 * hammerhead's own parser mis-handles IPv6 hosts and ws: URLs, so this uses the WHATWG URL parser.
 * @returns {URL|null}
 */
function parseDestination(reqUrl) {
    const m = String(reqUrl || '').match(/^(?:[a-z0-9]+:\/\/[^/]+)?\/[^/]+\/([^]+)/i);
    if (!m) return null;
    try {
        return new URL(m[1].replace(/^(https?|wss?):\/(?!\/)/i, '$1://')); // tolerate a collapsed "//"
    } catch (e) {
        return null;
    }
}

/**
 * @returns {string|null} a reason if the destination must be refused
 */
function checkDestination(url, options = DEFAULTS) {
    if (!url) return 'unparseable destination';
    if (!options.allowedProtocols.includes(url.protocol)) return `protocol ${url.protocol} is not allowed`;
    const port = Number(url.port || (url.protocol === 'https:' || url.protocol === 'wss:' ? 443 : 80));
    if (options.blockedPorts.includes(port)) return `port ${port} is not allowed`;
    if (!options.allowPrivateDestinations) {
        const host = url.hostname.replace(/^\[|\]$/g, '');
        if (net.isIP(host) && isBlockedAddress(host)) return 'private or reserved address';
        if (/^localhost$|\.localhost$|\.local$|\.internal$/i.test(host)) return 'local hostname';
    }
    return null;
}

/** dns.lookup replacement that refuses to connect to blocked addresses (also defeats DNS rebinding). */
function makeSafeLookup(onBlocked) {
    return function safeLookup(hostname, opts, cb) {
        if (typeof opts === 'function') [cb, opts] = [opts, {}];
        dns.lookup(hostname, { ...opts, all: true }, (err, addrs) => {
            if (err) return cb(err);
            const bad = addrs.find((a) => isBlockedAddress(a.address));
            if (bad) {
                if (onBlocked) onBlocked(hostname, bad.address);
                const e = new Error(`ENOTFOUND blocked destination ${hostname}`);
                e.code = 'ENOTFOUND';
                return cb(e);
            }
            if (opts && opts.all) return cb(null, addrs);
            cb(null, addrs[0].address, addrs[0].family);
        });
    };
}

/**
 * Builds the object handed to the engine as host.guard. The engine enforces it on its own connections:
 *  - checkDestination(url)  -> reason | null     (protocol, port, IP-literal checks; call before connecting)
 *  - parseDestination(path) -> URL | null        (reads the destination out of a proxy path)
 *  - lookup                 -> dns.lookup-compatible function that refuses private addresses (null when allowed)
 *  - checkProxyHost(host)   -> Promise<reason | null>
 */
function createGuard(options, logger) {
    const opts = { ...DEFAULTS, ...options };
    if (opts.allowPrivateDestinations && logger) {
        logger.warn('(guard) allowPrivateDestinations is ON: users can reach loopback/private addresses through this proxy');
    }
    return {
        options: opts,
        checkDestination: (url) => checkDestination(url, opts),
        parseDestination,
        lookup: opts.allowPrivateDestinations ? null : makeSafeLookup((host, addr) => logger && logger.warn(`(guard) blocked connect to ${host} -> ${addr}`)),
        checkProxyHost: (host) => checkProxyHost(host, opts)
    };
}

/** For validating a user-supplied upstream proxy host. @returns {Promise<string|null>} a reason or null */
async function checkProxyHost(host, options = DEFAULTS) {
    if (options.allowPrivateDestinations) return null;
    const bare = String(host).replace(/^\[|\](?::\d+)?$|:\d+$/g, '');
    const addrs = net.isIP(bare) ? [{ address: bare }] : await dns.promises.lookup(bare, { all: true }).catch(() => []);
    if (!addrs.length) return 'cannot resolve the proxy host';
    return addrs.some((a) => isBlockedAddress(a.address)) ? 'the proxy host is a private or reserved address' : null;
}

module.exports = { DEFAULTS, isBlockedAddress, parseDestination, checkDestination, makeSafeLookup, createGuard, checkProxyHost };
