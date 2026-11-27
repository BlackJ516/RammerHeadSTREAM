'use strict';
const net = require('net');

/**
 * Address string -> bytes (4 for IPv4, 16 for IPv6). The same address always gives the same bytes, which is all the
 * load balancer needs to keep one client on one worker process.
 */
function toBuffer(address) {
    const text = String(address || '');
    const kind = net.isIP(text);
    if (kind === 4) return Buffer.from(text.split('.').map(Number));
    if (kind === 6) {
        // IPv4-mapped (::ffff:a.b.c.d) and embedded-IPv4 forms
        let s = text.replace(/%.*$/, '');
        const v4 = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
        if (v4) {
            const b = v4[2].split('.').map(Number);
            s = v4[1] + ((b[0] << 8) | b[1]).toString(16) + ':' + ((b[2] << 8) | b[3]).toString(16);
        }
        const [head, tail] = s.split('::');
        const h = head ? head.split(':') : [];
        const t = tail !== undefined && tail ? tail.split(':') : [];
        const missing = 8 - h.length - t.length;
        const groups = tail === undefined ? h : [...h, ...Array(missing).fill('0'), ...t];
        const out = Buffer.alloc(16);
        groups.forEach((g, i) => out.writeUInt16BE(parseInt(g || '0', 16), i * 2));
        return out;
    }
    // not an address we can parse: hash the text so the result is still stable
    return require('crypto').createHash('sha1').update(text).digest().subarray(0, 4);
}

module.exports = { toBuffer };
