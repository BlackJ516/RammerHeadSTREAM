'use strict';
const addStaticDirToProxy = require('../util/addStaticDirToProxy');
const { PageRenderer } = require('./render');
const { createHeaderPolicy } = require('./securityHeaders');
const packageJson = require('../../package.json');

/**
 * Serves the site's own pages and assets, adds security headers to them, and publishes robots.txt.
 * @returns {{pages: object[]}}
 */
module.exports = function setupSiteRoutes(http, { config, reservedRoutes, logger }) {
    const site = config.site;
    const renderer = new PageRenderer({ publicDir: config.publicDir, site, appVersion: packageJson.version });
    const state = { pages: [] };

    // security headers on every route this server answers itself (never on proxied third-party pages)
    const headersFor = createHeaderPolicy({ trustProxy: (config.network && config.network.trustProxy) || [], getPages: () => state.pages });
    http.addToOnRequestPipeline((req, res, _serverInfo, isRoute) => {
        if (!isRoute) return;
        for (const [k, v] of Object.entries(headersFor(req))) res.setHeader(k, v);
    });

    state.pages = addStaticDirToProxy(http, config.publicDir, {
        forbiddenRoutes: reservedRoutes,
        ignore: (file) => !site.engineGuide && file === 'engine.html',
        render: (name, source, pagePath) => {
            try {
                return renderer.render(source, pagePath);
            } catch (e) {
                throw new Error(`could not render page "${name}": ${e.message}`, { cause: e });
            }
        }
    }).pages;

    // keep crawlers out of the API and session routes
    http.GET('/robots.txt', (req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });
        res.end(['User-agent: *', 'Disallow: /api/', 'Disallow: /newsession', 'Disallow: /editsession', 'Disallow: /deletesession', 'Disallow: /sessionexists', 'Disallow: /mainport', 'Allow: /', ''].join('\n'));
    });

    if (logger && !state.pages.some((p) => p.name === 'index')) logger.warn('(site) no index.html found in the public folder');
    return state;
};
