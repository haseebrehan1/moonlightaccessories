#!/usr/bin/env bash
#
# Moonlight Accessories — redeploy latest code
#
# Run on the server after pushing to master:
#   bash /var/www/moonlight-backend/deploy/deploy.sh
#
# Pulls both repos, reinstalls dependencies, restarts the API, and verifies
# it actually came back. Never touches .env, the database, or uploads/.

set -euo pipefail

APP_DIR="/var/www/moonlight-backend"
WEB_DIR="/var/www/moonlight-frontend"
APP_USER="moonlight"

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

[[ $EUID -eq 0 ]] || { echo "Run as root."; exit 1; }

log "Pulling latest code"
git -C "$APP_DIR" fetch --quiet origin
git -C "$APP_DIR" reset --hard --quiet origin/HEAD
git -C "$WEB_DIR" fetch --quiet origin
git -C "$WEB_DIR" reset --hard --quiet origin/HEAD

log "Installing dependencies"
cd "$APP_DIR"
npm ci --omit=dev --silent 2>/dev/null || npm install --omit=dev --silent

mkdir -p "$APP_DIR/uploads/products"
chown -R "$APP_USER:$APP_USER" "$APP_DIR" "$WEB_DIR"
chmod 600 "$APP_DIR/.env"

# Pick up unit file changes if deploy/ changed.
if ! cmp -s "$APP_DIR/deploy/moonlight-api.service" /etc/systemd/system/moonlight-api.service; then
    log "systemd unit changed — reinstalling"
    install -m 644 "$APP_DIR/deploy/moonlight-api.service" /etc/systemd/system/moonlight-api.service
    systemctl daemon-reload
fi

log "Restarting API"
systemctl restart moonlight-api
sleep 6

if ! systemctl is-active --quiet moonlight-api; then
    echo "!! API failed to start — rolling back is manual, logs follow:"
    journalctl -u moonlight-api -n 40 --no-pager
    exit 1
fi

log "Verifying health endpoint"
if curl -fsS --max-time 10 http://127.0.0.1:5000/api/health; then
    printf '\n\nDeploy complete.\n'
else
    echo "!! API is running but /api/health did not respond:"
    journalctl -u moonlight-api -n 40 --no-pager
    exit 1
fi
