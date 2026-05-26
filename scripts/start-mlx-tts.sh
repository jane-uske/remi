#!/usr/bin/env bash
set -e

VENV="$HOME/remi-tts-env"
PORT="${MLX_PORT:-8000}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ ! -d "$VENV" ]; then
  echo "错误：未找到 Python 虚拟环境 $VENV"
  echo "请先运行：python3.13 -m venv ~/remi-tts-env && source ~/remi-tts-env/bin/activate && pip install 'mlx-audio[server]'"
  exit 1
fi

source "$VENV/bin/activate"

echo "启动 MLX TTS server (自定义轻量版)..."
echo "  端口: $PORT"
echo ""

exec python "$SCRIPT_DIR/mlx_tts_server.py"
