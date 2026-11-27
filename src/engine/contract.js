/**
 * Shape check for what an engine's create(host) returns. Checks that members exist and are callable, it does not
 * (and cannot) prove behaviour: behaviour is covered by the engine acceptance tests (npm run engine:test).
 */
const REQUIRED = {
    'info': 'object',
    'http': 'object',
    'http.GET': 'function',
    'http.POST': 'function',
    'http.addToOnRequestPipeline': 'function',
    'http.addToOnUpgradePipeline': 'function',
    'sessions': 'object',
    'sessions.create': 'function',
    'sessions.exists': 'function',
    'sessions.ownerOf': 'function',
    'sessions.configure': 'function',
    'sessions.remove': 'function',
    'sessions.shuffleDict': 'function',
    'sessionIdFromUrl': 'function',
    'health': 'function',
    'close': 'function'
};

function validateEngine(engine) {
    const errors = [];
    if (!engine || typeof engine !== 'object') return ['create() must resolve to an object'];
    for (const [pathStr, type] of Object.entries(REQUIRED)) {
        const value = pathStr.split('.').reduce((o, k) => (o == null ? undefined : o[k]), engine);
        if (typeof value !== type) errors.push(`engine.${pathStr} must be a ${type}`);
    }
    if (!engine.http || !Array.isArray(engine.http.servers) || engine.http.servers.length < 1) errors.push('engine.http.servers must be a non-empty array of node http(s) servers');
    if (engine.reservedRoutes !== undefined && !Array.isArray(engine.reservedRoutes)) errors.push('engine.reservedRoutes must be an array when present');
    if (engine.info && (typeof engine.info.id !== 'string' || typeof engine.info.version !== 'string')) errors.push('engine.info needs string "id" and "version"');
    return errors;
}

module.exports = { validateEngine, REQUIRED };
