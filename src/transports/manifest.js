'use strict';
const fs = require('fs');
const path = require('path');
const { nodeRangeOk } = require('../engine/manifest');

/** Transport plug-in contract versions this core understands. */
const SUPPORTED_CONTRACTS = [1];
const SLUG = /^[a-z0-9][a-z0-9-]{0,31}$/;
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

/**
 * Reads and checks <dir>/manifest.json of a transport plug-in without running any of its code.
 *
 *   { "contract": 1, "id": "libcurl", "name": "libcurl", "version": "2.0.6",
 *     "description": "...", "license": "AGPL-3.0-only",
 *     "entry": "index.js",          optional: a server part, exporting create(host)
 *     "assets": "public",           optional: a folder served read-only at /transports/<id>/
 *     "engines": ["*"],             optional: engine ids this transport works with ("*" = any)
 *     "node": ">=20" }
 *
 * @param {string} dir  the plug-in folder; its name must equal the manifest id
 * @returns {{ok:boolean, errors:string[], manifest?:object, entryPath?:string, assetsDir?:string}}
 */
function readTransportManifest(dir) {
    const file = path.join(dir, 'manifest.json');
    if (!fs.existsSync(file)) return { ok: false, errors: ['no manifest.json'] };
    let m;
    try {
        m = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        return { ok: false, errors: ['manifest.json is not valid JSON: ' + e.message] };
    }
    if (m === null || typeof m !== 'object' || Array.isArray(m)) return { ok: false, errors: ['manifest.json must be an object'] };
    const errors = [];
    if (!Number.isInteger(m.contract)) errors.push('"contract" must be an integer');
    else if (!SUPPORTED_CONTRACTS.includes(m.contract)) errors.push(`transport contract v${m.contract} is not supported (this application supports v${SUPPORTED_CONTRACTS.join(', v')})`);
    if (typeof m.id !== 'string' || !SLUG.test(m.id)) errors.push('"id" must be a lowercase slug such as "libcurl"');
    else if (path.basename(path.resolve(dir)) !== m.id) errors.push(`the folder must be named "${m.id}" to match the manifest id`);
    if (typeof m.name !== 'string' || !m.name.trim()) errors.push('"name" is required');
    if (typeof m.version !== 'string' || !SEMVER.test(m.version)) errors.push('"version" must be semver, e.g. "2.0.6"');
    if (m.engines !== undefined && (!Array.isArray(m.engines) || m.engines.some((x) => typeof x !== 'string'))) errors.push('"engines" must be a list of engine ids, or ["*"]');
    if (m.node !== undefined && !nodeRangeOk(m.node)) errors.push(`needs Node ${m.node}, running ${process.versions.node}`);

    const inside = (rel) => {
        const abs = path.resolve(dir, rel);
        const r = path.relative(path.resolve(dir), abs);
        return !r.startsWith('..') && !path.isAbsolute(r) ? abs : null;
    };
    let entryPath;
    if (m.entry !== undefined) {
        entryPath = typeof m.entry === 'string' ? inside(m.entry) : null;
        if (!entryPath) errors.push('"entry" must be a path inside the plug-in folder');
        else if (!fs.existsSync(entryPath)) errors.push(`entry file "${m.entry}" does not exist`);
    }
    let assetsDir;
    if (m.assets !== undefined) {
        assetsDir = typeof m.assets === 'string' ? inside(m.assets) : null;
        if (!assetsDir) errors.push('"assets" must be a folder inside the plug-in folder');
        else if (!fs.existsSync(assetsDir) || !fs.statSync(assetsDir).isDirectory()) errors.push(`assets folder "${m.assets}" does not exist`);
    }
    if (errors.length) return { ok: false, errors, manifest: typeof m.id === 'string' ? m : undefined };
    return { ok: true, errors: [], manifest: { engines: ['*'], ...m }, entryPath, assetsDir };
}

/** does a transport that lists `engines` work with the engine called `engineId`? */
const compatibleWithEngine = (manifest, engineId) => {
    const list = manifest.engines || ['*'];
    return list.includes('*') || (!!engineId && list.includes(engineId));
};

module.exports = { SUPPORTED_CONTRACTS, readTransportManifest, compatibleWithEngine };
