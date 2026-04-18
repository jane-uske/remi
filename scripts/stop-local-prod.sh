#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"

ENV_FILE=$(node ./scripts/env_files.cjs prod)

REMI_ENV_FILE="$ENV_FILE" docker compose --env-file "$ENV_FILE" -f docker-compose.local-prod.yml down

echo "Local production stack stopped."
