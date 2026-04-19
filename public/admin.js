let enlargedCameraId = null;

const STALE_AFTER_MS = 5000;
const OFFLINE_AFTER_MS = 30000;

class AdminDashboard {
    constructor() {
        this.socket = io();
        this.cameras = new Map();
        this.activeStreams = new Set();
        this.lastFrameAt = new Map();
        this.lastFrameBlobs = new Map(); // cameraId -> { blob, width, height, timestamp }

        this.initConnectionStatus();
        this.initSocketListeners();
        this.initLogout();
        this.initAddCamera();
        this.initRenameModal();
        this.initEnlargeModal();
        this.loadRegisteredCameras().then(() => this.requestCameraList());
        this.startStaleWatcher();
    }

    // ------------------------------------------------------------------
    // Connection status
    // ------------------------------------------------------------------
    initConnectionStatus() {
        this.connStatus = document.getElementById('connStatus');
        this.setConnState('connecting');
        this.socket.on('connect', () => this.setConnState('live'));
        this.socket.on('disconnect', () => this.setConnState('offline'));
        this.socket.on('reconnect_attempt', () => this.setConnState('connecting'));
        this.socket.io.on('reconnect_attempt', () => this.setConnState('connecting'));
    }

    setConnState(state) {
        if (!this.connStatus) return;
        const labels = { live: 'Live', connecting: 'Connecting…', offline: 'Disconnected' };
        this.connStatus.className = `conn-status conn-status--${state}`;
        const label = this.connStatus.querySelector('.conn-label');
        if (label) label.textContent = labels[state] || state;
    }

    // ------------------------------------------------------------------
    // Boot: load registered RTSP cameras so the grid populates immediately.
    // ------------------------------------------------------------------
    async loadRegisteredCameras() {
        try {
            const res = await fetch('/api/cameras/rtsp', { credentials: 'same-origin' });
            if (!res.ok) return;
            const data = await res.json();
            if (!data.cameras || !data.cameras.length) {
                this.renderEmptyState();
                return;
            }
            const seeded = data.cameras.map(c => ({
                id: c.id,
                name: c.name,
                type: c.type || 'rtsp',
                status: c.status || 'offline',
                timestamp: c.addedAt || new Date().toISOString()
            }));
            this.updateCameraList(seeded);
        } catch (err) {
            console.warn('Failed to preload registered cameras:', err);
        }
    }

    initLogout() {
        const logoutBtn = document.getElementById('logoutBtn');
        if (!logoutBtn) return;
        logoutBtn.addEventListener('click', async () => {
            try {
                await fetch('/logout', { method: 'POST' });
                window.location.href = '/login.html';
            } catch (error) {
                console.error('Logout error:', error);
                window.ui.showToast({ type: 'error', message: 'Logout failed' });
            }
        });
    }

    // ------------------------------------------------------------------
    // Add camera modal
    // ------------------------------------------------------------------
    initAddCamera() {
        const modal = document.getElementById('addCameraModal');
        const addBtn = document.getElementById('addCameraBtn');
        const cancelBtn = document.getElementById('cancelAddCamera');
        const submitBtn = document.getElementById('submitAddCamera');
        const errorEl = document.getElementById('addCameraError');
        const nameInput = document.getElementById('rtspName');
        const urlInput = document.getElementById('rtspUrl');

        const open = () => {
            nameInput.value = '';
            urlInput.value = '';
            errorEl.textContent = '';
            const cameraUrl = `${location.origin}/`;
            const urlEl = document.getElementById('addCameraUrl');
            const qrEl = document.getElementById('addCameraQr');
            if (urlEl) urlEl.textContent = cameraUrl;
            if (qrEl) qrEl.src = `/api/qrcode?text=${encodeURIComponent(cameraUrl)}`;
            modal.classList.add('is-open');
            nameInput.focus();
        };
        const close = () => modal.classList.remove('is-open');
        const showError = (msg) => { errorEl.textContent = msg; };

        addBtn.addEventListener('click', open);
        cancelBtn.addEventListener('click', close);
        modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal.classList.contains('is-open')) close();
        });

        const submit = async () => {
            const name = nameInput.value.trim();
            const url = urlInput.value.trim();
            if (!url.startsWith('rtsp://')) return showError('URL must start with rtsp://');

            submitBtn.disabled = true;
            submitBtn.textContent = 'Adding…';
            try {
                const res = await fetch('/api/cameras/rtsp', {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, url })
                });
                if (res.status === 401) return showError('Session expired — please refresh the page');
                const data = await res.json();
                if (res.ok) {
                    close();
                    window.ui.showToast({ type: 'success', message: `Added ${data.camera?.name || 'camera'}` });
                } else {
                    showError(data.message || 'Failed to add camera');
                }
            } catch (err) {
                console.error('Add camera error:', err);
                showError('Connection error — check server logs');
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Add Camera';
            }
        };

        submitBtn.addEventListener('click', submit);
        urlInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') submit(); });
        nameInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') urlInput.focus(); });
    }

    // ------------------------------------------------------------------
    // Rename modal
    // ------------------------------------------------------------------
    initRenameModal() {
        const modal = document.getElementById('renameModal');
        const input = document.getElementById('renameInput');
        const errorEl = document.getElementById('renameError');
        const cancelBtn = document.getElementById('cancelRename');
        const submitBtn = document.getElementById('submitRename');

        this._renameState = { cameraId: null };

        const close = () => { modal.classList.remove('is-open'); errorEl.textContent = ''; };

        cancelBtn.addEventListener('click', close);
        modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal.classList.contains('is-open')) close();
        });

        const submit = async () => {
            const name = input.value.trim();
            const id = this._renameState.cameraId;
            if (!name) return (errorEl.textContent = 'Name is required');
            if (!id) return close();

            const camera = this.cameras.get(id);
            const isRtsp = camera && camera.type === 'rtsp';
            submitBtn.disabled = true;
            try {
                if (isRtsp) {
                    const res = await fetch(`/api/cameras/rtsp/${id}`, {
                        method: 'PATCH',
                        credentials: 'same-origin',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name })
                    });
                    if (!res.ok) {
                        const data = await res.json().catch(() => ({}));
                        errorEl.textContent = data.message || 'Rename failed';
                        return;
                    }
                    // camera-list-update will flow in; also update locally now.
                    if (camera) camera.name = name;
                    const card = document.querySelector(`[data-camera-id="${id}"] .camera-name`);
                    if (card) card.textContent = name;
                    window.ui.showToast({ type: 'success', message: 'Camera renamed' });
                } else {
                    // Phone cameras: no server API, update locally only.
                    if (camera) camera.name = name;
                    const card = document.querySelector(`[data-camera-id="${id}"] .camera-name`);
                    if (card) card.textContent = name;
                    window.ui.showToast({ type: 'info', message: 'Renamed locally (phone cameras reset on reconnect)' });
                }
                close();
            } catch (err) {
                errorEl.textContent = 'Connection error';
            } finally {
                submitBtn.disabled = false;
            }
        };

        submitBtn.addEventListener('click', submit);
        input.addEventListener('keypress', (e) => { if (e.key === 'Enter') submit(); });

        const deleteBtn = document.getElementById('deleteCameraBtn');
        deleteBtn.addEventListener('click', async () => {
            const id = this._renameState.cameraId;
            if (!id) return;
            const camera = this.cameras.get(id);
            const isRtsp = camera && camera.type === 'rtsp';
            close();
            await this.disconnectCamera(id, isRtsp);
        });
    }

    openRenameModal(cameraId) {
        const camera = this.cameras.get(cameraId);
        if (!camera) return;
        this._renameState.cameraId = cameraId;
        const modal = document.getElementById('renameModal');
        const input = document.getElementById('renameInput');
        const deleteBtn = document.getElementById('deleteCameraBtn');
        input.value = camera.name || '';
        if (deleteBtn) {
            deleteBtn.textContent = camera.type === 'rtsp' ? 'Remove camera' : 'Disconnect camera';
        }
        modal.classList.add('is-open');
        setTimeout(() => { input.focus(); input.select(); }, 50);
    }

    // ------------------------------------------------------------------
    // Socket listeners
    // ------------------------------------------------------------------
    initSocketListeners() {
        this.socket.on('connect', () => {
            this.requestCameraList();
        });

        this.socket.on('pairing-request', (data) => this.showPairingRequest(data));
        this.socket.on('camera-paired', (camera) => this.showPairingSuccess(camera));
        this.socket.on('pairing-expired', (data) => this.removePairingRequest(data.socketId));
        this.socket.on('camera-list-update', (cameras) => this.updateCameraList(cameras));
        this.socket.on('video-frame', (data) => this.updateVideoFrame(data));
        this.socket.on('stream-quality-changed', (data) => this.updateQualityIndicator(data.cameraId, data.quality));
    }

    requestCameraList() {
        this.socket.emit('get-camera-list');
    }

    // ------------------------------------------------------------------
    // Camera list rendering
    // ------------------------------------------------------------------
    updateCameraList(cameras) {
        const grid = document.getElementById('cameraGrid');

        if (!cameras.length) {
            this.cameras.clear();
            this.renderEmptyState();
            return;
        }

        // Drop empty-state if present
        const empty = grid.querySelector('.empty-state');
        if (empty) empty.remove();

        const currentIds = new Set(cameras.map(c => c.id));
        const existingIds = new Set(this.cameras.keys());
        const added = cameras.filter(c => !existingIds.has(c.id));
        const removed = [...existingIds].filter(id => !currentIds.has(id));
        const unchanged = cameras.filter(c => existingIds.has(c.id));

        removed.forEach(id => {
            const card = grid.querySelector(`[data-camera-id="${id}"]`);
            if (card) card.remove();
            this.cameras.delete(id);
            this.lastFrameAt.delete(id);
            this.lastFrameBlobs.delete(id);
        });

        unchanged.forEach(camera => {
            this.cameras.set(camera.id, camera);
            const card = grid.querySelector(`[data-camera-id="${camera.id}"]`);
            if (!card) return;
            const nameEl = card.querySelector('.camera-name');
            if (nameEl && camera.name) nameEl.textContent = camera.name;
            if (camera.type === 'rtsp') {
                const badge = card.querySelector('.rtsp-badge');
                if (badge) {
                    badge.className = `rtsp-badge ${this.getStatusClass(camera.status)}`;
                    badge.textContent = this.getStatusLabel(camera.status);
                }
            }
        });

        this.applyResponsiveGridClass(grid, cameras.length);

        added.forEach(camera => {
            const card = this.createCameraCard(camera);
            grid.appendChild(card);
            this.cameras.set(camera.id, camera);
            this.startStream(camera.id);
        });
    }

    renderEmptyState() {
        const grid = document.getElementById('cameraGrid');
        grid.className = 'camera-grid';
        const cameraUrl = `${location.origin}/`;
        const qrSrc = `/api/qrcode?text=${encodeURIComponent(cameraUrl)}`;
        grid.innerHTML = `
            <div class="empty-state">
                <div class="empty-state__icon">${window.ui.icon('camera', '')}</div>
                <div class="empty-state__title">No cameras connected</div>
                <div class="empty-state__subtitle">
                    Add an IP camera via RTSP, or use any phone or tablet as a camera.
                </div>
                <div class="empty-state__actions">
                    <button class="btn btn-primary" id="emptyAddBtn">${window.ui.icon('plus')} Add RTSP camera</button>
                </div>
                <div class="empty-state__divider">Or use a phone</div>
                <div style="color: var(--text-muted); font-size: 13px; margin-bottom: 10px;">
                    Open this URL on any phone or tablet
                </div>
                <div class="url-panel">
                    <div class="url-panel__text" id="emptyUrl">${cameraUrl}</div>
                </div>
                <div class="empty-state__qr">
                    <img src="${qrSrc}" alt="QR code for camera URL" width="160" height="160">
                    <div class="empty-state__qr-caption">Scan with a phone camera</div>
                </div>
            </div>
        `;
        const addBtn = grid.querySelector('#emptyAddBtn');
        if (addBtn) addBtn.addEventListener('click', () => document.getElementById('addCameraBtn').click());
    }

    applyResponsiveGridClass(grid, cameraCount) {
        grid.classList.remove('single-camera', 'two-cameras', 'three-cameras', 'four-cameras', 'many-cameras');
        switch (cameraCount) {
            case 1: grid.classList.add('single-camera'); break;
            case 2: grid.classList.add('two-cameras'); break;
            case 3: grid.classList.add('three-cameras'); break;
            case 4: grid.classList.add('four-cameras'); break;
            default: grid.classList.add('many-cameras'); break;
        }
    }

    createCameraCard(camera) {
        const card = document.createElement('div');
        card.className = 'camera-card';
        card.dataset.cameraId = camera.id;

        const isRtsp = camera.type === 'rtsp';
        const status = camera.status || 'connected';
        const statusLabel = this.getStatusLabel(status);
        const statusClass = this.getStatusClass(status);

        card.innerHTML = `
            <div class="camera-video" id="video-${camera.id}" data-stale-label="" data-enlarge="${camera.id}" title="Click to enlarge" role="button" tabindex="0">
                <span>${isRtsp && status !== 'connected' ? statusLabel : 'Waiting for stream…'}</span>
                <button class="tile-snapshot-btn" data-snapshot="${camera.id}" title="Snapshot" aria-label="Snapshot">${window.ui.icon('download')}</button>
            </div>
            <div class="camera-info">
                <div class="camera-name-wrap">
                    <span class="camera-name">${this.escape(camera.name || 'Camera')}</span>
                    ${isRtsp ? `<span class="rtsp-badge ${statusClass}">${statusLabel}</span>` : ''}
                </div>
                <button class="icon-btn" data-rename="${camera.id}" title="Settings" aria-label="Settings">${window.ui.icon('settings')}</button>
            </div>
            ${isRtsp && (status === 'offline' || status === 'disconnected' || status === 'error')
                ? `<div style="display: flex; justify-content: flex-end;">
                    <button class="btn" data-reconnect="${camera.id}">Reconnect</button>
                </div>`
                : ''}
        `;

        const videoEl = card.querySelector('[data-enlarge]');
        videoEl?.addEventListener('click', () => this.enlargeStream(camera.id));
        videoEl?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.enlargeStream(camera.id);
            }
        });
        card.querySelector('[data-reconnect]')?.addEventListener('click', () => this.reconnectRtspCamera(camera.id));
        card.querySelector('[data-rename]')?.addEventListener('click', () => this.openRenameModal(camera.id));
        card.querySelector('[data-snapshot]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.snapshotCamera(camera.id);
        });
        return card;
    }

    escape(s) {
        return String(s).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    getStatusLabel(status) {
        const labels = {
            connecting: 'Connecting',
            connected: 'Live',
            disconnected: 'Disconnected',
            offline: 'Offline',
            error: 'Error'
        };
        return labels[status] || status;
    }

    getStatusClass(status) {
        const classes = {
            connecting: 'rtsp-status--connecting',
            connected: 'rtsp-status--connected',
            disconnected: 'rtsp-status--disconnected',
            offline: 'rtsp-status--offline',
            error: 'rtsp-status--error'
        };
        return classes[status] || '';
    }

    async reconnectRtspCamera(cameraId) {
        try {
            const res = await fetch(`/api/cameras/rtsp/${cameraId}/reconnect`, { method: 'POST' });
            if (!res.ok) {
                window.ui.showToast({ type: 'error', message: 'Reconnect failed' });
            } else {
                window.ui.showToast({ type: 'info', message: 'Reconnecting…' });
            }
        } catch (err) {
            window.ui.showToast({ type: 'error', message: 'Connection error' });
        }
    }

    // ------------------------------------------------------------------
    // Enlarge modal
    // ------------------------------------------------------------------
    initEnlargeModal() {
        const modal = document.getElementById('enlargeModal');
        const closeBtn = document.getElementById('closeModalBtn');
        const prevBtn = document.getElementById('enlargePrev');
        const nextBtn = document.getElementById('enlargeNext');
        const snapBtn = document.getElementById('enlargeSnapshot');
        const fsBtn = document.getElementById('enlargeFullscreen');

        const close = () => {
            modal.classList.remove('active');
            const modalImg = document.getElementById('modalImage');
            if (modalImg) {
                if (modalImg._blobUrl) URL.revokeObjectURL(modalImg._blobUrl);
                modalImg._blobUrl = null;
                modalImg.src = '';
            }
            enlargedCameraId = null;
            if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        };

        closeBtn.addEventListener('click', close);
        modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
        prevBtn.addEventListener('click', () => this.cycleEnlarged(-1));
        nextBtn.addEventListener('click', () => this.cycleEnlarged(1));
        snapBtn.addEventListener('click', () => {
            if (enlargedCameraId) this.snapshotCamera(enlargedCameraId);
        });
        fsBtn.addEventListener('click', () => {
            const el = document.querySelector('.enlarge-content');
            if (!document.fullscreenElement && el?.requestFullscreen) el.requestFullscreen().catch(() => {});
            else document.exitFullscreen().catch(() => {});
        });

        document.addEventListener('keydown', (e) => {
            if (!modal.classList.contains('active')) return;
            if (e.key === 'Escape') close();
            else if (e.key === 'ArrowLeft') this.cycleEnlarged(-1);
            else if (e.key === 'ArrowRight') this.cycleEnlarged(1);
            else if (e.key === 's' || e.key === 'S') { if (enlargedCameraId) this.snapshotCamera(enlargedCameraId); }
            else if (e.key === 'f' || e.key === 'F') fsBtn.click();
        });
    }

    enlargeStream(cameraId) {
        const modal = document.getElementById('enlargeModal');
        enlargedCameraId = cameraId;
        modal.classList.add('active');
        this.refreshEnlargeFromState();
    }

    cycleEnlarged(dir) {
        const ids = Array.from(this.cameras.keys());
        if (!ids.length) return;
        const idx = ids.indexOf(enlargedCameraId);
        const next = ids[(idx + dir + ids.length) % ids.length];
        enlargedCameraId = next;
        this.refreshEnlargeFromState();
    }

    refreshEnlargeFromState() {
        const camera = this.cameras.get(enlargedCameraId);
        const nameEl = document.getElementById('enlargeName');
        if (nameEl) nameEl.textContent = camera?.name || 'Camera';
        const last = this.lastFrameBlobs.get(enlargedCameraId);
        const modalImg = document.getElementById('modalImage');
        if (last && modalImg) {
            if (modalImg._blobUrl) URL.revokeObjectURL(modalImg._blobUrl);
            const url = URL.createObjectURL(last.blob);
            modalImg._blobUrl = url;
            modalImg.src = url;
        } else if (modalImg) {
            if (modalImg._blobUrl) URL.revokeObjectURL(modalImg._blobUrl);
            modalImg._blobUrl = null;
            modalImg.src = '';
        }
        this.updateEnlargeTimestamp();
    }

    updateEnlargeTimestamp() {
        const el = document.getElementById('enlargeTimestamp');
        if (!el) return;
        const t = this.lastFrameAt.get(enlargedCameraId);
        if (!t) { el.textContent = ''; return; }
        const ageSec = Math.max(0, Math.floor((Date.now() - t) / 1000));
        el.textContent = ageSec <= 1 ? 'live' : `${ageSec}s ago`;
    }

    // ------------------------------------------------------------------
    // Stream handling
    // ------------------------------------------------------------------
    startStream(cameraId) {
        const camera = this.cameras.get(cameraId);
        if (!camera || camera.type !== 'rtsp') {
            this.socket.emit('request-camera-stream', cameraId);
        }
        this.activeStreams.add(cameraId);
    }

    updateVideoFrame(data) {
        const videoContainer = document.getElementById(`video-${data.cameraId}`);
        if (!videoContainer) return;

        let img = videoContainer.querySelector('img');
        if (!img) {
            // Preserve the snapshot button when clearing the placeholder
            const snapBtn = videoContainer.querySelector('.tile-snapshot-btn');
            videoContainer.innerHTML = '';
            img = document.createElement('img');
            videoContainer.appendChild(img);
            if (snapBtn) videoContainer.appendChild(snapBtn);
        }

        if (img._blobUrl) URL.revokeObjectURL(img._blobUrl);
        const blob = new Blob([data.frame], { type: 'image/jpeg' });
        const url = URL.createObjectURL(blob);
        img._blobUrl = url;
        img.src = url;

        if (data.width && data.height) {
            img.style.aspectRatio = `${data.width} / ${data.height}`;
            img.dataset.width = data.width;
            img.dataset.height = data.height;
        }

        // Track freshness
        this.lastFrameAt.set(data.cameraId, Date.now());
        this.lastFrameBlobs.set(data.cameraId, {
            blob,
            width: data.width,
            height: data.height,
            timestamp: data.timestamp
        });

        // Clear stale classes if present
        const card = document.querySelector(`[data-camera-id="${data.cameraId}"]`);
        if (card) {
            card.classList.remove('is-stale', 'is-offline');
            videoContainer.setAttribute('data-stale-label', '');
        }

        // If this camera is currently enlarged, update modal
        if (enlargedCameraId === data.cameraId) {
            const modalImg = document.getElementById('modalImage');
            if (modalImg) {
                if (modalImg._blobUrl) URL.revokeObjectURL(modalImg._blobUrl);
                const modalBlob = new Blob([data.frame], { type: 'image/jpeg' });
                const modalUrl = URL.createObjectURL(modalBlob);
                modalImg._blobUrl = modalUrl;
                modalImg.src = modalUrl;
            }
            this.updateEnlargeTimestamp();
        }
    }

    // ------------------------------------------------------------------
    // Stale watcher — run once per second, updates overlay labels.
    // ------------------------------------------------------------------
    startStaleWatcher() {
        setInterval(() => {
            const now = Date.now();
            for (const [id, camera] of this.cameras) {
                const card = document.querySelector(`[data-camera-id="${id}"]`);
                if (!card) continue;
                const video = card.querySelector('.camera-video');
                if (!video) continue;

                const last = this.lastFrameAt.get(id);
                // For RTSP cameras reporting themselves as offline, show offline overlay.
                if (camera.type === 'rtsp' && (camera.status === 'offline' || camera.status === 'error')) {
                    card.classList.remove('is-stale');
                    card.classList.add('is-offline');
                    video.setAttribute('data-stale-label', camera.status === 'error' ? 'Connection error' : 'Offline');
                    continue;
                }
                if (!last) continue; // never received a frame yet — leave placeholder alone
                const age = now - last;
                if (age > OFFLINE_AFTER_MS) {
                    card.classList.remove('is-stale');
                    card.classList.add('is-offline');
                    video.setAttribute('data-stale-label', `No signal — ${Math.floor(age / 1000)}s`);
                } else if (age > STALE_AFTER_MS) {
                    card.classList.add('is-stale');
                    card.classList.remove('is-offline');
                    video.setAttribute('data-stale-label', `No signal — ${Math.floor(age / 1000)}s`);
                } else {
                    card.classList.remove('is-stale', 'is-offline');
                    video.setAttribute('data-stale-label', '');
                }
            }
            if (enlargedCameraId) this.updateEnlargeTimestamp();
        }, 1000);
    }

    // ------------------------------------------------------------------
    // Snapshot — downloads the most recent JPEG for a camera.
    // ------------------------------------------------------------------
    snapshotCamera(cameraId) {
        const last = this.lastFrameBlobs.get(cameraId);
        const camera = this.cameras.get(cameraId);
        if (!last) {
            window.ui.showToast({ type: 'warning', message: 'No frame available yet' });
            return;
        }
        const url = URL.createObjectURL(last.blob);
        const a = document.createElement('a');
        const safeName = (camera?.name || 'camera').replace(/[^a-z0-9\-_]+/gi, '_').toLowerCase();
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        a.href = url;
        a.download = `${safeName}_${ts}.jpg`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        window.ui.showToast({ type: 'success', message: 'Snapshot saved' });
    }

    // ------------------------------------------------------------------
    // Pairing notifications (unchanged behavior, cleaner markup)
    // ------------------------------------------------------------------
    showPairingRequest(data) {
        const notification = document.createElement('div');
        notification.id = `pairing-${data.socketId}`;
        notification.className = 'toast toast--pairing';
        notification.innerHTML = `
            <div class="toast__header">
                <h3 class="toast__title">Camera Pairing</h3>
            </div>
            <div class="toast__device">${this.escape(data.deviceInfo)}</div>
            <div class="toast__code-wrap">
                <div class="toast__code-label">Show this code to camera:</div>
                <div class="toast__code">${this.escape(data.code)}</div>
            </div>
            <div class="toast__expiry">Expires in 60 seconds</div>
        `;
        document.body.appendChild(notification);
        setTimeout(() => this.removePairingRequest(data.socketId), 60000);
    }

    removePairingRequest(socketId) {
        const notification = document.getElementById(`pairing-${socketId}`);
        if (!notification) return;
        notification.classList.add('is-removing');
        setTimeout(() => notification.remove(), 300);
    }

    showPairingSuccess(camera) {
        this.removePairingRequest(camera.id);
        window.ui.showToast({ type: 'success', message: `${camera.name} connected` });
    }

    // ------------------------------------------------------------------
    // Disconnect / remove
    // ------------------------------------------------------------------
    async disconnectCamera(cameraId, isRtsp = false) {
        const camera = this.cameras.get(cameraId);
        const name = camera?.name || 'this camera';
        const ok = await window.ui.showConfirm({
            title: isRtsp ? 'Remove camera?' : 'Disconnect camera?',
            message: isRtsp
                ? `"${name}" will be removed from the registry and FFmpeg will be stopped.`
                : `"${name}" will be disconnected. The phone will reload.`,
            confirmText: isRtsp ? 'Remove' : 'Disconnect',
            danger: true
        });
        if (!ok) return;

        if (isRtsp) {
            try {
                const res = await fetch(`/api/cameras/rtsp/${cameraId}`, { method: 'DELETE' });
                if (!res.ok) window.ui.showToast({ type: 'error', message: 'Failed to remove camera' });
            } catch (err) {
                window.ui.showToast({ type: 'error', message: 'Connection error' });
            }
        } else {
            this.socket.emit('disconnect-camera', { cameraId });
        }

        const card = document.querySelector(`[data-camera-id="${cameraId}"]`);
        if (card) {
            card.style.animation = 'fadeOut 0.3s ease';
            setTimeout(() => {
                if (card.parentNode) card.parentNode.removeChild(card);
                this.cameras.delete(cameraId);
                this.lastFrameAt.delete(cameraId);
                this.lastFrameBlobs.delete(cameraId);
                if (this.cameras.size === 0) this.renderEmptyState();
            }, 300);
        }
    }

    updateQualityIndicator(cameraId, quality) {
        const qualitySelect = document.getElementById(`quality-${cameraId}`);
        if (qualitySelect) qualitySelect.value = quality;
    }
}

let dashboard;
document.addEventListener('DOMContentLoaded', () => {
    dashboard = new AdminDashboard();
});
