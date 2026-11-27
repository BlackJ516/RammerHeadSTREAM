'use strict';
// File helpers shared by the plug-in management tools.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const fail = (msg) => { console.error('error: ' + msg); process.exit(1); };

function assertNoSymlinks(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isSymbolicLink()) fail(`refusing to install: ${path.relative(dir, p)} is a symlink (plug-ins must not contain symlinks)`);
        if (e.isDirectory() && e.name !== 'node_modules') assertNoSymlinks(p);
    }
}
const copyContents = (from, to) => {
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from)) fs.cpSync(path.join(from, name), path.join(to, name), { recursive: true, verbatimSymlinks: true });
};

/** copies a folder, or extracts an archive, into a fresh temp folder; returns { dir, tmp }. Handles one wrapping folder. */
function stage(source, wantedManifest = 'manifest.json') {
    const abs = path.resolve(source);
    if (!fs.existsSync(abs)) fail('source not found: ' + source);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rh-plugin-'));
    if (fs.statSync(abs).isDirectory()) copyContents(abs, tmp);
    else {
        const r = spawnSync('tar', ['-xf', abs, '-C', tmp], { encoding: 'utf8' });
        if (r.status !== 0) fail('could not extract the archive: ' + (r.stderr || '').trim());
    }
    let dir = tmp;
    const kids = fs.readdirSync(tmp);
    if (!fs.existsSync(path.join(tmp, wantedManifest)) && kids.length === 1 && fs.statSync(path.join(tmp, kids[0])).isDirectory()) dir = path.join(tmp, kids[0]);
    return { dir, tmp };
}

const timestamp = () => new Date().toISOString().replace(/[:.]/g, '-');

module.exports = { fail, assertNoSymlinks, copyContents, stage, timestamp };
