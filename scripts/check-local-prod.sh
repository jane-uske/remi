#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"

if [ ! -f .env ]; then
  echo "MISS env: .env not found"
  echo "Run: cp .env.example .env"
  exit 1
fi

read_env_value() {
  key="$1"
  line=$(grep -E "^[[:space:]]*${key}=" .env | tail -n 1 || true)
  if [ -z "$line" ]; then
    echo ""
    return
  fi
  value=${line#*=}
  value=$(printf "%s" "$value" | sed 's/[[:space:]]*$//')
  echo "$value"
}

require_non_empty() {
  key="$1"
  value=$(read_env_value "$key")
  if [ -z "$value" ]; then
    echo "MISS env: $key is empty"
    return 1
  fi
  echo "OK   env: $key is set"
  return 0
}

has_error=0

for key in key base_url model JWT_SECRET POSTGRES_PASSWORD; do
  if ! require_non_empty "$key"; then
    has_error=1
  fi
done

pg_password=$(read_env_value "POSTGRES_PASSWORD")
if [ "$pg_password" = "rem_password" ]; then
  echo "MISS env: POSTGRES_PASSWORD is still default 'rem_password'"
  has_error=1
fi

if [ "$has_error" -ne 0 ]; then
  echo "Local production checks failed."
  exit 1
fi

if lsof -nP -iTCP:${PORT:-3000} -sTCP:LISTEN >/dev/null 2>&1; then
  echo "OK   port: localhost:${PORT:-3000} is listening"
else
  echo "MISS port: localhost:${PORT:-3000} is not listening yet (start may be pending)"
fi

if command -v curl >/dev/null 2>&1; then
  if curl -fsS --max-time 3 "http://127.0.0.1:${PORT:-3000}/health" >/dev/null 2>&1; then
    echo "OK   health: /health responded"
  else
    echo "MISS health: /health not ready yet"
  fi
fi

echo "check-local-prod completed."
