const path_ = require('path');

// content types for the files the interface ships (a small table instead of a dependency)
const CONTENT_TYPES = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
    '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
    '.wasm': 'application/wasm', '.map': 'application/json', '.webmanifest': 'application/manifest+json'
};
const contentTypeFor = (file) => CONTENT_TYPES[path_.extname(file).toLowerCase()] || 'application/octet-stream';
const fs = require('fs');
const path = require('path');

// default reserved routes (an engine can supply its own list via engine.reservedRoutes)
const DEFAULT_RESERVED = [
    '/rammerhead.js',
    '/hammerhead.js',
    '/task.js',
    '/iframe-task.js',
    '/messaging',
    '/transport-worker.js',
    '/worker-hammerhead.js'
];

const isDirectory = (dir) => fs.lstatSync(dir).isDirectory();

/**
 * Serves a folder publicly.
 *  - names starting with "_" or "." are NEVER served (partials, .gitkeep, dotfiles)
 *  - .html files are rendered by options.render(name, source) and also answer without the extension (/about for about.html)
 *  - index.html answers on / as well
 *
 * @param {{GET:Function}} proxy
 * @param {string} staticDir
 * @param {object} [options]
 * @param {string[]} [options.forbiddenRoutes]  routes the engine owns; a clash is an error
 * @param {(name:string, source:string) => {html:string, page:object}} [options.render]
 * @param {(file:string) => boolean} [options.ignore]
 * @returns {{pages: {name:string, route:string, page:object}[]}}
 */
function addStaticFilesToProxy(proxy, staticDir, options = {}, rootPath = '/', collected = { pages: [] }) {
    const { forbiddenRoutes = DEFAULT_RESERVED, render, ignore = () => false } = options;
    if (!isDirectory(staticDir)) throw new TypeError('specified folder path is not a directory');
    if (!rootPath.endsWith('/')) rootPath += '/';

    for (const file of fs.readdirSync(staticDir)) {
        if (file.startsWith('_') || file.startsWith('.')) continue; // partials and dotfiles are never public
        const pathToFile = path.join(staticDir, file);
        if (isDirectory(pathToFile)) {
            addStaticFilesToProxy(proxy, pathToFile, options, rootPath + file + '/', collected);
            continue;
        }
        if (ignore(file)) continue;

        const route = rootPath + file;
        if (forbiddenRoutes.includes(route)) {
            throw new TypeError(`route clashes with the engine. problematic route: ${route}. problematic static file: ${pathToFile}`);
        }

        if (file.endsWith('.html') && render) {
            const name = file.slice(0, -5);
            const pagePath = name === 'index' ? rootPath : rootPath + name;
            const { html, page } = render(name, fs.readFileSync(pathToFile, 'utf8'), pagePath);
            const content = { content: Buffer.from(html, 'utf8'), contentType: contentTypeFor(file) };
            proxy.GET(route, content);
            if (name === 'index') proxy.GET(rootPath, content);
            else proxy.GET(pagePath, content);
            collected.pages.push({ name, route: pagePath, page });
            continue;
        }

        const staticContent = { content: fs.readFileSync(pathToFile), contentType: contentTypeFor(file) };
        proxy.GET(route, staticContent);
        if (file === 'index.html') proxy.GET(rootPath, staticContent);
    }
    return collected;
}

module.exports = addStaticFilesToProxy;
