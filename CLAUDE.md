# Remi — AI Companion (数字生命)

> 跨设备、持续在场、拥有性格连续性和长期记忆的实时 AI 伙伴。
> Web + iOS + watchOS + 桌面 Tauri 四端同一 WebSocket 协议。

---

## 0. 产品定位与开发约束

> **所有改代码的决策都应先过这一节**。这不是"愿景文档"，而是硬约束。

### Remi 是什么

Remi 不是通用 AI 助手。她是一个以**活人感、人格连续性、存在感**为核心目标的实时 AI 陪伴系统。
用户打开 Remi 的动机不是"帮我一下"，而是"我想见见她"。

### 当前主线（2026-06）

**Web 端 10 分钟在场感体验**：让一个用户在单端、单默认人格下待 10 分钟后，不再把她当成普通聊天框。

执行看板在 `docs/ops/TASKS.md`（W-PRES-01 ~ 04）：
1. 默认人格稳定 ← `in_progress`
2. 严肃场景承接修正
3. Web 在场感统一
4. 10 分钟体验压测

终局形态（虚拟世界伴侣）与世界线阶段定义见 `docs/design/REMIWORLD_NORTH_STAR.md`：
世界（`/world`，RemiWorld）是这条在场感主线的**空间化载体**，不是第二条主线；世界线任务以 `RW-` 前缀挂在 TASKS.md 并行支线。

### 改动优先级

按此顺序决策：

1. **实时交互质量** — 感知延迟、打断、turn-taking、TTS 连续性
2. **人格与关系连续性** — 人格稳定、记忆不丢、语气不飘
3. **架构清晰度** — 职责边界清楚，状态流转清楚
4. **可靠性** — 不破坏现有文本聊天和 fallback 路径
5. **可演进性** — 为跨终端和 plugin 留边界

### 代码规则

**一定要做：**
- 保持现有行为，除非任务明确要求改变
- 高敏感变更按真实影响面决定是否加 feature flag
- 给 turn-taking、interrupt、latency 关键决策补日志
- 改了 `server/session/`、`brains/`、`memory/`、`voice/` 时先看 `docs/guides/TEST_MAP.md`

**绝不要做：**
- 不要在 fast path 塞阻塞性工作（记忆检索、工具调用）
- 不要把外部平台 SDK 耦进核心对话循环
- 不要静默移除 fallback 模式
- 不要让 Remi 变成"什么都能做的通用助手"——工具只服务陪伴，不重写产品分类

### 热点文件（同一迭代只允许一个 owner）

- `server/session/index.ts`
- `brains/slow_brain_store.ts`
- `web/src/hooks/useRemiChat.ts`
- `memory/memory_agent.ts`

### 深入阅读（按需，不要启动时全读）

| 文档 | 何时读 |
|------|--------|
| `docs/ops/TASKS.md` | 要知道当前该做什么 |
| `docs/ops/CURRENT_FOCUS.md` | 要理解优先级判断的上下文 |
| `docs/guides/NEW_DEVICE_SETUP.md` | 新设备复现完整本地栈 |
| `docs/README.md` | 文档总索引（Agent 友好） |
| `docs/design/ARCHITECTURE.md` | 要改模块边界或理解分层 |
| `docs/design/PIPELINE.md` | 要改实时链路或调试延迟 |
| `docs/design/MEMORY_V2_DESIGN.md` | 要改记忆系统 |
| `docs/design/VOICE_ROADMAP.md` | 要改语音链路 |
| `docs/guides/PLUGIN_GUIDE.md` | 要写插件 |
| `docs/guides/TEST_MAP.md` | 改目录后先跑什么测试 |
| `docs/guides/LOCAL_LLM.md` | 本地 Ollama / LM Studio 部署 |

---

## 1. 整体架构

```
┌──────────────────────────────────────────────────────────────────────────┐
│                           Clients (4 端)                                │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │ Web      │  │ iOS      │  │ watchOS      │  │ Desktop (Tauri)    │  │
│  │ Next.js  │  │ SwiftUI  │  │ SwiftUI      │  │ React + Rust       │  │
│  │ 15 App   │  │ + Live2D │  │ + HealthKit  │  │ dual-window        │  │
│  │ Router   │  │ WKWebView│  │ companion    │  │ transparent avatar │  │
│  └────┬─────┘  └────┬─────┘  └──────┬───────┘  └────────┬───────────┘  │
│       │              │               │                   │              │
│       └──────────────┴───────────────┴───────────────────┘              │
│                              │ WebSocket (/ws)                          │
│                              │ + binary RAUD audio frames               │
└──────────────────────────────┼──────────────────────────────────────────┘
                               ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                     Node.js Server (单进程)                              │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ Gateway (raw http + ws)                                          │  │
│  │  /health  /ws  /__access/login  /api/desktop/exchange-token      │  │
│  │  /api/ext/chat (SSE)   → Next.js handle (all other routes)       │  │
│  └──┬────────────────────────────────────────────────────────────────┘  │
│     ▼                                                                   │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ Session (per WebSocket connection)                               │   │
│  │  message_router → pipeline (LLM + TTS + persist)                │   │
│  │  duplex audio → VAD → STT → voice_submit                       │   │
│  │  interruption · turn_taking · continuity · bootstrap            │   │
│  └──┬──────────┬───────────┬──────────┬─────────────────────────────┘   │
│     │          │           │          │                                  │
│  ┌──▼──┐  ┌───▼───┐  ┌───▼───┐  ┌───▼───────┐                         │
│  │Brain│  │Voice  │  │Memory │  │  Persona   │                         │
│  │fast │  │TTS:   │  │episode│  │  4-layer:  │                         │
│  │slow │  │ edge* │  │memory │  │  default   │                         │
│  │ctx  │  │ volc  │  │prompt │  │  soul      │                         │
│  │orch │  │ openai│  │decay  │  │  style     │                         │
│  │     │  │ piper │  │       │  │  preset    │                         │
│  │     │  │ mlx   │  │       │  │            │                         │
│  │     │  │STT:   │  │       │  │            │                         │
│  │     │  │ openai*│ │       │  │            │                         │
│  │     │  │ whisp │  │       │  │            │                         │
│  │     │  │ sherpa│  │       │  │            │                         │
│  └──┬──┘  └───────┘  └───┬───┘  └────────────┘                         │
│     │                    │                                              │
│     ▼                    ▼                                              │
│  ┌──────────┐   ┌────────────────┐                                      │
│  │ OpenAI-  │   │ PostgreSQL 16  │                                      │
│  │ compat   │   │ + pgvector     │                                      │
│  │ LLM API  │   │ (optional)     │                                      │
│  └──────────┘   └────────┬───────┘                                      │
│                          │                                              │
│                 ┌────────▼───────┐                                      │
│                 │ Redis 7        │                                      │
│                 │ (optional,     │                                      │
│                 │  cache only)   │                                      │
│                 └────────────────┘                                      │
└──────────────────────────────────────────────────────────────────────────┘

*默认 provider，无需 API key
```

### 目录结构

```
remi/
├── server/                 # 服务端入口 + 网关 + 会话 + 管道
│   ├── server.ts           # ★ 主入口：dotenv → Zod 校验 → 初始化 → createGateway
│   ├── config/schema.ts    # Zod 环境变量 schema（全部变量的 source of truth）
│   ├── gateway/            # HTTP 路由 + WebSocket 升级 + 鉴权
│   │   ├── index.ts        # 路由分发、Next.js 集成、WS server
│   │   ├── rest_api.ts     # /api/ext/chat SSE 接口
│   │   └── desktop_auth.ts # Clerk → JWT 交换（桌面端用）
│   ├── session/            # 每连接会话状态机 (~30 个文件)
│   │   ├── index.ts        # ConnectionSession 主类
│   │   ├── bootstrap.ts    # 连接初始化、身份解析、历史加载
│   │   ├── message_router.ts # WS 消息分发
│   │   ├── pipeline/       # LLM + TTS + 持久化管道
│   │   ├── turn_taking.ts  # 句子结束检测、阶段推进
│   │   ├── interruption.ts # 打断分类
│   │   ├── duplex_audio.ts # 全双工音频缓冲
│   │   ├── voice_submit.ts # STT → pipeline 提交
│   │   ├── continuity.ts   # 沉默搭话、连续性
│   │   └── tts_transport.ts # TTS 传输模式选择
│   └── pipeline/runner.ts  # runPipeline: LLM 流 → 情绪解析 → TTS → 存储
│
├── agents/                 # 对话代理（conversation_agent: chatStream）
├── avatar/                 # 头像控制器、情绪映射、SVG 资源
├── brain/                  # 人格核心、角色规则、prompt 构建、语调策略
├── brains/                 # 快脑(reply_stream)/慢脑(background_analysis)/上下文编排
├── capabilities/           # 家庭记忆、日期回顾等能力适配器
├── cold_layer/             # 文本归档与检索
├── emotion/                # 情绪引擎、运行时、状态
├── infra/                  # 鉴权(auth.ts)、限流、日志、延迟追踪、应用状态
├── llm/                    # Embedding 客户端、Qwen 客户端、代理抓取
├── memory/                 # 情节存储、记忆代理、会话叠加、遗忘衰减
├── persona/                # 人格预设（remi_default/soul_overlay/style_override/presets）
├── plugin/                 # 插件注册表和类型
├── services/               # 微服务（family-memory）
├── storage/                # DB/Redis 客户端、schema.sql、repositories
│   ├── database.ts         # pg.Pool 初始化 + 查询包装
│   ├── redis.ts            # ioredis 客户端
│   ├── schema.sql          # DDL 参考（实际由 migrations 管理）
│   └── repositories/       # episode/memory/message/session/user 仓库（原生 SQL）
├── utils/                  # 句子分块器、情绪标签解析、重试
├── voice/                  # TTS（5 种 provider）+ STT（3 种）+ VAD + 打断
│   ├── tts.ts              # TTS provider 路由
│   ├── tts_stream.ts       # TTS 统一入口
│   ├── tts_edge.ts         # Edge TTS (WebSocket 连接池)
│   ├── tts_volc.ts         # 火山引擎 TTS
│   ├── tts_mlx.ts          # 本地 MLX Qwen3-TTS
│   ├── stt_stream.ts       # STT provider 路由
│   ├── stt_sherpa_runtime.ts # Sherpa-ONNX 流式 STT
│   └── vad.ts              # 能量 + 过零率 + 峰值因子 VAD
│
├── migrations/             # node-pg-migrate SQL 迁移
│   ├── 001_initial.js      # 完整建表（users/sessions/messages/memories/episodes）
│   └── 002_episodes_v3_columns.js
│
├── web/                    # Next.js 15 前端（npm workspace）
│   ├── src/app/            # App Router 页面
│   │   ├── page.tsx        # / — 主聊天入口
│   │   ├── remi/page.tsx   # /remi — 产品展示页
│   │   ├── demo/page.tsx   # /demo — 3D avatar 离线 demo
│   │   ├── benchmark/      # /benchmark
│   │   └── sign-in/        # /sign-in — Clerk 登录
│   ├── src/components/     # UI 组件
│   │   ├── RemiChatApp.tsx  # ★ 主聊天壳：编排所有子组件
│   │   ├── RemiAuthProvider.tsx # 鉴权上下文（Clerk / legacy JWT / disabled）
│   │   ├── CharacterStage.tsx # 角色渲染路由（live2d → vrm → portrait 降级链）
│   │   ├── Remi3DAvatar.tsx # 3D 角色容器
│   │   ├── ChatWindow.tsx   # 消息列表（流式揭示 + 滚动管理）
│   │   ├── InputBar.tsx     # 输入栏（文本 + 麦克风 + 发送）
│   │   └── MessageBubble.tsx # 消息气泡
│   ├── src/hooks/          # 自定义 Hooks
│   │   ├── useRemiChat.ts   # ★ 主 hook：编排所有子 hook
│   │   ├── useRemiConnection.ts  # WebSocket 生命周期
│   │   ├── useRemiMessages.ts    # 消息历史 + 实时消息
│   │   ├── useRemiVoice.ts       # PCM 采集、全双工、麦克风门控
│   │   ├── useRemiAvatar.ts      # 角色状态
│   │   ├── useRemiTurnEngine.ts  # 回合状态机
│   │   └── useAudioBase64Queue.ts # TTS 音频缓冲/播放
│   ├── src/lib/            # 工具库
│   │   ├── wsUrl.ts        # WS URL 解析和规范化
│   │   ├── rem3d/          # Live2D / VRM 查看器、表情权重、唇形校准
│   │   ├── avatar/         # 角色注册表、模型 URL 解析
│   │   └── presence/       # 对话表现模型（流式揭示节奏、阶段提示）
│   ├── src/runtime/        # 角色渲染模型适配层
│   └── public/             # 静态资源
│       ├── live2d/hiyori-pro/ # Live2D Hiyori Pro 模型
│       ├── vrm/            # VRM 模型文件
│       └── avatar/assets/  # 情绪 SVG + 头像 PNG
│
├── desktop/                # Tauri v2 桌面端（npm workspace）
│   ├── src/                # React 前端（CharacterApp + ChatPanelApp）
│   └── src-tauri/          # Rust 后端（双窗口 + 系统托盘 + 本地 OAuth）
│
├── ios/                    # Swift 原生客户端
│   ├── RemiChatLite/       # iOS 主应用（Live2D + 全双工语音 + 聊天）
│   │   └── RemiWatch/      # 嵌入式 watchOS target（情绪手环 + HealthKit）
│   └── RemiWatch/          # 独立 watchOS 应用
│
├── scripts/                # 开发/运维脚本（30+）
├── docs/                   # 文档（索引见 docs/README.md）
│   ├── ops/                # TASKS.md, CURRENT_FOCUS.md, 部署
│   ├── guides/             # NEW_DEVICE_SETUP, LOCAL_LLM, PLUGIN, TEST_MAP
│   ├── design/             # ARCHITECTURE, PIPELINE, MEMORY_V2_DESIGN
│   └── archive/            # 历史记录
├── docker/                 # Dockerfile + 全部 compose 文件
├── test/                   # Mocha 测试（镜像源码结构）
│
├── .env.example            # 全量变量字典（不直接加载）
├── .env.localhost.example  # 开发模板 → 复制为 .env.localhost
└── .env.local-prod.example # local-prod 模板 → 复制为 .env.local-prod
```

### 入口文件

| 组件 | 入口文件 | 说明 |
|------|---------|------|
| **服务端** | `server/server.ts` | dotenv → Zod 校验 → DB/Redis 初始化 → createGateway → startServer |
| **生产启动** | `dist/server/server.js` | `tsc` 编译产物 |
| **Web 前端** | `web/src/app/page.tsx` | Next.js App Router `/` 路由 |
| **Web 主组件** | `web/src/components/RemiChatApp.tsx` | 聊天 UI shell |
| **Web 主 hook** | `web/src/hooks/useRemiChat.ts` | WebSocket + 语音 + 消息 + 角色编排 |
| **桌面端** | `desktop/src/CharacterApp.tsx` / `ChatPanelApp.tsx` | Tauri 双窗口 |
| **iOS** | `ios/RemiChatLite/.../RemiChatLiteApp.swift` | SwiftUI @main |
| **watchOS** | `ios/RemiChatLite/.../RemiWatch/RemiWatchApp.swift` | 嵌入式 watch target |

---

## 2. 基础设施

### Docker Compose 服务

| 文件 | 服务 | 端口 | 作用 |
|------|------|------|------|
| `docker/docker-compose.dev.yml` | `postgres` | 127.0.0.1:5432 | PostgreSQL 16 + pgvector，dev 数据库 |
| | `redis` | 127.0.0.1:6379 | Redis 7 缓存，appendonly 持久化 |
| | `app-dev` (profile `app`) | 127.0.0.1:3001 | Node 20 容器跑 `npm run dev` |
| | `code-server` (profile `ide`) | 127.0.0.1:8443 | 浏览器版 VS Code |
| | `cloudflared` (profile `tunnel`) | — | Cloudflare Tunnel 远程访问 |
| `docker/docker-compose.yml` | `app` | 3000 | 生产构建镜像 |
| | `postgres` | 5432 | 生产数据库 |
| | `redis` | 6379 | 生产缓存 |
| `docker/docker-compose.local-prod.yml` | 同上 | 127.0.0.1:3000 | 本地生产化测试，用外部 volume |

### 数据库

- **引擎**: PostgreSQL 16 + pgvector 扩展（向量相似度检索）
- **Docker 镜像**: `pgvector/pgvector:pg16`
- **默认连接**: `postgresql://rem:rem_password@localhost:5432/rem_ai`（dev 环境）
- **ORM**: 无。使用原生 `pg` (node-postgres) + 参数化查询
- **Schema 定义**: `storage/schema.sql`（参考用），实际由 migrations 管理
- **Migrations**: `node-pg-migrate`

```bash
# 运行迁移
npm run migrate:up

# 回滚
npm run migrate:down

# 创建新迁移
npm run migrate:create -- <migration-name>
```

迁移文件在 `migrations/` 目录：
- `001_initial.js` — 建表：users, user_auth_identities, user_persona_presets, sessions, messages, memories(+vector), episodes(+vector)
- `002_episodes_v3_columns.js` — episodes 表增加 v3 扩展字段

**数据库是可选的**：不配 `DATABASE_URL` 时，服务端正常启动，记忆/历史存在内存中（volatile）。

### Redis

- **引擎**: Redis 7 (alpine)
- **客户端**: `ioredis` v5，`lazyConnect`，无重试策略
- **用途**: 纯缓存层（`cacheGet`/`cacheSet`/`cacheDel`）
- **可选**: 不配 `REDIS_URL` 时，缓存调用静默 no-op，不影响功能

### CDN / 代理

- **Cloudflare Tunnel**: 远程开发用，不做 CDN
- **配置模板**: `infra/cloudflared/config.example.yml`
- **两种部署方式**:
  1. 原生 `cloudflared` 二进制: `npm run tunnel:start`（需先配 `infra/cloudflared/config.yml`）
  2. Docker compose: `--profile tunnel`（需设 `CLOUDFLARE_TUNNEL_TOKEN`）
- **无 Nginx/Caddy**: 流量直达 Node.js 进程

### 部署

**无 CI/CD 流水线**，手动脚本部署：

```bash
# 本地生产化构建 + 启动
npm run prod:local:build    # 构建 Docker 镜像 remi-ai-app
npm run prod:local:start    # docker-compose up (postgres + redis + app)
npm run prod:local:stop     # 停止
npm run prod:local:rebuild  # 重新构建并启动
npm run prod:local:check    # 健康检查
```

**Dockerfile 三阶段构建**:
1. `backend-build`: Node 20 alpine → `npx tsc` 编译后端
2. `frontend-build`: Node 20 alpine → `next build` 编译前端（接受 `NEXT_PUBLIC_*` build args）
3. Runtime: Node 20 alpine + ffmpeg → `node dist/server/server.js`，暴露 3000 端口

---

## 3. 环境变量

### 速查：从零到能跑

```bash
cp .env.localhost.example .env.localhost
# 编辑 .env.localhost，填入 REMI_LLM_API_KEY 和 REMI_LLM_BASE_URL
npm run dev
```

### 核心变量（`.env.example` 完整注释见文件本身）

#### LLM（必填）

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `REMI_LLM_API_KEY` | ✅ | — | LLM API key |
| `REMI_LLM_BASE_URL` | ✅ | `http://127.0.0.1:1234/v1` | OpenAI 兼容端点 |
| `REMI_LLM_MODEL` | — | 按 BASE_URL 自动检测* | LLM 模型名 |
| `REMI_LLM_PROXY_URL` | — | — | HTTP 代理（如 `http://127.0.0.1:1082`） |
| `REMI_FAST_BRAIN_MODEL` | — | 复用主模型 | 快脑单独使用的轻量模型 |
| `REMI_FAST_BRAIN_REASONING_EFFORT` | — | — | 推理强度: minimal/low/medium/high |

\* 自动检测规则: `api.openai.com` → `gpt-4o-mini`, `dashscope.aliyuncs.com` → `qwen-plus`, `api.deepseek.com` → `deepseek-chat`, 其他 → `qwen2.5-14b-instruct`

#### TTS（可选，默认 Edge TTS 免费可用）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `REMI_TTS_PROVIDER` | `edge` | edge / piper / openai / volc / mlx |
| `REMI_TTS_VOICE` | `zh-CN-XiaoyiNeural` | Edge TTS 音色（晓伊，年轻可爱） |
| `VOLC_TTS_API_KEY` | — | 火山引擎 TTS key（仅 volc provider） |
| `VOLC_TTS_RESOURCE_ID` | — | 火山引擎资源 ID |
| `tts_key` | — | OpenAI TTS API key（仅 openai provider） |
| `REMI_TTS_MLX_URL` | `http://127.0.0.1:8000` | 本地 MLX TTS 服务地址 |

#### STT（可选，语音输入才需要）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `REMI_STT_PROVIDER` | `openai` | openai / whisper-cpp / sherpa |
| `REMI_STT_API_KEY` | — | OpenAI Whisper API key |
| `REMI_STT_BASE_URL` | — | 自定义 STT 端点 |

#### 存储（可选）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DATABASE_URL` | — | PostgreSQL 连接串，不设则内存模式 |
| `REDIS_URL` | — | Redis 连接串，不设则禁用缓存 |
| `POSTGRES_DB` | `rem_ai` | Docker compose 建库用 |
| `POSTGRES_USER` | `rem` | Docker compose 用户 |
| `POSTGRES_PASSWORD` | `rem_password` | Docker compose 密码 |

#### Embedding（可选，语义记忆检索用）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `REMI_EMBEDDING_BASE_URL` | — | 不设则禁用语义召回 |
| `REMI_EMBEDDING_MODEL` | `nomic-embed-text` | Embedding 模型名 |
| `REMI_EMBEDDING_API_KEY` | — | Embedding API key |

#### 鉴权

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `REMI_AUTH_MODE` | `disabled` | disabled / legacy_jwt / clerk |
| `REMI_AUTH_ALLOW_LOOPBACK_BYPASS` | `1` | 本地回环跳过鉴权 |
| `REMI_AUTH_JWT_SECRET` | — | JWT 签名密钥（legacy_jwt 模式） |
| `CLERK_SECRET_KEY` | — | Clerk 后端密钥 |
| `CLERK_JWT_KEY` | — | Clerk JWT 公钥（PEM RS256） |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | — | Clerk 前端公钥 |
| `NEXT_PUBLIC_REMI_AUTH_MODE` | — | 前端鉴权模式（需与后端一致） |
| `REMI_ACCESS_PASSWORD` | — | 共享密码门禁（可选附加层） |
| `REMI_MOBILE_DEV_KEY` | — | iOS 内测兜底鉴权 key |

#### 前端

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `NEXT_PUBLIC_WS_URL` | 自动推断 | WebSocket URL（如 `ws://127.0.0.1:3000/ws`） |
| `NEXT_PUBLIC_LIVE2D_MODEL_ID` | `hiyori-pro` | Live2D 模型 ID |
| `NEXT_PUBLIC_VRM_URL` | — | VRM 模型路径 |
| `NEXT_PUBLIC_VRM_FRAMING` | `full` | 取景: full（全身）/ upper（上半身） |

#### 服务器

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `NODE_ENV` | `development` | development / production |
| `PORT` / `REMI_PORT` | `3001` | HTTP 监听端口 |
| `REMI_LOG_LEVEL` | `info` | 日志级别 |

#### 环境文件优先级

| 场景 | 加载顺序 |
|------|---------|
| `npm run dev` | `.env.localhost` |
| `npm run prod:local:start` | `.env.local-prod` |
| Docker compose dev | `${REMI_ENV_FILE:-.env.localhost}` |

---

## 4. 本地开发

### 从零启动（最快路径）

```bash
# 1. 安装依赖
npm install

# 2. 创建最小配置
cp .env.localhost.example .env.localhost
# 编辑 .env.localhost，填入你的 LLM API key 和 base URL

# 3. 启动（前后端一体，无需 Docker）
npm run dev
# → http://localhost:3001
```

这就够了。无需数据库、无需 Redis、无需 TTS key。
- TTS 默认 Edge TTS（免费，无需配置）
- 记忆存在内存中
- 鉴权默认关闭

### 完整开发环境（含数据库）

```bash
# 1. 一键初始化（检测环境、创建 .env.localhost、创建 Docker volumes）
npm run dev:bootstrap

# 2. 启动基础设施（PostgreSQL + Redis）
npm run dev:infra

# 3. 运行迁移
npm run migrate:up

# 4. 启动应用
npm run dev
# → http://localhost:3001
```

### 本地 Ollama 全栈

```bash
# 安装 Ollama 并拉取模型
ollama pull qwen3:8b
ollama pull qwen3:4b           # 快脑用
ollama pull nomic-embed-text   # 语义召回用

# 使用 Ollama 预设
# Ollama 变量写入 .env.localhost，见 docs/guides/LOCAL_LLM.md
npm run dev:infra   # 启动 postgres + redis
npm run migrate:up
npm run dev
```

### 常用开发命令

```bash
npm run dev                # 启动全栈（后端 + Next.js 前端）
npm run dev:infra          # 只启动 postgres + redis
npm run dev:infra:ide      # 上面 + 浏览器 IDE (code-server)
npm run dev:web:standalone # 只启动前端（后端需另行启动在 3000）
npm run dev:web:clean      # 清 Next.js 缓存
npm run dev:down           # 停止所有 dev 服务

npm run test               # 跑 Mocha 测试
npm run typecheck          # TypeScript 类型检查
npm run build              # 构建前端 + 后端

npm run desktop:dev        # 启动 Tauri 桌面端开发

node scripts/doctor.mjs    # 诊断脚本：检查 LLM/STT/TTS/DB/Redis 连通性
node scripts/smoke.mjs     # 冒烟测试：健康检查 + WebSocket 聊天
```

### 常见启动失败

| 症状 | 原因 | 解法 |
|------|------|------|
| `LLM API key is required` | `.env.localhost` 缺少 `REMI_LLM_API_KEY` | 填入 API key |
| `EADDRINUSE 3001` | 端口被占 | 上次进程没关干净，`npm run dev` 默认会自动 kill 旧实例；也可手动 `lsof -i :3001` |
| `Cannot find module 'xxx'` | 依赖没装全 | `npm install`（根目录一次即可） |
| Next.js HMR 断连 | `.next-dev` 缓存损坏 | `npm run dev:web:clean` |
| `database "rem_ai" does not exist` | 数据库未初始化 | `npm run dev:infra` 自动建库；或 `npm run migrate:up` |
| pgvector 扩展报错 | 用的不是 pgvector 镜像 | 确保 Docker 镜像是 `pgvector/pgvector:pg16` |
| Live2D 模型白屏 | Cubism Core SDK 未加载 | 默认从 CDN 拉取，无需操作；离线需设 `NEXT_PUBLIC_LIVE2D_CUBISM_CORE_URL` |

---

## 5. 外部服务依赖

### LLM（必需）

| 服务 | 用途 | 获取方式 | 本地替代 |
|------|------|---------|---------|
| **OpenAI API** | 主对话 + STT | https://platform.openai.com/api-keys | Ollama / LM Studio / 任何 OpenAI 兼容端点 |
| **阿里云 DashScope** | 通义千问 | https://dashscope.console.aliyun.com/ | 同上 |
| **DeepSeek API** | DeepSeek Chat | https://platform.deepseek.com/ | 同上 |

服务端使用 OpenAI SDK 对接任意 OpenAI 兼容 API，通过 `REMI_LLM_BASE_URL` 切换。

### TTS

| Provider | 需要 API key | 说明 |
|----------|-------------|------|
| **Edge TTS** ✱默认 | ❌ | 微软 Edge 免费 TTS，WebSocket 连接池复用 |
| **OpenAI TTS** | ✅ `tts_key` | 高质量，按用量计费 |
| **火山引擎 (Doubao)** | ✅ `VOLC_TTS_API_KEY` + `VOLC_TTS_RESOURCE_ID` | https://www.volcengine.com/product/tts |
| **Piper** | ❌ | 本地离线，需安装 `piper` 命令行 + 下载模型 |
| **MLX (Qwen3-TTS)** | ❌ | Apple Silicon 本地推理，`python scripts/mlx_tts_server.py` |

### STT

| Provider | 需要 API key | 说明 |
|----------|-------------|------|
| **OpenAI Whisper** ✱默认 | ✅ `REMI_STT_API_KEY` | 准确度最高 |
| **whisper-cpp** | ❌ | 本地离线，需下载模型文件 |
| **Sherpa-ONNX** | ❌ | 本地流式 STT，`npm run stt:sherpa:setup` 自动安装 |

### Embedding（可选）

| 服务 | 模型 | 说明 |
|------|------|------|
| 本地 LM Studio / Ollama | `nomic-embed-text` | 推荐，零成本 |
| OpenAI | `text-embedding-3-small` | 云端方案 |

不设 `REMI_EMBEDDING_BASE_URL` 则完全跳过语义召回，零性能影响。

### 鉴权（可选）

| 服务 | 用途 | 获取方式 |
|------|------|---------|
| **Clerk** | 生产级身份认证 | https://clerk.com/ |

开发环境默认 `REMI_AUTH_MODE=disabled`，无需配置任何鉴权服务。

---

## 6. 已知坑点

### 环境变量

1. **旧变量名仍然可用但会报 deprecation warning**: `key` → `REMI_LLM_API_KEY`, `base_url` → `REMI_LLM_BASE_URL`, `model` → `REMI_LLM_MODEL`, `tts_provider` → `REMI_TTS_PROVIDER`, `stt_provider` → `REMI_STT_PROVIDER`, `JWT_SECRET` → `REMI_AUTH_JWT_SECRET` 等。建议统一用 `REMI_` 前缀。

2. **`NEXT_PUBLIC_WS_URL` 格式**: 必须包含 `ws://` 或 `wss://` 前缀。只写 `localhost:3000/ws` 会被当成相对路径，导致地址栏嵌套。

3. **`REMI_NEXT_HOSTNAME` 不要带端口**: 正确 `REMI_NEXT_HOSTNAME=app-remi.example.com`，错误 `REMI_NEXT_HOSTNAME=localhost:3000`。

4. **前端分离开发**: `npm run dev:web:standalone` 单跑前端时必须配 `NEXT_PUBLIC_WS_URL=ws://127.0.0.1:3000/ws` 指向已启动的后端。

5. **Clerk localhost 安全限制**: 生产 Clerk key 在 localhost 被自动阻止，防止误用。本地开发请用 `REMI_AUTH_MODE=disabled` 或使用 Clerk 的 dev key。

### Docker

6. **浅克隆 + git merge**: 代理镜像克隆可能导致 commit hash 不同（内容一致），`git merge origin/main` 会报 `refusing to merge unrelated histories`。解法: `git fetch origin && git reset --hard origin/main`。

7. **local-prod 需预创建外部 volume**: `docker/docker-compose.local-prod.yml` 使用 `external: true` 卷，必须先运行 `npm run dev:bootstrap` 或手动 `docker volume create`。

8. **Docker 内访问宿主机 Whisper**: 需设 `extra_hosts: host.docker.internal:host-gateway`（local-prod compose 已内置）。

9. **`node_modules` volume 陷阱**: dev compose 用 Docker volume 挂载 `node_modules`（避免 Linux/Mac 架构冲突），但宿主机 `npm install` 后需重启容器让 volume 更新。

### 第三方服务

10. **Edge TTS 偶发超时**: 免费服务有速率限制。连接池（`edge_tts_pool=1`）默认启用，复用连接减少超时。如果仍然频繁超时，可配 `TTS_FALLBACK_PROVIDER=openai` 做降级。

11. **OpenAI Whisper 中文**: `stt_language=zh` + `stt_prompt=以下是普通话口语对话。` 能显著提升中文识别率。不设 prompt 时短句容易出错。

12. **pgvector 必须用专门镜像**: 标准 `postgres:16` 镜像不包含 pgvector 扩展，`CREATE EXTENSION vector` 会报错。务必使用 `pgvector/pgvector:pg16`。

### 前端

13. **VRM 模型手臂姿势异常**: 默认禁用 `VRMC_node_constraint`，否则每帧会把手拉回预设姿势。如果头发/饰品异常，设 `NEXT_PUBLIC_VRM_DISABLE_NODE_CONSTRAINT=0` 恢复。

14. **Live2D Cubism Core CDN**: 默认从 `NEXT_PUBLIC_LIVE2D_CUBISM_CORE_URL` 加载 Cubism SDK Core。离线环境需下载放到本地路径。

15. **React 版本差异**: web 使用 React 19，desktop 也用 React 19，但 iOS 端 Live2D 使用 PIXI v7 内嵌的 WebView 渲染，与主前端独立。

### 会话/管道

16. **情绪标签跨 chunk 切割**: LLM 流式返回时，`</emotion>` 闭合标签可能跨 chunk 分割。已在 `35a174bc` 修复（emotion tag parser 做缓冲拼接）。

17. **pipeline 串行化**: 每个 WebSocket 连接的 `pipelineChain` 保证同一时间只运行一个 LLM 管道。并发消息会排队，不会丢失但可能有延迟。

18. **Hot files 禁止并行编辑**: `server/session/index.ts`, `brains/slow_brain_store.ts`, `web/src/hooks/useRemiChat.ts`, `memory/memory_agent.ts` 是高变更文件，多人/多分支同时改动极易冲突。

---

## 7. 常用操作速查

### 重启服务

```bash
# 重启整个 dev 环境
npm run dev:down && npm run dev:infra && npm run dev

# 只重启 app（保留 DB/Redis）
# 在 npm run dev 的终端按 Ctrl+C，然后重新 npm run dev

# 重启本地生产环境
npm run prod:local:stop && npm run prod:local:start
```

### 数据库

```bash
# 运行迁移
npm run migrate:up

# 回滚最后一个迁移
npm run migrate:down

# 创建新迁移
npm run migrate:create -- add-new-feature

# 连接数据库（dev 环境）
docker exec -it $(docker ps -qf "name=postgres") psql -U rem -d rem_ai

# 重置数据库（删除所有数据，重跑迁移）
npm run migrate:down  # 先回滚
npm run migrate:up    # 再应用

# 重置 demo 用户
npm run prod:local:reset-demo-users
```

### 查看日志

```bash
# dev 模式日志直接输出到终端（pino-pretty 格式）
npm run dev

# 查看 Docker compose 日志
docker compose -f docker/docker-compose.dev.yml logs -f postgres
docker compose -f docker/docker-compose.dev.yml logs -f redis
docker compose -f docker/docker-compose.local-prod.yml logs -f app

# 调整日志级别
REMI_LOG_LEVEL=debug npm run dev
```

### 添加新 API 接口

1. **WebSocket 消息**: 在 `server/session/message_router.ts` 的 `routeMessage()` 中添加 case
2. **REST 端点**: 在 `server/gateway/index.ts` 的 HTTP handler 中添加路径匹配，或扩展 `server/gateway/rest_api.ts`
3. **类型定义**: 服务端消息类型在 `server/gateway/types.ts`

### 添加新前端页面

1. 在 `web/src/app/<route>/page.tsx` 创建文件（Next.js App Router 约定）
2. 页面组件从 `'use client'` 开始（如需交互）
3. 共用布局在 `web/src/app/layout.tsx`
4. Tailwind v4 样式在 `web/src/app/globals.css`

### 添加新 TTS/STT Provider

1. 在 `voice/` 目录创建新 provider 文件（参考 `tts_edge.ts`）
2. 在 `voice/tts.ts` 或 `voice/stt_stream.ts` 的 provider 路由中添加 case
3. 在 `server/config/schema.ts` 的 Zod enum 中添加新 provider 名

### 测试

```bash
npm run test                  # 全部测试
npm run typecheck             # 类型检查
node scripts/smoke.mjs        # 冒烟测试（健康检查 + WS 聊天）
node scripts/doctor.mjs       # 环境诊断
npm run memory:v2:audit       # 记忆系统审计
npm run memory:v2:acceptance  # 记忆验收测试
```

### 桌面端开发

```bash
npm run desktop:dev    # 启动 Tauri 开发模式
npm run desktop:build  # 构建桌面端发行版

# 桌面端环境变量在 desktop/.env
# VITE_WS_URL=ws://localhost:3000/ws
```

---

## 8. 技术栈速查

| 层 | 技术 |
|----|------|
| **运行时** | Node.js 20 |
| **语言** | TypeScript 6 (后端), TypeScript 5 (前端) |
| **包管理** | npm workspaces (root + web + desktop) |
| **后端框架** | 无框架，raw `http` + `ws` + Next.js 集成 |
| **前端框架** | Next.js 15 (App Router) + React 19 |
| **CSS** | Tailwind CSS v4 (PostCSS, 无 config 文件) |
| **桌面端** | Tauri v2 (Rust + React + Vite) |
| **iOS** | SwiftUI + WKWebView (Live2D) |
| **3D 渲染** | pixi-live2d-display (Cubism 4) / @pixiv/three-vrm (Three.js) |
| **数据库** | PostgreSQL 16 + pgvector（可选） |
| **缓存** | Redis 7（可选） |
| **LLM** | OpenAI SDK → 任意兼容端点 |
| **TTS** | Edge TTS (默认) / Volcengine / OpenAI / Piper / MLX |
| **STT** | OpenAI Whisper / whisper-cpp / Sherpa-ONNX |
| **鉴权** | Clerk / legacy JWT / disabled |
| **测试** | Mocha + Chai |
| **构建** | tsc (后端) + next build (前端) + Vite (桌面) |
| **容器** | Docker + docker-compose |

---

## 9. WebSocket 协议速查

所有客户端共用同一 WebSocket 协议，连接 `/ws`。

### 客户端 → 服务端

| type | 字段 | 说明 |
|------|------|------|
| `client_context` | `timeZone`, `locale`, `ttsTransport` | 连接后首发 |
| `chat` | `content` | 文本消息 |
| `duplex_start` | `mode`, `sampleRate` | 开始语音会话 |
| `duplex_stop` | — | 结束语音会话 |
| `history_more` | `cursor.id`, `cursor.createdAt` | 加载更多历史 |
| `playback_start/end` | `generationId` | TTS 播放生命周期 |
| _(binary)_ | RAUD header + PCM16 | 音频帧 |

### 服务端 → 客户端

| type | 说明 |
|------|------|
| `chat_chunk` / `chat_end` | LLM 流式 token / 回合结束 |
| `emotion` | 情绪变化 |
| `voice` | TTS 音频 (base64) |
| `voice_pcm_chunk` | 流式 PCM TTS |
| `vad_start` / `vad_end` | VAD 状态 |
| `stt_partial` / `stt_final` | 转写预览 / 最终结果 |
| `interrupt` | 打断信号 |
| `turn_state` | 回合状态机 |
| `avatar_frame` / `avatar_intent` | 角色动画 |
| `tts_lip_sync` | 唇形同步 |
| `history_page` | 聊天历史 |
| `error` | 错误信息 |

### 音频帧格式 (RAUD)

```
Bytes 0-3:  Magic  52 41 55 44 ("RAUD")
Bytes 4-7:  Version 01 01 00 00
Bytes 8-11: SampleRate (uint32 LE, 通常 16000)
Bytes 12-15: Length (uint32 LE)
Bytes 16+:  PCM16 payload
```

---

## 10. 配置验证

所有环境变量在启动时由 Zod schema (`server/config/schema.ts`) 统一验证。
验证失败 → 打印具体错误 → `process.exit(1)`。

旧变量名通过 `LEGACY_ALIASES` 映射表自动转换到新名，并输出 deprecation 警告。

运行 `node scripts/doctor.mjs` 可在不启动服务的情况下检查所有外部依赖连通性。
