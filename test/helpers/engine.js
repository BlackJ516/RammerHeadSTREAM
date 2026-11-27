// Helpers so tests do not depend on a real engine being installed. SOURCE ships with no engine; tests that exercise the
// application use a small test engine, and tests that need a REAL engine (real proxying) run only when one is installed.
const fs = require('fs');
const os = require('os');
const path = require('path');
const makeTestEngine = require('../fixtures/makeTestEngine');
const { readManifest } = require('../../src/engine/manifest');

const realEngineDir = path.join(__dirname, '../../engines/active');

/** true when an actual engine (with its dependencies) is installed in engines/active */
function hasRealEngine() {
    if (!readManifest(realEngineDir).ok) return false;
    const pkg = path.join(realEngineDir, 'package.json');
    return !fs.existsSync(pkg) || fs.existsSync(path.join(realEngineDir, 'node_modules'));
}

/** a fresh engine folder holding a test engine; returns its path */
function testEngineDir(options = {}) {
    return makeTestEngine(fs.mkdtempSync(path.join(os.tmpdir(), 'rhengine-')), { name: 'Fixture', ...options });
}

const NO_ENGINE = { skip: 'no real engine is installed in engines/active (install one to run this test)' };
const needsRealEngine = () => (hasRealEngine() ? {} : NO_ENGINE);

module.exports = { hasRealEngine, testEngineDir, needsRealEngine, realEngineDir };
