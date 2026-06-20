#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"

ENV_FILE=$(node ./scripts/env_files.cjs dev)
COMPOSE_PROJECT=$(node -e "require('dotenv').config({ path: process.argv[1], quiet: true }); const { resolveComposeProjectName } = require('./scripts/env_files.cjs'); process.stdout.write(resolveComposeProjectName('dev'));" "$ENV_FILE")
DEV_PORT=$(node -e "require('dotenv').config({ path: process.argv[1], quiet: true }); const { resolveDevPort } = require('./scripts/env_files.cjs'); process.stdout.write(String(resolveDevPort(process.env)));" "$ENV_FILE")

PROFILE_ARGS=""
SERVICES="postgres redis"
for arg in "$@"; do
  case "$arg" in
    --app)
      PROFILE_ARGS="$PROFILE_ARGS --profile app"
      SERVICES="$SERVICES app-dev"
      ;;
    --ide)
      PROFILE_ARGS="$PROFILE_ARGS --profile ide"
      SERVICES="$SERVICES code-server"
      ;;
    --tunnel)
      PROFILE_ARGS="$PROFILE_ARGS --profile tunnel"
      SERVICES="$SERVICES cloudflared"
      ;;
    *)
      echo "Unknown option: $arg"
      echo "Usage: $0 [--app] [--ide] [--tunnel]"
      exit 1
      ;;
  esac
done

if [ ! -f "$ENV_FILE" ]; then
  echo "Env file not found: $ENV_FILE"
  echo "Run ./scripts/bootstrap-home-dev.sh first."
  exit 1
fi

for volume in $(node -e "require('dotenv').config({ path: process.argv[1], quiet: true }); const { resolveDevVolumeNames } = require('./scripts/env_files.cjs'); process.stdout.write(resolveDevVolumeNames().join('\n'));" "$ENV_FILE"); do
  if ! docker volume inspect "$volume" >/dev/null 2>&1; then
    docker volume create "$volume" >/dev/null
  fi
done

REMI_ENV_FILE="$ENV_FILE" docker compose -p "$COMPOSE_PROJECT" --env-file "$ENV_FILE" -f docker/docker-compose.dev.yml $PROFILE_ARGS up -d $SERVICES

echo "Remote dev services started."
echo "Storage:     postgres=127.0.0.1:5432 redis=127.0.0.1:6379"
if printf '%s' "$SERVICES" | grep -q "app-dev"; then
  echo "App preview: http://127.0.0.1:${DEV_PORT}"
else
  echo "App preview: start native app with 'npm run dev', then open http://127.0.0.1:${DEV_PORT}"
fi
if printf '%s' "$SERVICES" | grep -q "code-server"; then
  echo "Browser IDE: http://127.0.0.1:${CODE_SERVER_PORT:-8443}"
fi
