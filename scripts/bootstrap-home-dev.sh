#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"

echo "=== Remi Dev Bootstrap ==="
echo

# ── Prerequisites ──────────────────────────────────────────────────────────

MISSING=""

if ! command -v docker >/dev/null 2>&1; then
  MISSING="$MISSING docker"
fi

if ! docker compose version >/dev/null 2>&1; then
  MISSING="$MISSING docker-compose-plugin"
fi

if ! command -v node >/dev/null 2>&1; then
  MISSING="$MISSING node"
fi

if ! command -v npm >/dev/null 2>&1; then
  MISSING="$MISSING npm"
fi

if [ -n "$MISSING" ]; then
  echo "[ERROR] Missing prerequisites:$MISSING"
  echo "Install them and re-run this script."
  exit 1
fi

echo "[OK] Prerequisites: docker, docker-compose, node, npm"

# ── Ollama Check ───────────────────────────────────────────────────────────

OLLAMA_OK=0
if command -v ollama >/dev/null 2>&1; then
  OLLAMA_OK=1
  echo "[OK] Ollama installed"
elif curl -sf http://127.0.0.1:11434/v1/models >/dev/null 2>&1; then
  OLLAMA_OK=1
  echo "[OK] Ollama API reachable at 127.0.0.1:11434"
else
  echo "[WARN] Ollama not found. Local LLM requires Ollama (or compatible API)."
  echo "       Install: curl -fsSL https://ollama.com/install.sh | sh"
  echo "       Docs:    docs/guides/LOCAL_LLM.md"
fi

# ── Model Check ────────────────────────────────────────────────────────────

if [ "$OLLAMA_OK" = "1" ] && command -v ollama >/dev/null 2>&1; then
  MODELS_NEEDED=""
  if ! ollama list 2>/dev/null | grep -q "nomic-embed-text"; then
    MODELS_NEEDED="$MODELS_NEEDED nomic-embed-text"
  fi
  if ! ollama list 2>/dev/null | grep -q "qwen3:4b"; then
    MODELS_NEEDED="$MODELS_NEEDED qwen3:4b"
  fi
  if ! ollama list 2>/dev/null | grep -q "qwen3:8b"; then
    MODELS_NEEDED="$MODELS_NEEDED qwen3:8b"
  fi

  if [ -n "$MODELS_NEEDED" ]; then
    echo "[WARN] Missing Ollama models:$MODELS_NEEDED"
    echo "       Pull them with:"
    for m in $MODELS_NEEDED; do
      echo "         ollama pull $m"
    done
  else
    echo "[OK] Required models available (qwen3:4b, qwen3:8b, nomic-embed-text)"
  fi
fi

# ── Environment Files ──────────────────────────────────────────────────────

echo

if [ ! -f .env.localhost ]; then
  cp .env.localhost.example .env.localhost
  echo "[CREATED] .env.localhost from .env.localhost.example"
  if [ "$OLLAMA_OK" = "1" ]; then
    echo "[HINT] Ollama preset vars — see docs/guides/LOCAL_LLM.md"
  else
    echo "[EDIT]  Fill REMI_LLM_API_KEY and REMI_LLM_BASE_URL in .env.localhost"
  fi
else
  echo "[OK] .env.localhost already exists"
fi

mkdir -p .cloudflared

# ── Docker Volumes ─────────────────────────────────────────────────────────

echo
echo "Creating Docker volumes (if needed)..."
for vol in remi-ai_rem_pgdata remi-ai_rem_redisdata remi-ai_rem_root_node_modules remi-ai_rem_web_node_modules remi-ai_rem_code_server_config; do
  if ! docker volume inspect "$vol" >/dev/null 2>&1; then
    docker volume create "$vol" >/dev/null
    echo "  Created: $vol"
  fi
done
echo "[OK] Docker volumes ready"

# ── Summary ────────────────────────────────────────────────────────────────

echo
echo "=== Bootstrap Complete ==="
echo
echo "Next steps:"
echo "  1. Start infra:     npm run dev:infra"
echo "  2. Install deps:    npm install"
echo "  3. Run migrations:  npm run migrate:up"
echo "  4. Start dev:       npm run dev"
echo
if [ "$OLLAMA_OK" = "0" ]; then
  echo "  [!] Install Ollama first — see docs/guides/LOCAL_LLM.md"
fi
