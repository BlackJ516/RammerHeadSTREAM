const path = require('path');
const { readManifest } = require('./manifest');
const { validateEngine } = require('./contract');

/**
 * Loads whichever engine is installed in the engine folder and reports a precise status instead of crashing.
 * The application core only ever talks to the object this returns, never to engine internals.
 *
 * status: 'ready' | 'missing' | 'invalid-manifest' | 'incompatible' | 'failed'
 */
async function loadEngine(dir, host) {
    const m = readManifest(dir);
    if (!m.ok) {
        return {
            status: m.code, manifest: m.manifest || null, errors: m.errors,
            hint: m.code === 'missing'
                ? 'Put an engine in the engine folder (see docs/ENGINES.md) and run: npm run engine -- validate'
                : 'Fix the engine manifest or install a compatible engine, then run: npm run engine -- validate'
        };
    }
    let mod;
    try {
        mod = require(m.entryPath);
    } catch (e) {
        const missingDep = e && e.code === 'MODULE_NOT_FOUND';
        return {
            status: 'failed', manifest: m.manifest,
            errors: [`could not load the engine entry: ${e.message.split('\n')[0]}`],
            hint: missingDep ? 'The engine is missing a dependency. Run: npm run engine:setup' : 'See the server log for details.'
        };
    }
    if (!mod || typeof mod.create !== 'function') {
        return { status: 'invalid-manifest', manifest: m.manifest, errors: ['the entry file must export a create(host) function'], hint: 'See docs/ENGINES.md' };
    }
    let engine;
    try {
        engine = await mod.create(host);
    } catch (e) {
        return { status: 'failed', manifest: m.manifest, errors: [`engine create() threw: ${e.message}`], hint: 'See the server log for details.' };
    }
    const shapeErrors = validateEngine(engine);
    if (shapeErrors.length) {
        return { status: 'incompatible', manifest: m.manifest, errors: shapeErrors, hint: 'The engine does not implement contract v' + m.manifest.contract + ' completely.' };
    }
    return { status: 'ready', manifest: m.manifest, engine, errors: [], dir: path.resolve(dir) };
}

module.exports = { loadEngine };
