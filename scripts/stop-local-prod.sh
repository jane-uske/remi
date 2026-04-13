#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"

docker compose -f docker-compose.local-prod.yml down

echo "Local production stack stopped."
