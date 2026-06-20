# 本地 LLM 部署指南

Remi 使用三个模型角色，各有不同的性能/质量权衡：

## 模型角色

| 角色 | 用途 | 推荐模型 | 显存需求 | 配置项 |
|------|------|----------|----------|--------|
| **Fast Brain** | 实时流式回复 | `qwen3:4b` | ~3 GB | `REMI_FAST_BRAIN_MODEL` |
| **Slow Brain** | 后台记忆分析 | `qwen3:8b` | ~6 GB | `REMI_LLM_MODEL` |
| **Embedding** | 语义检索/向量搜索 | `nomic-embed-text` | ~0.3 GB | `REMI_EMBEDDING_MODEL` |

> **三个角色可以都用同一个模型吗？** 可以但不推荐。Fast Brain 需要低延迟，用小模型 + `reasoning_effort=minimal`；Slow Brain 异步运行不怕慢，用大模型出好结果。

## 快速安装 (Ollama)

```bash
# 1. 安装 Ollama
curl -fsSL https://ollama.com/install.sh | sh

# 2. 拉取模型
ollama pull qwen3:4b        # Fast Brain (~2.5 GB 下载)
ollama pull qwen3:8b        # Slow Brain (~5 GB 下载)
ollama pull nomic-embed-text # Embedding (~275 MB 下载)

# 3. 验证
ollama list
```

## 配置

将下列变量写入 `.env.localhost`（开发）或 `.env.local-prod`（Docker 生产化）：

```env
REMI_LLM_API_KEY=ollama
REMI_LLM_BASE_URL=http://127.0.0.1:11434/v1
REMI_LLM_MODEL=qwen3:8b

REMI_FAST_BRAIN_MODEL=qwen3:4b
REMI_FAST_BRAIN_REASONING_EFFORT=minimal

REMI_EMBEDDING_API_KEY=ollama
REMI_EMBEDDING_BASE_URL=http://127.0.0.1:11434/v1
REMI_EMBEDDING_MODEL=nomic-embed-text

DATABASE_URL=postgresql://rem:rem_password@127.0.0.1:5432/rem_ai
REDIS_URL=redis://127.0.0.1:6379
REMI_SLOW_BRAIN_ENABLED=1
```

尚无 `.env.localhost` 时：`cp .env.localhost.example .env.localhost`

## 替代模型选项

### 显存 < 8 GB (只跑一个模型)

| 角色 | 替代 | 说明 |
|------|------|------|
| Fast + Slow | `qwen3:4b` | 所有角色共用同一个模型 |
| Embedding | `nomic-embed-text` | 必须，不能省略 |

配置：不设置 `REMI_FAST_BRAIN_MODEL`，让 Fast Brain 使用 `REMI_LLM_MODEL`。

### 显存 16+ GB (追求质量)

| 角色 | 替代 | 说明 |
|------|------|------|
| Fast Brain | `qwen3:8b` | 响应更有深度 |
| Slow Brain | `qwen3:14b` | 记忆分析更精准 |
| Embedding | `nomic-embed-text` | 维度固定 768，不要换其他模型 |

### LM Studio / vLLM / 其他后端

任何 OpenAI 兼容 API 均可，修改 `REMI_LLM_BASE_URL` 指向你的端点：

```env
REMI_LLM_BASE_URL=http://127.0.0.1:1234/v1   # LM Studio
REMI_LLM_BASE_URL=http://127.0.0.1:8000/v1   # vLLM
```

## Embedding 不配置会怎样？

记忆系统的语义检索功能依赖 Embedding。如果不配置：

- `REMI_EMBEDDING_BASE_URL` 为空 → 启动时打印警告
- 记忆写入仍然正常，但 **无法通过语义搜索召回**
- Episode 检索退化为纯关键词匹配（`classifyDomain` 的 keyword 分支）
- Proactive prompt 无法按相似度排序记忆

**结论：Embedding 是必须配置的。** `nomic-embed-text` 仅 275 MB，没有理由跳过。

## 验证安装

```bash
# 检查 Ollama 是否在运行
curl http://127.0.0.1:11434/v1/models

# 运行 Remi 开发检查
npm run dev:check
```

## 完整开发流程

```bash
# 一键设置 (首次)
npm run dev:bootstrap

# 启动基础设施 (PostgreSQL + Redis)
npm run dev:infra

# 安装依赖
npm install

# 数据库迁移
npm run migrate:up

# 启动开发服务器
npm run dev
```
