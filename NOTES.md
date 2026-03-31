# 📝 Development Notes & Planned Features

*Last Updated: December 13, 2025*

---

## 🎯 Decided Features for Implementation

### 1. 📱 **Background Mode - PWA Implementation**

**Approach:** Progressive Web App with manifest and service worker

**Key Features:**
- Add to Home Screen capability
- Works like native app on iOS/Android
- Better background persistence
- Wake Lock API to prevent screen sleep during streaming
- Offline capability with service worker

**Benefits:**
- No app store approval needed
- Cross-platform (iOS & Android)
- Quick installation for users
- Enhanced performance and reliability

---

### 2. 🎤 **One-Way Audio Streaming (Camera → Admin)**

#### **Client Side:**
- **Toggle button** appears after starting camera
- **Default state:** Muted
- **No visual indicators** needed
- Captures raw audio (no processing)

#### **Admin Side:**
- **Mute button** for each camera stream
- **Volume slider** to control audio level per stream
- **Visual audio indicator:** Show waveform or bars when audio detected
- **Audio mixing:** Handle multiple camera audio streams

#### **Technical Details:**
- Audio quality: Balanced (64kbps recommended)
- Format: Opus codec for web compatibility
- Latency target: ~500ms-1s
- Transmission: Via Socket.IO alongside video

#### **Future Enhancement:**
- Two-way audio using WebRTC
- Push-to-talk from admin to camera
- Audio recording with video clips

---

### 3. 🔐 **Authentication System**

#### **Admin Dashboard Protection:**
- **Basic password login** required to access admin dashboard
- Login page styled with dark theme (glassmorphism)
- Session-based authentication
- Session duration: 24 hours
- Rate limiting on login attempts
- "Remember me" option for trusted devices

#### **Camera Pairing System:** ⭐ *Unique Feature*
When a client clicks "Start Camera":
1. Camera generates connection request
2. Admin dashboard displays **3-digit pairing code**
3. Camera client must enter this code to connect
4. Code expires after 60 seconds if not used
5. Visual notification on admin when camera requests pairing

**Benefits:**
- Prevents unauthorized cameras from connecting
- Admin explicitly approves each camera
- Simple and user-friendly
- No pre-configuration needed

**Implementation Details:**
```
Camera: "Start Camera" → Request pairing
Admin: Shows "Camera requesting access - Code: 847"
Camera: User enters "847" → Connection approved
Admin: Camera appears in dashboard
```

---

### 4. 🎨 **Visual Redesign - Glassmorphism Dark Theme**

#### **Style Choice: Style B - Glassmorphism**

**Design Characteristics:**
- **Frosted glass effect** on cards and panels
- **Semi-transparent backgrounds** with backdrop-blur
- **Soft glows and shadows** for depth
- **Gradient accents** for visual interest
- **Smooth animations** and transitions
- **Modern, premium feel**

#### **Color Palette:** *(Finalized)*
**Chosen: Teal/Cyan (#14b8a6)**

**Base Colors:**
```css
--bg-primary: #0a0a0f;
--bg-secondary: #16161f;
--glass-bg: rgba(255, 255, 255, 0.05);
--glass-border: rgba(255, 255, 255, 0.1);
--accent: #14b8a6;
--accent-hover: #0d9488;
--accent-glow: rgba(20, 184, 166, 0.3);
--text-primary: #e5e7eb;
--text-secondary: #9ca3af;
--text-dim: #6b7280;
```

#### **Key Design Elements:**

**Admin Dashboard:**
- Blurred glass cards for each camera stream
- Floating header with glassmorphism
- Grid layout with smooth hover effects
- Status indicators with subtle glows
- Motion alerts with pulsing animations
- Sidebar stats panel (transparent)

**Camera Client:**
- Large video preview with minimal chrome
- Floating control buttons with glass effect
- Status footer with blur background
- Smooth button state transitions
- Audio/motion indicators with animations

**Login Page:**
- Centered glass card
- Gradient border animation
- Smooth input focus states
- Error messages with slide animation

#### **Typography:**
- Primary font: System UI fonts (SF Pro, Segoe UI)
- Fallback: Inter, system-ui, sans-serif
- Headings: Semi-bold, larger spacing
- Body: Regular weight, comfortable line height

#### **Animations:**
- Fade-in on page load (300ms)
- Hover lift effect on cards (200ms)
- Button press scale effect
- Smooth color transitions (150ms)
- Motion alert pulse animation
- Audio waveform visualization

---

## 🚀 Implementation Phases

### **Phase 1: Visual Redesign** ✅ *COMPLETED*
- [x] Define final accent color (Teal #14b8a6)
- [x] Create CSS variables for glassmorphism theme
- [x] Redesign admin.html and styles
- [x] Redesign index.html (camera client)
- [x] Add smooth animations and transitions
- [x] Test responsiveness on mobile

**Completed:** December 13, 2025
**Time Taken:** ~1 hour

---

### **Phase 2: PWA Implementation** ✅ *COMPLETED*
- [x] Create manifest.json
- [x] Design app icons (deferred - empty array for now)
- [x] Implement service worker
- [x] Add offline fallback with caching
- [x] Implement wake lock API
- [x] Add PWA meta tags
- [x] Configure caching strategies (network-first)
- [x] Test service worker registration
- [x] Exclude WebSocket connections from cache

**Completed:** December 14, 2025
**Time Taken:** ~1 hour
**Notes:** App now installable on mobile devices. Wake lock keeps screen on during streaming. Icons deferred for user upload later.

---

### **Phase 3: Authentication System** 🔐 *Priority 3*
- [ ] Create login.html with glassmorphism design
- [ ] Add express-session middleware
- [ ] Implement password hashing (bcrypt)
- [ ] Create authentication routes
- [ ] Add camera pairing code system
- [ ] Build pairing UI for admin dashboard
- [ ] Add pairing input on camera client
- [ ] Implement session management
- [ ] Add rate limiting

**Estimated Time:** 4-5 hours

---

### **Phase 4: Audio Streaming** 🎤 *Priority 4*
- [ ] Add microphone permission request
- [ ] Create audio toggle button on camera client
- [ ] Capture and encode audio stream
- [ ] Send audio chunks via Socket.IO
- [ ] Receive and play audio on admin dashboard
- [ ] Add mute button per camera
- [ ] Implement volume slider
- [ ] Create visual audio indicators (waveform/bars)
- [ ] Handle multiple audio streams
- [ ] Optimize audio quality vs bandwidth

**Estimated Time:** 6-8 hours

---

## 📋 Technical Architecture

### **Current Stack:**
- **Backend:** Node.js + Express
- **WebSocket:** Socket.IO
- **Frontend:** Vanilla JavaScript
- **Styling:** CSS3 with custom properties

### **New Dependencies Needed:**
```json
{
  "express-session": "^1.17.3",
  "bcrypt": "^5.1.1",
  "connect-rate-limit": "^1.1.0"
}
```

### **File Structure:**
```
web_server_camera/
├── server.js                 # Main server (updated)
├── package.json             # Dependencies
├── public/
│   ├── index.html           # Camera client (redesigned)
│   ├── admin.html           # Admin dashboard (redesigned)
│   ├── login.html           # New: Login page
│   ├── camera.js            # Camera logic (audio added)
│   ├── admin.js             # Admin logic (audio + pairing added)
│   ├── styles.css           # New: Glassmorphism theme
│   ├── manifest.json        # New: PWA manifest
│   ├── service-worker.js    # New: PWA service worker
│   └── icons/               # New: PWA icons
├── NOTES.md                 # This file
├── MOTION_DETECTION.md      # Motion detection docs
└── README.md                # Project overview
```

---

## 🎯 Key User Flows

### **Camera Setup Flow:**
```
1. User opens http://IP_ADDRESS
2. Clicks "Start Camera"
3. Grants camera permission
4. Server generates 3-digit code (e.g., "847")
5. Code displayed on admin dashboard
6. User enters "847" on camera page
7. Camera connects and streams
8. Optional: Click "Enable Audio" button
9. Grant microphone permission
10. Audio streams to admin
```

### **Admin Monitoring Flow:**
```
1. User opens http://IP_ADDRESS/admin
2. Redirected to login page
3. Enters admin password
4. Dashboard loads with glass-themed UI
5. See pairing request: "Code: 847"
6. Camera connects after pairing
7. Live video stream appears in glass card
8. See audio indicator when audio active
9. Can mute/unmute audio per camera
10. Adjust volume with slider
11. Toggle motion detection remotely
```

---

## 💡 Future Enhancements (Not Implemented Yet)

### **Short Term:**
- Recording video clips (manual + motion-triggered)
- Snapshot capture feature
- Motion detection zones
- Email/SMS notifications
- Custom camera naming

### **Medium Term:**
- Two-way audio (WebRTC)
- Multiple admin accounts
- Video playback library
- Mobile app (React Native)
- Time-lapse recording

### **Long Term:**
- AI person/pet detection
- Cloud storage integration
- Home automation webhooks
- Face recognition
- Multi-server federation

---

## 🔧 Configuration Options

### **Environment Variables:**
```bash
PORT=80                          # Server port
SESSION_SECRET=your-secret-key   # Session encryption key
ADMIN_PASSWORD=initial-password  # Initial admin password (hashed on first run)
NODE_ENV=production             # Environment mode
```

### **Customizable Settings (Future):**
- Video quality presets
- Audio bitrate
- Motion sensitivity defaults
- Session timeout duration
- Pairing code expiry time
- Maximum connected cameras

---

## 📊 Performance Targets

### **Video Streaming:**
- Target FPS: 15-30 fps
- Resolution options: 640x480, 1280x720, 1920x1080
- Latency: <1 second
- Bandwidth per camera: 1-4 Mbps

### **Audio Streaming:**
- Bitrate: 64 kbps (balanced)
- Sample rate: 48 kHz
- Latency: 500ms-1s
- Codec: Opus

### **Server Performance:**
- Support 10+ concurrent cameras
- CPU usage: <50% with 5 cameras
- Memory: <500MB with 5 cameras
- Response time: <100ms

---

## 🐛 Known Considerations

### **Browser Compatibility:**
- iOS Safari: Requires HTTPS for camera/microphone
- Chrome/Edge: Full support
- Firefox: Full support
- Solution: Use Cloudflare + Nginx Proxy Manager for SSL

### **Mobile Limitations:**
- Background mode limited on iOS
- PWA helps but not perfect
- Battery drain with continuous streaming
- Network switching can disconnect

### **Security Considerations:**
- Passwords stored hashed (bcrypt)
- Sessions use secure cookies
- Rate limiting prevents brute force
- CORS configured properly
- No credentials in client-side code

---

## 📚 Resources & References

### **PWA Resources:**
- [MDN PWA Guide](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps)
- [Web.dev PWA](https://web.dev/progressive-web-apps/)
- [PWA Asset Generator](https://github.com/elegantapp/pwa-asset-generator)

### **Audio Streaming:**
- [MDN MediaStream API](https://developer.mozilla.org/en-US/docs/Web/API/MediaStream_API)
- [Socket.IO Binary Data](https://socket.io/docs/v4/emitting-events/#binary)
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)

### **Design Inspiration:**
- [Glassmorphism CSS](https://css.glass/)
- [Dribbble - Dark Dashboards](https://dribbble.com/search/dark-dashboard)
- [Vercel Design System](https://vercel.com/design)

---

## ✅ Completed Features

- [x] Basic camera streaming
- [x] Multi-camera support
- [x] Admin dashboard
- [x] Motion detection
- [x] Real-time alerts
- [x] Socket.IO communication
- [x] HTTP server (port 80)
- [x] Removed SSL (handled by proxy)

---

## 🎨 Design Assets Needed

- [ ] App icons (192x192, 512x512)
- [ ] Favicon (multiple sizes)
- [ ] Splash screen (optional)
- [ ] Logo for header (optional)

---

*This document will be updated as features are implemented and new ideas emerge.*
