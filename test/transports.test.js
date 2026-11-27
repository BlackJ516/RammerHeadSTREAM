// Transport plug-ins: manifests, compatibility rules, loading, and the add / remove / rollback tools.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const makeTestTransport = require('./fixtures/makeTestTransport');
const { readTransportManifest, compatibleWithEngine } = require('../src/transports/manifest');
const { loadTransports, closeTransports, TransportRegistry } = require('../src/transports/registry');
const { normalizeTransportId, evaluateTransports, describeTransports, usableTransports } = require('../src/engine/transports');
const { RECIPES } = require('../src/transports/recipes');

const root = path.join(__dirname, '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rht-'));
const quietLogger = { debug() {}, info() {}, warn() {}, error() {} };

test('names and aliases: "eproxy" is Epoxy, "node" is the built-in HTTP, junk is refused', () => {
    assert.strictEqual(normalizeTransportId('EProxy'), 'epoxy');
    assert.strictEqual(normalizeTransportId('epoxy-transport'), 'epoxy');
    assert.strictEqual(normalizeTransportId('node'), 'http');
    assert.strictEqual(normalizeTransportId('LibCurl'), 'libcurl');
    assert.strictEqual(normalizeTransportId('custom-1'), 'custom-1');
    for (const bad of ['../x', '', 'a b', 5, null, 'x'.repeat(40)]) assert.strictEqual(normalizeTransportId(bad), null);
});

test('manifest rules', () => {
    const parent = tmp();
    assert.ok(readTransportManifest(makeTestTransport(parent, { id: 'good' })).ok);
    assert.match(readTransportManifest(makeTestTransport(parent, { id: 'wrongname', folderName: 'other' })).errors.join(), /must be named "wrongname"/);
    assert.match(readTransportManifest(makeTestTransport(parent, { id: 'future', badManifest: true })).errors.join(), /contract v99/);
    const d = makeTestTransport(parent, { id: 'escape' });
    const m = JSON.parse(fs.readFileSync(path.join(d, 'manifest.json')));
    fs.writeFileSync(path.join(d, 'manifest.json'), JSON.stringify({ ...m, entry: '../../etc/passwd', assets: '../..' }));
    const bad = readTransportManifest(d);
    assert.strictEqual(bad.ok, false);
    assert.match(bad.errors.join(' '), /entry.*inside the plug-in folder/);
    assert.match(bad.errors.join(' '), /assets.*inside the plug-in folder/);
    const none = path.join(parent, 'empty');
    fs.mkdirSync(none);
    assert.match(readTransportManifest(none).errors[0], /no manifest/);
    assert.ok(compatibleWithEngine({ engines: ['*'] }, 'x'));
    assert.ok(compatibleWithEngine({ engines: ['a', 'b'] }, 'b'));
    assert.ok(!compatibleWithEngine({ engines: ['a'] }, 'z'));
});

function registryWith(plugins) {
    const reg = new TransportRegistry();
    for (const p of plugins) reg.entries.set(p.id, { id: p.id, name: p.id, version: '1.0.0', status: p.status || 'ready', errors: p.errors || [], manifest: { engines: p.engines || ['*'] } });
    return reg;
}

test('COMPATIBILITY: a transport is usable only when installed, declared by the engine, made for it, and allowed', () => {
    const reg = registryWith([{ id: 'libcurl' }, { id: 'epoxy', engines: ['other-engine'] }, { id: 'broken', status: 'failed', errors: ['boom'] }, { id: 'extra' }]);
    const caps = { transports: ['node', 'libcurl', 'epoxy', 'bare', 'broken'] };
    const ev = evaluateTransports({ caps, engineId: 'mine', registry: reg, config: {} });
    assert.deepStrictEqual(ev.usable.map((u) => u.id), ['http', 'libcurl']);
    const why = Object.fromEntries(ev.installed.map((i) => [i.id, i.reason]));
    assert.strictEqual(why.libcurl, null);
    assert.strictEqual(why.epoxy, 'incompatible-engine');
    assert.strictEqual(why.broken, 'not-loaded');
    assert.strictEqual(why.extra, 'engine-does-not-declare', 'installed but the engine does not support it: unusable');
    // declared but never installed is not usable either
    assert.ok(!ev.usable.some((u) => u.id === 'bare'));
    // an engine that declares nothing offers only the built-in method
    assert.deepStrictEqual(usableTransports({ caps: {}, engineId: 'mine', registry: reg, config: {} }), ['http']);
    // engine-internal transports need no plug-in
    assert.deepStrictEqual(usableTransports({ caps: { transports: ['http', 'bare'], builtinTransports: ['bare'] }, registry: reg, config: {} }), ['http', 'bare']);
    // the administrator can narrow the list
    assert.deepStrictEqual(usableTransports({ caps, engineId: 'mine', registry: reg, config: { allowed: ['http'] } }), ['http']);
    assert.strictEqual(evaluateTransports({ caps, engineId: 'mine', registry: reg, config: { allowed: ['http'] } }).installed.find((i) => i.id === 'libcurl').reason, 'blocked');
});

test('describe: defaults, fallback and the "can be added" list come out right', () => {
    const reg = registryWith([{ id: 'libcurl' }]);
    const d = describeTransports({ caps: { transports: ['http', 'libcurl'], transportTest: true }, engineId: 'mine', registry: reg, config: { default: 'libcurl', fallback: 'http' } });
    assert.strictEqual(d.default, 'libcurl');
    assert.strictEqual(d.fallback, 'http');
    assert.ok(d.available.every((a) => a.canTest));
    assert.deepStrictEqual(d.addable.map((a) => a.id).sort(), ['bare', 'epoxy']);
    // a default that is not usable falls back to something that is
    assert.strictEqual(describeTransports({ caps: { transports: ['http'] }, registry: reg, config: { default: 'libcurl' } }).default, 'http');
});

test('recipes only name official packages, and carry a license to show', () => {
    assert.deepStrictEqual(Object.keys(RECIPES).sort(), ['bare', 'epoxy', 'libcurl']);
    for (const r of Object.values(RECIPES)) {
        assert.match(r.package, /^@mercuryworkshop\/[a-z0-9-]+$/);
        assert.ok(r.license && r.range && r.needs);
    }
});

test('loading: a bad plug-in is reported and skipped, the good ones still load, assets and server parts are registered', async () => {
    const dir = tmp();
    makeTestTransport(dir, { id: 'good', server: true });
    makeTestTransport(dir, { id: 'badmanifest', badManifest: true });
    makeTestTransport(dir, { id: 'crashes', throwOnLoad: true });
    fs.mkdirSync(path.join(dir, '_backups'));
    fs.mkdirSync(path.join(dir, '.hiddenfolder'));
    const routes = [];
    const http = { GET: (r) => routes.push(r), POST() {}, addToOnRequestPipeline() {}, addToOnUpgradePipeline() {} };
    const reg = await loadTransports(dir, { logger: quietLogger, http, guard: {}, auth: {} }, []);
    const byId = Object.fromEntries(reg.list().map((e) => [e.id, e.status]));
    assert.deepStrictEqual(byId, { badmanifest: 'invalid', crashes: 'failed', good: 'ready' });
    assert.ok(routes.includes('/transports/good/index.mjs'));
    assert.ok(routes.includes('/transports/good/ping'), "the plug-in's own server part registered a route");
    assert.ok(!routes.some((r) => /_private|\.hidden|secret|manifest/.test(r)), 'only the assets folder is published, and never _ or . names');
    assert.strictEqual(reg.instance('crashes'), null);
    assert.strictEqual(typeof reg.instance('good').test, 'function');
    await closeTransports(reg);
    assert.strictEqual(global.__closed_good, true, 'plug-ins are told to shut down');
});

// ---- the command line tool ----
const cli = (dir, ...args) => spawnSync('node', ['scripts/transport.js', ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, RAMMERHEAD_TRANSPORTS_DIR: dir } });

test('CLI: install, replace (old one backed up), remove (backed up), rollback, list', () => {
    const dir = tmp();
    const src1 = makeTestTransport(tmp(), { id: 'demo', version: '1.0.0' });
    let r = cli(dir, 'install', src1);
    assert.strictEqual(r.status, 0, r.stderr + r.stdout);
    assert.ok(fs.existsSync(path.join(dir, 'demo', 'manifest.json')));
    assert.match(cli(dir, 'list').stdout, /installed\s+demo\s+Test demo 1\.0\.0/);

    const src2 = makeTestTransport(tmp(), { id: 'demo', version: '2.0.0' });
    r = cli(dir, 'install', src2);
    assert.match(r.stdout, /backed up the existing "demo"/);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'demo', 'manifest.json'))).version, '2.0.0');

    r = cli(dir, 'remove', 'demo');
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(!fs.existsSync(path.join(dir, 'demo')));
    const backups = fs.readdirSync(path.join(dir, '_backups'));
    assert.ok(backups.some((b) => /demo-2\.0\.0/.test(b)) && backups.some((b) => /demo-1\.0\.0/.test(b)));

    r = cli(dir, 'rollback');
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'demo', 'manifest.json'))).version, '2.0.0', 'the latest backup comes back');
    assert.strictEqual(cli(dir, 'validate').status, 0);
});

test('CLI: refuses invalid plug-ins, symlinks, unknown names and the built-in method; installs nothing', () => {
    const dir = tmp();
    assert.notStrictEqual(cli(dir, 'install', makeTestTransport(tmp(), { id: 'future', badManifest: true })).status, 0);
    const linked = makeTestTransport(tmp(), { id: 'linked' });
    fs.symlinkSync('/etc/passwd', path.join(linked, 'sneaky'));
    const r = cli(dir, 'install', linked);
    assert.notStrictEqual(r.status, 0);
    assert.match(r.stderr, /symlink/);
    assert.notStrictEqual(cli(dir, 'add', 'notreal', '--accept-license').status, 0);
    assert.match(cli(dir, 'remove', 'http').stderr, /cannot be removed/);
    assert.match(cli(dir, 'remove', 'ghost').stderr, /not installed/);
    assert.deepStrictEqual(fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f !== '_backups') : [], []);
});

test('CLI: "add" shows the license and downloads NOTHING until it is accepted', () => {
    const dir = tmp();
    const r = cli(dir, 'add', 'eproxy'); // the alias works
    assert.strictEqual(r.status, 2);
    assert.match(r.stdout, /Epoxy/);
    assert.match(r.stdout, /License:\s+AGPL-3\.0-only/);
    assert.match(r.stdout, /--accept-license/);
    assert.deepStrictEqual(fs.readdirSync(dir), [], 'nothing was installed');
});
