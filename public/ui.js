// Shared UI primitives: toast + confirm modal.
// Attached to window.ui so other scripts can use it.
(function () {
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
                // Fallback — should never hit on admin page.
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
            // Fallback for non-secure contexts
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

    window.ui = { showToast, showConfirm, copyText };
})();
