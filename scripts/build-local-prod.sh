#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"

ENV_FILE=$(node ./scripts/env_files.cjs prod)
COMPOSE_PROJECT=$(node -e "require('dotenv').config({ path: process.argv[1], quiet: true }); const { resolveComposeProjectName } = require('./scripts/env_files.cjs'); process.stdout.write(resolveComposeProjectName('prod'));" "$ENV_FILE")

if [ ! -f "$ENV_FILE" ]; then
  echo "Env file not found: $ENV_FILE"
  echo "Run: cp .env.example .env.local-prod"
  exit 1
fi

if ! node ./scripts/local_prod_config_check.cjs "$ENV_FILE"; then
  exit 1
fi

REMI_ENV_FILE="$ENV_FILE" docker compose -p "$COMPOSE_PROJECT" --env-file "$ENV_FILE" -f docker-compose.local-prod.yml build app

echo "Local production app image built."
