'use strict';
const fs = require('fs');
const path = require('path');

/**
 * Renders the site's own HTML pages from small templates, once at startup.
 *
 *   {{site.name}}                 a value (always HTML-escaped)
 *   {{#if engineGuide}}..{{else}}..{{/if}}   a condition
 *   {{include:footer}}            a partial from public/_partials/<name>.html
 *
 * A partial that does not exist renders as nothing. If both public/_partials/<name>.html and
 * public/_partials/defaults/<name>.html exist, the first one wins, so a deployment can replace a shared part (such as the
 * footer) by adding a file, without editing the pages.
 *
 * The first line of a page may carry its metadata:  <!--page {"title":"About","description":"..."} -->
 */
const MAX_DEPTH = 6;
/** only http(s) addresses may become links, whatever is in the config */
const safeUrl = (u) => (typeof u === 'string' && /^https?:\/\/[^\s"'<>]+$/i.test(u.trim()) ? u.trim() : '');
const NAME = /^[a-z0-9][a-z0-9-]{0,40}$/;

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function parse(text) {
    const root = [];
    const stack = [{ nodes: root }];
    const re = /\{\{\s*(#if\s+[\w.]+|else|\/if|include:[\w-]+|[\w.]+)\s*\}\}/g;
    let last = 0;
    let m;
    const top = () => stack[stack.length - 1];
    const push = (node) => top().nodes.push(node);
    while ((m = re.exec(text))) {
        if (m.index > last) push({ t: 'text', v: text.slice(last, m.index) });
        last = re.lastIndex;
        const tag = m[1];
        if (tag.startsWith('#if ')) {
            const node = { t: 'if', k: tag.slice(4).trim(), yes: [], no: [] };
            push(node);
            stack.push({ node, nodes: node.yes });
        } else if (tag === 'else') {
            const frame = top();
            if (!frame.node) throw new Error('{{else}} without {{#if}}');
            frame.nodes = frame.node.no;
        } else if (tag === '/if') {
            if (stack.length < 2) throw new Error('{{/if}} without {{#if}}');
            stack.pop();
        } else if (tag.startsWith('include:')) {
            push({ t: 'inc', n: tag.slice(8) });
        } else {
            push({ t: 'var', k: tag });
        }
    }
    if (last < text.length) push({ t: 'text', v: text.slice(last) });
    if (stack.length !== 1) throw new Error('unclosed {{#if}}');
    return root;
}

class PageRenderer {
    /**
     * @param {object} o
     * @param {string} o.publicDir
     * @param {object} o.site        config.site
     * @param {string} o.appVersion
     */
    constructor({ publicDir, site, appVersion }) {
        this.partialDirs = [path.join(publicDir, '_partials'), path.join(publicDir, '_partials', 'defaults')];
        this.site = site;
        this.appVersion = appVersion;
    }

    partial(name) {
        if (!NAME.test(name)) return null;
        for (const dir of this.partialDirs) {
            const file = path.join(dir, name + '.html');
            if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
        }
        return null;
    }

    flags(page) {
        const s = this.site;
        return {
            engineGuide: !!s.engineGuide,
            reportEmail: !!s.reportEmail,
            sourceUrl: !!safeUrl(s.sourceUrl),
            operator: !!s.operator,
            title: !!(page && page.title)
        };
    }

    values(page) {
        const s = this.site;
        return {
            'site.name': s.name,
            'site.operator': s.operator || s.name,
            'site.reportEmail': s.reportEmail,
            'site.sourceUrl': safeUrl(s.sourceUrl),
            'page.title': page.title || '',
            'page.description': page.description || '',
            'page.path': page.path,
            year: String(new Date().getFullYear()),
            'app.version': this.appVersion
        };
    }

    evaluate(nodes, ctx, depth) {
        let out = '';
        for (const n of nodes) {
            if (n.t === 'text') out += n.v;
            else if (n.t === 'var') out += escapeHtml(Object.prototype.hasOwnProperty.call(ctx.values, n.k) ? ctx.values[n.k] : '');
            else if (n.t === 'if') out += this.evaluate(ctx.flags[n.k] ? n.yes : n.no, ctx, depth);
            else if (n.t === 'inc') {
                if (depth >= MAX_DEPTH) throw new Error('partials are nested too deeply (loop?): ' + n.n);
                const src = this.partial(n.n);
                if (src) out += this.evaluate(parse(src), ctx, depth + 1);
            }
        }
        return out;
    }

    /**
     * @param {string} source  the page template
     * @param {string} pagePath  '/' for the home page, otherwise '/name'
     * @returns {{html:string, page:object}}
     */
    render(source, pagePath) {
        const page = { path: pagePath };
        const meta = source.match(/^\s*<!--page\s+(\{[^\n]*\})\s*-->\s*/);
        if (meta) {
            Object.assign(page, JSON.parse(meta[1]));
            source = source.slice(meta[0].length);
        }
        const ctx = { values: this.values(page), flags: this.flags(page) };
        return { html: this.evaluate(parse(source), ctx, 0), page };
    }
}

module.exports = { PageRenderer, escapeHtml, parse };
