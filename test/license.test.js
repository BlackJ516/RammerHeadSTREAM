// The AGPL license, the two bundled transports and their notices, the "Source code" link, and that the bundled transports are replaceable.
const test = require('node:test');
const assert = require('node:assert');
const { spawn, spawnSync, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { testEngineDir } = require('./helpers/engine');
const makeTestTransport = require('./fixtures/makeTestTransport');
const { readTransportManifest } = require('../src/transports/manifest');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const tracked = () => execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
// built from pieces so this file does not contain the phrases it searches for
const closedLicense = new RegExp(['proprietary', ' software'].join('') + '|' + ['all rights', ' reserved'].join(''), 'i');

test('LICENSE is the genuine GNU AGPL-3.0, and every document agrees', () => {
    const license = read('LICENSE');
    assert.match(license, /^\s*GNU AFFERO GENERAL PUBLIC LICENSE\s+Version 3, 19 November 2007/);
    assert.match(license, /13\. Remote Network Interaction; Use with the GNU General Public License\./);
    assert.ok(license.length > 34000 && license.length < 35000, 'the full text (' + license.length + ' bytes)');
    assert.strictEqual(JSON.parse(read('package.json')).license, 'AGPL-3.0-only');
    assert.match(read('NOTICE.md'), /GNU Affero General Public License/);
    assert.match(read('NOTICE.md'), /site\.sourceUrl/);
    assert.match(read('README.md'), /GNU AGPL-3\.0/);
    for (const f of tracked().filter((x) => /\.(md|html|json|js)$/.test(x) && !/^(transports\/[^/]+\/public\/|package-lock)/.test(x))) {
        assert.doesNotMatch(fs.readFileSync(path.join(root, f), 'utf8'), closedLicense, f + ' still talks about a proprietary license');
    }
});

test('exactly libcurl and Epoxy are bundled, each complete with its license, notice and source', () => {
    const ids = fs.readdirSync(path.join(root, 'transports')).filter((f) => !f.startsWith('.') && !f.startsWith('_')).sort();
    assert.deepStrictEqual(ids, ['epoxy', 'libcurl']);
    const notices = read('THIRD-PARTY-NOTICES.md');
    for (const id of ids) {
        const dir = path.join(root, 'transports', id);
        const m = readTransportManifest(dir);
        assert.ok(m.ok, id + ': ' + m.errors.join('; '));
        assert.strictEqual(m.manifest.license, 'AGPL-3.0-only');
        assert.ok(fs.existsSync(path.join(dir, 'public', 'index.mjs')), id + ' has its built files');
        assert.strictEqual(fs.readFileSync(path.join(dir, 'LICENSE'), 'utf8'), read('LICENSE'), id + ' carries the AGPL text');
        const notice = fs.readFileSync(path.join(dir, 'NOTICE.txt'), 'utf8');
        const pkg = m.manifest.source.replace(/^npm:/, '');
        assert.ok(notice.includes(pkg), id + ' NOTICE names ' + pkg);
        assert.match(notice, /Source code: https:\/\/github\.com\/MercuryWorkshop\//);
        assert.ok(notices.includes(pkg), 'THIRD-PARTY-NOTICES lists ' + pkg);
    }
    assert.ok(notices.includes('libcurl.js') && notices.includes('LGPL-3.0-or-later'), 'the code built into libcurl is credited');
    assert.ok(notices.includes('epoxy-tls'), 'the code built into Epoxy is credited');
    assert.match(notices, /Simon Cheng/);
});

// ---- the "Source code" link ----
const servers = [];
test.after(() => servers.forEach((s) => s.kill()));
async function start(port, env = {}) {
    const child = spawn('node', ['src/server.js'], {
        cwd: root,
        env: { ...process.env, RAMMERHEAD_PORT: String(port), RAMMERHEAD_WORKERS: '0', RAMMERHEAD_ENGINE_DIR: testEngineDir({ transports: ['http', 'libcurl', 'epoxy'] }), RAMMERHEAD_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'rhlic-')), ...env }
    });
    servers.push(child);
    for (let i = 0; i < 60; i++) {
        try { if ((await fetch(`http://localhost:${port}/robots.txt`)).ok) break; } catch (e) { /* wait */ }
        await new Promise((r) => setTimeout(r, 250));
    }
    return `http://localhost:${port}`;
}
const html = async (base, p) => (await fetch(base + p)).text();

test('the Source code link: shown everywhere when configured, absent when not, and never a javascript: link', async () => {
    const withUrl = await start(18420, { RAMMERHEAD_SOURCE_URL: 'https://example.com/me/rammerhead-stream' });
    for (const p of ['/', '/about', '/help', '/privacy', '/terms', '/report', '/status']) {
        assert.match(await html(withUrl, p), /<a href="https:\/\/example\.com\/me\/rammerhead-stream" rel="noopener">Source code<\/a>/, p);
    }
    const about = await html(withUrl, '/about');
    assert.match(about, /GNU Affero General Public License, version 3/);
    assert.match(about, /source code of this site is available at/);
    assert.match(await html(withUrl, '/'), /Free software under the GNU AGPL-3\.0: <a href="https:\/\/example\.com\/me\/rammerhead-stream"/);

    const without = await start(18421, {});
    for (const p of ['/', '/about']) assert.doesNotMatch(await html(without, p), />Source code</, p);
    assert.match(await html(without, '/about'), /Free software/, 'the license is still stated');

    for (const evil of ['javascript:alert(1)', 'data:text/html,hi', 'https://x.com/"><script>alert(1)</script>', 'ftp://example.com']) {
        const bad = await start(18422 + servers.length, { RAMMERHEAD_SOURCE_URL: evil });
        const page = await html(bad, '/about');
        assert.doesNotMatch(page, />Source code</, evil + ' must not become a link');
        assert.doesNotMatch(page, /<script>alert/, evil);
    }
});

// ---- replaceable ----
const cli = (dir, ...args) => spawnSync('node', ['scripts/transport.js', ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, RAMMERHEAD_TRANSPORTS_DIR: dir } });
function copyBundled() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rhbundle-'));
    for (const id of ['libcurl', 'epoxy']) fs.cpSync(path.join(root, 'transports', id), path.join(dir, id), { recursive: true });
    return dir;
}

test('REPLACEABLE: the bundled transports can be removed, brought back, and swapped for another build', () => {
    const dir = copyBundled();
    const listed = cli(dir, 'list').stdout;
    assert.match(listed, /installed\s+libcurl\s+libcurl 2\.0\.6/);
    assert.match(listed, /installed\s+epoxy\s+Epoxy 3\.0\.2/);

    // remove one: it goes to the backups, the other is untouched
    let r = cli(dir, 'remove', 'libcurl');
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(!fs.existsSync(path.join(dir, 'libcurl')));
    assert.ok(fs.existsSync(path.join(dir, 'epoxy', 'manifest.json')));
    assert.match(cli(dir, 'list').stdout, /not installed\s+libcurl/, 'it is offered for adding again');

    // bring it back, byte for byte
    r = cli(dir, 'rollback');
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'libcurl', 'public', 'index.mjs')).length, fs.readFileSync(path.join(root, 'transports', 'libcurl', 'public', 'index.mjs')).length);

    // swap Epoxy for a different build: the old one is backed up, the new one is in place and valid
    const mine = makeTestTransport(fs.mkdtempSync(path.join(os.tmpdir(), 'rhmine-')), { id: 'epoxy', version: '9.9.9' });
    r = cli(dir, 'install', mine);
    assert.strictEqual(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /backed up the existing "epoxy"/);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'epoxy', 'manifest.json'))).version, '9.9.9');
    assert.ok(fs.readdirSync(path.join(dir, '_backups')).some((b) => /epoxy-3\.0\.2/.test(b)), 'the original is kept');
    assert.strictEqual(cli(dir, 'validate').status, 0);
});

test('with the bundled transports installed, a server offers exactly what the engine supports, and serves the real files', async () => {
    const bundled = path.join(root, 'transports');
    const both = await start(18430, { RAMMERHEAD_TRANSPORTS_DIR: bundled });
    const reg = await (await fetch(both + '/api/auth/register', { method: 'POST', body: JSON.stringify({ username: 'bundled', password: 'violet lantern harbor' }) })).json();
    const H = { Authorization: 'Bearer ' + reg.token };
    const st = await (await fetch(both + '/api/engine/status', { headers: H })).json();
    assert.deepStrictEqual(st.transports.available.map((t) => t.id), ['http', 'libcurl', 'epoxy'], 'the engine declares both, and both are installed');
    assert.deepStrictEqual(st.transports.addable.map((a) => a.id), ['bare']);
    assert.ok(st.transports.installed.every((t) => t.usable));

    for (const id of ['libcurl', 'epoxy']) {
        const r = await fetch(`${both}/transports/${id}/index.mjs`);
        assert.strictEqual(r.status, 200);
        assert.match(r.headers.get('content-type'), /javascript/);
        assert.strictEqual((await r.arrayBuffer()).byteLength, fs.statSync(path.join(bundled, id, 'public', 'index.mjs')).size, id + ' is served unchanged');
        for (const hidden of ['LICENSE', 'NOTICE.txt', 'manifest.json']) assert.notStrictEqual((await fetch(`${both}/transports/${id}/${hidden}`)).status, 200, hidden + ' is not served as a file');
    }

    // an engine that supports only HTTP: they are installed but unusable, and the server refuses them
    const httpOnly = await start(18431, { RAMMERHEAD_TRANSPORTS_DIR: bundled, RAMMERHEAD_ENGINE_DIR: testEngineDir({ transports: ['http'] }) });
    const reg2 = await (await fetch(httpOnly + '/api/auth/register', { method: 'POST', body: JSON.stringify({ username: 'httponly', password: 'violet lantern harbor' }) })).json();
    const H2 = { Authorization: 'Bearer ' + reg2.token };
    const st2 = await (await fetch(httpOnly + '/api/engine/status', { headers: H2 })).json();
    assert.deepStrictEqual(st2.transports.available.map((t) => t.id), ['http']);
    assert.deepStrictEqual(st2.transports.installed.map((t) => [t.id, t.reason]).sort(), [['epoxy', 'engine-does-not-declare'], ['libcurl', 'engine-does-not-declare']]);
    const id = await (await fetch(httpOnly + '/newsession', { headers: H2 })).text();
    assert.strictEqual((await fetch(`${httpOnly}/editsession?id=${id}&transport=libcurl`, { headers: H2 })).status, 400);
});
