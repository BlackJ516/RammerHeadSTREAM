'use strict';
/**
 * Transports: how the engine carries its requests to the web. The core only knows the NAMES. Whether a transport actually
 * works depends on the engine; an engine lists what it supports in manifest.capabilities.transports, and the core refuses
 * anything else. See docs/ENGINES.md.
 */
const TRANSPORTS = {
    http: {
        name: 'Built-in HTTP',
        description: "The server's own HTTP client. Every engine can be expected to offer this one.",
        aliases: ['node', 'builtin', 'direct']
    },
    libcurl: {
        name: 'libcurl',
        description: 'Requests are made with libcurl. Only available if the installed engine supports it.',
        aliases: ['curl', 'libcurl-transport']
    },
    epoxy: {
        name: 'Epoxy',
        description: 'The Epoxy transport. Only available if the installed engine supports it.',
        aliases: ['eproxy', 'epoxy-transport', 'epoxy-tls']
    },
    bare: {
        name: 'Bare',
        description: 'The Bare transport. Only available if the installed engine supports it.',
        aliases: ['bare-client']
    }
};

const ID = /^[a-z0-9][a-z0-9._-]{0,31}$/;
const aliasMap = new Map();
for (const [id, t] of Object.entries(TRANSPORTS)) {
    aliasMap.set(id, id);
    for (const a of t.aliases) aliasMap.set(a, id);
}

/** 'EProxy' -> 'epoxy', 'node' -> 'http'. Unknown but well-formed ids are kept (engines may offer others). Bad input -> null. */
function normalizeTransportId(raw) {
    if (typeof raw !== 'string') return null;
    const id = raw.trim().toLowerCase();
    if (!ID.test(id)) return null;
    return aliasMap.get(id) || id;
}

/** The transports an engine offers, normalised and de-duplicated; an engine that declares nothing offers 'http'. */
function declaredTransports(declared) {
    const list = Array.isArray(declared) ? declared.map(normalizeTransportId).filter(Boolean) : [];
    return [...new Set(list.length ? list : ['http'])];
}

const { compatibleWithEngine } = require('../transports/manifest');
const { RECIPES } = require('../transports/recipes');

const REASONS = {
    'not-loaded': 'The transport is installed but did not load.',
    'engine-does-not-declare': 'The installed engine does not support this transport.',
    'incompatible-engine': 'This transport is not made for the installed engine.',
    blocked: 'The administrator has turned this transport off.'
};

/**
 * Works out which transports can be used right now, and why the others cannot.
 *
 * A transport can be used only when ALL of these are true:
 *   1. it is the built-in HTTP method, or an engine-internal one the engine lists in capabilities.builtinTransports,
 *      or a plug-in that is installed and loaded;
 *   2. the engine lists it in capabilities.transports;
 *   3. the plug-in's manifest says it works with this engine (engines: ["*"] or the engine's id);
 *   4. the administrator has not excluded it (config.transport.allowed).
 *
 * @param {object} o
 * @param {object} o.caps       engine manifest capabilities
 * @param {string} [o.engineId]
 * @param {import('../transports/registry').TransportRegistry} [o.registry]
 * @param {object} [o.config]   config.transport
 */
function evaluateTransports({ caps = {}, engineId, registry, config = {} }) {
    const declared = declaredTransports(caps.transports);
    const builtin = new Set(['http', ...(Array.isArray(caps.builtinTransports) ? caps.builtinTransports.map(normalizeTransportId).filter(Boolean) : [])]);
    const allowed = (config.allowed || []).map(normalizeTransportId).filter(Boolean);
    const blocked = (id) => allowed.length > 0 && !allowed.includes(id);
    const entries = registry ? registry.list() : [];

    const usable = [];
    for (const id of declared) {
        if (blocked(id)) continue;
        if (builtin.has(id)) usable.push({ id, source: 'builtin' });
        else {
            const e = registry && registry.get(id);
            if (e && e.status === 'ready' && compatibleWithEngine(e.manifest, engineId)) usable.push({ id, source: 'plugin' });
        }
    }

    const installed = entries.map((e) => {
        let reason = null;
        if (e.status !== 'ready') reason = 'not-loaded';
        else if (!declared.includes(e.id)) reason = 'engine-does-not-declare';
        else if (!compatibleWithEngine(e.manifest, engineId)) reason = 'incompatible-engine';
        else if (blocked(e.id)) reason = 'blocked';
        return {
            id: e.id, name: e.name || e.id, version: e.version || '', status: e.status, usable: !reason,
            reason, explanation: reason ? REASONS[reason] : '', detail: e.status !== 'ready' ? (e.errors || []).join(' ') : ''
        };
    });
    return { usable, installed, declared };
}

/** what users may choose (ids only) */
const usableTransports = (opts) => evaluateTransports(opts).usable.map((u) => u.id);

/** the full picture for Settings (signed-in users only) */
function describeTransports(opts) {
    const { usable, installed } = evaluateTransports(opts);
    const { registry, caps = {}, config = {} } = opts;
    const available = usable.map(({ id, source }) => {
        const inst = registry && source === 'plugin' ? registry.instance(id) : null;
        const t = TRANSPORTS[id];
        const m = registry && registry.get(id) && registry.get(id).manifest;
        return {
            id,
            name: t ? t.name : (m && m.name) || id,
            description: (m && m.description) || (t ? t.description : 'Provided by the installed engine.'),
            known: !!t,
            source,
            canTest: !!((inst && typeof inst.test === 'function') || caps.transportTest === true)
        };
    });
    const ids = available.map((t) => t.id);
    const wantedDefault = normalizeTransportId(config.default || 'http');
    const wantedFallback = normalizeTransportId(config.fallback || '');
    const have = new Set((registry ? registry.list() : []).map((e) => e.id));
    const addable = Object.entries(RECIPES)
        .filter(([id]) => !have.has(id))
        .map(([id, r]) => ({ id, name: r.name, license: r.license, command: `npm run transport -- add ${id}` }));
    return {
        available,
        default: ids.includes(wantedDefault) ? wantedDefault : ids[0] || 'http',
        fallback: wantedFallback && ids.includes(wantedFallback) ? wantedFallback : '',
        installed,
        addable
    };
}

module.exports = { TRANSPORTS, normalizeTransportId, declaredTransports, evaluateTransports, usableTransports, describeTransports };
