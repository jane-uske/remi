#!/usr/bin/env sh
set -eu

PORT="${REMI_TERMINAL_PORT:-${REM_TERMINAL_PORT:-7681}}"

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "OK   terminal: localhost:$PORT is listening"
else
  echo "MISS terminal: localhost:$PORT is not listening"
fi
