#!/usr/bin/env bash
# Deploy DOS Radio from its standalone repository to borg.tools.
# Static PWA -> /var/www/dosradio.theones.io
# FastAPI API & Recorder -> /home/vizi/apps/dosradio-api (PM2)
#
# The web root also holds files this script does not own: feeds/ (published by the
# launchd job io.theones.dosradio.feeds) and share-* (shared files). Both are excluded
# from --delete, so a deploy never removes them.
set -euo pipefail
HOST="${HOST:-borg-ts}"
WEB="/var/www/dosradio.theones.io"
API="/home/vizi/apps/dosradio-api"
BACKUP_DIR="/home/vizi/backups/dosradio"
NGINX_VHOST="/etc/nginx/sites-enabled/dosradio.theones.io"
HEALTH_URL="http://127.0.0.1:3015/radio-api/health"
HEALTH_TRIES=30
STAMP="$(date +%Y%m%d-%H%M%S)"
SHA="$(git rev-parse --short HEAD)"
# Everything that ends up in dist/ or on the API host. Tooling state (.planning, .hermes) is not deployed.
DEPLOY_INPUTS=(index.html package.json package-lock.json vite.config.ts tsconfig.json src public orbita
  server/app server/scripts server/requirements.txt server/start.sh server/ecosystem.config.cjs)

echo "=== 0. Checking deploy inputs are committed ($SHA) ==="
if [ -n "$(git status --porcelain -- "${DEPLOY_INPUTS[@]}")" ] && [ "${ALLOW_DIRTY:-0}" != "1" ]; then
  echo "Deploy inputs have uncommitted changes. Commit first or run with ALLOW_DIRTY=1." >&2
  git status --short -- "${DEPLOY_INPUTS[@]}" >&2
  exit 1
fi

echo "=== 1. Building frontend (Orbita bundle, type check, Vite) ==="
npm run build
for f in index.html sw.js icon-192.png manifest.webmanifest orbita.html admin.html; do
  test -f "dist/$f" || { echo "Missing dist/$f" >&2; exit 1; }
done

echo "=== 2. Creating backups on $HOST ==="
ssh "$HOST" bash -s -- "$WEB" "$API" "$BACKUP_DIR" "$NGINX_VHOST" "$STAMP" <<'REMOTE'
set -euo pipefail
WEB="$1"; API="$2"; BACKUP_DIR="$3"; NGINX_VHOST="$4"; STAMP="$5"
mkdir -p "$BACKUP_DIR"
if [ -d "$WEB" ]; then
  sudo -n tar czf "$BACKUP_DIR/web-$STAMP.tgz" -C "$WEB" .
  sudo -n chown vizi:vizi "$BACKUP_DIR/web-$STAMP.tgz"
fi
if [ -d "$API/app" ]; then
  items=""
  for f in app scripts start.sh ecosystem.config.cjs requirements.txt; do
    if [ -e "$API/$f" ]; then items="$items $f"; fi
  done
  tar czf "$BACKUP_DIR/api-$STAMP.tgz" -C "$API" $items
fi
if [ -f "$API/.env" ]; then
  install -m 600 "$API/.env" "$BACKUP_DIR/env-$STAMP"
fi
if [ -f "$API/data/dosradio.db" ]; then
  python3 - "$API/data/dosradio.db" "$BACKUP_DIR/db-$STAMP.sqlite" <<'PY'
import sqlite3
import sys

source = sqlite3.connect(sys.argv[1])
target = sqlite3.connect(sys.argv[2])
source.backup(target)
target.close()
source.close()
PY
  chmod 600 "$BACKUP_DIR/db-$STAMP.sqlite"
fi
if [ -e "$NGINX_VHOST" ]; then
  sudo -n cp -L "$NGINX_VHOST" "$BACKUP_DIR/nginx-$STAMP.conf"
  sudo -n chown vizi:vizi "$BACKUP_DIR/nginx-$STAMP.conf"
fi
sudo -n mkdir -p "$WEB"
sudo -n chown vizi:vizi "$WEB"
mkdir -p "$API"
ls -la "$BACKUP_DIR" | grep -- "$STAMP" || true
REMOTE

echo "=== 3. Uploading static build ==="
rsync -az --delete --exclude 'feeds/' --exclude 'share-*' dist/ "$HOST:$WEB/"

echo "=== 4. Uploading backend ==="
rsync -az --delete \
  --exclude '.venv*' --exclude data --exclude data-local --exclude '.env*' \
  --exclude __pycache__ --exclude .pytest_cache --exclude tests --exclude .DS_Store \
  server/ "$HOST:$API/"

echo "=== 5. Restarting services ==="
ssh "$HOST" bash -s -- "$API" <<'REMOTE'
set -euo pipefail
cd "$1"
test -f .env
chmod 600 .env
[ -x .venv/bin/uvicorn ] || python3.12 -m venv .venv
.venv/bin/pip install -q -r requirements.txt </dev/null
if pm2 describe dosradio-api >/dev/null 2>&1 </dev/null; then
  pm2 restart dosradio-api --update-env </dev/null
else
  pm2 start ecosystem.config.cjs </dev/null
fi
pm2 save >/dev/null </dev/null
REMOTE

echo "=== 6. Health check ==="
ssh "$HOST" bash -s -- "$HEALTH_URL" "$HEALTH_TRIES" <<'REMOTE'
set -euo pipefail
for _ in $(seq 1 "$2"); do
  if body="$(curl -fsS --max-time 3 "$1" 2>/dev/null)"; then
    echo "${body:0:200}"
    exit 0
  fi
  sleep 1
done
echo "Health check failed: $1" >&2
exit 1
REMOTE
echo "=== Deployed $SHA ($STAMP) successfully ==="
