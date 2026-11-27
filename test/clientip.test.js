const test = require('node:test');
const assert = require('node:assert');
const clientIp = require('../src/util/clientIp');
const req = (peer, xff) => ({ socket: { remoteAddress: peer }, headers: xff === undefined ? {} : { 'x-forwarded-for': xff } });

test('X-Forwarded-For is ignored unless the connection comes from a trusted proxy', () => {
    assert.strictEqual(clientIp(req('203.0.113.9', '1.2.3.4'), []), '203.0.113.9');
    assert.strictEqual(clientIp(req('203.0.113.9', '1.2.3.4'), ['127.0.0.1']), '203.0.113.9'); // spoof attempt
});
test('behind a trusted proxy the real client is used, and prepended fakes are ignored', () => {
    assert.strictEqual(clientIp(req('127.0.0.1', '198.51.100.7'), ['127.0.0.1']), '198.51.100.7');
    assert.strictEqual(clientIp(req('127.0.0.1', '6.6.6.6, 198.51.100.7'), ['127.0.0.1']), '198.51.100.7'); // client faked the first hop
    assert.strictEqual(clientIp(req('::ffff:127.0.0.1', '198.51.100.7'), ['127.0.0.1']), '198.51.100.7');
    assert.strictEqual(clientIp(req('127.0.0.1', '198.51.100.7, 127.0.0.1'), ['127.0.0.1']), '198.51.100.7');
    assert.strictEqual(clientIp(req('127.0.0.1'), ['127.0.0.1']), '127.0.0.1');
});
