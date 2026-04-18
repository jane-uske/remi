#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"

ENV_FILE=$(node ./scripts/env_files.cjs dev)

if [ ! -f "$ENV_FILE" ]; then
  echo "Env file not found: $ENV_FILE"
  echo "Run ./scripts/bootstrap-home-dev.sh first."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required but not found in PATH."
  exit 1
fi

PORT_TO_USE=$(node -e "require('dotenv').config({ path: process.argv[1], quiet: true }); const { resolveDevPort } = require('./scripts/env_files.cjs'); process.stdout.write(String(resolveDevPort(process.env)));" "$ENV_FILE")

if lsof -nP -iTCP:"$PORT_TO_USE" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $PORT_TO_USE is already in use. Stop the existing process or change PORT in .env."
  exit 1
fi

export DOTENV_CONFIG_PATH="$ENV_FILE"
export REMI_ACTIVE_ENV_FILE="$ENV_FILE"
export PORT="$PORT_TO_USE"

exec ts-node server/server.ts
