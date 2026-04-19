#!/usr/bin/env bash
# Install local-cctv as a systemd service.
#
# Usage:
#   sudo ./scripts/install-service.sh            # install + enable + start
#   sudo ./scripts/install-service.sh --uninstall
#
# The service runs as the user who invoked `sudo` (or as the current user
# when run as root with SUDO_USER unset). It binds to whatever PORT your
# .env specifies; CAP_NET_BIND_SERVICE is granted so ports <1024 work
# without running as root.

set -euo pipefail

SERVICE_NAME="local-cctv"
UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}.service"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

die()  { echo "error: $*" >&2; exit 1; }
info() { echo "==> $*"; }

if [[ $EUID -ne 0 ]]; then
    if command -v sudo >/dev/null 2>&1; then
        die "This script must be run as root (try: sudo $0)"
    else
        die "This script must be run as root"
    fi
fi

if [[ ! -d /run/systemd/system ]]; then
    die "systemd is not active on this host; cannot install a service"
fi

# --- uninstall ---------------------------------------------------------------
if [[ "${1:-}" == "--uninstall" || "${1:-}" == "-u" ]]; then
    if [[ -f "$UNIT_PATH" ]]; then
        info "Stopping and disabling ${SERVICE_NAME}"
        systemctl stop "${SERVICE_NAME}.service" 2>/dev/null || true
        systemctl disable "${SERVICE_NAME}.service" 2>/dev/null || true
        rm -f "$UNIT_PATH"
        systemctl daemon-reload
        info "Removed ${UNIT_PATH}"
    else
        info "No unit file at ${UNIT_PATH} — nothing to do"
    fi
    exit 0
fi

# --- preflight ---------------------------------------------------------------
RUN_USER="${SUDO_USER:-$(id -un)}"
[[ "$RUN_USER" == "root" ]] && info "warning: service will run as root (no SUDO_USER set)"

RUN_GROUP="$(id -gn "$RUN_USER")"

NODE_BIN=""
if [[ "$RUN_USER" == "root" || ! $(command -v sudo) ]]; then
    NODE_BIN="$(command -v node || true)"
else
    NODE_BIN="$(sudo -u "$RUN_USER" bash -lc 'command -v node' || true)"
fi
[[ -z "$NODE_BIN" ]] && die "'node' not found on PATH for user '$RUN_USER'. Install Node.js first."

[[ -f "${REPO_DIR}/server.js" ]] || die "server.js not found at ${REPO_DIR}/server.js"
[[ -f "${REPO_DIR}/.env" ]]      || info "warning: no .env found at ${REPO_DIR}/.env — the app may refuse to start"

info "Service name : ${SERVICE_NAME}"
info "Repo dir     : ${REPO_DIR}"
info "Run as user  : ${RUN_USER} (${RUN_GROUP})"
info "Node binary  : ${NODE_BIN}"

# --- write unit file ---------------------------------------------------------
info "Writing ${UNIT_PATH}"
cat > "$UNIT_PATH" <<EOF
[Unit]
Description=local-cctv — multi-camera monitoring dashboard
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${RUN_USER}
Group=${RUN_GROUP}
WorkingDirectory=${REPO_DIR}
EnvironmentFile=-${REPO_DIR}/.env
ExecStart=${NODE_BIN} ${REPO_DIR}/server.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

# Allow binding to ports <1024 without running as root
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE

# Basic hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=read-only
ReadWritePaths=${REPO_DIR}

[Install]
WantedBy=multi-user.target
EOF

chmod 644 "$UNIT_PATH"

info "Reloading systemd"
systemctl daemon-reload

info "Enabling ${SERVICE_NAME} on boot"
systemctl enable "${SERVICE_NAME}.service" >/dev/null

info "Starting ${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}.service"

sleep 1
systemctl --no-pager --full status "${SERVICE_NAME}.service" | head -n 15 || true

cat <<EOF

Installed.

Common commands:
  sudo systemctl status  ${SERVICE_NAME}
  sudo systemctl restart ${SERVICE_NAME}
  sudo systemctl stop    ${SERVICE_NAME}
  sudo journalctl -u     ${SERVICE_NAME} -f

To uninstall:
  sudo ${BASH_SOURCE[0]} --uninstall
EOF
