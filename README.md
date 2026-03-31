# Camera Monitor

A self-hosted, web-based multi-camera monitoring system. Turn any phone, tablet, or laptop into a security camera — then watch all streams live from a password-protected admin dashboard.

## How It Works

```
Mobile Device               Server               Admin Dashboard
──────────────              ──────               ───────────────
Open http://IP         →    Pairing code    →    Code displayed
Enter pairing code     →    Verify code     →    Camera appears
Stream video + torch   →    Relay frames    →    Live grid view
```

Any number of devices can connect as cameras simultaneously. The admin dashboard auto-arranges them in a responsive grid.

## Features

**Camera Client**
- Live video streaming to the admin dashboard
- Front / back camera toggle
- Flashlight (torch) control
- Pinch-to-zoom with on-screen slider
- Secure 3-digit pairing code required to connect

**Admin Dashboard**
- Password-protected login (session-based, 24h / 30-day "remember me")
- Live grid layout that adapts to 1–4+ connected cameras
- Enlarge any stream in a fullscreen modal
- Per-camera stream quality control
- Force-disconnect any camera remotely
- Real-time pairing notifications with 60-second expiry

**General**
- Real-time communication via Socket.IO
- Glassmorphism dark UI (teal accent)
- PWA-ready — installable on iOS & Android via "Add to Home Screen"
- Wake Lock API keeps the screen on while streaming
- SSL handled externally (e.g. Cloudflare + Nginx Proxy Manager)

## Requirements

- Node.js 18+
- All devices on the same network (or server accessible via HTTPS for iOS camera access)

## Installation

```bash
npm install
```

## Usage

```bash
# Production
npm start

# Development (auto-restart on changes)
npm run dev
```

The server starts on port `80` by default.

| URL | Purpose |
|-----|---------|
| `http://YOUR_IP` | Camera client — open on any device to stream |
| `http://YOUR_IP/admin` | Admin dashboard — monitor all cameras |

## Camera Setup Flow

1. Open `http://YOUR_IP` on a phone or tablet
2. Tap **Start Camera** and grant camera permission
3. A pairing request appears on the admin dashboard with a 3-digit code
4. Enter the code on the camera device → connection is approved
5. The live stream appears in the dashboard grid

## Configuration

Copy `.env.example` to `.env` and set your values before starting the server:

```bash
cp .env.example .env
```

| Variable | Default | Notes |
|----------|---------|-------|
| `ADMIN_PASSWORD` | `admin` | Password for the admin dashboard |
| `SESSION_SECRET` | fallback string | Sign session cookies — use a long random string in production |
| `PORT` | `80` | HTTP port |

Generate a strong session secret:
```bash
openssl rand -base64 32
```

Other settings:

| Setting | Default | Notes |
|---------|---------|-------|
| Session duration | 24 hours | 30 days with "Remember Me" |
| Pairing code expiry | 60 seconds | Hardcoded in `server.js` |
| Login lockout | 5 attempts / 15 min | Hardcoded in `server.js` |

## iOS Notes

iOS Safari requires **HTTPS** for camera and microphone access on non-localhost origins. For local network use, proxy the server through Nginx + a self-signed cert, or use Cloudflare Tunnel for a public HTTPS URL.

Avoid opening the camera client inside in-app browsers (Instagram, Facebook, etc.) — use Safari or Chrome directly.

## Security Notes

- Admin password is hashed with bcrypt (never stored in plaintext)
- Sessions use signed cookies
- Camera pairing codes prevent unauthorised devices from connecting
- No credentials are exposed to client-side code

## Tech Stack

- **Backend:** Node.js, Express, Socket.IO
- **Auth:** express-session, bcrypt, dotenv
- **Frontend:** Vanilla JS, CSS3 (glassmorphism theme)
- **Protocol:** HTTP + WebSocket (Socket.IO)
