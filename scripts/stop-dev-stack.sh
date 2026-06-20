#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"

ENV_FILE=$(node ./scripts/env_files.cjs dev)
COMPOSE_PROJECT=$(node -e "require('dotenv').config({ path: process.argv[1], quiet: true }); const { resolveComposeProjectName } = require('./scripts/env_files.cjs'); process.stdout.write(resolveComposeProjectName('dev'));" "$ENV_FILE")

REMI_ENV_FILE="$ENV_FILE" docker compose -p "$COMPOSE_PROJECT" --env-file "$ENV_FILE" -f docker/docker-compose.dev.yml down

echo "Remote dev stack stopped."
