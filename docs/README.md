# Remi 文档索引

> **Agent 入口**：改代码前先读本节「按需阅读」表；人类开发者从 [README.md](../README.md) 和 [CLAUDE.md](../CLAUDE.md) 进入。

## 按需阅读（Agent）

| 你要做什么 | 先读 |
|-----------|------|
| 知道当前该做什么、任务状态 | [ops/TASKS.md](ops/TASKS.md) |
| 理解优先级与交付边界 | [ops/CURRENT_FOCUS.md](ops/CURRENT_FOCUS.md) |
| 新设备复现完整本地栈 | [guides/NEW_DEVICE_SETUP.md](guides/NEW_DEVICE_SETUP.md) |
| 最小启动（仅文本聊天） | [README.md](../README.md) Quick Start + `.env.localhost.example` |
| 本机 Docker 生产化（2–3 用户试用） | [ops/LOCAL_PROD_DEPLOY.md](ops/LOCAL_PROD_DEPLOY.md) |
| 远程开发 / Tunnel | [ops/REMOTE_DEV.md](ops/REMOTE_DEV.md) |
| 改模块边界、分层 | [design/ARCHITECTURE.md](design/ARCHITECTURE.md) |
| 改实时链路、延迟 | [design/PIPELINE.md](design/PIPELINE.md) |
| 改记忆系统 | [design/MEMORY_V2_DESIGN.md](design/MEMORY_V2_DESIGN.md) |
| 改语音链路 | [design/VOICE_ROADMAP.md](design/VOICE_ROADMAP.md) |
| 世界线 / RemiWorld 终局 | [design/REMIWORLD_NORTH_STAR.md](design/REMIWORLD_NORTH_STAR.md) |
| 写插件 | [guides/PLUGIN_GUIDE.md](guides/PLUGIN_GUIDE.md) |
| 改目录后跑什么测试 | [guides/TEST_MAP.md](guides/TEST_MAP.md) |
| 本地 LLM（Ollama / LM Studio） | [guides/LOCAL_LLM.md](guides/LOCAL_LLM.md) |
| Docker compose 文件说明 | [../docker/README.md](../docker/README.md) |
| 前端 3D / Live2D 踩坑 | [../web/docs/FRONTEND_PITFALLS.md](../web/docs/FRONTEND_PITFALLS.md) |
| 对话样例 / 手工验收 | [evals/TEST_DIALOGUES.md](evals/TEST_DIALOGUES.md) |
| 日志 / duplex 数据分析 | [guides/LOG_DATA_ANALYSIS.md](guides/LOG_DATA_ANALYSIS.md)、[guides/DUPLEX_DATA_ANALYSIS.md](guides/DUPLEX_DATA_ANALYSIS.md) |

**冲突时优先级**：`CURRENT_FOCUS.md` → `TASKS.md` → 实际代码 → `archive/` 内历史文档。

## 环境变量文件

| 文件 | 提交 git | 作用 |
|------|----------|------|
| `.env.example` | 是 | 全量变量字典与注释，不直接加载 |
| `.env.localhost.example` | 是 | 开发模板 → `cp` 为 `.env.localhost` |
| `.env.local-prod.example` | 是 | local-prod 模板 → `cp` 为 `.env.local-prod` |
| `.env.localhost` | 否 | **`npm run dev` 运行时配置**（端口 3001） |
| `.env.local-prod` | 否 | **`npm run prod:local:*` 运行时配置**（端口 3000） |

## 目录结构

```
docs/
├── README.md          ← 本文件（索引）
├── ops/               ← 执行：任务板、部署、远程开发
├── guides/            ← 操作指南：环境、插件、测试、分析
├── design/            ← 架构与设计（长期有效）
├── evals/             ← 验收对话与评测样例
└── archive/           ← 历史记录，勿作当前事实源
```

## ops/ — 执行与部署

| 文件 | 用途 |
|------|------|
| [TASKS.md](ops/TASKS.md) | 任务看板（W-PRES、RW- 等） |
| [CURRENT_FOCUS.md](ops/CURRENT_FOCUS.md) | 当前主线与取舍 |
| [LOCAL_PROD_DEPLOY.md](ops/LOCAL_PROD_DEPLOY.md) | 单机 Docker 生产化 |
| [REMOTE_DEV.md](ops/REMOTE_DEV.md) | 浏览器远程开发 |

## guides/ — 操作指南

| 文件 | 用途 |
|------|------|
| [NEW_DEVICE_SETUP.md](guides/NEW_DEVICE_SETUP.md) | **新设备从零复现当前完整配置** |
| [LOCAL_LLM.md](guides/LOCAL_LLM.md) | Ollama / LM Studio 本地模型 |
| [PLUGIN_GUIDE.md](guides/PLUGIN_GUIDE.md) | 插件开发 |
| [TEST_MAP.md](guides/TEST_MAP.md) | 改目录 → 跑哪些测试 |
| [LOG_DATA_ANALYSIS.md](guides/LOG_DATA_ANALYSIS.md) | 日志分析入口 |
| [DUPLEX_DATA_ANALYSIS.md](guides/DUPLEX_DATA_ANALYSIS.md) | 全双工语音数据分析 |

## design/ — 架构

| 文件 | 用途 |
|------|------|
| [ARCHITECTURE.md](design/ARCHITECTURE.md) | 模块分层与目录地图 |
| [PIPELINE.md](design/PIPELINE.md) | 实时对话管道 |
| [MEMORY_V2_DESIGN.md](design/MEMORY_V2_DESIGN.md) | 记忆 V2 |
| [VOICE_ROADMAP.md](design/VOICE_ROADMAP.md) | 语音路线图 |
| [REMIWORLD_NORTH_STAR.md](design/REMIWORLD_NORTH_STAR.md) | 世界线北极星 |
| [DESKTOP_MULTI_DEVICE_CLERK.md](design/DESKTOP_MULTI_DEVICE_CLERK.md) | 桌面多端 Clerk |

## archive/ — 历史（只读参考）

已完成阶段性文档、旧计划、spot-check 记录。**不要**用 archive 指导当前优先级。

常见归档：`STRUCTURAL_DEBT.md`（SD-01~07 已完成）、`PROJECT_CONTEXT.md`、`AGENTS.md`、各类 `MEMORY_*` spot-check。