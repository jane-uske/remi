# 新设备从零复现完整配置

适用：在 **macOS Apple Silicon** 新机器上，从 `git clone` 跑到与当前 maintainer 一致的本地全栈（LM Studio + MLX TTS + whisper-cpp + Docker local-prod + 可选 ComfyUI / 成人插件）。

最小文本聊天不需要本文档——见 [README.md](../../README.md) Quick Start（`.env.localhost.example` → `.env.localhost` + `npm run dev`）。

## 前提

- macOS arm64
- [Homebrew](https://brew.sh)
- [Docker Desktop](https://www.docker.com/products/docker-desktop)（含 Compose v2+）
- 磁盘：主 LLM ~21 GB + MLX TTS ~2.4 GB + whisper ~400 MB + 依赖

## 1. 系统工具

```bash
brew install node@24 python@3.12 whisper-cpp
# Node 24 加入 PATH（按 brew 提示 link 或 export PATH）
```

## 2. 克隆与依赖

```bash
cd ~/Desktop
git clone <your-repo-url> remi
cd remi
npm install
```

## 3. LM Studio（LLM + Embedding）

1. 安装 [LM Studio](https://lmstudio.ai)
2. 下载模型：
   - `qwen3.6-35b-a3b-uncensored-hauhaucs-aggressive` — 主 LLM
   - `text-embedding-nomic-embed-text-v1.5` — Embedding（语义记忆）
3. Settings → 开启 Local Server（默认 `http://127.0.0.1:1234`）
4. 加载上述两个模型

Ollama 替代方案见 [LOCAL_LLM.md](LOCAL_LLM.md)。

## 4. MLX TTS（Qwen3-TTS）

```bash
pip3 install mlx_audio fastapi uvicorn

# 首次运行自动下载模型（~2.4 GB）
python3 scripts/mlx_tts_server.py --port 3555
# 确认 http://127.0.0.1:3555 可访问后 Ctrl+C；日常由你手动或脚本常驻
```

## 5. whisper-server（本地 STT，语音输入需要）

```bash
mkdir -p ~/.cache/whisper
curl -L -o ~/.cache/whisper/ggml-large-v3-turbo-q5_0.bin \
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin"

whisper-server --model ~/.cache/whisper/ggml-large-v3-turbo-q5_0.bin --port 8178
# 验证后 Ctrl+C；local-prod 可设 whisper_server_autostart=0 由你宿主机管理
```

## 6. ComfyUI（生图，可选）

宿主机运行 ComfyUI，默认 `http://127.0.0.1:8188`。workflow 见 `capabilities/image_generation/workflows/`。`.env.local-prod` 中设 `COMFYUI_ENABLED=1`。

## 7. 成人插件（可选）

```bash
cd ~/Desktop
git clone <adult-plugin-repo-url> remi-plugin-adult
cd remi-plugin-adult
npm install && npm run build
```

## 8. 环境配置

```bash
cd ~/Desktop/remi
cp .env.local-prod.example .env.local-prod
# 编辑 .env.local-prod：Clerk 密钥、路径、模型名按你的环境填写
```

### 关键变量模板

**Docker 内访问宿主机**一律用 `host.docker.internal`（local-prod compose 已配置 `extra_hosts`）。

```env
# LLM — LM Studio
REMI_LLM_API_KEY=lm-studio
REMI_LLM_BASE_URL=http://host.docker.internal:1234/v1
REMI_LLM_MODEL=qwen3.6-35b-a3b-uncensored-hauhaucs-aggressive

# Embedding
REMI_EMBEDDING_API_KEY=lm-studio
REMI_EMBEDDING_BASE_URL=http://host.docker.internal:1234/v1
REMI_EMBEDDING_MODEL=text-embedding-nomic-embed-text-v1.5

# TTS — MLX
REMI_TTS_PROVIDER=mlx
REMI_TTS_MLX_URL=http://host.docker.internal:3555
REMI_TTS_MLX_MODEL=mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit
REMI_TTS_MLX_SPEAKER=serena

# STT — whisper-cpp
REMI_STT_PROVIDER=whisper-cpp
whisper_use_server=1
whisper_server_autostart=0
whisper_server_url=http://host.docker.internal:8178
whisper_lang=zh

# 数据库（compose 服务名）
POSTGRES_PASSWORD=<strong-password>
DATABASE_URL=postgresql://rem:<password>@postgres:5432/rem_ai
REDIS_URL=redis://redis:6379

# 鉴权（试用可改 REMI_AUTH_MODE=disabled，但不推荐用于 local-prod）
REMI_AUTH_MODE=clerk
NEXT_PUBLIC_REMI_AUTH_MODE=clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=<pk_...>
CLERK_JWT_KEY=<PEM public key>

# 插件（可选）
REMI_NSFW_ENABLED=1
REMI_ADULT_MODE=1
REMI_ADULT_PLUGIN_HOST_PATH=/Users/<you>/Desktop/remi-plugin-adult
REMI_PLUGIN_PATH=/plugins/remi-plugin-adult/dist/index.js
REMI_REPO_PATH=/Users/<you>/Desktop/remi

# ComfyUI（可选）
COMFYUI_ENABLED=1
COMFYUI_BASE_URL=http://host.docker.internal:8188
```

完整变量注释见 `.env.example`。

## 9. 启动

### 开发模式（日常，端口 3001）

```bash
npm run dev:bootstrap   # 首次：卷 + 环境检查
npm run dev:infra       # Postgres + Redis
npm run migrate:up

# 宿主机常驻
# - LM Studio :1234
python3 scripts/mlx_tts_server.py --port 3555 &

npm run dev
# → http://localhost:3001
```

开发只用 `.env.localhost`；`REMI_*_BASE_URL` 用 `http://127.0.0.1:...` 而非 `host.docker.internal`。

### 本地生产模式（Docker，端口 3000）

宿主机需常驻：LM Studio、MLX TTS、（可选）whisper-server、ComfyUI。

```bash
npm run prod:local:check
npm run prod:local:build
npm run prod:local:start
# → http://localhost:3000
```

运维细节：[LOCAL_PROD_DEPLOY.md](../ops/LOCAL_PROD_DEPLOY.md)。Compose 说明：[docker/README.md](../../docker/README.md)。

## 10. 验证

```bash
node scripts/doctor.mjs
node scripts/smoke.mjs
```

浏览器发「你好」，确认 LLM 回复 + TTS 播放正常。

## 外部服务一览

| 软件 | 端口 | 用途 | 必须？ |
|------|------|------|--------|
| LM Studio | 1234 | LLM + Embedding | 是 |
| MLX TTS | 3555 | 语音合成 | 推荐（否则 Edge TTS fallback） |
| whisper-server | 8178 | 语音识别 | 仅语音输入 |
| ComfyUI | 8188 | 生图 | 可选 |
| Docker Desktop | — | DB + local-prod | prod 必须；dev 仅 infra 时需要 |
| Clerk | — | 鉴权 | 可选（`REMI_AUTH_MODE=disabled`） |