// The site's own pages: they render, link to each other, carry security headers, and expose nothing they should not.
const test = require('node:test');
const assert = require('node:assert');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { testEngineDir } = require('./helpers/engine');

const root = path.join(__dirname, '..');
const servers = [];
async function start(port, env = {}) {
    const child = spawn('node', ['src/server.js'], {
        cwd: root,
        env: { ...process.env, RAMMERHEAD_PORT: String(port), RAMMERHEAD_WORKERS: '0', RAMMERHEAD_ENGINE_DIR: testEngineDir(), RAMMERHEAD_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'rhsite-')), ...env }
    });
    servers.push(child);
    for (let i = 0; i < 60; i++) {
        try { if ((await fetch(`http://localhost:${port}/robots.txt`)).ok) break; } catch (e) { /* wait */ }
        await new Promise((r) => setTimeout(r, 250));
    }
    return `http://localhost:${port}`;
}
test.after(() => servers.forEach((s) => s.kill()));

const PAGES = ['/', '/about', '/help', '/privacy', '/terms', '/report', '/status', '/engine'];
const text = async (base, p) => { const r = await fetch(base + p); return { status: r.status, html: await r.text(), headers: r.headers }; };

test('every page renders as a complete page, with the same footer links, and no template left over', async () => {
    const base = await start(18365, { RAMMERHEAD_REPORT_EMAIL: 'reports@example.org' });
    for (const p of PAGES) {
        const { status, html } = await text(base, p);
        assert.strictEqual(status, 200, p);
        assert.match(html, /<html lang="en">/, p);
        assert.match(html, /<title>[^<]+<\/title>/, p);
        assert.match(html, /<meta name="description" content="[^"]+"/, p);
        assert.doesNotMatch(html, /\{\{|\}\}/, p + ' still contains template markers');
        for (const link of ['/about', '/help', '/privacy', '/terms', '/report', '/status']) {
            assert.ok(html.includes(`href="${link}"`), `${p} should link to ${link}`);
        }
        assert.match(html, /Created by <strong>BlackJ<\/strong>/, p);
    }
    // the extension (/about.html) and the plain address (/about) give the same page
    assert.strictEqual((await text(base, '/about.html')).html, (await text(base, '/about')).html);
    assert.strictEqual((await text(base, '/index.html')).html, (await text(base, '/')).html);
});

test('every link on every page leads somewhere', async () => {
    const base = await start(18366, {});
    const seen = new Set();
    for (const p of PAGES) {
        const { html } = await text(base, p);
        for (const m of html.matchAll(/(?:href|src)="(\/[^"#]*)(?:#[^"]*)?"/g)) seen.add(m[1]);
    }
    assert.ok(seen.size >= 10, 'found only ' + seen.size + ' links');
    for (const link of seen) {
        const r = await fetch(base + link);
        assert.strictEqual(r.status, 200, `${link} should exist`);
    }
});

test('there is no contact page, nothing links to one, and lost passwords are explained honestly', async () => {
    const base = await start(18367, {});
    assert.notStrictEqual((await fetch(base + '/contact')).status, 200);
    assert.notStrictEqual((await fetch(base + '/contact.html')).status, 200);
    for (const p of PAGES) {
        const { html } = await text(base, p);
        assert.doesNotMatch(html, /href="\/contact/, p + ' still links to a contact page');
        assert.doesNotMatch(html, />Contact</, p + ' still has a Contact link');
    }
    const help = (await text(base, '/help')).html;
    assert.match(help, /Passwords cannot be recovered/);
    assert.match(help, /nobody, including whoever runs this site/);
    assert.match(help, /create a new account/);
    assert.doesNotMatch(help, /administrator of the site can set a new one/);
    // the privacy policy offers self-service deletion instead of asking anyone to reply
    const privacy = (await text(base, '/privacy')).html;
    assert.match(privacy, /Delete your account yourself in Settings/);
    assert.doesNotMatch(privacy, /Questions can be sent to|contact a/i);
    assert.doesNotMatch((await text(base, '/terms')).html, /<h2>Contact<\/h2>/);
});

test('the Report page only offers an address, and only promises a review, when one is configured', async () => {
    const withEmail = await start(18368, { RAMMERHEAD_REPORT_EMAIL: 'reports@example.org' });
    const yes = (await text(withEmail, '/report')).html;
    assert.ok(yes.includes('mailto:reports@example.org'));
    assert.match(yes, /What happens next/);
    const without = await start(18376, {});
    const no = (await text(without, '/report')).html;
    assert.match(no, /does not publish an address for abuse reports/);
    assert.doesNotMatch(no, /mailto:/);
    assert.doesNotMatch(no, /What happens next|Please include:/);
    assert.match(no, /Websites that are not ours/);
});

test('security headers on pages, and the strict content-security policy', async () => {
    const base = await start(18369, {});
    for (const p of ['/', '/privacy', '/engine']) {
        const { headers } = await text(base, p);
        const csp = headers.get('content-security-policy');
        for (const d of ["default-src 'self'", "script-src 'self'", "style-src 'self'", "object-src 'none'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'"]) {
            assert.ok(csp.includes(d), `${p} CSP should include ${d}`);
        }
        assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|\*/);
        assert.strictEqual(headers.get('x-content-type-options'), 'nosniff');
        assert.strictEqual(headers.get('x-frame-options'), 'DENY');
        assert.strictEqual(headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
        assert.match(headers.get('permissions-policy'), /camera=\(\)/);
        assert.strictEqual(headers.get('strict-transport-security'), null, 'no HSTS over plain http');
    }
    const api = await fetch(base + '/api/engine/status');
    assert.strictEqual(api.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.strictEqual(api.headers.get('cache-control'), 'no-store');
});

test('the pages themselves obey their own content-security policy (no inline scripts, styles or handlers)', async () => {
    const base = await start(18370, {});
    for (const p of PAGES) {
        const { html } = await text(base, p);
        assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, p + ' has an inline script');
        assert.doesNotMatch(html, /\sstyle="/i, p + ' has an inline style');
        assert.doesNotMatch(html, /\son[a-z]+="/i, p + ' has an inline event handler');
        assert.doesNotMatch(html, /<script[^>]+src="https?:\/\//i, p + ' loads an outside script');
    }
    for (const f of ['/script.js', '/status.js', '/engine.js']) assert.doesNotMatch((await text(base, f)).html, /\.innerHTML\s*=|document\.write|eval\(/, f + ' uses an unsafe DOM call');
});

test('HSTS is sent over HTTPS (also behind a trusted proxy) and cannot be faked by visitors', async () => {
    const trusted = await start(18371, { RAMMERHEAD_TRUST_PROXY: '127.0.0.1,::1' });
    const viaProxy = await fetch(trusted + '/', { headers: { 'X-Forwarded-Proto': 'https' } });
    assert.match(viaProxy.headers.get('strict-transport-security'), /max-age=31536000/);
    const untrusted = await start(18372, {});
    const forged = await fetch(untrusted + '/', { headers: { 'X-Forwarded-Proto': 'https' } });
    assert.strictEqual(forged.headers.get('strict-transport-security'), null);
});

test('nothing that is not meant to be public can be fetched', async () => {
    const base = await start(18373, {});
    const forbidden = [
        '/_partials/defaults/head.html', '/_partials/', '/_partials', '/.gitkeep', '/package.json', '/package-lock.json', '/LICENSE',
        '/src/config.js', '/src/server/index.js', '/data/auth.json', '/data/token.secret', '/sessions/', '/scripts/engine.js',
        '/engines/active/manifest.json', '/transports/', '/test/auth.test.js', '/config.js', '/.env', '/.git/config', '/node_modules/',
        '/..%2fpackage.json', '/%2e%2e/package.json', '/public/index.html'
    ];
    for (const p of forbidden) {
        const r = await fetch(base + p);
        assert.notStrictEqual(r.status, 200, `${p} must not be served`);
    }
    const robots = await (await fetch(base + '/robots.txt')).text();
    for (const line of ['Disallow: /api/', 'Disallow: /newsession', 'Disallow: /editsession', 'Allow: /']) assert.ok(robots.includes(line));
    assert.strictEqual((await fetch(base + '/sitemap.xml')).status !== 200, true, 'no sitemap is published');
});

test('the public status reveals nothing about the server', async () => {
    const base = await start(18374, {});
    const raw = await (await fetch(base + '/api/engine/status')).text();
    assert.deepStrictEqual(JSON.parse(raw), { status: 'ready', app: { name: 'Rammerhead Stream', creator: 'BlackJ' } });
    assert.doesNotMatch(raw, /\/home|\/tmp|node_modules|version|manifest|Fixture/);
    const stat = await (await fetch(base + '/api/auth/status')).json();
    assert.deepStrictEqual(Object.keys(stat).sort(), ['authenticated', 'registration', 'username']);
});

test('the engine guide can be switched off, and then it and every link to it disappear', async () => {
    const base = await start(18375, { RAMMERHEAD_ENGINE_GUIDE: '0' });
    assert.notStrictEqual((await fetch(base + '/engine')).status, 200);
    assert.notStrictEqual((await fetch(base + '/engine.html')).status, 200);
    for (const p of ['/', '/about', '/help', '/privacy']) assert.doesNotMatch((await text(base, p)).html, /href="\/engine/, p);
    assert.match((await text(base, '/')).html, /<body data-engine-guide="">/);
});

// ---- what ships ----
const tracked = () => execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);

test('SOURCE contains no advertising or consent-banner code, and no engine', () => {
    const forbidden = /adsbygoogle|googlesyndication|adsense|ad-slot|cookie banner|cookie settings|StreamConsent|stream-consent/i;
    const files = tracked().filter((f) => /^(src|public|scripts)\//.test(f) || f === 'config.example.js');
    for (const f of files) assert.doesNotMatch(fs.readFileSync(path.join(root, f), 'utf8'), forbidden, f);
    const engine = tracked().filter((f) => f.startsWith('engines/active/') && !f.endsWith('.gitkeep'));
    assert.deepStrictEqual(engine, [], 'engines/active must ship empty');
    const other = tracked().filter((f) => f.startsWith('transports/') && !f.endsWith('.gitkeep') && !/^transports\/(libcurl|epoxy)\//.test(f));
    assert.deepStrictEqual(other, [], 'only the two basic transports (libcurl and Epoxy) are bundled');
});

test('nothing private ships: no local paths, secrets, keys, personal addresses, runtime data or the old name', () => {
    const rules = [
        [/\/home\/claude|\/mnt\/user-data|\/tmp\/rh/, 'a local path'],
        [/gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{20,}/, 'a token'],
        [/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'a private key'],
        [/ca-pub-\d{6,}/, 'a publisher id'],
        // built from pieces so that this file never spells out the words it is hunting for
        [new RegExp(['Think', 'Centre'].join('') + '|' + ['github', '\\.io'].join('') + '|' + ['MAIN', ' branch'].join(''), 'i'), "the owner's private plans"],
        [new RegExp(['bl', 'uj'].join('') + '|' + ['bl', 'u j'].join(''), 'i'), 'the old brand name']
    ];
    const emailOk = /@(example\.(com|org|net)|b\.c|localhost)$/;
    for (const f of tracked()) {
        // third-party built files are not ours to scan; everything else that ships is
        if (/\.(png|ico|jpg|wasm|tgz|zip)$/i.test(f) || f === 'package-lock.json' || /^transports\/[^/]+\/public\//.test(f)) continue;
        const t = fs.readFileSync(path.join(root, f), 'utf8');
        for (const [re, what] of rules) assert.doesNotMatch(t, re, `${f} contains ${what}`);
        for (const m of t.matchAll(/[\w.+-]+@[\w-]+\.[\w.-]+/g)) {
            if (/^(Simon|Tim|Sindre|Josh|TJ)/i.test(m[0]) || /\.(js|css|png)$/.test(m[0]) || /@\d+\.\d/.test(m[0]) /* package@1.2.3 */) continue;
            assert.ok(emailOk.test(m[0]), `${f} contains an email address: ${m[0]}`);
        }
    }
    for (const dir of ['data', 'sessions', 'cache-js', 'engines/_backups', 'transports/_backups']) {
        const extra = tracked().filter((f) => f.startsWith(dir + '/') && !f.endsWith('.gitkeep'));
        assert.deepStrictEqual(extra, [], dir + ' must hold no runtime data');
    }
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.strictEqual(pkg.private, true, 'private:true stops an accidental npm publish');
});
