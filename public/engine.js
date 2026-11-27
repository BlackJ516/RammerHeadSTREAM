(function () {
    'use strict';
    const status = document.getElementById('live-status');

    // Live engine status. Visitors only learn the state; the plain-language explanation is written here, so no server
    // details or file paths are ever sent to someone who is not signed in.
    const EXPLAIN = {
        missing: 'No engine is installed in engines/active/. Follow the steps below to install one.',
        'invalid-manifest': "An engine is installed, but its manifest.json is incomplete or invalid, or its entry file does not provide create(host).",
        incompatible: 'The installed engine was made for a different version of the engine contract, or is incomplete. Install one made for contract 1.',
        failed: 'The installed engine failed to load, often because its dependencies are missing. Run the setup step below.'
    };
    fetch('/api/engine/status', { cache: 'no-store' })
        .then((r) => r.json())
        .then((s) => {
            status.textContent = '';
            const ok = s.status === 'ready';
            const strong = document.createElement('strong');
            strong.textContent = ok ? 'Ready' : 'Not available (' + s.status + ')';
            strong.className = ok ? 'ok' : 'bad-text';
            status.append(strong);
            if (s.engine) status.append(' \u2014 ' + s.engine.name + ' ' + s.engine.version);
            if (!ok && EXPLAIN[s.status]) {
                const p = document.createElement('span');
                p.className = 'muted';
                p.textContent = ' ' + EXPLAIN[s.status];
                status.append(document.createElement('br'), p);
            }
        })
        .catch(() => {
            status.textContent = 'Could not reach the server to read the engine status.';
        });

    // copy buttons
    document.querySelectorAll('button.copy').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const text = btn.getAttribute('data-copy');
            let done;
            try {
                await navigator.clipboard.writeText(text);
                done = true;
            } catch (e) {
                // clipboard API unavailable (plain http): fall back to selecting the text
                const code = btn.parentElement.querySelector('code');
                const range = document.createRange();
                range.selectNodeContents(code);
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);
                try { done = document.execCommand('copy'); } catch (err) { done = false; }
            }
            const old = btn.textContent;
            btn.textContent = done ? 'Copied' : 'Press Ctrl+C';
            setTimeout(() => { btn.textContent = old; }, 1800);
        });
    });
})();
