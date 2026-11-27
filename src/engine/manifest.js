const fs = require('fs');
const path = require('path');

/** Engine contract versions this core can talk to. Raise when the contract changes incompatibly. */
const SUPPORTED_CONTRACTS = [1];

const SLUG = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

function nodeRangeOk(range, version = process.versions.node) {
    // supports the forms engines actually use: ">=16", ">=16.5.0", "16", "*"
    if (!range || range === '*') return true;
    const m = String(range).trim().match(/^(>=|>)?\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
    if (!m) return false;
    const want = [Number(m[2]), Number(m[3] || 0), Number(m[4] || 0)];
    const have = version.split('.').map(Number);
    if (!m[1]) return have[0] === want[0];
    for (let i = 0; i < 3; i++) {
        if (have[i] > want[i]) return true;
        if (have[i] < want[i]) return false;
    }
    return m[1] === '>=';
}

/**
 * Reads and validates <dir>/manifest.json without running any engine code.
 * @returns {{ok:boolean, errors:string[], manifest?:object, entryPath?:string}}
 */
function readManifest(dir) {
    const file = path.join(dir, 'manifest.json');
    if (!fs.existsSync(file)) return { ok: false, code: 'missing', errors: [`no manifest.json in ${dir}`] };
    let m;
    try {
        m = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        return { ok: false, code: 'invalid-manifest', errors: ['manifest.json is not valid JSON: ' + e.message] };
    }
    const errors = [];
    if (m === null || typeof m !== 'object' || Array.isArray(m)) return { ok: false, code: 'invalid-manifest', errors: ['manifest.json must be an object'] };
    if (!Number.isInteger(m.contract)) errors.push('"contract" must be an integer (the engine contract version it implements)');
    if (typeof m.id !== 'string' || !SLUG.test(m.id)) errors.push('"id" must be a lowercase slug such as "my-engine"');
    if (typeof m.name !== 'string' || !m.name.trim()) errors.push('"name" is required');
    if (typeof m.version !== 'string' || !SEMVER.test(m.version)) errors.push('"version" must be semver, e.g. "2.3.0"');
    if (typeof m.entry !== 'string' || !m.entry) errors.push('"entry" is required (path of the JavaScript entry file)');
    if (m.node !== undefined && typeof m.node !== 'string') errors.push('"node" must be a string such as ">=16"');
    if (m.capabilities !== undefined && (typeof m.capabilities !== 'object' || m.capabilities === null)) errors.push('"capabilities" must be an object');

    let entryPath;
    if (typeof m.entry === 'string' && m.entry) {
        entryPath = path.resolve(dir, m.entry);
        const rel = path.relative(path.resolve(dir), entryPath);
        if (rel.startsWith('..') || path.isAbsolute(rel)) errors.push('"entry" must stay inside the engine folder');
        else if (!fs.existsSync(entryPath)) errors.push(`entry file "${m.entry}" does not exist`);
    }
    if (errors.length) return { ok: false, code: 'invalid-manifest', errors, manifest: m };

    if (!SUPPORTED_CONTRACTS.includes(m.contract)) {
        return {
            ok: false, code: 'incompatible', manifest: m,
            errors: [`engine implements contract v${m.contract}, but this application supports v${SUPPORTED_CONTRACTS.join(', v')}. ` +
                'Install an engine built for a supported contract, or upgrade the application.']
        };
    }
    if (!nodeRangeOk(m.node)) {
        return { ok: false, code: 'incompatible', manifest: m, errors: [`engine needs Node ${m.node}, running ${process.versions.node}`] };
    }
    return { ok: true, errors: [], manifest: m, entryPath };
}

module.exports = { SUPPORTED_CONTRACTS, readManifest, nodeRangeOk };
