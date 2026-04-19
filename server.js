require('dotenv').config();
const express = require('express');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const bcrypt = require('bcrypt');
const { spawn } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 80;

// Hashed at startup from env variable — set ADMIN_PASSWORD in your .env file
let ADMIN_PASSWORD_HASH;

// Store active camera connections
const activeCameras = new Map();

// Store pending camera pairing requests
const pairingRequests = new Map();

// RTSP camera management
const CAMERAS_FILE = path.join(__dirname, 'cameras.json');
const rtspProcesses = new Map();
const rtspRetries = new Map();
const RTSP_MAX_RETRIES = 10;
const RTSP_RETRY_INTERVAL = 5000; // 5s base, scales with retry count

// Simple in-memory rate limiter for login attempts
const loginAttempts = new Map();
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes

function checkLoginRateLimit(ip) {
    const now = Date.now();
    const record = loginAttempts.get(ip);
    if (!record || now > record.resetAt) {
        loginAttempts.delete(ip);
        return { limited: false };
    }
    if (record.count >= MAX_LOGIN_ATTEMPTS) {
        const retryAfter = Math.ceil((record.resetAt - now) / 1000);
        return { limited: true, retryAfter };
    }
    return { limited: false };
}

function recordFailedLogin(ip) {
    const now = Date.now();
    const record = loginAttempts.get(ip) || { count: 0, resetAt: now + LOCKOUT_DURATION };
    record.count++;
    loginAttempts.set(ip, record);
}

// --- Camera Registry ---

function loadCameraRegistry() {
    try {
        if (fs.existsSync(CAMERAS_FILE)) {
            const data = fs.readFileSync(CAMERAS_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (err) {
        console.error('Error loading camera registry:', err.message);
    }
    return { cameras: [] };
}

function saveCameraRegistry(registry) {
    try {
        fs.writeFileSync(CAMERAS_FILE, JSON.stringify(registry, null, 2));
    } catch (err) {
        console.error('Error saving camera registry:', err.message);
    }
}

// --- RTSP Stream Management ---

function startRtspStream(camera) {
    if (rtspProcesses.has(camera.id)) {
        stopRtspStream(camera.id);
    }

    console.log(`Starting RTSP stream for "${camera.name}" (${camera.id})`);

    const args = [
        '-loglevel', 'warning',
        '-rtsp_transport', 'tcp',
        '-i', camera.url,
        '-f', 'image2pipe',
        '-vf', 'fps=10',
        '-q:v', '5',
        '-vcodec', 'mjpeg',
        '-an',
        'pipe:1'
    ];

    const ffmpeg = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });

    let buffer = Buffer.alloc(0);
    let receivedFirstFrame = false;

    ffmpeg.stdout.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);

        // Parse JPEG frames (SOI: 0xFFD8, EOI: 0xFFD9)
        while (true) {
            const soiIndex = buffer.indexOf(Buffer.from([0xFF, 0xD8]));
            if (soiIndex === -1) break;

            const eoiIndex = buffer.indexOf(Buffer.from([0xFF, 0xD9]), soiIndex + 2);
            if (eoiIndex === -1) break;

            const frame = buffer.slice(soiIndex, eoiIndex + 2);
            buffer = buffer.slice(eoiIndex + 2);

            if (!receivedFirstFrame) {
                receivedFirstFrame = true;
                rtspRetries.set(camera.id, { count: 0 });
                const info = activeCameras.get(camera.id);
                if (info) {
                    info.status = 'connected';
                    io.to('admins').emit('camera-list-update', Array.from(activeCameras.values()));
                }
                console.log(`RTSP stream connected: "${camera.name}"`);
            }

            io.to('admins').emit('video-frame', {
                cameraId: camera.id,
                frame: frame,
                timestamp: Date.now(),
                width: null,
                height: null
            });
        }

        // Prevent buffer from growing unbounded
        if (buffer.length > 5 * 1024 * 1024) {
            buffer = Buffer.alloc(0);
        }
    });

    ffmpeg.stderr.on('data', (data) => {
        const msg = data.toString().trim();
        if (msg) console.warn(`FFmpeg [${camera.name}]: ${msg}`);
    });

    ffmpeg.on('error', (err) => {
        if (err.code === 'ENOENT') {
            console.error('FFmpeg is not installed. RTSP support requires FFmpeg.');
            console.error('Install with: brew install ffmpeg (macOS) or apt install ffmpeg (Linux)');
        }
        rtspProcesses.delete(camera.id);
        const info = activeCameras.get(camera.id);
        if (info) {
            info.status = 'error';
            io.to('admins').emit('camera-list-update', Array.from(activeCameras.values()));
        }
    });

    ffmpeg.on('close', (code) => {
        console.log(`FFmpeg for "${camera.name}" exited (code ${code})`);
        rtspProcesses.delete(camera.id);

        const info = activeCameras.get(camera.id);
        if (info) {
            info.status = 'disconnected';
            io.to('admins').emit('camera-list-update', Array.from(activeCameras.values()));
        }

        // Auto-retry if camera is still in registry
        const registry = loadCameraRegistry();
        const stillRegistered = registry.cameras.find(c => c.id === camera.id);
        if (stillRegistered) {
            const retryState = rtspRetries.get(camera.id) || { count: 0 };
            retryState.count++;
            rtspRetries.set(camera.id, retryState);

            if (retryState.count <= RTSP_MAX_RETRIES) {
                const delay = Math.min(RTSP_RETRY_INTERVAL * retryState.count, 60000);
                console.log(`Retrying "${camera.name}" in ${delay / 1000}s (attempt ${retryState.count}/${RTSP_MAX_RETRIES})`);
                setTimeout(() => {
                    if (!rtspProcesses.has(camera.id)) {
                        startRtspStream(stillRegistered);
                    }
                }, delay);
            } else {
                console.log(`Max retries reached for "${camera.name}". Use dashboard to reconnect.`);
                if (info) {
                    info.status = 'offline';
                    io.to('admins').emit('camera-list-update', Array.from(activeCameras.values()));
                }
            }
        }
    });

    rtspProcesses.set(camera.id, ffmpeg);

    activeCameras.set(camera.id, {
        id: camera.id,
        name: camera.name,
        type: 'rtsp',
        status: 'connecting',
        timestamp: new Date().toISOString()
    });

    io.to('admins').emit('camera-list-update', Array.from(activeCameras.values()));
}

function stopRtspStream(cameraId) {
    rtspRetries.delete(cameraId);
    const proc = rtspProcesses.get(cameraId);
    if (proc) {
        proc.kill('SIGTERM');
        rtspProcesses.delete(cameraId);
    }
    activeCameras.delete(cameraId);
}

function stopAllRtspStreams() {
    for (const [, proc] of rtspProcesses) {
        proc.kill('SIGTERM');
    }
    rtspProcesses.clear();
    rtspRetries.clear();
}

function reconnectRegisteredCameras() {
    const registry = loadCameraRegistry();
    if (registry.cameras.length === 0) return;

    console.log(`Reconnecting ${registry.cameras.length} registered RTSP camera(s)...`);
    for (const camera of registry.cameras) {
        startRtspStream(camera);
    }
}

// Session configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'change-me-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 24 * 60 * 60 * 1000 // 24 hours default
    }
}));

// Middleware to parse JSON
app.use(express.json());

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Authentication middleware
function requireAuth(req, res, next) {
    if (req.session && req.session.isAuthenticated) {
        next();
    } else if (req.path.startsWith('/api/')) {
        res.status(401).json({ success: false, message: 'Not authenticated' });
    } else {
        res.redirect('/login.html');
    }
}

// Login route
app.post('/login', async (req, res) => {
    const ip = req.ip || req.socket.remoteAddress;
    const rateCheck = checkLoginRateLimit(ip);

    if (rateCheck.limited) {
        return res.status(429).json({
            success: false,
            message: `Too many login attempts. Try again in ${Math.ceil(rateCheck.retryAfter / 60)} minutes.`
        });
    }

    const { password, rememberMe } = req.body;
    
    try {
        const isValid = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
        
        if (isValid) {
            loginAttempts.delete(ip); // Clear attempts on successful login
            req.session.isAuthenticated = true;
            
            // Extend session if remember me is checked
            if (rememberMe) {
                req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
            }
            
            res.json({ success: true });
        } else {
            recordFailedLogin(ip);
            res.status(401).json({ success: false, message: 'Invalid password' });
        }
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Logout route
app.post('/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// Check auth status
app.get('/auth-status', (req, res) => {
    res.json({ authenticated: req.session.isAuthenticated || false });
});

// Root route - serve the main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Admin page route (protected)
app.get('/admin', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Serve admin.html with auth check
app.get('/admin.html', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// QR code generator (SVG) for the given text. Protected: admin only.
app.get('/api/qrcode', requireAuth, async (req, res) => {
    const text = String(req.query.text || '').slice(0, 512);
    if (!text) return res.status(400).send('text query param required');
    try {
        const svg = await QRCode.toString(text, {
            type: 'svg',
            margin: 1,
            color: { dark: '#e6edf3', light: '#00000000' }
        });
        res.set('Content-Type', 'image/svg+xml');
        res.set('Cache-Control', 'public, max-age=3600');
        res.send(svg);
    } catch (err) {
        console.error('QR generation failed:', err);
        res.status(500).send('QR generation failed');
    }
});

// --- RTSP Camera API Routes (protected) ---

// Add an RTSP camera
app.post('/api/cameras/rtsp', requireAuth, (req, res) => {
    const { name, url } = req.body;

    if (!url || !url.startsWith('rtsp://')) {
        return res.status(400).json({ success: false, message: 'A valid RTSP URL is required (rtsp://...)' });
    }

    const cameraName = (name || '').trim() || 'RTSP Camera';
    const id = `rtsp-${crypto.randomUUID().split('-')[0]}`;

    const camera = {
        id,
        name: cameraName,
        type: 'rtsp',
        url,
        addedAt: new Date().toISOString()
    };

    // Save to registry
    const registry = loadCameraRegistry();
    registry.cameras.push(camera);
    saveCameraRegistry(registry);

    // Start the stream
    startRtspStream(camera);

    console.log(`RTSP camera added: "${cameraName}" → ${url}`);
    res.json({ success: true, camera: { id, name: cameraName, type: 'rtsp' } });
});

// List registered RTSP cameras
app.get('/api/cameras/rtsp', requireAuth, (req, res) => {
    const registry = loadCameraRegistry();
    // Strip URLs from response (credentials stay server-side)
    const cameras = registry.cameras.map(c => ({
        id: c.id,
        name: c.name,
        type: c.type,
        addedAt: c.addedAt,
        status: activeCameras.has(c.id) ? activeCameras.get(c.id).status : 'offline'
    }));
    res.json({ cameras });
});

// Remove an RTSP camera
app.delete('/api/cameras/rtsp/:id', requireAuth, (req, res) => {
    const { id } = req.params;

    const registry = loadCameraRegistry();
    const index = registry.cameras.findIndex(c => c.id === id);
    if (index === -1) {
        return res.status(404).json({ success: false, message: 'Camera not found' });
    }

    const removed = registry.cameras.splice(index, 1)[0];
    saveCameraRegistry(registry);

    stopRtspStream(id);

    io.to('admins').emit('camera-list-update', Array.from(activeCameras.values()));

    console.log(`RTSP camera removed: "${removed.name}" (${id})`);
    res.json({ success: true });
});

// Rename an RTSP camera
app.patch('/api/cameras/rtsp/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    const { name } = req.body;

    if (!name || !name.trim()) {
        return res.status(400).json({ success: false, message: 'Name is required' });
    }

    const registry = loadCameraRegistry();
    const camera = registry.cameras.find(c => c.id === id);
    if (!camera) {
        return res.status(404).json({ success: false, message: 'Camera not found' });
    }

    camera.name = name.trim();
    saveCameraRegistry(registry);

    // Update active camera info
    const info = activeCameras.get(id);
    if (info) {
        info.name = camera.name;
        io.to('admins').emit('camera-list-update', Array.from(activeCameras.values()));
    }

    res.json({ success: true, camera: { id, name: camera.name } });
});

// Reconnect a specific RTSP camera
app.post('/api/cameras/rtsp/:id/reconnect', requireAuth, (req, res) => {
    const { id } = req.params;

    const registry = loadCameraRegistry();
    const camera = registry.cameras.find(c => c.id === id);
    if (!camera) {
        return res.status(404).json({ success: false, message: 'Camera not found' });
    }

    stopRtspStream(id);
    startRtspStream(camera);

    res.json({ success: true });
});

// Create HTTP server
const httpServer = http.createServer(app);
const io = socketIo(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

async function startServer() {
    const password = process.env.ADMIN_PASSWORD || 'admin';
    ADMIN_PASSWORD_HASH = await bcrypt.hash(password, 10);

    httpServer.listen(PORT, () => {
        console.log(`🚀 HTTP Server running on port ${PORT}`);
        console.log(`📱 Camera App: http://localhost:${PORT}`);
        console.log(`📱 Admin Dashboard: http://localhost:${PORT}/admin`);

        // Auto-reconnect registered RTSP cameras
        reconnectRegisteredCameras();
    });
}

startServer();

// Graceful shutdown
function shutdown() {
    console.log('Shutting down — stopping RTSP streams...');
    stopAllRtspStreams();
    process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Unified Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    // Generate 3-digit pairing code
    function generatePairingCode() {
        return Math.floor(100 + Math.random() * 900).toString();
    }

    // Handle camera pairing request
    socket.on('request-pairing', (data) => {
        socket.join('cameras');

        const pairingCode = generatePairingCode();
        const pairingRequest = {
            socketId: socket.id,
            code: pairingCode,
            deviceInfo: data.deviceInfo || 'Unknown Device',
            timestamp: Date.now(),
            expiresAt: Date.now() + 60000 // 60 seconds expiration
        };
        
        pairingRequests.set(socket.id, pairingRequest);
        console.log(`Pairing request from ${socket.id}, code: ${pairingCode}`);
        
        // Notify all admin clients about pairing request
        io.to('admins').emit('pairing-request', {
            socketId: socket.id,
            code: pairingCode,
            deviceInfo: pairingRequest.deviceInfo
        });
        
        // Auto-expire after 60 seconds
        setTimeout(() => {
            if (pairingRequests.has(socket.id)) {
                pairingRequests.delete(socket.id);
                socket.emit('pairing-expired');
                io.to('admins').emit('pairing-expired', { socketId: socket.id });
                console.log(`Pairing code ${pairingCode} expired`);
            }
        }, 60000);
    });

    // Handle pairing code submission from camera
    socket.on('submit-pairing-code', (data) => {
        const request = pairingRequests.get(socket.id);
        
        if (!request) {
            socket.emit('pairing-failed', { message: 'No active pairing request' });
            return;
        }
        
        if (request.expiresAt < Date.now()) {
            pairingRequests.delete(socket.id);
            socket.emit('pairing-failed', { message: 'Pairing code expired' });
            return;
        }
        
        if (request.code === data.code) {
            // Pairing successful
            pairingRequests.delete(socket.id);
            
            const cameraInfo = {
                id: socket.id,
                name: data.name || `Camera ${socket.id.substring(0, 6)}`,
                deviceInfo: request.deviceInfo,
                timestamp: new Date().toISOString(),
                paired: true
            };
            
            activeCameras.set(socket.id, cameraInfo);
            
            socket.emit('pairing-success');
            io.to('admins').emit('camera-paired', cameraInfo);
            io.to('admins').emit('camera-list-update', Array.from(activeCameras.values()));
            
            console.log(`Camera ${socket.id} paired successfully`);
        } else {
            socket.emit('pairing-failed', { message: 'Invalid pairing code' });
        }
    });

    // Handle camera registration (legacy - for backward compatibility)
    socket.on('register-camera', (data) => {
        socket.join('cameras');

        const cameraInfo = {
            id: socket.id,
            name: data.name || `Camera ${socket.id.substring(0, 6)}`,
            deviceInfo: data.deviceInfo || 'Unknown Device',
            timestamp: new Date().toISOString()
        };
        
        activeCameras.set(socket.id, cameraInfo);
        console.log('Camera registered:', cameraInfo);
        
        // Notify all admin clients about new camera
        io.to('admins').emit('camera-list-update', Array.from(activeCameras.values()));
    });

    // Handle video stream from camera
    socket.on('video-stream', (data) => {
        // Forward video stream to admin clients only
        io.to('admins').emit('video-frame', {
            cameraId: socket.id,
            frame: data.frame,
            timestamp: data.timestamp,
            width: data.width,
            height: data.height
        });
    });

    // Handle stream quality change requests from admin
    socket.on('change-stream-quality', (data) => {
        const { cameraId, quality } = data;
        console.log(`Admin ${socket.id} requesting quality change for camera ${cameraId} to ${quality}`);
        
        // Forward quality change request to specific camera
        const targetSocket = io.sockets.sockets.get(cameraId);
        if (targetSocket) {
            targetSocket.emit('quality-change-request', {
                quality: quality,
                requestedBy: socket.id
            });
        } else {
            console.log(`Camera ${cameraId} not found for quality change request`);
        }
    });

    // Handle quality change confirmation from camera
    socket.on('quality-changed', (data) => {
        console.log(`Camera ${socket.id} confirmed quality change to ${data.quality}`);
        
        // Notify all admin clients about the quality change
        io.to('admins').emit('stream-quality-changed', {
            cameraId: socket.id,
            quality: data.quality
        });
    });

    // Handle admin requesting camera list
    socket.on('get-camera-list', () => {
        socket.join('admins');
        socket.emit('camera-list-update', Array.from(activeCameras.values()));
    });

    // Handle admin requesting specific camera stream
    socket.on('request-camera-stream', (cameraId) => {
        // RTSP cameras stream automatically — no action needed
        const cameraInfo = activeCameras.get(cameraId);
        if (cameraInfo && cameraInfo.type === 'rtsp') return;

        const targetSocket = io.sockets.sockets.get(cameraId);
        if (targetSocket) {
            targetSocket.emit('start-streaming', socket.id);
            console.log(`Admin ${socket.id} requested stream from camera ${cameraId}`);
        } else {
            console.log(`Camera ${cameraId} not found for stream request`);
        }
    });

    // Handle admin stopping camera stream
    socket.on('stop-camera-stream', (cameraId) => {
        const targetSocket = io.sockets.sockets.get(cameraId);
        if (targetSocket) {
            targetSocket.emit('stop-streaming', socket.id);
            console.log(`Admin ${socket.id} stopped stream from camera ${cameraId}`);
        }
    });

    // Handle admin disconnecting a camera
    socket.on('disconnect-camera', (data) => {
        const { cameraId } = data;

        // Check if it's an RTSP camera
        const cameraInfo = activeCameras.get(cameraId);
        if (cameraInfo && cameraInfo.type === 'rtsp') {
            console.log(`Admin ${socket.id} disconnecting RTSP camera ${cameraId}`);

            // Remove from registry
            const registry = loadCameraRegistry();
            const index = registry.cameras.findIndex(c => c.id === cameraId);
            if (index !== -1) {
                registry.cameras.splice(index, 1);
                saveCameraRegistry(registry);
            }

            stopRtspStream(cameraId);
            io.to('admins').emit('camera-list-update', Array.from(activeCameras.values()));
            return;
        }

        // Phone/tablet camera
        const targetSocket = io.sockets.sockets.get(cameraId);
        
        if (targetSocket) {
            console.log(`Admin ${socket.id} disconnecting camera ${cameraId}`);
            
            // Notify camera to reload before disconnecting
            targetSocket.emit('force-disconnect');
            
            // Remove from active cameras
            activeCameras.delete(cameraId);
            
            // Disconnect the camera socket
            targetSocket.disconnect(true);
            
            // Notify all admin clients about camera removal
            io.to('admins').emit('camera-list-update', Array.from(activeCameras.values()));
        } else {
            console.log(`Camera ${cameraId} not found for disconnect request`);
        }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        activeCameras.delete(socket.id);
        pairingRequests.delete(socket.id); // Bug 4: clean up any pending pairing request
        
        // Notify all admin clients about camera removal
        io.to('admins').emit('camera-list-update', Array.from(activeCameras.values()));
    });
});
