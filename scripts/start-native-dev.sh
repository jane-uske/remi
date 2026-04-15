#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"

if [ ! -f .env ]; then
  echo ".env not found. Run ./scripts/bootstrap-home-dev.sh first."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required but not found in PATH."
  exit 1
fi

PORT_TO_USE="${PORT:-3000}"

if lsof -nP -iTCP:"$PORT_TO_USE" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $PORT_TO_USE is already in use. Stop the existing process or change PORT in .env."
  exit 1
fi

exec ts-node server/server.ts
