'use strict';
const fs = require('fs');
const path = require('path');
const addStaticDirToProxy = require('../util/addStaticDirToProxy');
const { readTransportManifest } = require('./manifest');

/**
 * What is installed in the transports folder and whether it loaded.
 * Entry status: 'ready' | 'invalid' (bad manifest) | 'failed' (its server part threw)
 */
class TransportRegistry {
    constructor() {
        this.entries = new Map();
    }
    /** @returns {{id, name?, version?, status, errors, manifest?, instance?}[]} */
    list() {
        return [...this.entries.values()];
    }
    get(id) {
        return this.entries.get(id) || null;
    }
    /** the loaded server part of a ready transport (what the engine asks for), or null */
    instance(id) {
        const e = this.entries.get(id);
        return e && e.status === 'ready' ? e.instance || {} : null;
    }
}

/** folder names that are plug-ins (not backups, hidden files or loose files) */
function pluginFolders(dir) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.'))
        .map((d) => d.name)
        .sort();
}

/**
 * Loads every transport plug-in. A broken plug-in is reported and skipped; it never stops the others or the server.
 * Plug-in assets are served read-only at /transports/<id>/ (names starting with "_" or "." are never served).
 *
 * @param {string} dir
 * @param {{http:{GET:Function}, logger:object, [k:string]:any}} host  what plug-in server parts receive
 * @param {string[]} reservedRoutes
 * @param {TransportRegistry} [registry]  an existing registry to fill (the engine already holds a handle to it)
 */
async function loadTransports(dir, host, reservedRoutes, registry = new TransportRegistry()) {
    for (const name of pluginFolders(dir)) {
        const folder = path.join(dir, name);
        const read = readTransportManifest(folder);
        if (!read.ok) {
            registry.entries.set(name, { id: name, name: read.manifest && read.manifest.name, status: 'invalid', errors: read.errors });
            host.logger.warn(`(transports) ${name}: ${read.errors.join('; ')}`);
            continue;
        }
        const entry = { id: read.manifest.id, name: read.manifest.name, version: read.manifest.version, manifest: read.manifest, status: 'ready', errors: [] };
        try {
            if (read.entryPath) {
                const mod = require(read.entryPath);
                if (!mod || typeof mod.create !== 'function') throw new Error('the entry file must export a create(host) function');
                entry.instance = (await mod.create({ ...host, transport: { id: entry.id, dir: folder } })) || {};
            }
            if (read.assetsDir) {
                addStaticDirToProxy(host.http, read.assetsDir, { forbiddenRoutes: reservedRoutes || [] }, `/transports/${entry.id}/`);
            }
        } catch (e) {
            entry.status = 'failed';
            entry.errors = [e.message.split('\n')[0]];
            host.logger.warn(`(transports) ${entry.id} failed to load: ${entry.errors[0]}`);
        }
        registry.entries.set(entry.id, entry);
    }
    return registry;
}

/** ask every loaded transport to release what it holds (called on shutdown) */
async function closeTransports(registry) {
    for (const e of registry.list()) {
        try { if (e.instance && typeof e.instance.close === 'function') await e.instance.close(); } catch (err) { /* shutting down anyway */ }
    }
}

module.exports = { closeTransports, TransportRegistry, loadTransports, pluginFolders };
