#!/usr/bin/env node
/**
 * Engine management for Rammerhead Stream.
 *   npm run engine -- status             what is installed and is it compatible
 *   npm run setup                        installs the app and tells you what to do about the engine
 *   npm run engine -- validate           load it for real (runs the engine's code) and check its health
 *   npm run engine -- setup              install the engine's dependencies and build it
 *   npm run engine -- install <dir|.tgz> back up the current engine, then put the new one in the folder
 *   npm run engine -- backups            list backups
 *   npm run engine -- rollback [name]    put a backup back (the current engine is backed up first)
 *
 * Nothing here runs a new engine's code until you ask: `install` only copies and reads manifest.json;
 * `setup` and `validate` are the explicit steps that execute engine code (npm install uses --ignore-scripts).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { readManifest } = require('../src/engine/manifest');

const config = require('../src/config');
const ENGINE_DIR = config.engine.dir;
const BACKUP_DIR = path.join(path.dirname(ENGINE_DIR), '_backups');

const out = (...a) => console.log(...a);
const fail = (msg) => { console.error('error: ' + msg); process.exit(1); };
const isEmptyDir = (d) => !fs.existsSync(d) || fs.readdirSync(d).filter((f) => f !== '.gitkeep').length === 0;

function assertNoSymlinks(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isSymbolicLink()) fail(`refusing to install: ${path.relative(dir, p)} is a symlink (engines must not contain symlinks)`);
        if (e.isDirectory() && e.name !== 'node_modules') assertNoSymlinks(p);
    }
}
function moveContents(from, to) {
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from)) fs.renameSync(path.join(from, name), path.join(to, name));
}
function copyContents(from, to) {
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from)) fs.cpSync(path.join(from, name), path.join(to, name), { recursive: true, verbatimSymlinks: true });
}
function backupCurrent() {
    if (isEmptyDir(ENGINE_DIR)) return null;
    const m = readManifest(ENGINE_DIR);
    const label = m.manifest ? `${m.manifest.id}-${m.manifest.version}` : 'unknown';
    const name = new Date().toISOString().replace(/[:.]/g, '-') + '_' + label;
    moveContents(ENGINE_DIR, path.join(BACKUP_DIR, name));
    return name;
}

function describe() {
    const m = readManifest(ENGINE_DIR);
    if (!m.ok) {
        out(`engine folder: ${ENGINE_DIR}`);
        out(`status: ${m.code === 'missing' ? 'NO ENGINE INSTALLED' : m.code.toUpperCase()}`);
        m.errors.forEach((e) => out('  - ' + e));
        return m;
    }
    const x = m.manifest;
    const hasPkg = fs.existsSync(path.join(ENGINE_DIR, 'package.json'));
    const depsOk = !hasPkg || fs.existsSync(path.join(ENGINE_DIR, 'node_modules'));
    out(`engine folder: ${ENGINE_DIR}`);
    out(`engine:        ${x.name} ${x.version} (${x.id}), contract v${x.contract}`);
    out(`author:        ${x.author || 'n/a'}`);
    out(`dependencies:  ${hasPkg ? (depsOk ? 'installed' : 'NOT INSTALLED - run: npm run engine:setup') : 'none declared'}`);
    out(`capabilities:  ${JSON.stringify(x.capabilities || {})}`);
    out('manifest:      OK (run "npm run engine -- validate" to load it and check health)');
    return m;
}

async function validate() {
    const m = describe();
    if (!m.ok) process.exit(1);
    const { loadEngine } = require('../src/engine/EngineAdapter');
    const guardLib = require('../src/util/destinationGuard');
    const RammerheadLogging = require('../src/core/logging');
    const logger = new RammerheadLogging({ logLevel: 'warn', generatePrefix: () => '' });
    const host = {
        logger, guard: guardLib.createGuard(config.network, logger),
        // enableWorkers:true means "do not bind ports" for engines that honour it, so validation never opens a socket
        config: { ...config, enableWorkers: true, isMaster: true, sessionStore: { ...config.fileCacheSessionConfig, saveDirectory: fs.mkdtempSync(path.join(os.tmpdir(), 'rh-validate-')) } }
    };
    const r = await loadEngine(ENGINE_DIR, host);
    if (r.status !== 'ready') {
        out(`\nVALIDATION FAILED (${r.status})`);
        r.errors.forEach((e) => out('  - ' + e));
        if (r.hint) out('  hint: ' + r.hint);
        process.exit(1);
    }
    const h = await r.engine.health();
    const id = r.engine.sessions.create({ owner: 'validate', ip: '127.0.0.1' });
    const ok = r.engine.sessions.exists(id) && r.engine.sessions.ownerOf(id) === 'validate';
    r.engine.sessions.remove(id);
    await r.engine.close();
    if (!h || h.ok !== true || !ok) { out('\nVALIDATION FAILED: health() was not ok or the session round-trip failed'); process.exit(1); }
    out('\nVALIDATION PASSED: contract shape OK, health OK, session create/lookup/remove OK');
    process.exit(0);
}

function setup() {
    const m = describe();
    if (!m.ok) process.exit(1);
    const pkg = path.join(ENGINE_DIR, 'package.json');
    if (!fs.existsSync(pkg)) return out('\nnothing to set up (the engine declares no package.json)');
    out('\nInstalling engine dependencies (npm --ignore-scripts)... this runs only npm, not engine code');
    const hasLock = fs.existsSync(path.join(ENGINE_DIR, 'package-lock.json'));
    let r = spawnSync('npm', [hasLock ? 'ci' : 'install', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund'], { cwd: ENGINE_DIR, stdio: 'inherit', shell: process.platform === 'win32' });
    if (r.status !== 0) fail('npm install failed in the engine folder');
    const scripts = JSON.parse(fs.readFileSync(pkg, 'utf8')).scripts || {};
    if (m.manifest.setup && m.manifest.setup.build && scripts.build) {
        out('\nBuilding the engine (runs the engine\'s own "build" script)...');
        r = spawnSync('npm', ['run', 'build'], { cwd: ENGINE_DIR, stdio: 'inherit', shell: process.platform === 'win32' });
        if (r.status !== 0) fail('the engine build failed');
    }
    out('\nsetup complete. Next: npm run engine -- validate');
}

function stage(source) {
    const abs = path.resolve(source);
    if (!fs.existsSync(abs)) fail('source not found: ' + source);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rh-engine-'));
    if (fs.statSync(abs).isDirectory()) copyContents(abs, tmp);
    else {
        const r = spawnSync('tar', ['-xf', abs, '-C', tmp], { encoding: 'utf8' });
        if (r.status !== 0) fail('could not extract the archive: ' + (r.stderr || '').trim());
    }
    // allow archives that wrap everything in one top-level folder
    let dir = tmp;
    const kids = fs.readdirSync(tmp);
    if (!fs.existsSync(path.join(tmp, 'manifest.json')) && kids.length === 1 && fs.statSync(path.join(tmp, kids[0])).isDirectory()) dir = path.join(tmp, kids[0]);
    return { dir, tmp };
}

function install(source) {
    if (!source) fail('usage: npm run engine -- install <folder|archive.tgz>');
    const { dir, tmp } = stage(source);
    try {
        assertNoSymlinks(dir);
        const m = readManifest(dir);
        if (!m.ok) { m.errors.forEach((e) => console.error(' - ' + e)); fail(`not installing: ${m.code}`); }
        const backup = backupCurrent();
        if (backup) out(`backed up the current engine to engines/_backups/${backup}`);
        copyContents(dir, ENGINE_DIR);
        out(`installed ${m.manifest.name} ${m.manifest.version} into ${ENGINE_DIR}`);
        out('next:  npm run engine:setup   (installs its dependencies / builds it)');
        out('       npm run engine -- validate');
        out('if it does not validate:  npm run engine -- rollback');
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

function backups() {
    const list = fs.existsSync(BACKUP_DIR) ? fs.readdirSync(BACKUP_DIR).filter((f) => f !== '.gitkeep').sort() : [];
    if (!list.length) return out('no backups');
    list.forEach((b) => out(b));
    return list;
}

function rollback(name) {
    const list = fs.existsSync(BACKUP_DIR) ? fs.readdirSync(BACKUP_DIR).filter((f) => f !== '.gitkeep').sort() : [];
    if (!list.length) fail('there is no backup to roll back to');
    const pick = name || list[list.length - 1];
    if (!list.includes(pick)) fail('no such backup: ' + pick);
    const current = backupCurrent();
    if (current) out(`saved the current engine as engines/_backups/${current}`);
    moveContents(path.join(BACKUP_DIR, pick), ENGINE_DIR);
    fs.rmdirSync(path.join(BACKUP_DIR, pick));
    out(`restored ${pick}`);
    describe();
}

const [cmd, arg] = process.argv.slice(2);
(async () => {
    switch (cmd) {
        case 'status': return describe().ok ? process.exit(0) : process.exit(1);
        case 'hint': { // used by `npm run setup`: say what to do next, and never fail just because there is no engine yet
            const m = readManifest(ENGINE_DIR);
            if (!m.ok) {
                out('\nThe app is installed. No browsing engine is installed yet, so nothing can be opened until you add one:');
                out('  npm run engine -- install /path/to/engine   then   npm run engine:setup   then   npm run engine -- validate');
                out('Start the app with:  npm start      Engine and transport instructions: docs/ENGINES.md');
            } else {
                out(`\nThe app is installed. Engine found: ${m.manifest.name} ${m.manifest.version}. Next: npm run engine:setup, then npm run engine -- validate, then npm start`);
            }
            return process.exit(0);
        }
        case 'validate': return validate();
        case 'setup': return setup();
        case 'install': return install(arg);
        case 'backups': return backups();
        case 'rollback': return rollback(arg);
        default:
            out('usage: npm run engine -- status | validate | setup | install <dir|.tgz> | backups | rollback [name]');
    }
})().catch((e) => fail(e.stack || e.message));
