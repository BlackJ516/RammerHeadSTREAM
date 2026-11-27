'use strict';
/**
 * One-command recipes for the best-known transports. `npm run transport -- add <id>` downloads the official package from npm, copies
 * its built files into transports/<id>/ and records its license, version and source in the folder. libcurl and Epoxy already ship with
 * the project; the recipes put them back after a removal, update them, and add Bare. The licenses below were read from the packages'
 * own metadata; the command shows them before it installs anything.
 */
const RECIPES = {
    libcurl: {
        name: 'libcurl',
        package: '@mercuryworkshop/libcurl-transport',
        range: '^2',
        license: 'AGPL-3.0-only (it uses libcurl.js, LGPL-3.0-or-later)',
        description: 'Requests are made by libcurl compiled to WebAssembly, with end-to-end TLS, over a Wisp connection.',
        needs: 'An engine that can use it, and a Wisp server endpoint.'
    },
    epoxy: {
        name: 'Epoxy',
        package: '@mercuryworkshop/epoxy-transport',
        range: '^3',
        license: 'AGPL-3.0-only',
        description: 'The Epoxy transport: end-to-end TLS with epoxy-tls over a Wisp connection.',
        needs: 'An engine that can use it, and a Wisp server endpoint.'
    },
    bare: {
        name: 'Bare',
        package: '@mercuryworkshop/bare-as-module3',
        range: '^2',
        license: 'LGPL-3.0',
        description: 'The TompHTTP Bare protocol, as a client for Bare-Mux.',
        needs: 'An engine that can use it, and a Bare server endpoint.'
    }
};
module.exports = { RECIPES };
