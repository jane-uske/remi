#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"

ENV_FILE=$(node ./scripts/env_files.cjs dev)
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$ENV_FILE"
  set +a
fi

if ! command -v ttyd >/dev/null 2>&1; then
  echo "ttyd is required but was not found in PATH."
  echo "Install it with: brew install ttyd"
  exit 1
fi

if ! command -v tmux >/dev/null 2>&1; then
  echo "tmux is required but was not found in PATH."
  exit 1
fi

PUBLIC_PORT="${REMI_TERMINAL_PORT:-${REM_TERMINAL_PORT:-7681}}"
INTERNAL_PORT="${REMI_TERMINAL_INTERNAL_PORT:-${REM_TERMINAL_INTERNAL_PORT:-7682}}"

if lsof -nP -iTCP:"$PUBLIC_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $PUBLIC_PORT is already in use."
  exit 1
fi

if lsof -nP -iTCP:"$INTERNAL_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $INTERNAL_PORT is already in use."
  exit 1
fi

exec node "$ROOT_DIR/scripts/web_terminal_proxy.js"
