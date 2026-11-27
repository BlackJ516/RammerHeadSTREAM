// Builds a TEST-ONLY transport plug-in folder. It does not carry any real traffic; it exists to exercise the plug-in system.
const fs = require('fs');
const path = require('path');

module.exports = function makeTestTransport(parentDir, { id, version = '1.0.0', engines, assets = true, server = false, testOk = true, throwOnLoad = false, badManifest = false, folderName }) {
    const dir = path.join(parentDir, folderName || id);
    fs.mkdirSync(dir, { recursive: true });
    const manifest = { contract: badManifest ? 99 : 1, id, name: 'Test ' + id, version, description: 'test transport ' + id, license: 'MIT', ...(engines ? { engines } : {}) };
    if (assets) {
        manifest.assets = 'public';
        fs.mkdirSync(path.join(dir, 'public'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'public', 'index.mjs'), `export const id = ${JSON.stringify(id)};\n`);
        fs.writeFileSync(path.join(dir, 'public', '_private.txt'), 'must never be served');
        fs.writeFileSync(path.join(dir, 'public', '.hidden'), 'must never be served');
    }
    fs.writeFileSync(path.join(dir, 'secret.txt'), 'outside the assets folder; must never be served');
    if (server || throwOnLoad) {
        manifest.entry = 'index.js';
        fs.writeFileSync(path.join(dir, 'index.js'), throwOnLoad
            ? "exports.create = async () => { throw new Error('server part failed to start'); };"
            : `exports.create = async (host) => {
    host.http.GET('/transports/${id}/ping', (req, res) => { res.end('pong from ${id}'); });
    return { test: async () => (${testOk} ? { ok: true } : { ok: false, error: 'plug-in check failed' }), close: () => { global.__closed_${id.replace(/-/g, '_')} = true; } };
};`);
    }
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    return dir;
};
