#!/usr/bin/env bash
#
# Moonlight Accessories — one-time server bootstrap
#
# Takes a bare Ubuntu 22.04/24.04 Hetzner box to a fully serving stack:
# Node + Postgres + nginx + the app, with everything enabled to survive reboot.
#
# Usage (as root on the fresh server):
#   curl -fsSL https://raw.githubusercontent.com/haseebrehan1/moonlightaccessories/master/deploy/provision.sh -o provision.sh
#   bash provision.sh
#
# Safe to re-run: it skips work that is already done and will NOT overwrite an
# existing .env (so it never silently rotates your DB password or JWT secrets).

set -euo pipefail

DOMAIN="moonlightaccessories.pk"
APP_USER="moonlight"
APP_DIR="/var/www/moonlight-backend"
WEB_DIR="/var/www/moonlight-frontend"
BACKEND_REPO="https://github.com/haseebrehan1/moonlightaccessories.git"
FRONTEND_REPO="https://github.com/haseebrehan1/moonlight-frontend.git"
DB_NAME="moonlight_db"
DB_USER="moonlight"
NODE_MAJOR="20"

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

[[ $EUID -eq 0 ]] || { echo "Run as root."; exit 1; }

# ── Packages ──────────────────────────────────────────────
log "Installing packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git ufw nginx postgresql postgresql-contrib \
                      certbot python3-certbot-nginx ca-certificates gnupg

if ! command -v node >/dev/null || [[ "$(node -v | cut -c2- | cut -d. -f1)" -lt "$NODE_MAJOR" ]]; then
    log "Installing Node.js ${NODE_MAJOR}.x"
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
    apt-get install -y -qq nodejs
fi
log "node $(node -v) / npm $(npm -v)"

# ── App user ──────────────────────────────────────────────
if ! id -u "$APP_USER" >/dev/null 2>&1; then
    log "Creating service user '$APP_USER'"
    adduser --system --group --home /var/www --no-create-home "$APP_USER"
fi

# ── Source ────────────────────────────────────────────────
log "Fetching source"
mkdir -p /var/www
for pair in "$BACKEND_REPO|$APP_DIR" "$FRONTEND_REPO|$WEB_DIR"; do
    repo="${pair%%|*}"; dir="${pair##*|}"
    if [[ -d "$dir/.git" ]]; then
        git -C "$dir" fetch --quiet origin && git -C "$dir" reset --hard --quiet origin/HEAD
    else
        git clone --quiet "$repo" "$dir"
    fi
done

# ── Database ──────────────────────────────────────────────
log "Configuring PostgreSQL"
systemctl enable --now postgresql

DB_PASSWORD=""
if [[ -f "$APP_DIR/.env" ]]; then
    # Reuse the password already in .env so re-runs don't break the app.
    DB_PASSWORD="$(grep -E '^DB_PASSWORD=' "$APP_DIR/.env" | cut -d= -f2- || true)"
fi
[[ -n "$DB_PASSWORD" ]] || DB_PASSWORD="$(openssl rand -hex 24)"

sudo -u postgres psql -tAc \
    "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1 \
    && sudo -u postgres psql -qc "ALTER ROLE $DB_USER WITH LOGIN PASSWORD '$DB_PASSWORD';" \
    || sudo -u postgres psql -qc "CREATE ROLE $DB_USER WITH LOGIN PASSWORD '$DB_PASSWORD';"

sudo -u postgres psql -tAc \
    "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 \
    || sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"

# setupDb.js creates ENUM types and tables, which needs schema ownership.
sudo -u postgres psql -qd "$DB_NAME" -c "GRANT ALL ON SCHEMA public TO $DB_USER;"

# ── Environment ───────────────────────────────────────────
if [[ -f "$APP_DIR/.env" ]]; then
    log ".env already exists — leaving it untouched"
    ADMIN_PASSWORD="(unchanged — see existing .env)"
else
    log "Generating .env with fresh secrets"
    ADMIN_PASSWORD="$(openssl rand -base64 15)"
    cat > "$APP_DIR/.env" <<EOF
PORT=5000
NODE_ENV=production

DB_HOST=localhost
DB_PORT=5432
DB_NAME=$DB_NAME
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASSWORD

JWT_SECRET=$(openssl rand -hex 32)
JWT_EXPIRES_IN=7d
JWT_REFRESH_SECRET=$(openssl rand -hex 32)
JWT_REFRESH_EXPIRES_IN=30d

ADMIN_EMAIL=admin@$DOMAIN
ADMIN_PASSWORD=$ADMIN_PASSWORD

MAX_FILE_SIZE_MB=10
FRONTEND_URL=https://$DOMAIN

# Fill these in — order emails and JazzCash stay disabled until you do.
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
EMAIL_FROM=Moonlight Accessories <orders@$DOMAIN>

JAZZCASH_MERCHANT_ID=
JAZZCASH_PASSWORD=
JAZZCASH_INTEGRITY_SALT=
JAZZCASH_URL=https://sandbox.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform/
EOF
fi
chmod 600 "$APP_DIR/.env"

# ── Dependencies ──────────────────────────────────────────
log "Installing npm dependencies"
cd "$APP_DIR"
npm ci --omit=dev --silent 2>/dev/null || npm install --omit=dev --silent

mkdir -p "$APP_DIR/uploads/products"
chown -R "$APP_USER:$APP_USER" "$APP_DIR" "$WEB_DIR"

# ── systemd ───────────────────────────────────────────────
log "Installing systemd unit"
install -m 644 "$APP_DIR/deploy/moonlight-api.service" /etc/systemd/system/moonlight-api.service
systemctl daemon-reload
systemctl enable --now moonlight-api

# server.js runs setupDb + seedDb itself on first production boot.
sleep 8
systemctl is-active --quiet moonlight-api \
    && log "API is running" \
    || { echo "API failed to start:"; journalctl -u moonlight-api -n 40 --no-pager; exit 1; }

# ── nginx ─────────────────────────────────────────────────
log "Configuring nginx"
install -m 644 "$APP_DIR/deploy/nginx/$DOMAIN.conf" "/etc/nginx/sites-available/$DOMAIN"
ln -sf "/etc/nginx/sites-available/$DOMAIN" "/etc/nginx/sites-enabled/$DOMAIN"
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable nginx
systemctl reload nginx

# ── Firewall ──────────────────────────────────────────────
log "Configuring firewall"
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null
ufw status numbered

# ── TLS ───────────────────────────────────────────────────
log "Requesting TLS certificate"
if certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" \
           --non-interactive --agree-tos --register-unsafely-without-email --redirect; then
    systemctl reload nginx
else
    echo "!! certbot failed — site is up on HTTP. Confirm DNS points here, then re-run:"
    echo "   certbot --nginx -d $DOMAIN -d www.$DOMAIN --redirect"
fi

cat <<EOF

────────────────────────────────────────────────
 Moonlight Accessories is deployed.

   Site   : https://$DOMAIN
   Admin  : https://$DOMAIN/admin
   Health : https://$DOMAIN/api/health

   Admin login : admin@$DOMAIN
   Password    : $ADMIN_PASSWORD

 Change that password after your first login.

 Logs    : journalctl -u moonlight-api -f
 Restart : systemctl restart moonlight-api
 Update  : bash $APP_DIR/deploy/deploy.sh
────────────────────────────────────────────────
EOF
