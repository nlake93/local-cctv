let enlargedCameraId = null;

class AdminDashboard {
    constructor() {
        this.socket = io();
        this.cameras = new Map();
        this.activeStreams = new Set();
        this.videoFrames = new Map();
        
        this.initSocketListeners();
        this.initLogout();
        this.initAddCamera();
        this.requestCameraList();
    }

    initLogout() {
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', async () => {
                try {
                    await fetch('/logout', { method: 'POST' });
                    window.location.href = '/login.html';
                } catch (error) {
                    console.error('Logout error:', error);
                }
            });
        }
    }

    initAddCamera() {
        const modal = document.getElementById('addCameraModal');
        const addBtn = document.getElementById('addCameraBtn');
        const cancelBtn = document.getElementById('cancelAddCamera');
        const submitBtn = document.getElementById('submitAddCamera');
        const errorEl = document.getElementById('addCameraError');
        const nameInput = document.getElementById('rtspName');
        const urlInput = document.getElementById('rtspUrl');

        const openModal = () => {
            modal.style.display = 'flex';
            nameInput.value = '';
            urlInput.value = '';
            errorEl.style.display = 'none';
            nameInput.focus();
        };

        const closeModal = () => {
            modal.style.display = 'none';
        };

        const showError = (msg) => {
            errorEl.textContent = msg;
            errorEl.style.display = 'block';
        };

        addBtn.addEventListener('click', openModal);
        cancelBtn.addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

        const submitCamera = async () => {
            const name = nameInput.value.trim();
            const url = urlInput.value.trim();

            if (!url.startsWith('rtsp://')) {
                showError('URL must start with rtsp://');
                return;
            }

            submitBtn.disabled = true;
            submitBtn.textContent = 'Adding...';

            try {
                const res = await fetch('/api/cameras/rtsp', {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, url })
                });
                if (res.status === 401) {
                    showError('Session expired — please refresh the page');
                    return;
                }
                const data = await res.json();
                if (res.ok) {
                    closeModal();
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

        submitBtn.addEventListener('click', submitCamera);
        urlInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') submitCamera(); });
        nameInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') urlInput.focus(); });
    }

    initSocketListeners() {
        this.socket.on('connect', () => {
            console.log('Connected to server');
            this.requestCameraList();
        });

        // Pairing events
        this.socket.on('pairing-request', (data) => {
            this.showPairingRequest(data);
        });

        this.socket.on('camera-paired', (camera) => {
            this.showPairingSuccess(camera);
        });

        this.socket.on('pairing-expired', (data) => {
            this.removePairingRequest(data.socketId);
        });

        this.socket.on('camera-list-update', (cameras) => {
            this.updateCameraList(cameras);
        });

        this.socket.on('video-frame', (data) => {
            this.updateVideoFrame(data);
        });

        this.socket.on('stream-quality-changed', (data) => {
            this.updateQualityIndicator(data.cameraId, data.quality);
            console.log(`Quality changed for camera ${data.cameraId} to ${data.quality}`);
        });

        this.socket.on('disconnect', () => {
            console.log('Disconnected from server');
        });
    }

    requestCameraList() {
        this.socket.emit('get-camera-list');
    }

    updateCameraList(cameras) {
        const grid = document.getElementById('cameraGrid');
        
        if (cameras.length === 0) {
            grid.innerHTML = `
                <div class="no-cameras">
                    <p>No cameras connected</p>
                    <p style="font-size: 0.9em; margin-top: 10px;">Open the camera app on a device to see it here</p>
                </div>
            `;
            grid.className = 'camera-grid';
            this.cameras.clear();
            return;
        }

        const currentIds = new Set(cameras.map(c => c.id));
        const existingIds = new Set(this.cameras.keys());

        // Check if cameras added or removed
        const added = cameras.filter(c => !existingIds.has(c.id));
        const removed = [...existingIds].filter(id => !currentIds.has(id));
        const unchanged = cameras.filter(c => existingIds.has(c.id));

        // Remove departed cameras
        removed.forEach(id => {
            const card = grid.querySelector(`[data-camera-id="${id}"]`);
            if (card) card.remove();
            this.cameras.delete(id);
        });

        // Update status badges on existing RTSP cameras (no rebuild)
        unchanged.forEach(camera => {
            this.cameras.set(camera.id, camera);
            if (camera.type === 'rtsp') {
                const card = grid.querySelector(`[data-camera-id="${camera.id}"]`);
                if (card) {
                    const badge = card.querySelector('.rtsp-badge');
                    if (badge) {
                        badge.className = `rtsp-badge ${this.getStatusClass(camera.status)}`;
                        badge.textContent = this.getStatusLabel(camera.status);
                    }
                }
            }
        });

        // Add new cameras
        if (added.length > 0 || removed.length > 0) {
            this.applyResponsiveGridClass(grid, cameras.length);
        }
        added.forEach(camera => {
            const cameraCard = this.createCameraCard(camera);
            grid.appendChild(cameraCard);
            this.cameras.set(camera.id, camera);
            this.startStream(camera.id);
        });

        // Remove "no cameras" message if present
        const noMsg = grid.querySelector('.no-cameras');
        if (noMsg) noMsg.remove();
    }

    applyResponsiveGridClass(grid, cameraCount) {
        // Remove all existing grid classes
        grid.classList.remove('single-camera', 'two-cameras', 'three-cameras', 'four-cameras', 'many-cameras');
        
        // Apply appropriate class based on camera count
        switch (cameraCount) {
            case 1:
                grid.classList.add('single-camera');
                break;
            case 2:
                grid.classList.add('two-cameras');
                break;
            case 3:
                grid.classList.add('three-cameras');
                break;
            case 4:
                grid.classList.add('four-cameras');
                break;
            default:
                grid.classList.add('many-cameras');
                break;
        }
        
        console.log(`Applied ${grid.classList[1]} layout for ${cameraCount} camera(s)`);
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
            <div class="camera-video" id="video-${camera.id}">
                <span>${isRtsp && status !== 'connected' ? statusLabel : 'Waiting for stream...'}</span>
            </div>
            <div class="camera-info">
                <div style="display: flex; align-items: center; gap: 8px;">
                    ${camera.name || 'Camera'}
                    ${isRtsp ? `<span class="rtsp-badge ${statusClass}">${statusLabel}</span>` : ''}
                </div>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 8px; gap: 8px;">
                <button class="btn btn-primary" data-enlarge="${camera.id}" style="font-size: 0.8em; padding: 6px 12px;">Enlarge</button>
                ${isRtsp && (status === 'offline' || status === 'disconnected' || status === 'error')
                    ? `<button class="btn" data-reconnect="${camera.id}" style="font-size: 0.8em; padding: 6px 12px; background: var(--accent); border-color: var(--accent);">Reconnect</button>`
                    : ''}
                <button class="btn" data-disconnect="${camera.id}" style="font-size: 0.8em; padding: 6px 12px; background: #ef4444; border-color: #ef4444;">
                    ${isRtsp ? 'Remove' : 'Disconnect'}
                </button>
            </div>
        `;
        setTimeout(() => {
            const enlargeBtn = card.querySelector('[data-enlarge]');
            if (enlargeBtn) {
                enlargeBtn.addEventListener('click', () => this.enlargeStream(camera.id));
            }
            
            const disconnectBtn = card.querySelector('[data-disconnect]');
            if (disconnectBtn) {
                disconnectBtn.addEventListener('click', () => this.disconnectCamera(camera.id, isRtsp));
            }

            const reconnectBtn = card.querySelector('[data-reconnect]');
            if (reconnectBtn) {
                reconnectBtn.addEventListener('click', () => this.reconnectRtspCamera(camera.id));
            }
        }, 0);
        return card;
    }

    getStatusLabel(status) {
        const labels = {
            connecting: '⏳ Connecting',
            connected: '🟢 Live',
            disconnected: '🔴 Disconnected',
            offline: '⚫ Offline',
            error: '⚠️ Error'
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
            if (!res.ok) console.error('Reconnect failed');
        } catch (err) {
            console.error('Reconnect error:', err);
        }
    }

    enlargeStream(cameraId) {
        const videoContainer = document.getElementById(`video-${cameraId}`);
        const img = videoContainer ? videoContainer.querySelector('img') : null;
        const modal = document.getElementById('enlargeModal');
        const modalImg = document.getElementById('modalImage');
        if (img && modal && modalImg) {
            modalImg.src = img.src;
            modal.style.display = 'flex';
            enlargedCameraId = cameraId;
        }
    }


    getDeviceFromUserAgent(userAgent) {
        if (userAgent.includes('iPhone')) return 'iPhone';
        if (userAgent.includes('iPad')) return 'iPad';
        if (userAgent.includes('Android')) return 'Android';
        if (userAgent.includes('Mac')) return 'Mac';
        if (userAgent.includes('Windows')) return 'Windows';
        return 'Unknown Device';
    }

    startStream(cameraId) {
        const camera = this.cameras.get(cameraId);
        // RTSP streams are pushed automatically by the server
        if (!camera || camera.type !== 'rtsp') {
            this.socket.emit('request-camera-stream', cameraId);
        }
        this.activeStreams.add(cameraId);
        const videoContainer = document.getElementById(`video-${cameraId}`);
        if (videoContainer) {
            videoContainer.innerHTML = '<span>📡 Waiting for stream...</span>';
        }
    }

    // stopStream removed: not needed for auto-streaming

    updateVideoFrame(data) {
        const videoContainer = document.getElementById(`video-${data.cameraId}`);
        if (!videoContainer) return;

        let img = videoContainer.querySelector('img');
        if (!img) {
            img = document.createElement('img');
            videoContainer.innerHTML = '';
            videoContainer.appendChild(img);
        }

        // Revoke previous blob URL to free memory, then create new one
        if (img._blobUrl) URL.revokeObjectURL(img._blobUrl);
        const blob = new Blob([data.frame], { type: 'image/jpeg' });
        const url = URL.createObjectURL(blob);
        img._blobUrl = url;
        img.src = url;
        
        // Update aspect ratio if dimensions are provided
        if (data.width && data.height) {
            img.style.aspectRatio = `${data.width} / ${data.height}`;
            img.dataset.width = data.width;
            img.dataset.height = data.height;
        }

        // If modal is open for this camera, update modal image too
        if (enlargedCameraId === data.cameraId) {
            const modalImg = document.getElementById('modalImage');
            if (modalImg) {
                if (modalImg._blobUrl) URL.revokeObjectURL(modalImg._blobUrl);
                const modalBlob = new Blob([data.frame], { type: 'image/jpeg' });
                const modalUrl = URL.createObjectURL(modalBlob);
                modalImg._blobUrl = modalUrl;
                modalImg.src = modalUrl;
                if (data.width && data.height) {
                    modalImg.style.aspectRatio = `${data.width} / ${data.height}`;
                }
            }
        }
    }

    checkNoCameras() { // Bug 1: show placeholder when all cameras are gone
        const grid = document.getElementById('cameraGrid');
        if (this.cameras.size === 0) {
            grid.className = 'camera-grid';
            grid.innerHTML = `
                <div class="no-cameras">
                    <p>No cameras connected</p>
                    <p style="font-size: 0.85em; margin-top: 12px; color: var(--text-dim);">Open the camera app on a device to see it here</p>
                </div>
            `;
        }
    }

    formatTime(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleTimeString();
    }

    // Pairing methods
    showPairingRequest(data) {
        console.log('Pairing request received:', data);
        
        const notification = document.createElement('div');
        notification.id = `pairing-${data.socketId}`;
        notification.className = 'toast toast--pairing';

        notification.innerHTML = `
            <div class="toast__header">
                <h3 class="toast__title">Camera Pairing</h3>
            </div>
            <div class="toast__device">${data.deviceInfo}</div>
            <div class="toast__code-wrap">
                <div class="toast__code-label">Show this code to camera:</div>
                <div class="toast__code">${data.code}</div>
            </div>
            <div class="toast__expiry">Expires in 60 seconds</div>
        `;
        
        document.body.appendChild(notification);
        
        // Auto-remove after 60 seconds
        setTimeout(() => {
            this.removePairingRequest(data.socketId);
        }, 60000);
    }

    removePairingRequest(socketId) {
        const notification = document.getElementById(`pairing-${socketId}`);
        if (notification) {
            notification.classList.add('is-removing');
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }
    }

    showPairingSuccess(camera) {
        console.log('Camera paired successfully:', camera);
        
        // Remove pairing request notification
        this.removePairingRequest(camera.id);
        
        // Show success notification
        const notification = document.createElement('div');
        notification.className = 'toast toast--success';
        
        notification.textContent = `✓ ${camera.name} connected`;
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.classList.add('is-removing');
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, 3000);
    }

    changeStreamQuality(cameraId, quality) {
        console.log(`Changing quality for camera ${cameraId} to ${quality}`);
        
        // Send quality change request to camera
        this.socket.emit('change-stream-quality', {
            cameraId: cameraId,
            quality: quality
        });
        
        // Show loading indicator
        const videoContainer = document.getElementById(`video-${cameraId}`);
        if (videoContainer) {
            const img = videoContainer.querySelector('img');
            if (img) {
                img.style.opacity = '0.5';
            }
            
            // Reset opacity after 2 seconds
            setTimeout(() => {
                if (img) {
                    img.style.opacity = '1';
                }
            }, 2000);
        }
        
        // Update quality display
        this.updateQualityIndicator(cameraId, quality);
    }

    async disconnectCamera(cameraId, isRtsp = false) {
        const action = isRtsp ? 'remove' : 'disconnect';
        if (!confirm(`Are you sure you want to ${action} this camera?`)) return;

        console.log(`${action} camera ${cameraId}`);

        if (isRtsp) {
            try {
                await fetch(`/api/cameras/rtsp/${cameraId}`, { method: 'DELETE' });
            } catch (err) {
                console.error('Failed to remove RTSP camera:', err);
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
                this.checkNoCameras();
            }, 300);
        }
    }

    updateQualityIndicator(cameraId, quality) {
        const qualitySelect = document.getElementById(`quality-${cameraId}`);
        if (qualitySelect) {
            qualitySelect.value = quality;
        }
    }
}

// Initialize dashboard when page loads
let dashboard;
document.addEventListener('DOMContentLoaded', () => {
    dashboard = new AdminDashboard();
});

// Modal close logic for enlarge stream
// This must be outside the class and after the dashboard is initialized

document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('enlargeModal');
    const closeModalBtn = document.getElementById('closeModalBtn');
    
    if (closeModalBtn && modal) {
        // Close button click handler
        closeModalBtn.addEventListener('click', () => {
            closeModal();
        });
        
        // Click outside modal to close
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModal();
            }
        });
        
        // Escape key handler
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal.style.display === 'flex') {
                closeModal();
            }
        });
    }
    
    function closeModal() {
        if (modal) {
            modal.style.display = 'none';
            const modalImg = document.getElementById('modalImage');
            if (modalImg) {
                if (modalImg._blobUrl) URL.revokeObjectURL(modalImg._blobUrl);
                modalImg._blobUrl = null;
                modalImg.src = '';
            }
            enlargedCameraId = null;
        }
    }
});
