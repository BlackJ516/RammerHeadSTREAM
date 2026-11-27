'use strict';
const clientIpTrust = (req, trusted) => {
    const peer = String((req.socket && req.socket.remoteAddress) || '').replace(/^::ffff:/i, '');
    return trusted.map((a) => String(a).replace(/^::ffff:/i, '')).includes(peer);
};

/** true when the visitor reached us over HTTPS (directly, or through a proxy we trust) */
function isSecure(req, trustedProxies = []) {
    if (req.socket && req.socket.encrypted) return true;
    return clientIpTrust(req, trustedProxies) && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

/** Content-security policy for the site's own pages: only this site's own scripts, styles and images run. */
function buildCsp() {
    const policy = {
        'default-src': ["'self'"], 'script-src': ["'self'"], 'style-src': ["'self'"], 'img-src': ["'self'", 'data:'],
        'connect-src': ["'self'"], 'font-src': ["'self'"], 'object-src': ["'none'"], 'base-uri': ["'none'"],
        'frame-ancestors': ["'none'"], 'form-action': ["'self'"]
    };
    return Object.entries(policy).map(([k, v]) => `${k} ${v.join(' ')}`).join('; ');
}

/**
 * @param {object} o
 * @param {string[]} o.trustProxy
 * @param {() => {name:string, route:string}[]} o.getPages  the rendered pages (filled after startup)
 */
function createHeaderPolicy({ trustProxy, getPages }) {
    const csp = buildCsp();
    const common = {
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'X-Frame-Options': 'DENY',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'
    };
    return function headersFor(req) {
        const pathname = new URL(req.url, 'http://x').pathname;
        const headers = { ...common };
        const pages = getPages();
        const page = pages.find((p) => p.route === pathname || '/' + p.name + '.html' === pathname || (p.name === 'index' && pathname === '/index.html'));
        if (page) {
            headers['Content-Security-Policy'] = csp;
            headers['Cache-Control'] = 'no-cache';
        } else if (pathname.startsWith('/api/') || /^\/(newsession|editsession|deletesession|sessionexists|mainport)$/.test(pathname)) {
            headers['X-Robots-Tag'] = 'noindex, nofollow';
        }
        if (isSecure(req, trustProxy)) headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
        return headers;
    };
}

module.exports = { createHeaderPolicy, buildCsp, isSecure };
