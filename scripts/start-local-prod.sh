#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"

ENV_FILE=$(node ./scripts/env_files.cjs prod)
PROD_PORT=$(node -e "require('dotenv').config({ path: process.argv[1], quiet: true }); const { resolveProdPort } = require('./scripts/env_files.cjs'); process.stdout.write(String(resolveProdPort(process.env)));" "$ENV_FILE")

if [ ! -f "$ENV_FILE" ]; then
  echo "Env file not found: $ENV_FILE"
  echo "Run: cp .env.example .env.local-prod"
  exit 1
fi

./scripts/check-local-prod.sh

REMI_ENV_FILE="$ENV_FILE" docker compose --env-file "$ENV_FILE" -f docker-compose.local-prod.yml up -d --build

echo "Local production stack started."
echo "App: http://127.0.0.1:${PROD_PORT}"
