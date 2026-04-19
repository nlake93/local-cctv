# Camera Monitor

A self-hosted, web-based multi-camera monitoring system. Connect IP cameras via RTSP, or turn any phone or tablet into a security camera — then watch all streams live from a password-protected admin dashboard.

## How It Works

```
IP Camera (RTSP)  →  FFmpeg on server  →┐
                                         ├→  JPEG frames  →  Socket.IO  →  Admin Dashboard
Phone / Tablet    →  Pairing code      →┘                                  (live grid view)
```

Both camera types appear identically in the dashboard grid. Any number of cameras can connect simultaneously.

## Features

**RTSP IP Camera Support**
- Add IP cameras from the admin dashboard via RTSP URL
- FFmpeg-based stream ingestion (RTSP → MJPEG frames)
- Persistent camera registry (`cameras.json`) — cameras auto-reconnect on server restart
- Real-time status badges: Connecting / Live / Disconnected / Offline / Error
- Automatic retry with exponential backoff (up to 10 retries, max 60s delay)
- Reconnect button for failed cameras
- RTSP URLs (including credentials) are stored server-side only — never sent to the browser
- Graceful shutdown stops all FFmpeg processes on SIGTERM/SIGINT

**Phone/Tablet Camera Client**
- Live video streaming to the admin dashboard
- Front / back camera toggle
- Flashlight (torch) control
- Pinch-to-zoom with on-screen slider
- Secure 3-digit pairing code required to connect

**Admin Dashboard**
- Password-protected login (session-based, 24h / 30-day "remember me")
- Add RTSP cameras via modal dialog
- Live grid layout that adapts to 1–4+ connected cameras
- Enlarge any stream in a fullscreen modal
- Per-camera stream quality control (phone cameras)
- Force-disconnect or remove any camera remotely
- Real-time pairing notifications with 60-second expiry

**General**
- Real-time communication via Socket.IO
- Glassmorphism dark UI (teal accent)
- PWA-ready — installable on iOS & Android via "Add to Home Screen"
- Wake Lock API keeps the screen on while streaming
- SSL handled externally (e.g. Cloudflare + Nginx Proxy Manager)

## Requirements

- Node.js 18+
- **FFmpeg** installed on the server (required for RTSP camera support)
- All devices on the same network (or server accessible via HTTPS for iOS camera access)

Install FFmpeg:
```bash
# macOS
brew install ffmpeg

# Debian / Ubuntu
sudo apt install ffmpeg
```

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

## Running as a systemd Service (Linux)

On Linux servers, you can install local-cctv as a systemd service so it
starts on boot and restarts automatically on failure.

```bash
npm run install-service
# or equivalently:
sudo ./scripts/install-service.sh
```

What the installer does:

- Writes `/etc/systemd/system/local-cctv.service`
- Runs the process as your current (non-root) user
- Loads environment from `<repo>/.env`
- Grants `CAP_NET_BIND_SERVICE` so the app can bind to port 80 without root
- Applies basic sandboxing (`NoNewPrivileges`, `PrivateTmp`, read-only home, etc.)
- Enables the service on boot and starts it immediately

Common commands:

```bash
sudo systemctl status  local-cctv
sudo systemctl restart local-cctv
sudo systemctl stop    local-cctv
sudo journalctl -u     local-cctv -f    # tail logs
```

To uninstall:

```bash
npm run uninstall-service
```

## Adding an RTSP Camera

1. Open the admin dashboard at `http://YOUR_IP/admin`
2. Click **+ Add Camera**
3. Enter a name and the RTSP URL (e.g. `rtsp://192.168.1.100:8554/live`)
4. The camera appears in the grid with a "Connecting" status
5. Once frames arrive, the status changes to "Live" and the stream displays

Cameras are saved to `cameras.json` and will automatically reconnect when the server restarts.

## Phone/Tablet Camera Setup

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
| RTSP retry attempts | 10 | Exponential backoff, max 60s between retries |

## iOS Notes

iOS Safari requires **HTTPS** for camera and microphone access on non-localhost origins. For local network use, proxy the server through Nginx + a self-signed cert, or use Cloudflare Tunnel for a public HTTPS URL.

Avoid opening the camera client inside in-app browsers (Instagram, Facebook, etc.) — use Safari or Chrome directly.

## Security Notes

- Admin password is hashed with bcrypt (never stored in plaintext)
- Sessions use signed cookies
- Camera pairing codes prevent unauthorised devices from connecting
- RTSP URLs (which may contain credentials) are stored server-side only in `cameras.json`
- `cameras.json` is gitignored — never committed to the repo
- API routes return 401 JSON responses (not redirects) for unauthenticated requests

## Tech Stack

- **Backend:** Node.js, Express, Socket.IO
- **RTSP Ingestion:** FFmpeg (spawned as child processes)
- **Auth:** express-session, bcrypt, dotenv
- **Frontend:** Vanilla JS, CSS3 (glassmorphism theme)
- **Protocol:** HTTP + WebSocket (Socket.IO)

## Roadmap

Planned features for the pi-ip node integration and beyond. See `pi-ip-hub-integration.md` for full technical details.

### mDNS Auto-Discovery
Automatically discover pi-ip camera nodes on the network via `_pi-ip._tcp` mDNS/Bonjour advertisements. Cameras appear in the dashboard without manual IP entry. Works across Tailscale locations via MagicDNS.

### Camera Health Monitoring
Poll each pi-ip node's `/api/status` endpoint for health data — stream status, sensor info, uptime, and resource usage. Surface this in the dashboard with per-camera health indicators.

### Remote Camera Settings
Push camera settings (resolution, framerate, bitrate, exposure, white balance, flip, etc.) from the hub dashboard to pi-ip nodes via their `/api/settings` endpoint. Single UI to manage all cameras.

### OTA Firmware Updates
Trigger software updates on pi-ip nodes from the hub dashboard via `/api/update`. Batch update all cameras at once without SSH access.

### Recording & Playback
Manual record toggle per camera from the dashboard. FFmpeg writes streams to MP4 on local storage. Recordings section in the dashboard to browse, download, and delete clips.

### Tiered Storage & Archival
Hot storage on NVMe SSD for active recordings, with a background job that moves older recordings to NAS (NFS/SMB) for long-term archival. Configurable retention policies.

### Motion-Triggered Recording
Record only when motion is detected to reduce storage usage by 80-90% compared to continuous recording.

### Headless Node Mode
Optional mode for pi-ip nodes where the local web UI is disabled. Nodes expose only the RTSP stream and JSON API — all management happens through the hub.
