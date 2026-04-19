class CameraApp {
    constructor() {
        this.video = document.getElementById('video');
        this.canvas = document.getElementById('canvas');
        this.controls = document.querySelector('.controls');
        
        this.startBtn = document.getElementById('startCamera');
        this.switchBtn = document.getElementById('switchCamera');
        this.toggleViewBtn = document.getElementById('toggleCameraView');
        this.flashlightBtn = document.getElementById('flashlightBtn');
        this.stopBtn = document.getElementById('stopBtn');
    
        // Zoom controls
        this.zoomControls = document.getElementById('zoomControls');
        this.zoomSlider = document.getElementById('zoomSlider');
        this.zoomValue = document.getElementById('zoomValue');
        
        this.stream = null;
        this.currentCamera = 'environment'; // 'user' for front camera, 'environment' for back camera
        this.socket = io();
        this.streamingToAdmin = false;
        this.streamInterval = null;
        
        // Zoom and focus track
        this.videoTrack = null;
        this.capabilities = null;
        this.currentZoom = 1;
        this.torchOn = false;
        
        // Pairing properties
        this.paired = false;
        this.pairingModal = document.getElementById('pairingModal');
        this.pairingCodeInput = document.getElementById('pairingCode');
        this.pairingError = document.getElementById('pairingError');
        this.pairingTimer = document.getElementById('pairingTimer');
        this.pairingExpiresAt = null;
        this.pairingTimerInterval = null;
        
        // Stream quality settings
        this.currentQuality = 'medium';
        this.qualitySettings = {
            high: { width: 1280, height: 720, quality: 0.9 },
            medium: { width: 640, height: 480, quality: 0.7 },
            low: { width: 320, height: 240, quality: 0.5 }
        };
        
        this.initEventListeners();
        this.initPairingListeners();
        this.initSocketListeners();
        
        // Initially center the controls since camera is not active
        this.controls.classList.add('centered');
    }
    
    // Pairing methods
    initPairingListeners() {
        document.getElementById('submitPairing').addEventListener('click', () => {
            this.submitPairingCode();
        });
        
        document.getElementById('cancelPairing').addEventListener('click', () => {
            this.closePairingModal();
        });
        
        this.pairingCodeInput.addEventListener('input', (e) => {
            // Only allow numbers
            e.target.value = e.target.value.replace(/[^0-9]/g, '');
        });
        
        this.pairingCodeInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.submitPairingCode();
            }
        });
    }

    requestPairing() {
        const deviceInfo = `${navigator.platform} - ${navigator.userAgent.split('(')[1]?.split(')')[0] || 'Unknown'}`;
        this.socket.emit('request-pairing', { deviceInfo });
        this.showPairingModal();
    }

    showPairingModal() {
        this.pairingModal.style.display = 'flex';
        this.pairingCodeInput.value = '';
        this.pairingCodeInput.focus();
        this.pairingError.style.display = 'none';
        this.pairingExpiresAt = Date.now() + 60000;
        this.startPairingTimer();
    }

    closePairingModal() {
        this.pairingModal.style.display = 'none';
        this.pairingCodeInput.value = '';
        this.clearPairingTimer();
        if (!this.paired && this.stream) {
            window.location.reload();
        }
    }

    startPairingTimer() {
        this.clearPairingTimer();
        this.updatePairingTimer();
        this.pairingTimerInterval = setInterval(() => {
            this.updatePairingTimer();
        }, 1000);
    }

    updatePairingTimer() {
        const remaining = Math.max(0, Math.ceil((this.pairingExpiresAt - Date.now()) / 1000));
        this.pairingTimer.textContent = `Code expires in ${remaining} seconds`;
        
        if (remaining === 0) {
            this.clearPairingTimer();
            this.showPairingError('Pairing code expired. Please try again.');
            setTimeout(() => {
                this.closePairingModal();
            }, 2000);
        }
    }

    clearPairingTimer() {
        if (this.pairingTimerInterval) {
            clearInterval(this.pairingTimerInterval);
            this.pairingTimerInterval = null;
        }
    }

    submitPairingCode() {
        const code = this.pairingCodeInput.value.trim();
        
        if (code.length !== 3) {
            this.showPairingError('Please enter a 3-digit code');
            return;
        }
        
        this.socket.emit('submit-pairing-code', { 
            code,
            name: `Camera ${Date.now().toString().slice(-4)}`
        });
    }

    showPairingError(message) {
        this.pairingError.textContent = message;
        this.pairingError.style.display = 'block';
    }

    showDisconnectNotification() {
        const notification = document.createElement('div');
        notification.className = 'notification-disconnect';
        notification.textContent = 'Disconnected by admin';
        document.body.appendChild(notification);
        
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 2000);
    }
    
    initEventListeners() {
        this.startBtn.addEventListener('click', () => this.startCamera());
        this.switchBtn.addEventListener('click', () => this.switchCamera());
        this.toggleViewBtn.addEventListener('click', () => this.toggleCameraView());
        this.flashlightBtn.addEventListener('click', () => this.toggleFlashlight());
        this.stopBtn.addEventListener('click', () => window.location.reload());
        
        // Zoom slider
        this.zoomSlider.addEventListener('input', (e) => this.handleZoomChange(e.target.value));
        
        // Listen for orientation changes
        window.addEventListener('orientationchange', () => {
            setTimeout(() => {
                this.handleOrientationChange();
            }, 100);
        });
        
        // Also listen for resize events (fallback for browsers without orientationchange)
        window.addEventListener('resize', () => {
            if (this.stream && this.streamCanvas) {
                clearTimeout(this.resizeTimeout);
                this.resizeTimeout = setTimeout(() => {
                    this.handleOrientationChange();
                }, 200);
            }
        });
    }
    
    async startCamera() {
        try {
            // Check if getUserMedia is supported
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error('Camera access not supported in this browser');
            }

            // iOS-optimized constraints
            const constraints = {
                video: {
                    facingMode: { ideal: this.currentCamera },
                    width: { ideal: 1280, max: 1920 },
                    height: { ideal: 720, max: 1080 },
                    frameRate: { ideal: 30, max: 60 }
                },
                audio: false
            };

            // Try with iOS-optimized constraints first
            try {
                this.stream = await navigator.mediaDevices.getUserMedia(constraints);
            } catch (constraintError) {
                // Fallback to basic constraints for older devices
                console.warn('Advanced constraints failed, trying basic constraints:', constraintError);
                const basicConstraints = {
                    video: {
                        facingMode: this.currentCamera
                    },
                    audio: false
                };
                this.stream = await navigator.mediaDevices.getUserMedia(basicConstraints);
            }

            this.video.srcObject = this.stream;

            // Apply appropriate CSS class for camera orientation
            this.updateVideoOrientation();

            // Wait for video to load metadata
            await new Promise((resolve) => {
                this.video.onloadedmetadata = resolve;
            });
            
            // Initialize zoom and focus capabilities
            await this.initializeCameraCapabilities();

            // Show camera controls
            this.updateButtonStates(true);

            // Show the toggle view button
            this.toggleViewBtn.style.display = 'inline-block';
            this.toggleViewBtn.textContent = 'Hide Camera View';
            this.video.style.display = '';

            // Request pairing before streaming
            if (!this.paired) {
                this.requestPairing();
            } else {
                this.startStreamingToAdmin();
            }

        } catch (error) {
            console.error('Error accessing camera:', error);
            this.handleCameraError(error);
        }
    }
    
    async switchCamera() {
        if (!this.stream) return;
        
        // Stop current stream
        this.stream.getTracks().forEach(track => track.stop());
        
        // Switch camera
        this.currentCamera = this.currentCamera === 'user' ? 'environment' : 'user';
        
        // Start with new camera
        await this.startCamera();
    }
    
    
    toggleCameraView() {
        if (this.video.style.display === 'none') {
            this.video.style.display = '';
            this.toggleViewBtn.textContent = 'Hide Camera View';
        } else {
            this.video.style.display = 'none';
            this.toggleViewBtn.textContent = 'Show Camera View';
        }
    }

    updateVideoOrientation() {
        // Remove existing camera classes
        this.video.classList.remove('front-camera', 'back-camera');
        // Add appropriate class based on current camera
        if (this.currentCamera === 'user') {
            // Front camera - mirror horizontally for natural selfie view
            this.video.classList.add('front-camera');
        } else {
            // Back camera - show natural view without mirroring
            this.video.classList.add('back-camera');
        }
    }

    updateButtonStates(cameraActive) {
        this.startBtn.style.display = cameraActive ? 'none' : 'inline-block';
        this.switchBtn.style.display = cameraActive ? 'inline-block' : 'none';
        this.stopBtn.style.display = cameraActive ? 'inline-block' : 'none';
        // Toggle centered class based on camera state
        if (cameraActive) {
            this.controls.classList.remove('centered');
        } else {
            this.controls.classList.add('centered');
        }
    }

    handleCameraError(error) {
        let errorMessage = 'Camera access failed: ';
        switch (error.name) {
            case 'NotAllowedError':
                errorMessage += 'Permission denied. Please allow camera access and try again.';
                break;
            case 'NotFoundError':
                errorMessage += 'No camera found on this device.';
                break;
            case 'NotSupportedError':
                errorMessage += 'Camera not supported in this browser.';
                break;
            case 'NotReadableError':
                errorMessage += 'Camera is already in use by another application.';
                break;
            case 'OverconstrainedError':
                errorMessage += 'Camera constraints not supported.';
                break;
            case 'SecurityError':
                errorMessage += 'Security error - HTTPS required.';
                break;
            default:
                errorMessage += error.message || 'Unknown error occurred.';
        }
        this.showBanner(errorMessage);
        // Add debugging information
        console.error('Camera error details:', {
            name: error.name,
            message: error.message,
            userAgent: navigator.userAgent,
            isSecureContext: window.isSecureContext,
            protocol: location.protocol,
            hostname: location.hostname
        });
    }

    showBanner(message, duration = 6000) {
        const existing = document.querySelector('.camera-banner');
        if (existing) existing.remove();
        const el = document.createElement('div');
        el.className = 'camera-banner';
        el.textContent = message;
        el.addEventListener('click', () => el.remove());
        document.body.appendChild(el);
        if (duration > 0) setTimeout(() => el.remove(), duration);
    }

    initSocketListeners() {
        this.socket.on('connect', () => {
            console.log('Connected to server');
            this.registerCamera();
        });

        // Pairing events
        this.socket.on('pairing-success', () => {
            console.log('Pairing successful!');
            this.paired = true;
            this.clearPairingTimer();
            this.closePairingModal();
            this.startStreamingToAdmin();
        });

        this.socket.on('pairing-failed', (data) => {
            console.log('Pairing failed:', data.message);
            this.showPairingError(data.message);
        });

        this.socket.on('pairing-expired', () => {
            console.log('Pairing expired');
            this.showPairingError('Pairing code expired');
            setTimeout(() => {
                this.closePairingModal();
            }, 2000);
        });

        this.socket.on('disconnect', () => {
            console.log('Disconnected from server');
            if (this.stream) {
                // Reset pairing on disconnect
                this.paired = false;
            }
        });

        this.socket.on('start-streaming', (adminId) => {
            console.log('Admin requested stream');
            this.startStreamingToAdmin();
        });
        this.socket.on('stop-streaming', (adminId) => {
            console.log('Admin stopped stream');
            this.stopStreamingToAdmin();
        });

        this.socket.on('quality-change-request', (data) => {
            console.log('Quality change requested:', data.quality);
            this.changeStreamQuality(data.quality);
        });

        this.socket.on('force-disconnect', () => {
            console.log('Force disconnected by admin');
            window.location.reload();
        });
    }

    registerCamera() {
        const deviceInfo = this.getDeviceInfo();
        this.socket.emit('register-camera', {
            name: `${deviceInfo.device} Camera`,
            deviceInfo: deviceInfo.full
        });
    }

    getDeviceInfo() {
        const ua = navigator.userAgent;
        let device = 'Unknown Device';
        if (ua.includes('iPhone')) device = 'iPhone';
        else if (ua.includes('iPad')) device = 'iPad';
        else if (ua.includes('Android')) device = 'Android';
        else if (ua.includes('Mac')) device = 'Mac';
        else if (ua.includes('Windows')) device = 'Windows';
        return {
            device: device,
            full: ua
        };
    }

    startStreamingToAdmin() {
        if (!this.stream || this.streamingToAdmin) return;
        this.streamingToAdmin = true;
        // Create a separate canvas for streaming
        this.streamCanvas = document.createElement('canvas');
        // Match canvas size to video size for accurate streaming
        this.updateCanvasDimensions();
        // Start streaming at 10 FPS to avoid overwhelming the connection
        this.streamInterval = setInterval(() => {
            this.sendVideoFrame();
        }, 100); // 10 FPS
    }
    
    updateCanvasDimensions() {
        if (!this.streamCanvas || !this.video) return;
        const width = this.video.videoWidth || 320;
        const height = this.video.videoHeight || 240;
        
        // Only update if dimensions have changed
        if (this.streamCanvas.width !== width || this.streamCanvas.height !== height) {
            this.streamCanvas.width = width;
            this.streamCanvas.height = height;
            console.log(`Canvas dimensions updated: ${width}x${height}`);
        }
    }
    
    handleOrientationChange() {
        if (!this.stream || !this.streamCanvas) return;
        
        // Wait for video metadata to update
        setTimeout(() => {
            this.updateCanvasDimensions();
        }, 100);
    }

    stopStreamingToAdmin() {
        this.streamingToAdmin = false;
        if (this.streamInterval) {
            clearInterval(this.streamInterval);
            this.streamInterval = null;
        }
    }

    sendVideoFrame() {
        if (!this.stream || !this.streamingToAdmin) return;
        
        // Ensure canvas dimensions match video dimensions
        this.updateCanvasDimensions();
        
        const context = this.streamCanvas.getContext('2d');
        // Handle camera orientation
        if (this.currentCamera === 'user') {
            // Front camera - flip horizontally
            context.save();
            context.scale(-1, 1);
            context.drawImage(this.video, -this.streamCanvas.width, 0, this.streamCanvas.width, this.streamCanvas.height);
            context.restore();
        } else {
            // Back camera - draw normally
            context.drawImage(this.video, 0, 0, this.streamCanvas.width, this.streamCanvas.height);
        }

        const quality = this.qualitySettings[this.currentQuality].quality;
        const width = this.streamCanvas.width;
        const height = this.streamCanvas.height;

        // Send raw binary instead of base64 (~33% less data)
        this.streamCanvas.toBlob((blob) => {
            if (!blob || !this.streamingToAdmin) return;
            blob.arrayBuffer().then((buffer) => {
                this.socket.emit('video-stream', {
                    frame: buffer,
                    timestamp: Date.now(),
                    quality: this.currentQuality,
                    width,
                    height
                });
            });
        }, 'image/jpeg', quality);
    }

    changeStreamQuality(newQuality) {
        if (!this.qualitySettings[newQuality]) {
            console.error('Invalid quality setting:', newQuality);
            return;
        }

        this.currentQuality = newQuality;
        const settings = this.qualitySettings[newQuality];
        
        // Update stream canvas size
        if (this.streamCanvas) {
            this.streamCanvas.width = settings.width;
            this.streamCanvas.height = settings.height;
        }
        
        console.log(`Stream quality changed to ${newQuality} (${settings.width}x${settings.height})`);
        
        // Confirm quality change to server
        this.socket.emit('quality-changed', {
            quality: newQuality,
            settings: settings
        });
    }

    async initializeCameraCapabilities() {
        try {
            if (!this.stream) return;
            
            this.videoTrack = this.stream.getVideoTracks()[0];
            this.capabilities = this.videoTrack.getCapabilities();
            
            console.log('Camera capabilities:', this.capabilities);
            
            // Check if zoom is supported
            if (this.capabilities.zoom) {
                const { min, max, step } = this.capabilities.zoom;
                this.zoomSlider.min = min;
                this.zoomSlider.max = max;
                this.zoomSlider.step = step || 0.1;
                this.zoomSlider.value = min;
                this.currentZoom = min;
                this.zoomValue.textContent = `${min.toFixed(1)}x`;
                
                // Show zoom controls
                this.zoomControls.style.display = 'flex';
                console.log(`Zoom supported: ${min}x - ${max}x`);
            } else {
                console.log('Zoom not supported on this device');
                this.zoomControls.style.display = 'none';
            }
            
            // Check if torch/flashlight is supported
            if (this.capabilities.torch) {
                console.log('Torch supported');
                this.flashlightBtn.style.display = 'inline-block';
            } else {
                console.log('Torch not supported');
            }
        } catch (error) {
            console.error('Error initializing camera capabilities:', error);
        }
    }

    async handleZoomChange(value) {
        try {
            const zoomLevel = parseFloat(value);
            
            if (!this.videoTrack || !this.capabilities || !this.capabilities.zoom) {
                return;
            }
            
            await this.videoTrack.applyConstraints({
                advanced: [{ zoom: zoomLevel }]
            });
            
            this.currentZoom = zoomLevel;
            this.zoomValue.textContent = `${zoomLevel.toFixed(1)}x`;
            console.log(`Zoom set to ${zoomLevel}x`);
        } catch (error) {
            console.error('Error applying zoom:', error);
        }
    }

    async toggleFlashlight() {
        try {
            if (!this.videoTrack || !this.capabilities || !this.capabilities.torch) {
                console.log('Torch not available');
                return;
            }
            
            this.torchOn = !this.torchOn;
            
            await this.videoTrack.applyConstraints({
                advanced: [{ torch: this.torchOn }]
            });
            
            this.flashlightBtn.textContent = this.torchOn ? 'Flash On' : 'Flash';
            console.log('Flashlight:', this.torchOn ? 'ON' : 'OFF');
        } catch (error) {
            console.error('Error toggling flashlight:', error);
            this.torchOn = !this.torchOn;
        }
    }


}


// Initialize the camera app when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new CameraApp();
});

// Handle page visibility changes (iOS Safari optimization)
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        // Page is hidden, pause camera if needed
        console.log('Page hidden, camera may be paused');
    } else {
        // Page is visible again
        console.log('Page visible again');
    }
});

// iOS-specific touch handling for better mobile experience
document.addEventListener('touchstart', function() {}, { passive: true });

// Prevent scrolling on the entire page
document.addEventListener('touchmove', function(e) {
    // Allow touch move on zoom slider
    if (e.target.id === 'zoomSlider' || e.target.closest('.zoom-controls')) {
        return;
    }
    e.preventDefault();
}, { passive: false });

// Prevent pull-to-refresh on iOS
document.addEventListener('touchstart', function(e) {
    if (e.touches.length > 1) {
        e.preventDefault();
    }
}, { passive: false });

// Prevent zoom on iOS
document.addEventListener('touchend', function(e) {
    if (e.touches.length > 0) {
        e.preventDefault();
    }
}, { passive: false });

// Prevent default scroll behavior
document.addEventListener('scroll', function(e) {
    e.preventDefault();
    window.scrollTo(0, 0);
}, { passive: false });
