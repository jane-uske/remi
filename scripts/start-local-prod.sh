#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"

if [ ! -f .env ]; then
  echo ".env not found. Run: cp .env.example .env"
  exit 1
fi

./scripts/check-local-prod.sh

docker compose -f docker-compose.local-prod.yml up -d --build

echo "Local production stack started."
echo "App: http://127.0.0.1:${PORT:-3000}"
