#!/usr/bin/env bash
# Start the DOS Radio API with secrets from .env (never committed). Used by PM2 on borg.tools.
set -euo pipefail
cd "$(dirname "$0")"
set -a
. ./.env
set +a
exec .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port "${DOSRADIO_PORT:-3015}" --proxy-headers --forwarded-allow-ips=127.0.0.1
