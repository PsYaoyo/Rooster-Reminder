#!/usr/bin/env bash
# Rooster Reminder — one-shot provisioning for Aliyun Ubuntu 24.04 (2C2G).
# Run as root ON THE SERVER, from the uploaded project root:  bash deploy/setup.sh
set -euo pipefail

APP_DIR=/opt/rooster
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmmirror.com}"

echo "==> [1/8] base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates gnupg nginx ufw cron openssl rsync

echo "==> [2/8] Node.js 22 (node:sqlite requires >= 22.5)"
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "==> [3/8] pm2"
npm install -g pm2 --registry="$NPM_REGISTRY"

echo "==> [4/8] application files"
mkdir -p "$APP_DIR" /var/log/rooster "$APP_DIR/backups"
rsync -a --delete \
  --exclude node_modules --exclude data --exclude .qa-backup \
  "$SRC_DIR/server/" "$APP_DIR/server/"
rsync -a --delete "$SRC_DIR/deploy/" "$APP_DIR/deploy/"
mkdir -p "$APP_DIR/server/data"

echo "==> [5/8] dependencies"
cd "$APP_DIR/server"
npm install --omit=dev --registry="$NPM_REGISTRY"

echo "==> [6/8] secrets + environment"
if [ ! -f "$APP_DIR/.env" ]; then
  cat > "$APP_DIR/.env" <<EOF
HOST=127.0.0.1
PORT=3000
TZ=Asia/Shanghai
AUTH_SECRET=$(openssl rand -hex 32)
SEED_DEMO=false
# Fill these after the formal mini program + subscribe template are approved:
WX_APPID=
WX_SECRET=
WX_TEMPLATE_ID=
EOF
  chmod 600 "$APP_DIR/.env"
  echo "    created $APP_DIR/.env with a random AUTH_SECRET"
else
  echo "    keeping existing $APP_DIR/.env"
fi

echo "==> [7/8] pm2 + nginx + firewall + backup cron"
pm2 start "$APP_DIR/deploy/ecosystem.config.js"
pm2 save
pm2 startup systemd -u root --hp /root | tail -n 1 | bash || true

cp "$APP_DIR/deploy/nginx-rooster.conf" /etc/nginx/sites-available/rooster
ln -sf /etc/nginx/sites-available/rooster /etc/nginx/sites-enabled/rooster
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

chmod +x "$APP_DIR/deploy/backup.sh"
( crontab -l 2>/dev/null | grep -v rooster-backup ; \
  echo "30 3 * * * $APP_DIR/deploy/backup.sh >> /var/log/rooster-backup.log 2>&1 # rooster-backup" ) | crontab -

echo "==> [8/8] smoke test"
sleep 2
curl -fsS http://127.0.0.1:3000/api/health
echo
curl -fsS -o /dev/null -w "nginx /api/health -> %{http_code}\n" http://127.0.0.1/api/health

cat <<'NEXT'

Provisioned. Remaining manual steps (see deploy/README.md):
  1. Buy a domain, point an A record @ and www to this server's public IP.
  2. Complete Aliyun ICP备案 (personal entity) for that domain — 1-3 weeks.
  3. certbot --nginx -d your.domain.com   (free SSL + auto HTTPS redirect)
  4. Fill WX_APPID / WX_SECRET / WX_TEMPLATE_ID in /opt/rooster/.env, then:
       pm2 restart rooster-server
  5. Register the formal personal mini program, set request legal domain to
     https://your.domain.com, switch miniprogram/config.js ENV to 'prod'.
NEXT