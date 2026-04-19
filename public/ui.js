// Shared UI primitives: toast + confirm modal + icon registry.
// Attached to window.ui so other scripts can use it.
(function () {
    // ------------------------------------------------------------------
    // Icon registry (inline SVG strings, Lucide-style 24x24, stroke=2)
    // ------------------------------------------------------------------
    const ICONS = {
        plus:       '<path d="M12 5v14M5 12h14"/>',
        camera:     '<path d="M15 7h2a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3v-8a3 3 0 0 1 3-3h2l2-3h4l2 3z"/><circle cx="11" cy="14" r="4"/>',
        settings:   '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.05a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.05a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.05a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
        download:   '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
        maximize:   '<polyline points="4 14 4 20 10 20"/><polyline points="20 10 20 4 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/>',
        chevronLeft: '<polyline points="15 18 9 12 15 6"/>',
        chevronRight:'<polyline points="9 18 15 12 9 6"/>',
        close:      '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
        logout:     '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
        copy:       '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
        wifi:       '<path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>',
        wifiOff:    '<line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.58 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>',
        alertTriangle:'<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
        check:      '<polyline points="20 6 9 17 4 12"/>',
        circle:     '<circle cx="12" cy="12" r="9"/>',
        videoOff:   '<path d="M16.5 7.5V6a2 2 0 0 0-2-2h-9"/><path d="M10.66 10.66 2 19h13l-1.25-1.25"/><path d="M22 8l-6 4 6 4V8z"/><line x1="2" y1="2" x2="22" y2="22"/>'
    };

    function icon(name, cls = 'ic') {
        const body = ICONS[name];
        if (!body) return '';
        return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
    }

    // ------------------------------------------------------------------
    // Toast
    // ------------------------------------------------------------------
    function ensureToastStack() {
        let stack = document.getElementById('toastStack');
        if (!stack) {
            stack = document.createElement('div');
            stack.id = 'toastStack';
            stack.className = 'toast-stack';
            document.body.appendChild(stack);
        }
        return stack;
    }

    function showToast({ message, type = 'info', duration = 3500 } = {}) {
        if (!message) return;
        const stack = ensureToastStack();
        const el = document.createElement('div');
        el.className = `toast toast--stacked toast--${type}`;
        el.textContent = message;
        stack.appendChild(el);

        const remove = () => {
            if (!el.parentNode) return;
            el.classList.add('is-removing');
            setTimeout(() => el.remove(), 250);
        };
        if (duration > 0) setTimeout(remove, duration);
        el.addEventListener('click', remove);
        return remove;
    }

    function showConfirm({ title = 'Are you sure?', message = '', confirmText = 'Confirm', cancelText = 'Cancel', danger = false } = {}) {
        return new Promise((resolve) => {
            const modal = document.getElementById('confirmModal');
            if (!modal) {
                resolve(window.confirm(`${title}\n\n${message}`));
                return;
            }
            const titleEl = modal.querySelector('#confirmTitle');
            const msgEl = modal.querySelector('#confirmMessage');
            const okBtn = modal.querySelector('#confirmOk');
            const cancelBtn = modal.querySelector('#confirmCancel');

            titleEl.textContent = title;
            msgEl.textContent = message;
            msgEl.style.display = message ? 'block' : 'none';
            okBtn.textContent = confirmText;
            cancelBtn.textContent = cancelText;
            okBtn.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;

            modal.classList.add('is-open');

            const cleanup = (result) => {
                modal.classList.remove('is-open');
                okBtn.removeEventListener('click', onOk);
                cancelBtn.removeEventListener('click', onCancel);
                modal.removeEventListener('click', onBackdrop);
                document.removeEventListener('keydown', onKey);
                resolve(result);
            };
            const onOk = () => cleanup(true);
            const onCancel = () => cleanup(false);
            const onBackdrop = (e) => { if (e.target === modal) cleanup(false); };
            const onKey = (e) => {
                if (e.key === 'Escape') cleanup(false);
                else if (e.key === 'Enter') cleanup(true);
            };

            okBtn.addEventListener('click', onOk);
            cancelBtn.addEventListener('click', onCancel);
            modal.addEventListener('click', onBackdrop);
            document.addEventListener('keydown', onKey);
            okBtn.focus();
        });
    }

    async function copyText(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            let ok = false;
            try { ok = document.execCommand('copy'); } catch { /* ignore */ }
            ta.remove();
            return ok;
        }
    }

    window.ui = { showToast, showConfirm, copyText, icon };
})();
