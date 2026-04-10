require('dotenv').config();
const express = require('express');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const bcrypt = require('bcrypt');

const app = express();
const PORT = process.env.PORT || 80;

// Hashed at startup from env variable — set ADMIN_PASSWORD in your .env file
let ADMIN_PASSWORD_HASH;

// Store active camera connections
const activeCameras = new Map();

// Store pending camera pairing requests
const pairingRequests = new Map();

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
    if (req.session.isAuthenticated) {
        next();
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
    });
}

startServer();

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
