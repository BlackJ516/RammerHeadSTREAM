// Copy this file to config.js to change settings. Only list what you want to change; everything else keeps its default.
// All defaults and their explanations are in src/config.js.
const path = require('path');

module.exports = {
    // Listen address. Keep '127.0.0.1' when something else (nginx) is in front; use '0.0.0.0' only on a private network.
    // bindingAddress: '127.0.0.1',
    // port: 8080,
    // crossDomainPort: 8081,

    // Who may create accounts: 'open' | 'invite' | 'closed'.
    // The default is 'open' on localhost and 'invite' on any other address. Make invite codes with: npm run auth -- invite
    // auth: { registration: 'invite', dataDir: path.join(__dirname, 'data'), tokenTtlDays: 30 },

    // Behind nginx / a load balancer: the addresses of the proxies you trust, so real client IPs are used. See docs/NETWORKING.md
    // network: { trustProxy: ['127.0.0.1'], allowPrivateDestinations: false },

    // Public address clients use to reach you (needed behind a reverse proxy / on a domain)
    // getServerInfo: () => ({ hostname: 'stream.example.com', port: 443, crossDomainPort: 8443, protocol: 'https:' }),

    // Script parser used when users have not chosen one: 'js' (default) or 'wasm' (experimental, see docs/WASM.md)
    // scriptEngine: { default: 'js' },

    // Shown on the Privacy, Terms and Report pages. reportEmail is optional (where abuse reports can be sent).
    // site: { name: 'Rammerhead Stream', operator: 'Your name or organisation', reportEmail: 'reports@example.com', engineGuide: true },

    // How requests are carried. Users choose in Settings; an engine must support a transport before it can be used.
    // Add transports with `npm run transport -- add libcurl` (see docs/ENGINES.md).
    // transport: { default: 'http', fallback: '', allowed: [] },

    // Allow HTTP/2 from the proxy to destination sites (default). Set true to avoid HTTP/2-related errors.
    // disableHttp2: false,

    // Where the engine lives (see docs/ENGINES.md)
    // engine: { dir: path.join(__dirname, 'engines/active') },
    _example: path.basename(__filename) // harmless marker so this file is a valid module when copied unchanged
};
