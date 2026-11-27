#!/usr/bin/env node
/**
 * Transport plug-ins for Rammerhead Stream.
 *   npm run transport -- list                       what is installed, and what can be added
 *   npm run transport -- add <libcurl|epoxy|bare> --accept-license
 *                                                   download an official transport from npm (shows its license first)
 *   npm run transport -- install <dir|.tgz>         install a transport plug-in you already have
 *   npm run transport -- remove <id>                take one away (it is backed up, so it can be brought back)
 *   npm run transport -- validate [id]              check manifests and load server parts
 *   npm run transport -- backups | rollback [name]  list backups / restore one
 *
 * Installing only copies files and reads manifest.json: no transport code runs until the server starts (or you validate).
 * A transport is used only if the installed ENGINE supports it. See docs/ENGINES.md.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const config = require('../src/config');
const { readTransportManifest } = require('../src/transports/manifest');
const { pluginFolders } = require('../src/transports/registry');
const { RECIPES } = require('../src/transports/recipes');
const { normalizeTransportId } = require('../src/engine/transports');
const { fail, assertNoSymlinks, copyContents, stage, timestamp } = require('./lib/files');

const DIR = config.transport.dir;
const BACKUPS = path.join(DIR, '_backups');
const out = (...a) => console.log(...a);
const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')));
const [cmd, arg] = process.argv.slice(2).filter((a) => !a.startsWith('--'));

function backup(id) {
    const folder = path.join(DIR, id);
    if (!fs.existsSync(folder)) return null;
    const read = readTransportManifest(folder);
    const label = `${timestamp()}_${id}-${read.manifest && read.manifest.version ? read.manifest.version : 'unknown'}`;
    fs.mkdirSync(BACKUPS, { recursive: true });
    fs.renameSync(folder, path.join(BACKUPS, label));
    return label;
}

function installStaged(dir) {
    assertNoSymlinks(dir);
    // the folder name must equal the manifest id, so read the id first and check the rest in place
    let id;
    try { id = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).id; } catch (e) { fail('manifest.json is missing or not valid JSON'); }
    if (typeof id !== 'string') fail('manifest.json has no "id"');
    const named = path.join(path.dirname(dir), 'check-' + Math.random().toString(36).slice(2), id);
    copyContents(dir, named);
    const read = readTransportManifest(named);
    fs.rmSync(path.dirname(named), { recursive: true, force: true });
    if (!read.ok) { read.errors.forEach((e) => console.error(' - ' + e)); fail('not installing: the manifest is not valid'); }
    fs.mkdirSync(DIR, { recursive: true });
    const old = backup(id);
    if (old) out(`backed up the existing "${id}" to transports/_backups/${old}`);
    copyContents(dir, path.join(DIR, id));
    return read.manifest;
}

function list() {
    out(`transports folder: ${DIR}\n`);
    out('built in      http          Built-in HTTP (always available)');
    const have = new Set();
    for (const name of pluginFolders(DIR)) {
        const r = readTransportManifest(path.join(DIR, name));
        have.add(name);
        out(`installed     ${name.padEnd(13)} ${r.ok ? `${r.manifest.name} ${r.manifest.version}` : 'INVALID: ' + r.errors.join('; ')}`);
    }
    for (const [id, rec] of Object.entries(RECIPES)) {
        if (!have.has(id)) out(`not installed ${id.padEnd(13)} ${rec.name} (${rec.license}) -> npm run transport -- add ${id} --accept-license`);
    }
    out('\nA transport is only usable if the installed engine supports it: see docs/ENGINES.md.');
}

function add(name) {
    const id = normalizeTransportId(name || '');
    const recipe = id && RECIPES[id];
    if (!recipe) fail(`unknown transport "${name || ''}". Available: ${Object.keys(RECIPES).join(', ')}. To install your own, use: npm run transport -- install <folder>`);
    out(`${recipe.name}: ${recipe.description}`);
    out(`Package:  ${recipe.package}@${recipe.range}`);
    out(`License:  ${recipe.license}`);
    out(`Needs:    ${recipe.needs}\n`);
    if (!flags.has('--accept-license')) {
        out('This downloads the official package from npm. Its license applies to it (and may apply to anything that includes it).');
        out('Read the license, then run the same command again with --accept-license to continue.');
        process.exit(2);
    }
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rh-add-'));
    try {
        const pack = spawnSync('npm', ['pack', `${recipe.package}@${recipe.range}`, '--silent'], { cwd: tmp, encoding: 'utf8', shell: process.platform === 'win32' });
        const tgz = (pack.stdout || '').trim().split('\n').pop();
        if (pack.status !== 0 || !tgz) fail('could not download the package from npm: ' + ((pack.stderr || '').trim() || 'no output'));
        const ex = path.join(tmp, 'ex');
        fs.mkdirSync(ex);
        const x = spawnSync('tar', ['-xzf', path.join(tmp, tgz), '-C', ex], { encoding: 'utf8' });
        if (x.status !== 0) fail('could not extract the download');
        const pkgDir = path.join(ex, 'package');
        const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
        const dist = path.join(pkgDir, 'dist');
        if (!fs.existsSync(dist)) fail('the downloaded package has no dist/ folder; it cannot be used as a transport');
        const staged = path.join(tmp, 'stage', id);
        copyContents(dist, path.join(staged, 'public'));
        let hasLicenseFile = false;
        for (const f of fs.readdirSync(pkgDir)) {
            if (/^(license|licence|notice|copying)/i.test(f)) {
                fs.copyFileSync(path.join(pkgDir, f), path.join(staged, f));
                if (/^(license|licence|copying)/i.test(f)) hasLicenseFile = true;
            }
        }
        const pkgLicense = pkg.license || recipe.license;
        // a package that names the AGPL but ships no license file gets this project's copy of the same license text
        if (!hasLicenseFile && /^AGPL-3\.0/.test(String(pkgLicense))) {
            const own = path.join(__dirname, '..', 'LICENSE');
            if (fs.existsSync(own)) fs.copyFileSync(own, path.join(staged, 'LICENSE'));
        }
        const repo = pkg.repository && (typeof pkg.repository === 'string' ? pkg.repository : pkg.repository.url);
        fs.writeFileSync(path.join(staged, 'NOTICE.txt'), [
            `${recipe.name} transport plug-in`,
            '',
            `This folder contains the built files (dist/) of the npm package ${pkg.name}@${pkg.version}.`,
            `License: ${pkgLicense}`,
            `Source code: ${repo ? repo.replace(/^git\+/, '').replace(/\.git$/, '') : 'see the package on npm'}`,
            `npm: https://www.npmjs.com/package/${pkg.name}/v/${pkg.version}`,
            '',
            'Keep this notice and the license with these files. It can be removed or replaced with:',
            `  npm run transport -- remove ${id}`,
            ''
        ].join('\n'));
        fs.writeFileSync(path.join(staged, 'manifest.json'), JSON.stringify({
            contract: 1, id, name: recipe.name, version: pkg.version, description: recipe.description,
            license: pkgLicense, source: `npm:${pkg.name}@${pkg.version}`, assets: 'public', engines: ['*'], notes: recipe.needs
        }, null, 2) + '\n');
        const m = installStaged(staged);
        out(`\ninstalled ${m.name} ${m.version} into transports/${id}/`);
        out(`Its files are served at /transports/${id}/ . It is used only if your engine supports "${id}".`);
        out('Restart the server, then pick it in Settings.');
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

function install(source) {
    if (!source) fail('usage: npm run transport -- install <folder|archive.tgz>');
    const { dir, tmp } = stage(source);
    try {
        const m = installStaged(dir);
        out(`installed ${m.name} ${m.version} into transports/${m.id}/`);
        out('Restart the server, then pick it in Settings. It is used only if your engine supports it.');
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

function remove(id) {
    if (!id) fail('usage: npm run transport -- remove <id>');
    id = normalizeTransportId(id) || id;
    if (id === 'http') fail('the built-in HTTP transport cannot be removed');
    if (!fs.existsSync(path.join(DIR, id))) fail(`"${id}" is not installed`);
    const label = backup(id);
    out(`removed "${id}". It was moved to transports/_backups/${label}; bring it back with: npm run transport -- rollback ${label}`);
    out('Restart the server. Anyone who had chosen it in Settings is moved back to the default automatically.');
}

async function validate(only) {
    const guardLib = require('../src/util/destinationGuard');
    const RammerheadLogging = require('../src/core/logging');
    const logger = new RammerheadLogging({ logLevel: 'warn', generatePrefix: () => '' });
    const noop = () => {};
    const host = { logger, guard: guardLib.createGuard(config.network, logger), http: { GET: noop, POST: noop, addToOnRequestPipeline: noop, addToOnUpgradePipeline: noop }, config: {}, auth: { authenticate: () => null }, engine: null };
    const { loadTransports } = require('../src/transports/registry');
    const registry = await loadTransports(DIR, host, []);
    let bad = 0;
    for (const e of registry.list()) {
        if (only && e.id !== only) continue;
        const ok = e.status === 'ready';
        if (!ok) bad++;
        out(`${ok ? 'OK    ' : 'FAILED'} ${e.id}${ok ? ' ' + e.version : ': ' + (e.errors || []).join('; ')}`);
    }
    if (only && !registry.get(only)) fail(`"${only}" is not installed`);
    out(bad ? `\n${bad} transport(s) have problems.` : '\nAll installed transports are valid.');
    process.exit(bad ? 1 : 0);
}

const backupNames = () => (fs.existsSync(BACKUPS) ? fs.readdirSync(BACKUPS).filter((f) => f !== '.gitkeep').sort() : []);
function backups() {
    const l = backupNames();
    out(l.length ? l.join('\n') : 'no backups');
}
function rollback(name) {
    const l = backupNames();
    if (!l.length) fail('there is no backup to roll back to');
    const pick = name || l[l.length - 1];
    if (!l.includes(pick)) fail('no such backup: ' + pick);
    const read = readTransportManifest(path.join(BACKUPS, pick));
    const id = read.manifest && read.manifest.id;
    if (!id) fail('that backup has no usable manifest');
    const current = backup(id);
    if (current) out(`saved the current "${id}" as transports/_backups/${current}`);
    fs.renameSync(path.join(BACKUPS, pick), path.join(DIR, id));
    out(`restored "${id}". Restart the server.`);
}

(async () => {
    switch (cmd) {
        case 'list': return list();
        case 'add': return add(arg);
        case 'install': return install(arg);
        case 'remove': return remove(arg);
        case 'validate': return validate(arg);
        case 'backups': return backups();
        case 'rollback': return rollback(arg);
        default: out('usage: npm run transport -- list | add <name> --accept-license | install <dir|.tgz> | remove <id> | validate [id] | backups | rollback [name]');
    }
})().catch((e) => fail(e.stack || e.message));
