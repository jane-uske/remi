#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required but was not found in PATH."
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "docker compose plugin is required but not available."
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node is recommended for native app development but was not found in PATH."
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is recommended for native app development but was not found in PATH."
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example. Fill in API keys before exposing preview URLs."
fi

mkdir -p .cloudflared

echo "Environment checks passed."
echo
echo "Suggested next steps:"
echo "  1. Edit .env and set at least key/base_url/model/JWT_SECRET."
echo "  2. Start storage only:  npm run dev:infra"
echo "  3. Install deps once:   npm install && npm install --prefix web"
echo "  4. Run app natively:    npm run dev"
echo "  5. Optional browser IDE: npm run dev:infra:ide"
