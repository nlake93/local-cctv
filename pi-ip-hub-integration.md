# pi-ip Node Integration — Hub Reference

This document describes how pi-ip camera nodes are designed to integrate with the CCTV hub application. Use this as a reference when implementing RTSP source support in the hub.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│                        Tailscale Mesh                    │
│                                                          │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐         │
│  │  pi-ip     │  │  pi-ip     │  │  pi-ip     │         │
│  │  Node 1    │  │  Node 2    │  │  Node 3    │  . . .  │
│  │  (Front)   │  │  (Garden)  │  │  (Garage)  │         │
│  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘         │
│        │               │               │                 │
│        │   RTSP + API  │               │                 │
│        └───────────────┼───────────────┘                 │
│                        │                                 │
│                  ┌─────▼──────┐                          │
│                  │    Hub     │                          │
│                  │  (Pi 4)   │                          │
│                  └─────┬──────┘                          │
│                        │                                 │
│               ┌────────┴────────┐                        │
│               │                 │                        │
│          ┌────▼─────┐    ┌─────▼────┐                    │
│          │  1TB NVMe │    │   NAS    │                    │
│          │  (hot)    │    │  (cold)  │                    │
│          └──────────┘    └──────────┘                    │
└──────────────────────────────────────────────────────────┘
```

Each pi-ip node is a lightweight, headless camera that exposes an RTSP stream and a management API. The hub is the central control point — it discovers nodes, pulls their streams, manages settings, handles recording, and provides the single user-facing dashboard.

Tailscale provides encrypted, NAT-punching connectivity between all nodes. Cameras can be at different physical locations (home, office, holiday house) and still appear on the same private network.

---

## Node Details

### Hardware per Node (~$100)

| Component | Spec | Cost |
|-----------|------|------|
| Raspberry Pi Zero 2W | ARM64, 512 MB RAM | ~$15 |
| Pi Camera Module v3 | 1080p, autofocus, HDR | ~$25-35 |
| Case, PSU, SD card, ribbon | — | ~$30-40 |
| microSD | 8 GB minimum, A1/endurance rated | ~$5-10 |

### Stream Configuration (recommended defaults)

| Setting | Value | Rationale |
|---------|-------|-----------|
| Resolution | 1920×1080 | Best detail for identification (faces, plates) |
| Framerate | 30 fps | Smooth motion, no benefit going higher for CCTV |
| Bitrate | 4 Mbps | Good quality, within Zero 2W WiFi limits (~8 Mbps reliable) |
| H.264 Profile | Main | Good compression, universal compatibility |
| H.264 Level | 4.1 | Supports 1080p30 with headroom |
| Keyframe interval | 60 frames (2s) | Fast stream pickup, quick recovery from network glitches |
| Exposure mode | Normal | Auto-adapts to lighting conditions |

### Stream URLs

Each node exposes these endpoints (no authentication currently):

| Protocol | URL | Use case |
|----------|-----|----------|
| RTSP | `rtsp://NODE_IP:8554/live` | Primary — hub pulls this for recording and display |
| WebRTC | `http://NODE_IP:8889/live` | Low-latency browser preview |

### Web UI

Each node has a local web UI at `http://NODE_IP:8080` for standalone management. This will become optional once hub mode is implemented — the hub will be the preferred way to manage all cameras.

### Resource Usage (per node)

| Resource | Usage |
|----------|-------|
| RAM | ~55-60% of 512 MB |
| CPU | Low — H.264 encoding runs on VideoCore GPU |
| Disk | ~2 GB total install |
| Network | ~4 Mbps upstream (at recommended bitrate) |

---

## Planned Node Features (pi-ip roadmap)

These features will be built into pi-ip to support hub integration. The hub should be designed with these in mind.

### 1. mDNS Advertisement

Each node will broadcast itself on the network via Avahi/Bonjour using the service type `_pi-ip._tcp`. The hub can listen for these advertisements to auto-discover cameras without manual IP entry.

**Advertised metadata will include:**
- Camera UUID (persistent, survives IP changes)
- Camera name (user-assigned, e.g. "Front Door")
- RTSP port
- API port
- Firmware/software version

**Note:** mDNS works over Tailscale via MagicDNS, so discovery should work across locations.

### 2. Persistent Camera Identity (UUID)

Each node generates a UUID on first boot, stored in `config/identity.json`. This UUID is the canonical identifier the hub uses to track cameras — not the IP address, which can change.

```json
{
  "uuid": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "name": "Front Door"
}
```

### 3. Status API

`GET /api/status` — unauthenticated JSON endpoint for hub health monitoring.

```json
{
  "uuid": "a1b2c3d4-...",
  "name": "Front Door",
  "version": "1.0.0",
  "uptime": 86400,
  "stream": {
    "running": true,
    "rtspPort": 8554,
    "webrtcPort": 8889,
    "path": "/live"
  },
  "camera": {
    "sensor": "imx708",
    "name": "Camera Module 3",
    "detected": true
  },
  "settings": {
    "width": 1920,
    "height": 1080,
    "fps": 30,
    "bitrate": 4000000
  }
}
```

### 4. Settings API

`POST /api/settings` — authenticated JSON endpoint allowing the hub to push camera settings remotely.

```json
{
  "width": 1920,
  "height": 1080,
  "fps": 30,
  "bitrate": 4000000,
  "profile": "main",
  "level": "4.1",
  "idr": 60,
  "brightness": 0.0,
  "contrast": 1.0,
  "saturation": 1.0,
  "sharpness": 1.0,
  "exposureValue": 0.0,
  "exposureMode": "normal",
  "awbMode": "auto",
  "hFlip": false,
  "vFlip": false
}
```

The node validates all fields server-side (whitelisted values, clamped ranges) before applying.

### 5. OTA Updates

`POST /api/update` — authenticated endpoint that triggers the node to pull the latest software and restart.

The hub can push updates to all cameras at once from a single button, avoiding the need to SSH into each Pi individually.

### 6. Headless Mode

Optional mode where the local web UI is disabled entirely. The node exposes only the RTSP stream and the JSON API. All management happens through the hub.

---

## Hub Responsibilities

### Camera Discovery & Management

1. **Listen for mDNS** `_pi-ip._tcp` broadcasts to auto-discover nodes
2. **Register cameras** by UUID — track name, IP, status, last seen
3. **Poll `/api/status`** periodically for health monitoring (stream up/down, sensor info)
4. **Push settings** via `/api/settings` — the hub is the single UI for managing all cameras
5. **Push updates** via `/api/update` — batch firmware updates across all nodes

### Stream Handling

1. **Pull RTSP** from each node at `rtsp://NODE_IP:8554/live`
2. **Display grid** — multi-camera live view in the web dashboard
3. **Record** — write streams to local NVMe storage
4. **Archive** — background job moves recordings older than X days to NAS

### Recording & Storage

**Tiered storage architecture:**

| Tier | Medium | Purpose | Retention |
|------|--------|---------|-----------|
| Hot | 1 TB NVMe (USB 3.0 on Pi 4) | Active recordings, fast playback/scrubbing | Recent (configurable) |
| Cold | NAS (NFS/SMB mount) | Long-term archival | Months/years |

**Storage math at 4 Mbps per camera (continuous recording):**

| Cameras | Per day | 1 TB NVMe lasts |
|---------|---------|-----------------|
| 4 | ~170 GB | ~6 days |
| 6 | ~250 GB | ~4 days |
| 8 | ~340 GB | ~3 days |
| 10 | ~425 GB | ~2.5 days |

**Motion-triggered recording** reduces storage by 80-90% compared to continuous.

**Archival workflow:**
1. Record to NVMe in real-time
2. Background job moves recordings older than threshold to NAS
3. Delete from NVMe only after confirmed written to NAS
4. If NAS is offline, recordings buffer on NVMe — nothing is lost

### Hub Hardware

| Component | Spec |
|-----------|------|
| Raspberry Pi 4 | 8 GB RAM |
| NVMe SSD | 1 TB via USB 3.0 enclosure |
| NAS | Network-attached, NFS/SMB |

**Expected capacity:** 6-10 cameras for live display + recording. CPU-intensive features (AI detection) would reduce this to 3-4 cameras.

---

## Network & Security

### Tailscale

All nodes and the hub run Tailscale. This provides:
- **Encrypted WireGuard tunnels** between all devices
- **NAT traversal** — cameras work behind any router, no port forwarding
- **Cross-location** — cameras at different physical sites appear local
- **Access control** — only Tailscale devices can reach the streams
- **MagicDNS** — mDNS-style discovery works across the mesh

### Current Auth State

| Component | Authentication |
|-----------|---------------|
| Web UI | Username/password + session cookie + CSRF tokens |
| RTSP stream | None (Tailscale network-level isolation) |
| API endpoints (planned) | API key (issued during hub pairing) |

RTSP auth can be added natively in MediaMTX if needed in the future. For now, Tailscale network isolation is sufficient.

---

## Phone/Tablet Camera Sources

The hub also supports phones and tablets as camera sources (existing feature). When implementing RTSP support, both source types should appear identically in the hub UI:

| Source type | Discovery | Stream protocol |
|-------------|-----------|----------------|
| Phone/tablet | Manual add or QR code | WebRTC / RTSP |
| pi-ip node | mDNS auto-discovery | RTSP |

The hub dashboard should present a unified camera grid regardless of source type. The user shouldn't need to care whether a feed is coming from a Pi or a phone.
