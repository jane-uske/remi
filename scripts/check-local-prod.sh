#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"

ENV_FILE=$(node ./scripts/env_files.cjs prod)
PROD_PORT=$(node -e "require('dotenv').config({ path: process.argv[1], quiet: true }); const { resolveProdPort } = require('./scripts/env_files.cjs'); process.stdout.write(String(resolveProdPort(process.env)));" "$ENV_FILE")

if [ ! -f "$ENV_FILE" ]; then
  echo "MISS env: $ENV_FILE not found"
  echo "Run: cp .env.example .env.local-prod"
  exit 1
fi

if ! node ./scripts/local_prod_config_check.cjs "$ENV_FILE"; then
  exit 1
fi

if lsof -nP -iTCP:${PROD_PORT} -sTCP:LISTEN >/dev/null 2>&1; then
  echo "OK   port: localhost:${PROD_PORT} is listening"
else
  echo "MISS port: localhost:${PROD_PORT} is not listening yet (start may be pending)"
fi

if command -v curl >/dev/null 2>&1; then
  if curl -fsS --max-time 3 "http://127.0.0.1:${PROD_PORT}/health" >/dev/null 2>&1; then
    echo "OK   health: /health responded"
  else
    echo "MISS health: /health not ready yet"
  fi
fi

echo "check-local-prod completed."
