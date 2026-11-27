(function () {
    'use strict';

    /* ------------------------------------------------------------------ *
     *  URL shuffling (must match src/util/StrShuffler.js on the server)   *
     * ------------------------------------------------------------------ */
    const mod = (n, m) => ((n % m) + m) % m;
    const baseDictionary = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz~-';
    const shuffledIndicator = '_rhs';
    class StrShuffler {
        constructor(dictionary) {
            this.dictionary = dictionary;
        }
        shuffle(str) {
            if (str.startsWith(shuffledIndicator)) return str;
            let out = '';
            for (let i = 0; i < str.length; i++) {
                const char = str.charAt(i);
                const idx = baseDictionary.indexOf(char);
                if (char === '%' && str.length - i >= 3) {
                    out += char + str.charAt(++i) + str.charAt(++i);
                } else if (idx === -1) {
                    out += char;
                } else {
                    out += this.dictionary.charAt(mod(idx + i, baseDictionary.length));
                }
            }
            return shuffledIndicator + out;
        }
    }

    /* ------------------------------ helpers ---------------------------- */
    const $ = (id) => document.getElementById(id);
    const el = (tag, props = {}, ...kids) => {
        const n = document.createElement(tag);
        for (const [k, v] of Object.entries(props)) {
            if (k === 'class') n.className = v;
            else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
            else n.setAttribute(k, v);
        }
        for (const kid of kids) n.append(kid);
        return n;
    };
    const store = {
        get(key, fallback) {
            try {
                const raw = localStorage.getItem(key);
                return raw === null ? fallback : JSON.parse(raw);
            } catch (e) {
                return fallback;
            }
        },
        set(key, value) {
            try {
                localStorage.setItem(key, JSON.stringify(value));
            } catch (e) {
                showBanner('This browser would not save your data (storage is full or disabled).', true);
            }
        },
        remove(key) {
            try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
        }
    };
    const TOKEN_KEY = 'rhs.token';
    let me = null; // { username, registration }
    let registration = 'invite';
    const ukey = (name) => 'rhs.u.' + me.username + '.' + name;

    function showBanner(msg, bad) {
        const b = $('banner');
        b.textContent = msg || '';
        b.hidden = !msg;
        b.classList.toggle('bad', !!bad);
    }

    /* ------------------------------- API ------------------------------- */
    async function api(method, url, body) {
        const headers = {};
        const token = store.get(TOKEN_KEY, null);
        if (token) headers.Authorization = 'Bearer ' + token;
        if (body) headers['Content-Type'] = 'application/json';
        let res;
        try {
            res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', credentials: 'same-origin' });
        } catch (e) {
            const err = new Error('Cannot reach the server. Check your connection and try again.');
            err.network = true;
            throw err;
        }
        const text = await res.text();
        // only /api/ endpoints speak JSON; the session routes return plain text (an id could look like a number)
        const isJson = url.startsWith('/api/');
        let json = null;
        if (isJson) {
            try { json = JSON.parse(text); } catch (e) { /* error page */ }
        }
        const sessionLost = (json && json.code === 'sign_in_required') || (res.status === 403 && /^sign in required/.test(text));
        if (sessionLost && me) signedOut('Your sign-in expired. Please sign in again.');
        if (!res.ok) {
            const err = new Error((json && json.error) || text || 'Request failed (' + res.status + ')');
            err.status = res.status;
            if (json && json.field) err.field = json.field;
            throw err;
        }
        return isJson ? json : text;
    }

    /* --------------------------- engine status ------------------------- */
    let engineStatus = null;
    async function loadEngineStatus() {
        try {
            engineStatus = await api('GET', '/api/engine/status');
        } catch (e) {
            engineStatus = null;
            return;
        }
        const b = $('engine-banner');
        const ok = engineStatus.status === 'ready';
        b.hidden = ok;
        if (!ok) {
            b.textContent = 'The browsing engine is not available (' + engineStatus.status + '). ' + (engineStatus.message || '') + ' ';
            if (document.body.dataset.engineGuide === '1') b.append(el('a', { href: '/engine' }, 'How to load an engine'));
        }
        $('go-btn').disabled = !ok;
    }
    function renderFacts() {
        const s = engineStatus;
        $('about-version').textContent = s && s.app && s.app.version ? 'v' + s.app.version : '';
        if (!s) return;
        const t = currentTransport();
        $('fact-transport').textContent = t ? transportName(t) : 'None (no engine installed)';
        $('fact-front').textContent = s.frontedBy === 'reverse proxy' ? 'A reverse proxy (for example nginx)' : 'Directly';
        $('fact-engine').textContent = s.engine ? s.engine.name + ' ' + s.engine.version : 'none installed';
    }

    /* ------------------------------ transports ------------------------- *
     * The engine says which transports it supports; only those are offered. A fallback can be named, and when one is set the
     * page checks the chosen transport before opening a page and switches to the fallback if the check fails.            */
    const transports = () => (engineStatus && engineStatus.transports) || null;
    const transportIds = () => (transports() ? transports().available.map((x) => x.id) : []);
    const canTestTransport = (id) => !!(transports() && transports().available.some((x) => x.id === id && x.canTest));
    function transportName(id) {
        const found = transports() && transports().available.find((x) => x.id === id);
        return found ? found.name : id;
    }
    function currentTransport() {
        const t = transports();
        if (!t) return null;
        const p = prefs();
        return transportIds().includes(p.transport) ? p.transport : t.default;
    }
    function currentFallback() {
        const t = transports();
        if (!t) return '';
        const p = prefs();
        const wanted = p.fallback === null || p.fallback === undefined ? t.fallback : p.fallback;
        return wanted && transportIds().includes(wanted) && wanted !== currentTransport() ? wanted : '';
    }
    function renderTransportControls() {
        const t = transports();
        const sel = $('set-transport');
        const fb = $('set-fallback');
        sel.textContent = '';
        fb.textContent = '';
        $('transport-result').textContent = '';
        if (!t) {
            sel.disabled = true;
            fb.disabled = true;
            sel.append(el('option', { value: '' }, 'No engine available'));
            fb.append(el('option', { value: '' }, 'Nothing'));
            $('transport-hint').textContent = 'Install an engine to choose how requests are carried.';
            $('fallback-hint').textContent = '';
            $('transport-test-row').hidden = true;
            return;
        }
        sel.disabled = false;
        for (const x of t.available) sel.append(el('option', { value: x.id }, x.known ? x.name : x.name + ' (' + x.id + ')'));
        sel.value = currentTransport();
        const chosen = t.available.find((x) => x.id === sel.value);
        $('transport-hint').textContent = chosen ? chosen.description : '';
        const others = t.available.filter((x) => x.id !== sel.value);
        fb.append(el('option', { value: '' }, 'Nothing'));
        for (const x of others) fb.append(el('option', { value: x.id }, x.name));
        fb.value = currentFallback();
        fb.disabled = others.length === 0;
        $('fallback-hint').textContent = others.length === 0
            ? 'Only one transport is available with the installed engine.'
            : canTestTransport(sel.value)
                ? 'When a fallback is set, the chosen transport is checked before each page opens, and the fallback is used if the check fails.'
                : 'The installed engine cannot check transports, so a fallback is not switched to automatically. Choose it here if the first one stops working.';
        $('transport-test-row').hidden = !canTestTransport(sel.value);
        renderTransportList();
    }
    function renderTransportList() {
        const ul = $('transport-list');
        ul.textContent = '';
        const t = transports();
        ul.append(el('li', {}, el('strong', {}, 'Built-in HTTP'), ' \u2014 ', el('span', { class: t ? 'ok' : 'muted' }, t && transportIds().includes('http') ? 'Ready to use' : 'Needs an engine')));
        if (!t) return;
        for (const x of t.installed) {
            ul.append(el('li', {}, el('strong', {}, x.name), x.version ? ' ' + x.version : '', ' \u2014 ',
                x.usable ? el('span', { class: 'ok' }, 'Ready to use') : el('span', { class: 'bad-text' }, x.explanation || 'Not usable'),
                x.detail ? el('span', { class: 'muted' }, ' (' + x.detail + ')') : ''));
        }
        if (t.addable.length) ul.append(el('li', { class: 'muted' }, 'Not installed: ' + t.addable.map((a) => a.name).join(', ') + '. The administrator can add them.'));
    }
    async function testTransport(id) {
        try {
            return await api('GET', '/api/transport/test?transport=' + encodeURIComponent(id));
        } catch (e) {
            if (e.status === 501) return { ok: false, unsupported: true, error: e.message };
            return { ok: false, error: e.message };
        }
    }
    // decides which transport to open this page with; may switch to the fallback, or refuse when neither works
    async function chooseTransport() {
        if (!transports()) return {};
        const primary = currentTransport();
        const fallback = currentFallback();
        if (!fallback || !canTestTransport(primary)) return { transport: primary };
        const first = await testTransport(primary);
        if (first.ok || first.unsupported) return { transport: primary };
        const second = await testTransport(fallback);
        if (second.ok) return { transport: fallback, note: transportName(primary) + ' is not responding, so ' + transportName(fallback) + ' was used for this page.' };
        throw new Error('Neither ' + transportName(primary) + ' nor ' + transportName(fallback) + ' could be reached.');
    }

    /* ------------------------------- theme ----------------------------- */
    function applyTheme(t) {
        if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
        else document.documentElement.removeAttribute('data-theme');
    }
    applyTheme(store.get('rhs.theme', 'system'));

    /* ----------------------------- auth screen ------------------------- */
    let authMode = 'signin';
    const countChars = (str) => [...str].length;
    const AUTH_FIELDS = { username: 'auth-user', password: 'auth-pass', password2: 'auth-pass2', invite: 'auth-invite' };
    function clearAuthError() {
        $('auth-error').hidden = true;
        for (const id of Object.values(AUTH_FIELDS)) $(id).removeAttribute('aria-invalid');
    }
    // shows a message and points at the exact field that needs fixing
    function showAuthError(message, field) {
        const err = $('auth-error');
        err.textContent = message;
        err.hidden = false;
        for (const id of Object.values(AUTH_FIELDS)) $(id).removeAttribute('aria-invalid');
        const target = AUTH_FIELDS[field] && !$(AUTH_FIELDS[field]).closest('[hidden]') ? $(AUTH_FIELDS[field]) : null;
        if (target) {
            target.setAttribute('aria-invalid', 'true');
            target.focus();
        }
    }
    function updatePwCount() {
        const n = countChars($('auth-pass').value);
        $('pw-count').textContent = authMode === 'signup' && n ? '(' + n + ' character' + (n === 1 ? '' : 's') + ' so far)' : '';
    }
    function setAuthMode(mode) {
        authMode = mode;
        const up = mode === 'signup';
        $('tab-signin').setAttribute('aria-selected', String(!up));
        $('tab-signup').setAttribute('aria-selected', String(up));
        $('auth-submit').textContent = up ? 'Create account' : 'Sign in';
        $('auth-pass').autocomplete = up ? 'new-password' : 'current-password';
        $('auth-user-hint').hidden = !up;
        $('auth-pass-hint').hidden = !up;
        $('confirm-row').hidden = !up;
        $('invite-row').hidden = !(up && registration === 'invite');
        $('auth-sub').textContent = up ? 'Pick a username and a password only you know.' : 'Sign in with your own account.';
        clearAuthError();
        updatePwCount();
    }
    function showAuth(message) {
        $('app').hidden = true;
        $('auth-view').hidden = false;
        const closed = registration === 'closed';
        $('tab-signup').hidden = closed;
        $('auth-closed').hidden = !closed;
        setAuthMode('signin');
        if (message) {
            $('auth-error').textContent = message;
            $('auth-error').hidden = false;
        }
        $('auth-user').focus();
    }
    function signedOut(message) {
        store.remove(TOKEN_KEY);
        me = null;
        showAuth(message);
    }

    async function submitAuth(ev) {
        ev.preventDefault();
        clearAuthError();
        const up = authMode === 'signup';
        const username = $('auth-user').value.trim();
        const password = $('auth-pass').value; // never trimmed: spaces are part of a password
        if (!username) return showAuthError('Enter a username.', 'username');
        if (!password) return showAuthError('Enter a password.', 'password');
        if (up) {
            if (countChars(password) < 8) return showAuthError('The password must be at least 8 characters (you entered ' + countChars(password) + ').', 'password');
            if (password !== $('auth-pass2').value) return showAuthError('The two passwords do not match.', 'password2');
            if (registration === 'invite' && !$('auth-invite').value.trim()) {
                return showAuthError('This server needs an invite code to create an account. Enter the code the administrator gave you.', 'invite');
            }
        }
        const btn = $('auth-submit');
        btn.disabled = true;
        try {
            const body = { username, password };
            if (up && registration === 'invite') body.inviteCode = $('auth-invite').value.trim();
            const r = await api('POST', up ? '/api/auth/register' : '/api/auth/login', body);
            store.set(TOKEN_KEY, r.token);
            $('auth-pass').value = '';
            $('auth-pass2').value = '';
            enterApp(r.username);
        } catch (e) {
            showAuthError(e.message, e.field);
        } finally {
            btn.disabled = false;
        }
    }

    /* ----------------------------- app shell --------------------------- */
    const VIEWS = ['home', 'bookmarks', 'history', 'settings'];
    function showView(name) {
        if (!VIEWS.includes(name)) name = 'home';
        for (const v of VIEWS) $('view-' + v).hidden = v !== name;
        document.querySelectorAll('.nav button').forEach((b) => {
            if (b.dataset.view === name) b.setAttribute('aria-current', 'page');
            else b.removeAttribute('aria-current');
        });
        if (name === 'home') renderQuick();
        if (name === 'bookmarks') renderBookmarks();
        if (name === 'history') renderHistory();
        if (name === 'settings') { loadSettings(); renderFacts(); }
        document.title = (name === 'home' ? '' : name[0].toUpperCase() + name.slice(1) + ' · ') + 'Rammerhead Stream';
    }
    function enterApp(username) {
        me = { username };
        $('auth-view').hidden = true;
        $('app').hidden = false;
        $('who-name').textContent = username;
        showBanner('');
        // when the engine status arrives, bring an already-open Settings page up to date
        loadEngineStatus().then(() => {
            renderFacts();
            if (!$('view-settings').hidden) loadSettings();
        });
        showView(location.hash.slice(1));
        $('go-input').focus();
    }

    /* --------------------------- preferences --------------------------- */
    const DEFAULT_PREFS = { search: 'https://duckduckgo.com/?q=%s', shuffle: true, keepHistory: true, proxy: '', parser: 'js', openIn: 'tabs', transport: '', fallback: null };
    const prefs = () => ({ ...DEFAULT_PREFS, ...store.get(ukey('prefs'), {}) });
    function loadSettings() {
        const p = prefs();
        $('set-theme').value = store.get('rhs.theme', 'system');
        $('set-search').value = p.search;
        $('set-shuffle').checked = p.shuffle;
        $('set-history').checked = p.keepHistory;
        $('set-proxy').value = p.proxy;
        const engines = (engineStatus && engineStatus.engine && engineStatus.engine.capabilities && engineStatus.engine.capabilities.scriptEngines) || [];
        $('perf-card').hidden = !engines.includes('wasm');
        $('set-parser').value = p.parser === 'wasm' ? 'wasm' : 'js';
        $('set-openin').value = p.openIn === 'same' ? 'same' : 'tabs';
        renderTransportControls();
    }
    function savePref(patch) {
        store.set(ukey('prefs'), { ...prefs(), ...patch });
    }

    /* ----------------------- bookmarks and history --------------------- */
    const getBookmarks = () => store.get(ukey('bookmarks'), []);
    const getHistory = () => store.get(ukey('history'), []);
    const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u; } };

    function normalizeUrl(input) {
        input = String(input || '').trim();
        if (!input) return null;
        if (/^[a-z][a-z0-9+.-]*:/i.test(input) && !/^[^/\s]+:\d+/.test(input) && !/^localhost:/i.test(input)) {
            // only web addresses; javascript:, data:, file: and friends are refused
            return /^https?:\/\//i.test(input) ? input : null;
        }
        if (!/\s/.test(input) && (/^localhost(:\d+)?(\/|$)/i.test(input) || /^[^\s/]+\.[^\s/.]{2,}(:\d+)?([/?#]|$)/.test(input))) {
            return 'https://' + input;
        }
        return prefs().search.replace('%s', encodeURIComponent(input));
    }

    function renderQuick() {
        const ul = $('quick');
        ul.textContent = '';
        const items = getBookmarks().slice(0, 12);
        $('quick-empty').hidden = items.length > 0;
        for (const b of items) {
            ul.append(el('li', {}, linkTo(b.url, el('span', { class: 'dot', 'aria-hidden': 'true' }, hostOf(b.url)[0].toUpperCase()), el('span', { class: 'name' }, b.title))));
        }
    }
    function linkTo(url, ...kids) {
        return el('a', { href: '#open', 'data-url': url, onclick: (e) => { e.preventDefault(); launch(url); } }, ...kids);
    }
    function renderBookmarks() {
        const list = getBookmarks();
        const ul = $('bm-list');
        ul.textContent = '';
        $('bm-empty').hidden = list.length > 0;
        list.forEach((b, i) => {
            ul.append(el('li', {},
                linkTo(b.url, el('span', { class: 't' }, b.title), el('span', { class: 'u' }, b.url)),
                el('button', { class: 'btn', type: 'button', 'aria-label': 'Remove bookmark ' + b.title, onclick: () => {
                    const l = getBookmarks(); l.splice(i, 1); store.set(ukey('bookmarks'), l); renderBookmarks();
                } }, 'Remove')));
        });
    }
    function renderHistory() {
        const list = getHistory();
        const ul = $('hist-list');
        ul.textContent = '';
        $('hist-empty').hidden = list.length > 0;
        $('hist-clear').hidden = list.length === 0;
        for (const h of list) {
            ul.append(el('li', {}, linkTo(h.url, el('span', { class: 't' }, hostOf(h.url)), el('span', { class: 'u' }, h.url + ' · ' + new Date(h.at).toLocaleString()))));
        }
    }
    function addHistory(url) {
        if (!prefs().keepHistory) return;
        const list = getHistory().filter((h) => h.url !== url);
        list.unshift({ url, at: Date.now() });
        store.set(ukey('history'), list.slice(0, 300));
    }

    /* ------------------------ proxy session + launch ------------------- */
    async function ensureSession() {
        const key = ukey('sessionId');
        let id = store.get(key, null);
        if (id) {
            try {
                if ((await api('GET', '/sessionexists?id=' + encodeURIComponent(id))) !== 'exists') id = null;
            } catch (e) {
                if (e.network) throw e;
                id = null;
            }
        }
        if (!id) {
            id = await api('GET', '/newsession');
            store.set(key, id);
        }
        return id;
    }
    /* -------------------------------- tabs ----------------------------- *
     * A Stream tab is a real browser tab opened by this page (no iframes). Proxied pages are served from this
     * origin, so the page can read each tab's title and drive its history. Tabs are listed on the Browse page
     * for as long as this page stays open.                                                                   */
    const tabs = [];
    let tabSeq = 0;
    function tabTitle(t) {
        try {
            const title = t.win.document && t.win.document.title;
            if (title) return title;
        } catch (e) { /* not readable yet */ }
        return hostOf(t.url);
    }
    function renderTabs() {
        const ul = $('tabstrip');
        ul.textContent = '';
        $('tabs-section').hidden = tabs.length === 0;
        for (const t of tabs) {
            const btn = (label, aria, fn) => el('button', { class: 'icon-btn', type: 'button', 'aria-label': aria + ': ' + tabTitle(t), onclick: fn }, label);
            ul.append(el('li', {},
                el('button', { class: 'tab-title', type: 'button', onclick: () => { try { t.win.focus(); } catch (e) { /* ignore */ } } },
                    tabTitle(t), el('small', {}, t.url)),
                btn('\u2190', 'Back', () => { try { t.win.history.back(); } catch (e) { /* ignore */ } }),
                btn('\u2192', 'Forward', () => { try { t.win.history.forward(); } catch (e) { /* ignore */ } }),
                btn('\u21bb', 'Reload', () => { try { t.win.location.reload(); } catch (e) { /* ignore */ } }),
                btn('\u2715', 'Close tab', () => { try { t.win.close(); } catch (e) { /* ignore */ } pruneTabs(true); })));
        }
    }
    function pruneTabs(force) {
        const before = tabs.map((t) => t.id + tabTitle(t)).join('|');
        for (let i = tabs.length - 1; i >= 0; i--) if (tabs[i].win.closed) tabs.splice(i, 1);
        if (force || tabs.map((t) => t.id + tabTitle(t)).join('|') !== before) renderTabs();
    }
    setInterval(() => { if (me && tabs.length) pruneTabs(false); }, 1500);

    let launching = false;
    async function launch(rawUrl) {
        const url = normalizeUrl(rawUrl);
        const status = $('go-status');
        if (!url) {
            status.textContent = 'Only http:// and https:// addresses can be opened.';
            return;
        }
        if (launching) return;
        launching = true;
        $('go-btn').disabled = true;
        status.textContent = 'Opening\u2026';
        // open the tab synchronously, inside the click, so pop-up blockers allow it
        let tabWin = null;
        if (prefs().openIn !== 'same') {
            try {
                tabWin = window.open('about:blank', 'stream-tab-' + ++tabSeq);
                if (tabWin) tabWin.opener = null; // the proxied page must not be able to reach this page
            } catch (e) { tabWin = null; }
        }
        try {
            const p = prefs();
            const choice = await chooseTransport();
            const id = await ensureSession();
            await api('GET', '/editsession?id=' + encodeURIComponent(id) + (p.proxy ? '&httpProxy=' + encodeURIComponent(p.proxy) : '') + '&enableShuffling=' + (p.shuffle ? '1' : '0') + '&scriptEngine=' + (p.parser === 'wasm' ? 'wasm' : 'js') + (choice.transport ? '&transport=' + encodeURIComponent(choice.transport) : ''));
            if (choice.note) showBanner(choice.note);
            const dict = await api('GET', '/api/session/shuffle-dict?id=' + encodeURIComponent(id));
            const dictionary = typeof dict === 'string' ? dict : dict && dict.dictionary;
            addHistory(url);
            const target = '/' + id + '/' + (dictionary ? new StrShuffler(dictionary).shuffle(url) : url);
            if (tabWin) {
                tabWin.location.href = target;
                tabs.push({ id: tabSeq, win: tabWin, url });
                renderTabs();
                $('go-input').value = '';
                status.textContent = '';
                launching = false;
                $('go-btn').disabled = false;
            } else {
                if (prefs().openIn !== 'same') showBanner('Your browser blocked the new tab, so the page opened here. Allow pop-ups for this site to use tabs.');
                window.location.href = target;
            }
        } catch (e) {
            if (tabWin) { try { tabWin.close(); } catch (err) { /* ignore */ } }
            status.textContent = '';
            showBanner('Could not open the page: ' + e.message, true);
            launching = false;
            $('go-btn').disabled = false;
        }
    }

    /* ------------------------------ wiring ----------------------------- */
    function wire() {
        $('tab-signin').onclick = () => setAuthMode('signin');
        $('tab-signup').onclick = () => setAuthMode('signup');
        $('auth-form').addEventListener('submit', submitAuth);
        $('auth-pass').addEventListener('input', updatePwCount);
        for (const id of Object.values(AUTH_FIELDS)) $(id).addEventListener('input', () => $(id).removeAttribute('aria-invalid'));
        $('auth-pass-toggle').addEventListener('click', () => {
            const show = $('auth-pass').type === 'password';
            $('auth-pass').type = show ? 'text' : 'password';
            $('auth-pass2').type = show ? 'text' : 'password';
            $('auth-pass-toggle').textContent = show ? 'Hide' : 'Show';
            $('auth-pass-toggle').setAttribute('aria-pressed', String(show));
            $('auth-pass-toggle').setAttribute('aria-label', show ? 'Hide password' : 'Show password');
        });

        document.querySelectorAll('.nav button').forEach((b) => {
            b.addEventListener('click', () => {
                history.replaceState(null, '', b.dataset.view === 'home' ? location.pathname : '#' + b.dataset.view);
                showView(b.dataset.view);
                $('main').focus();
            });
        });
        window.addEventListener('hashchange', () => me && showView(location.hash.slice(1)));
        document.addEventListener('keydown', (e) => {
            // "/" focuses the address bar when not typing in a field
            if (e.key === '/' && me && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
                e.preventDefault();
                showView('home');
                $('go-input').focus();
            }
        });

        $('go-form').addEventListener('submit', (e) => { e.preventDefault(); launch($('go-input').value); });

        $('bm-form').addEventListener('submit', (e) => {
            e.preventDefault();
            const url = normalizeUrl($('bm-url').value);
            if (!url || !/^https?:\/\//i.test(url) || $('bm-url').value.trim().includes(' ')) {
                showBanner('Enter a web address for the bookmark, like https://example.com', true);
                return;
            }
            showBanner('');
            const list = getBookmarks();
            if (list.length >= 200) return showBanner('You have reached the 200 bookmark limit.', true);
            list.unshift({ title: ($('bm-title').value.trim() || hostOf(url)).slice(0, 80), url });
            store.set(ukey('bookmarks'), list);
            $('bm-title').value = '';
            $('bm-url').value = '';
            renderBookmarks();
        });
        $('hist-clear').onclick = () => { store.set(ukey('history'), []); renderHistory(); };

        $('set-theme').onchange = (e) => { store.set('rhs.theme', e.target.value); applyTheme(e.target.value); };
        $('set-search').onchange = (e) => savePref({ search: e.target.value });
        $('set-shuffle').onchange = (e) => savePref({ shuffle: e.target.checked });
        $('set-history').onchange = (e) => savePref({ keepHistory: e.target.checked });
        $('set-proxy').onchange = (e) => savePref({ proxy: e.target.value.trim() });
        $('set-parser').onchange = (e) => savePref({ parser: e.target.value });
        $('set-openin').onchange = (e) => savePref({ openIn: e.target.value });
        $('set-transport').onchange = (e) => {
            const patch = { transport: e.target.value };
            if (currentFallback() === e.target.value) patch.fallback = '';
            savePref(patch);
            renderTransportControls();
            renderFacts();
        };
        $('set-fallback').onchange = (e) => savePref({ fallback: e.target.value });
        $('transport-test').onclick = async () => {
            const out = $('transport-result');
            const id = $('set-transport').value;
            out.className = 'small';
            out.textContent = 'Testing\u2026';
            const r = await testTransport(id);
            out.className = 'small ' + (r.ok ? 'ok' : 'bad-text');
            out.textContent = r.ok ? transportName(id) + ' is working' + (r.ms ? ' (' + r.ms + ' ms).' : '.') : transportName(id) + ' is not working' + (r.error ? ': ' + r.error : '.');
        };

        $('pw-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const msg = $('pw-msg');
            const say = (text, good) => { msg.textContent = text; msg.hidden = false; msg.className = 'small ' + (good ? 'ok' : 'error'); };
            const cur = $('pw-current').value, a = $('pw-new').value, b = $('pw-new2').value;
            if (!cur || !a) return say('Fill in your current and new password.');
            if (a !== b) return say('The new passwords do not match.');
            if (countChars(a) < 8) return say('The new password must be at least 8 characters (you entered ' + countChars(a) + ').');
            try {
                const r = await api('POST', '/api/auth/password', { currentPassword: cur, newPassword: a });
                store.set(TOKEN_KEY, r.token);
                $('pw-form').reset();
                say('Password changed. Your other devices were signed out.', true);
            } catch (err) {
                say(err.message);
            }
        });
        $('signout').onclick = () => signedOut();
        $('delete-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const msg = $('del-msg');
            const fail = (text) => { msg.textContent = text; msg.hidden = false; };
            msg.hidden = true;
            if (!$('del-pass').value) return fail('Enter your password to confirm.');
            const name = me.username;
            try {
                // the server removes the browsing session in the same step, after it has checked the password
                await api('POST', '/api/auth/delete', { password: $('del-pass').value, sessionId: store.get(ukey('sessionId'), null) });
            } catch (err) {
                return fail(err.message);
            }
            // forget everything this browser held for the account
            try {
                for (const k of Object.keys(localStorage)) if (k.startsWith('rhs.u.' + name + '.')) localStorage.removeItem(k);
            } catch (err) { /* storage unavailable */ }
            $('del-pass').value = '';
            signedOut('Your account was deleted.');
        });
        $('signout-all').onclick = async () => {
            try { await api('POST', '/api/auth/signout-everywhere'); signedOut('Signed out on every device.'); }
            catch (err) { showBanner(err.message, true); }
        };
        $('reset-session').onclick = async () => {
            const id = store.get(ukey('sessionId'), null);
            try { if (id) await api('GET', '/deletesession?id=' + encodeURIComponent(id)); } catch (e) { /* already gone */ }
            store.remove(ukey('sessionId'));
            showBanner('Started fresh: cookies and site data for your proxied browsing were cleared.');
        };
    }

    /* ------------------------------- boot ------------------------------ */
    async function boot() {
        wire();
        // the original behaviour: make sure we are on the server's main port
        try {
            const mainPort = await fetch('/mainport').then((r) => r.text());
            const defaultPort = location.protocol === 'https:' ? 443 : 80;
            if ((location.port || defaultPort) != (mainPort || defaultPort)) { location.port = mainPort; return; }
        } catch (e) { /* offline: status below reports it */ }

        try {
            const s = await api('GET', '/api/auth/status');
            registration = s.registration;
            if (s.token) store.set(TOKEN_KEY, s.token);
            if (s.authenticated) return enterApp(s.username);
            store.remove(TOKEN_KEY);
            showAuth();
        } catch (e) {
            showAuth(e.message);
        }
    }
    boot();
})();
