#!/usr/bin/env bash
# Deploy DOS Radio from its standalone repository to borg.tools.
# Static PWA -> /var/www/dosradio.theones.io
# FastAPI API & Recorder -> /home/vizi/apps/dosradio-api (PM2)
set -euo pipefail
HOST="${HOST:-borg-ts}"
WEB="/var/www/dosradio.theones.io"
API="/home/vizi/apps/dosradio-api"
STAMP="$(date +%Y%m%d-%H%M%S)"

echo "=== 1. Building frontend ==="
node scripts/build.mjs
test -f dist/index.html
test -f dist/sw.js
test -f dist/icon-192.png

echo "=== 2. Creating backups on $HOST ==="
ssh "$HOST" "mkdir -p /home/vizi/backups/dosradio && \
  { [ -d $WEB ] && sudo tar czf /home/vizi/backups/dosradio/web-$STAMP.tgz -C $WEB . || true; } && \
  { [ -d $API/app ] && tar czf /home/vizi/backups/dosradio/api-$STAMP.tgz -C $API app requirements.txt || true; } && \
  sudo mkdir -p $WEB && sudo chown vizi:vizi $WEB && mkdir -p $API"

echo "=== 3. Uploading static build ==="
rsync -az --delete dist/ "$HOST:$WEB/"

echo "=== 4. Uploading backend ==="
rsync -az --delete --exclude .venv --exclude data --exclude data-local --exclude '.env*' --exclude __pycache__ --exclude tests \
  server/ "$HOST:$API/"

echo "=== 5. Restarting services ==="
ssh "$HOST" "cd $API && test -f .env && chmod 600 .env && \
  { [ -x .venv/bin/uvicorn ] || python3.12 -m venv .venv; } && \
  .venv/bin/pip install -q -r requirements.txt && \
  { pm2 describe dosradio-api >/dev/null 2>&1 && pm2 restart dosradio-api --update-env || pm2 start ecosystem.config.cjs; } && \
  pm2 save >/dev/null"

echo "=== 6. Health check ==="
sleep 2
ssh "$HOST" "curl -s http://127.0.0.1:3015/radio-api/health | head -c 200; echo"
echo "=== Deployed $STAMP successfully ==="
