const path = require('path');
const fs = require('fs');
const os = require('os');

const enableWorkers = os.cpus().length !== 1;

module.exports = {
    //// HOSTING CONFIGURATION ////

    bindingAddress: '127.0.0.1',
    port: 8080,
    crossDomainPort: 8081,
    publicDir: path.join(__dirname, '../public'), // set to null to disable

    //// ENGINE ////
    // The browsing engine lives in this folder. To upgrade it, empty the folder and put the new engine inside.
    // See docs/ENGINES.md. Run `npm run engine -- status` to check what is installed.
    engine: { dir: path.join(__dirname, '../engines/active') },

    // enable or disable multithreading
    enableWorkers,
    workers: os.cpus().length,

    // ssl object is either null or { key: fs.readFileSync('path/to/key'), cert: fs.readFileSync('path/to/cert') }
    // for more info, see https://nodejs.org/api/https.html#https_https_createserver_options_requestlistener
    ssl: null,

    // this function's return object will determine how the client url rewriting will work.
    // set them differently from bindingAddress and port if rammerhead is being served
    // from a reverse proxy.
    getServerInfo: () => ({ hostname: 'localhost', port: 8080, crossDomainPort: 8081, protocol: 'http:' }),
    // example of non-hard-coding the hostname header
    // getServerInfo: (req) => {
    //     return { hostname: new URL('http://' + req.headers.host).hostname, port: 443, crossDomainPort: 8443, protocol: 'https: };
    // },

    // ACCOUNTS: there is no shared/default password. Every person creates their own account and password in
    // the browser; the server stores only a salted scrypt hash and the browser stores a revocable sign-in token.
    auth: {
        // 'open'   - anyone who can reach the site can create an account
        // 'invite' - sign-up needs a code made with `npm run auth -- invite`
        // 'closed' - no sign-ups; accounts are made with `npm run auth -- create-user <name>`
        // undefined = 'open' when bound to localhost only, otherwise 'invite' (never an open public proxy by default)
        registration: undefined,
        dataDir: path.join(__dirname, '../data'),
        tokenTtlDays: 30
    },

    // disable or enable localStorage sync (turn off if clients send over huge localStorage data, resulting in huge memory usages)
    disableLocalStorageSync: false,

    // restrict sessions to be only used per IP
    restrictSessionToIP: true,

    // caching options for js rewrites. (disk caching not recommended for slow HDD disks)
    // recommended: 50mb for memory, 5gb for disk
    // processed-script cache. { type: 'memory', maxBytes } or { type: 'disk', directory, maxBytes, maxEntries }
    jsCache: { type: 'disk', directory: path.join(__dirname, '../cache-js'), maxBytes: 5 * 1024 * 1024 * 1024, maxEntries: 50000 },

    //// SITE, PAGES AND ADVERTISING ////
    // Information shown on the site's own pages (About, Help, Privacy, Terms, Report abuse, Status).
    // See docs/SITE.md.
    site: {
        name: 'Rammerhead Stream',
        // Who runs this copy (a name or organisation); shown in the policies.
        operator: '',
        // Where the source code of THIS copy is published, for example 'https://example.com/you/your-fork'. The AGPL requires
        // you to offer it to the users of a modified copy that you run as a service; the site then shows a "Source code" link.
        sourceUrl: '',
        // Where abuse reports can be sent. Optional: when empty, the Report page says no address is published.
        reportEmail: '',
        // Show the "How to load an engine" page (/engine.html) and links to it. Turn off once an engine is bundled.
        engineGuide: true
    },

    //// SCRIPT PARSER ////
    // Which parser the engine uses when rewriting page scripts: 'js' (built in) or 'wasm' (WebAssembly, experimental).
    // Users can override this per account in Settings. Measured on 1,482 real scripts the WASM parser produced
    // identical output but was NOT faster (see docs/WASM.md), so the default stays 'js'.
    scriptEngine: { default: 'js' },

    //// CONNECTIONS ////
    // How the engine carries its requests: 'http' (built in), 'libcurl', 'epoxy', 'bare', or any id the engine offers.
    // An engine lists what it supports in manifest.capabilities.transports; anything else is refused. Users pick one in
    // Settings, and can name a fallback. See docs/ENGINES.md.
    transport: {
        // Transport plug-ins live here, one folder each (see docs/ENGINES.md). Add and remove them with `npm run transport`.
        dir: path.join(__dirname, '../transports'),
        default: 'http',  // used until a user chooses
        fallback: '',     // suggested fallback (empty = none)
        allowed: []       // limit what users may choose; empty = everything the engine offers
    },

    //// OUTBOUND DESTINATION SAFETY ////
    // By default users may only reach public web servers: file:, loopback, private-network, link-local and
    // cloud-metadata addresses are refused, and so are ports used by mail servers and databases.
    // Only set allowPrivateDestinations to true on a private deployment where everyone is trusted.
    network: {
        allowedProtocols: ['http:', 'https:', 'ws:', 'wss:'],
        blockedPorts: [22, 23, 25, 110, 135, 139, 143, 445, 465, 587, 993, 995, 1433, 2049, 3306, 3389, 5432, 5900, 6379, 9200, 11211, 27017],
        allowPrivateDestinations: false,
        // Behind nginx / a load balancer / Cloudflare: list the IP addresses of the proxies you trust (e.g. ['127.0.0.1']).
        // The client IP is then read from X-Forwarded-For, but ONLY when the connection really comes from one of them,
        // so clients cannot fake their address. Leave empty when clients connect directly.
        trustProxy: []
    },

    // whether to disable http2 (from the proxy to destination sites). Disabling may reduce errors and memory use,
    // but picky sites like web.whatsapp.com want an http2 connection before their websocket will connect.
    disableHttp2: false,

    //// REWRITE HEADER CONFIGURATION ////

    // removes reverse proxy headers
    // cloudflare example:
    // stripClientHeaders: ['cf-ipcountry', 'cf-ray', 'x-forwarded-proto', 'cf-visitor', 'cf-connecting-ip', 'cdn-loop', 'x-forwarded-for'],
    stripClientHeaders: [],
    // if you want to modify response headers, like removing the x-frame-options header, do it like so:
    // rewriteServerHeaders: {
    //     // you can also specify a function to modify/add the header using the original value (undefined if adding the header)
    //     // 'x-frame-options': (originalHeaderValue) => '',
    //     'x-frame-options': null, // set to null to tell rammerhead that you want to delete it
    // },
    rewriteServerHeaders: {},

    //// SESSION STORE CONFIG ////

    // see src/classes/RammerheadSessionFileCache.js for more details and options
    fileCacheSessionConfig: {
        saveDirectory: path.join(__dirname, '../sessions'),
        cacheTimeout: 1000 * 60 * 20, // 20 minutes
        cacheCheckInterval: 1000 * 60 * 10, // 10 minutes
        deleteUnused: true,
        staleCleanupOptions: {
            staleTimeout: 1000 * 60 * 60 * 24 * 3, // 3 days
            maxToLive: null,
            staleCheckInterval: 1000 * 60 * 60 * 6 // 6 hours
        },
        // corrupted session files happens when nodejs exits abruptly while serializing the JSON sessions to disk
        deleteCorruptedSessions: true,
    },

    //// LOGGING CONFIGURATION ////

    // valid values: 'disabled', 'debug', 'traffic', 'info', 'warn', 'error'
    logLevel: process.env.DEVELOPMENT ? 'debug' : 'info',
    generatePrefix: (level) => `[${new Date().toISOString()}] [${level.toUpperCase()}] `,

    // logger depends on this value
    getIP: (req) => require('./util/clientIp')(req, module.exports.network.trustProxy)
    // use the example below if rammerhead is sitting behind a reverse proxy like nginx
    // getIP: req => (req.headers['x-forwarded-for'] || req.connection.remoteAddress || '').split(',')[0].trim()
};

// Settings in config.js are merged INTO the defaults, level by level, so you only list what you change
// (for example `auth: { registration: 'invite' }` keeps the default `auth.dataDir`). Arrays and functions replace.
function deepMerge(target, source) {
    for (const key of Object.keys(source)) {
        const value = source[key];
        const isPlain = (v) => v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;
        target[key] = isPlain(value) && isPlain(target[key]) ? deepMerge({ ...target[key] }, value) : value;
    }
    return target;
}
if (fs.existsSync(path.join(__dirname, '../config.js'))) deepMerge(module.exports, require('../config'));

// environment overrides (handy for containers and tests); applied last
if (process.env.RAMMERHEAD_ALLOW_PRIVATE === '1') module.exports.network = { ...module.exports.network, allowPrivateDestinations: true };
if (process.env.RAMMERHEAD_ENGINE_DIR) module.exports.engine = { dir: path.resolve(process.env.RAMMERHEAD_ENGINE_DIR) };
if (process.env.RAMMERHEAD_WORKERS !== undefined) {
    module.exports.enableWorkers = Number(process.env.RAMMERHEAD_WORKERS) > 0;
    module.exports.workers = Math.max(1, Number(process.env.RAMMERHEAD_WORKERS));
}
if (process.env.RAMMERHEAD_TRUST_PROXY) module.exports.network = { ...module.exports.network, trustProxy: process.env.RAMMERHEAD_TRUST_PROXY.split(',').map((x) => x.trim()).filter(Boolean) };
if (process.env.RAMMERHEAD_REGISTRATION) module.exports.auth = { ...module.exports.auth, registration: process.env.RAMMERHEAD_REGISTRATION };
if (process.env.RAMMERHEAD_PUBLIC_DIR) module.exports.publicDir = path.resolve(process.env.RAMMERHEAD_PUBLIC_DIR);
if (process.env.RAMMERHEAD_SOURCE_URL) module.exports.site = { ...module.exports.site, sourceUrl: process.env.RAMMERHEAD_SOURCE_URL };
if (process.env.RAMMERHEAD_REPORT_EMAIL) module.exports.site = { ...module.exports.site, reportEmail: process.env.RAMMERHEAD_REPORT_EMAIL };
if (process.env.RAMMERHEAD_ENGINE_GUIDE === '0') module.exports.site = { ...module.exports.site, engineGuide: false };
if (process.env.RAMMERHEAD_TRANSPORTS_DIR) module.exports.transport = { ...module.exports.transport, dir: path.resolve(process.env.RAMMERHEAD_TRANSPORTS_DIR) };
if (process.env.RAMMERHEAD_TRANSPORTS_ALLOWED) module.exports.transport = { ...module.exports.transport, allowed: process.env.RAMMERHEAD_TRANSPORTS_ALLOWED.split(',').map((x) => x.trim()).filter(Boolean) };
if (process.env.RAMMERHEAD_BIND) module.exports.bindingAddress = process.env.RAMMERHEAD_BIND;
if (process.env.RAMMERHEAD_PORT) {
    module.exports.port = Number(process.env.RAMMERHEAD_PORT);
    module.exports.crossDomainPort = Number(process.env.RAMMERHEAD_CROSS_PORT || module.exports.port + 1);
    const { port, crossDomainPort } = module.exports;
    module.exports.getServerInfo = () => ({ hostname: 'localhost', port, crossDomainPort, protocol: 'http:' });
}
if (process.env.RAMMERHEAD_DATA_DIR) {
    module.exports.auth = { ...module.exports.auth, dataDir: process.env.RAMMERHEAD_DATA_DIR };
    module.exports.fileCacheSessionConfig = {
        ...module.exports.fileCacheSessionConfig,
        saveDirectory: path.join(process.env.RAMMERHEAD_DATA_DIR, 'sessions')
    };
    fs.mkdirSync(module.exports.fileCacheSessionConfig.saveDirectory, { recursive: true });
}
