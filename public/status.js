(function () {
    'use strict';
    const set = (id, text, cls) => {
        const el = document.getElementById(id);
        el.textContent = text;
        if (cls) el.className = cls;
    };
    Promise.all([
        fetch('/api/engine/status', { cache: 'no-store' }).then((r) => r.json()),
        fetch('/api/auth/status', { cache: 'no-store' }).then((r) => r.json())
    ])
        .then(([engine, auth]) => {
            set('st-service', 'Online', 'ok');
            set('st-engine', engine.status === 'ready' ? 'Ready' : 'Not available right now', engine.status === 'ready' ? 'ok' : 'bad-text');
            set('st-signup', { open: 'Open', invite: 'By invitation', closed: 'Closed' }[auth.registration] || 'Unknown');
        })
        .catch(() => {
            set('st-service', 'Could not be reached', 'bad-text');
            set('st-engine', 'Unknown');
            set('st-signup', 'Unknown');
        })
        .finally(() => set('st-time', new Date().toLocaleString()));
})();
