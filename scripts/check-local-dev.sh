#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"

ENV_FILE=$(node ./scripts/env_files.cjs dev)
DEV_PORT=$(node -e "require('dotenv').config({ path: process.argv[1], quiet: true }); const { resolveDevPort } = require('./scripts/env_files.cjs'); process.stdout.write(String(resolveDevPort(process.env)));" "$ENV_FILE")

echo "Checking local prerequisites..."

if lsof -nP -iTCP:"$DEV_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "OK   app:    localhost:$DEV_PORT is listening"
else
  echo "MISS app:    localhost:$DEV_PORT is not listening"
fi

if lsof -nP -iTCP:5432 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "OK   pg:     localhost:5432 is listening"
else
  echo "MISS pg:     localhost:5432 is not listening"
fi

if lsof -nP -iTCP:6379 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "OK   redis:  localhost:6379 is listening"
else
  echo "MISS redis:  localhost:6379 is not listening"
fi

if lsof -nP -iTCP:8443 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "OK   ide:    localhost:8443 is listening"
else
  echo "MISS ide:    localhost:8443 is not listening (optional)"
fi
