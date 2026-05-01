#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"

ENV_FILE=$(node ./scripts/env_files.cjs prod)
COMPOSE_PROJECT=$(node -e "require('dotenv').config({ path: process.argv[1], quiet: true }); const { resolveComposeProjectName } = require('./scripts/env_files.cjs'); process.stdout.write(resolveComposeProjectName('prod'));" "$ENV_FILE")
PROD_PORT=$(node -e "require('dotenv').config({ path: process.argv[1], quiet: true }); const { resolveProdPort } = require('./scripts/env_files.cjs'); process.stdout.write(String(resolveProdPort(process.env)));" "$ENV_FILE")

if [ ! -f "$ENV_FILE" ]; then
  echo "Env file not found: $ENV_FILE"
  echo "Run: cp .env.example .env.local-prod"
  exit 1
fi

node ./scripts/ensure_local_whisper_host.cjs "$ENV_FILE"

if ! node ./scripts/local_prod_config_check.cjs "$ENV_FILE"; then
  exit 1
fi

for volume in $(node -e "require('dotenv').config({ path: process.argv[1], quiet: true }); const { resolveProdVolumeNames } = require('./scripts/env_files.cjs'); process.stdout.write(resolveProdVolumeNames().join('\n'));" "$ENV_FILE"); do
  if ! docker volume inspect "$volume" >/dev/null 2>&1; then
    docker volume create "$volume" >/dev/null
  fi
done

if ! REMI_ENV_FILE="$ENV_FILE" docker compose -p "$COMPOSE_PROJECT" --env-file "$ENV_FILE" -f docker-compose.local-prod.yml up -d --no-build; then
  echo "Local production app image is missing or stale."
  echo "Run: npm run prod:local:build"
  echo "After code changes, use: npm run prod:local:rebuild"
  exit 1
fi

./scripts/check-local-prod.sh

echo "Local production stack started."
echo "App: http://127.0.0.1:${PROD_PORT}"
