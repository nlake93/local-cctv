# Future Features

---

## 💾 Persistent Camera Registry

Store known cameras in a local JSON file so they survive server restarts.

### Problem

Currently all camera state is held in memory. Every server restart wipes the camera list — RTSP cameras need to be re-added manually and paired phone cameras need to re-pair.

### How It Works

A `cameras.json` file in the project root acts as the registry. The server reads it on startup and writes to it whenever a camera is added, renamed, or removed.

```json
{
  "cameras": [
    {
      "id": "front-door",
      "name": "Front Door",
      "type": "rtsp",
      "url": "rtsp://192.168.1.100:554/stream",
      "addedAt": "2025-12-14T10:00:00.000Z"
    },
    {
      "id": "abc123",
      "name": "Living Room",
      "type": "phone",
      "addedAt": "2025-12-14T11:00:00.000Z"
    }
  ]
}
```

### Planned Implementation

**Backend (`server.js`)**
- Load `cameras.json` on startup; create it if it doesn't exist
- Auto-reconnect RTSP cameras from the registry on startup
- Write to registry when a camera is added, renamed, or disconnected
- `fs.promises` for async file reads/writes — no extra dependencies needed

**Admin Dashboard**
- Cameras from the registry appear immediately on page load (before they connect)
- Show a "reconnecting" state for registered cameras that aren't yet streaming
- Persist custom names set by the admin

### Considerations

- Phone cameras can't truly auto-reconnect (they require user interaction to start streaming) but their names and history can be preserved
- RTSP cameras can fully auto-reconnect on startup
- `cameras.json` should be added to `.gitignore` to avoid committing network details

---

## 📷 IP Camera Support (RTSP)

Allow IP cameras (e.g. old CCTV hardware) to be added to the dashboard alongside phone/tablet cameras.

### How It Works

```
IP Camera (RTSP) → FFmpeg on server → JPEG frames → Socket.IO → Admin dashboard
```

The server connects to the camera's RTSP stream using FFmpeg, extracts frames, and relays them to the admin dashboard in the same format as phone camera streams.

### Requirements

- **FFmpeg** installed on the server machine
- **fluent-ffmpeg** npm package to interface with FFmpeg from Node.js
- IP camera must be accessible on the same network as the server

### Planned Implementation

**Backend (`server.js`)**
- New `POST /cameras/rtsp` endpoint — accepts an RTSP URL and optional name
- Spawn an FFmpeg process per IP camera to pull frames from the RTSP stream
- Convert frames to JPEG and emit via Socket.IO (`video-frame` event, same as phone cameras)
- Store active RTSP cameras separately from paired phone cameras
- Clean up FFmpeg processes on server shutdown or when camera is removed

**Admin Dashboard**
- "Add IP Camera" button/form — input fields for RTSP URL and display name
- No pairing code flow — admin adds directly by URL
- Appears in the same camera grid as phone cameras
- Disconnect button kills the FFmpeg process and removes the stream

**RTSP URL format** (typical):
```
rtsp://username:password@192.168.1.100:554/stream
rtsp://192.168.1.100:554/live
```

### Considerations

- FFmpeg must be installed on the server host (`brew install ffmpeg` / `apt install ffmpeg`)
- Credentials in the RTSP URL are handled server-side only — never sent to the browser
- Each RTSP stream spawns one FFmpeg process — monitor CPU usage with many cameras
- Frame rate should be throttled (e.g. 10 FPS) to match phone camera behaviour

---

## 🎥 Recording

The ability to manually record a camera stream to a video file stored on the server. Scoped as a simple, lightweight feature — not intended to replace dedicated CCTV software.

### Approach

**Manual toggle per camera** — admin starts and stops recording from the dashboard. No always-on recording, no motion triggers. Simple and avoids any storage management complexity.

### Considerations

- FFmpeg is the natural tool here (already planned for RTSP support) and can write directly to MP4/MKV
- Phone camera streams come in as JPEG frames via Socket.IO — these would need to be re-encoded into a video file server-side
- A recordings section in the admin dashboard to download or delete saved clips

---
