# Remi Companion AI

实时 AI 陪伴系统 —— 能聊天、有记忆、懂情绪、能说话、有形象。

Remi 的终极目标不是做一个“功能更多的聊天机器人”，而是把她做成一个跨终端、持续在线、随时可陪伴、像活人一样存在的 AI 伴侣：

- 像真人对话：能听、能停顿、能接话、能被打断、能顺着语境自然回应
- 像持续存在的人：有人格稳定性、有长期记忆、有关系感，越聊越像“她”
- 像跨终端持续在线的存在：手机、电脑、网页、手表，各终端用最适合自己的形态承载她的存在
- 像真实角色在场：最好有语音、表情、3D 形象、嘴型同步和状态反馈
- 像产品而不是 demo：低延迟、稳定、可扩展，最后真的有人愿意天天打开

所以 Remi 不是“更会拼接上下文的聊天机器人”。
Remi 更接近“一个有实时交互感、人格连续性、跨终端存在感与陪伴感的数字生命雏形”。

长期看，Remi 还需要具备明确的能力扩展面：
- 插件系统 / capability system
- 直播平台接入
- 游戏接入
- 机器人 / IoT 接入
- 穿戴设备深度整合（watchOS 已有基础，AirPods / 耳机模式待接入）
- 特殊硬件接入

这些不是当前主线程，但架构上要避免把未来扩展堵死。

## 当前主线

**Web 端 10 分钟在场感体验** — 默认人格稳定 → 严肃场景承接 → Web 在场感统一 → 10 分钟压测。

详见 [CLAUDE.md](./CLAUDE.md)（开发入口）和 [TASKS.md](./docs/ops/TASKS.md)（执行看板）。

## 核心功能

- **自然语言对话** — 双脑架构（Fast Brain 低延迟流式回复 + Slow Brain 后台深度分析），支持多轮上下文
- **用户记忆** — 从对话中自动提取用户信息（姓名、城市、职业、偏好等），支持长期关系连续性
- **关系层 / Memory V2** — episode store、向量召回、主动策略规划主路径已接通；当前处于观察期与补验收证据阶段
- **情绪系统** — 基于关键词识别用户情绪，维护 AI 情绪状态（neutral / happy / curious / shy / sad / concerned / playful / thoughtful 共 8 种），影响回复风格与虚拟形象表现
- **语音输入（STT）** — 支持 Whisper API 和 whisper-cpp，实时双工 PCM 流式传输 + VAD 语音活动检测
- **语音输出（TTS）** — 支持 Edge TTS / Piper / OpenAI TTS / 火山 TTS，逐句流式合成
- **虚拟形象** — VRM 三维角色（Three.js）+ Live2D（Pixi.js）+ 情绪驱动；iOS 含 Metal 渲染骨架
- **实时通信** — WebSocket 全双工通信，支持打断控制、流式 token 推送、音频流传输
- **多端客户端** — Web（Next.js）、Desktop（Tauri v2 透明悬浮窗）、iOS（原生 Swift）、watchOS（情绪手环）四端共享同一 WebSocket 协议
- **watchOS 情绪手环** — 极简表情脸显示 Remi 情绪状态，PTT 语音交互 + haptic 反馈，HealthKit 主动关怀（心率异常/久坐检测），Complication 常驻表盘
- **3D Demo** — 独立 `/demo` 路由可离线切换模型、情绪、状态和动作，便于人工验收
- **长期扩展能力** — 目标上支持插件化 capability 接入，为直播、游戏、机器人和实体设备能力预留架构边界

## 技术栈

| 层级 | 技术 |
|------|------|
| 运行时 | Node.js + TypeScript |
| HTTP 网关 | Node.js `http` + Next.js + `ws` |
| 实时通信 | ws (WebSocket) |
| LLM | OpenAI 兼容 API（LM Studio / Qwen 等） |
| 语音识别 | Whisper API / whisper-cpp |
| 语音合成 | Edge TTS / Piper / OpenAI TTS |
| 数据库 | PostgreSQL + pgvector（向量语义检索） |
| 缓存 | Redis（ioredis） |
| 认证 | JWT（jsonwebtoken） |
| 日志 | pino 结构化日志 |
| 前端 | Next.js 15 + React 19 + Tailwind CSS v4 |
| 桌面客户端 | Tauri v2 + React 19 + Vite 6（双窗口：透明角色 + 聊天面板） |
| iOS 客户端 | Swift (SwiftUI)，原生 WebSocket + 语音双工 + Live2D |
| watchOS 客户端 | Swift (SwiftUI)，情绪表情脸 + PTT 语音 + HealthKit 关怀 |
| 前端（旧版） | 原生 HTML/CSS/JS |
| 部署 | Docker + Docker Compose |

## Quick Start

```bash
git clone https://github.com/jane-uske/remi.git && cd remi
npm install && npm install --prefix web
cp .env.localhost.example .env.localhost
# edit REMI_LLM_API_KEY + REMI_LLM_BASE_URL in .env.localhost
npm run dev             # open http://localhost:3001
```

Only 2 environment variables are required: `REMI_LLM_API_KEY` and `REMI_LLM_BASE_URL` (in `.env.localhost`).
No database, no Redis, no TTS key needed. Text chat works out of the box.
The model name auto-detects from your base URL (OpenAI → `gpt-4o-mini`, DashScope → `qwen-plus`).

### Advanced Setup

```bash
# Optional: local database + Redis for persistent memory
npm run dev:infra

# Optional: copy more tuning knobs from the full reference
# see .env.example (variable dictionary, not loaded directly)

# Standalone frontend dev (port 3001, backend on 3000)
npm run dev:web:standalone

# Type check only (no build output)
npm run typecheck
```

文档索引见 **[docs/README.md](docs/README.md)**（Agent 按需阅读表）。

浏览器远程开发与办公网实时预览见 **`docs/ops/REMOTE_DEV.md`**。
本机常驻小规模生产化部署（2-3 用户试用）见 **`docs/ops/LOCAL_PROD_DEPLOY.md`**。
新设备从零复现完整本地栈见 **`docs/guides/NEW_DEVICE_SETUP.md`**。
如果 Next 开发态缓存异常，可先执行 **`npm run dev:web:clean`** 再重启服务。

### 本地验证

```bash
# 后端健康检查
curl http://127.0.0.1:3001/health

# 冒烟：主页 + /health + WebSocket chat
node scripts/smoke.mjs

# 后端测试
npm test

# 前端测试
npm run test --prefix web
```

`/health` 现在由网关直接返回轻量 JSON（`ok` / `service` / `uptimeSec`），用于本地 smoke 和基础连通性检查，不表示 DB/Redis readiness。

### 访问与用户隔离（关键）

- `REMI_AUTH_MODE` 现在支持 `disabled / legacy_jwt / clerk` 三种模式；其中 `clerk` 用于 Web 正式登录闭环，`legacy_jwt` 继续兼容现有 token 客户端，`disabled` 保留开发态直连。
- 开启 `JWT_SECRET` 后，远程访问（如 `https://app-rem.remi.run`）必须带 token（query 或 `Authorization: Bearer`）。
- 本机回环访问是否允许无 token 进入，现由 `REMI_AUTH_ALLOW_LOOPBACK_BYPASS` 控制；默认开发开、生产关。
- 若同时配置了 `REMI_ACCESS_PASSWORD` 与正式 auth：有效 token 可直通访问，不再强依赖 access cookie 登录页。
- 但如果主域名已经切成 Clerk 正式入口，不建议再叠 `REMI_ACCESS_PASSWORD`；共享密码门禁只适合单独的开发/预发入口。
- Web 在 `NEXT_PUBLIC_REMI_AUTH_MODE=clerk` 且配置 `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` 时，正式域名会先走 Clerk 登录，再把 session token 透传给 WebSocket。
- `localhost` / `127.0.0.1` 若注入的是 Clerk `pk_live_...` production key，前端会自动退回本地开发口径，不再在 loopback 下强行启用 Clerk。也就是说：本地调开发功能，正式域名调真实登录。
- 环境文件拆分：开发只读 `.env.localhost`（端口 `3001`）；local-prod 只读 `.env.local-prod`（端口 `3000`）。模板见 `.env.localhost.example`、`.env.local-prod.example`；全量变量字典见 `.env.example`。
- WebSocket 会自动复用页面 URL 中的 `token` 参数，降低“页面可开但 WS 401 断连”风险。
- 前端聊天本地缓存按用户隔离：无 token 走默认缓存；带 token 时按 token 的 `id` 分桶，避免 `user_001` / `user_002` 共享同一份本地聊天历史。
- 3D 模型静态资源路径 `/vrm/*` 已加入鉴权放行，避免 VRM 请求被 `401` 拦截。
- `DATABASE_URL` / `REDIS_URL` 如果仍写着 Docker 服务名 `postgres` / `redis`，本机原生启动会自动回退到 `127.0.0.1` 再尝试连接；Docker 内仍按服务名解析。

### 实时语义约定

- `interrupt` 只表示“一个已激活 generation 被新输入抢占”，不再用于 idle 文本发送时的清队列。
- `chat_end` 只表示文本流结束，不等于本地音频已经播放完；前端会在播放 drain 后再回到 `confirmed_end`。
- 被打断的 assistant 半句只保留为 carry-forward 上下文，不进入正式 history、不进入 slow brain、也不会按正常 assistant 消息持久化。
- 跨连接记忆当前采用“session overlay”方式：会话启动时可从持久层预加载少量事实型记忆到本地副本，live path 只读本地副本，持久层写回异步进行。
- Memory V2 当前不是“准备切读路径”，而是“prompt recall / proactive 主路径已切到 V2，仍保留 snapshot/V1 fallback，并处于质量观察期”。

### 环境变量

| 变量 | 说明 |
|------|------|
| `key` | LLM API Key |
| `base_url` | LLM API Base URL |
| `model` | 模型名称 |
| `tts_provider` | TTS 后端（`edge` / `piper` / `openai` / `volc`） |
| `tts_voice` | TTS 音色 |
| `VOLC_TTS_API_KEY` | 火山引擎豆包语音新版控制台 API Key（`tts_provider=volc` 时） |
| `VOLC_TTS_RESOURCE_ID` | 火山 TTS 资源 ID（如 `seed-tts-2.0`） |
| `VOLC_TTS_VOICE_TYPE` | 火山 TTS 音色 ID（如 `zh_female_lingling_uranus_bigtts`） |
| `VOLC_TTS_ENABLE_DYNAMIC_STYLE` | 是否启用基于 `emotion + reply text` 的动态表达控制，默认 `1` |
| `VOLC_TTS_SPEECH_RATE` | 固定覆盖火山 `audio_params.speech_rate`；未设置时 Remi 会用略快一点的动态默认语速 |
| `VOLC_TTS_CONTEXT_TEXT` | 固定覆盖火山 `context_texts[0]`，用于手动锁定语气指令 |
| `VOLC_TTS_EMOTION` | 固定覆盖火山 `audio_params.emotion`，仅建议在确认音色支持时使用 |
| `VOLC_TTS_EMOTION_SCALE` | 固定覆盖火山 `audio_params.emotion_scale`，范围 `1-5` |
| `VOLC_TTS_SILENCE_DURATION` | 句尾额外静音时长（毫秒），用于控制尾音停顿，范围 `0-30000` |
| `VOLC_TTS_POST_PROCESS_PITCH` | 后处理音调微调，范围 `-12` 到 `12` |
| `TTS_EAGER_THRESHOLD` | 首句 eager 断句开始尝试软断点的长度阈值（默认 `24`）。 |
| `TTS_EAGER_LOOKAHEAD_CHARS` | 首句 eager 在阈值后额外观察多少字符来等一个更自然的软断点（默认 `10`）。 |
| `TTS_EAGER_SOFT_BREAK_MIN_CHARS` | 首句只有累计到这么长，才允许按 `，、；：~～…` 这类软断点提前送 TTS（默认 `24`）。 |
| `TTS_CHUNK_MAX_CHARS` | 首句 eager 之后，无硬句末标点时普通逐句 TTS 的强制分段长度。 |
| `stt_provider` | STT 后端（`openai` / `whisper-cpp`） |
| `whisper_model` | Whisper 模型路径 |
| `whisper_lang` | Whisper 语言 |
| `REMI_STT_FINAL_DISAMBIG_ENABLED` | 是否启用 `stt_final` 热词级局部同音消歧（默认 `0`，仅影响语音 final transcript） |
| `REMI_STT_FINAL_DISAMBIG_DICT_PATH` | 热词词表 JSON 路径；规则格式：`{ "id": "...", "canonical": "...", "aliases": ["..."] }` |
| `REMI_STT_FINAL_DISAMBIG_LOG_DIFF` | 命中纠偏时是否记录 `raw -> corrected` diff 日志（默认 `1`） |
| `DATABASE_URL` | PostgreSQL 连接串 |
| `REDIS_URL` | Redis 连接串 |
| `REMI_AUTH_MODE` | 认证模式：`disabled` / `legacy_jwt` / `clerk` |
| `JWT_SECRET` | JWT 签名密钥 |
| `REMI_AUTH_ALLOW_LOOPBACK_BYPASS` | 本机回环是否允许绕过正式登录（默认开发 `1`，生产 `0`） |
| `CLERK_JWT_KEY` | Clerk session token 公钥（服务端验签） |
| `CLERK_SECRET_KEY` | Clerk 服务端密钥（Web/服务端集成时需要） |
| `NEXT_PUBLIC_REMI_AUTH_MODE` | 前端认证模式；设为 `clerk` 时启用 Web 登录入口 |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk 前端 publishable key |
| `REMI_MOBILE_DEV_ENABLED` | 是否允许移动端开发 key 鉴权（默认 `0`）。用于 iOS/TestFlight 内测兜底，不建议生产开启。 |
| `REMI_MOBILE_DEV_KEY` | 移动端开发 key（配合 `X-Remi-Mobile-Key` 请求头使用）。 |
| `LOG_LEVEL` | 日志级别（默认 `info`） |
| `PORT` | 服务端口。`npm run dev` 默认 `3001`，`npm run prod:local:start` 默认 `3000`。 |
| `REMI_SILENCE_NUDGE_MS` | 用户无消息后多久由 Remi 主动搭话（毫秒）；`0` 或不设为关闭 |
| `REMI_SILENCE_NUDGE_MIN_TURNS` | 至少聊过几轮才允许沉默搭话（默认 `2`） |
| `REMI_LOCAL_LLM_ENABLED` | 本地 OpenAI 兼容 LLM 总开关；设为 `0`/`false` 时，主回复、slow brain、prediction 都不再调用本地 LLM。 |
| `REMI_SLOW_BRAIN_ENABLED` | 是否启用 slow brain 后台分析（默认 `1`）。设为 `0`/`false` 可关闭后台提炼，避免与 fast path 抢同一模型预算。 |
| `REMI_PROACTIVE_PLANNER_MAIN_PATH_ENABLED` | 是否让沉默搭话主路径优先走 V2 proactive planner（默认 `1`）。关闭时回退到 legacy nudge plan。 |
| `REMI_EPISODE_STORE_PROMPT_ENABLED` | 是否让 prompt recall 优先走 V2 `episodeStore.findRelevant()`（默认 `1`）。关闭时回退 snapshot/V1 recall。 |
| `REMI_EPISODE_LIFECYCLE_ENABLED` | 是否启用 V2 `episode` lifecycle 状态机（默认 `0`）。开启后才会使用 `active / cooling / resolved` 收口。 |
| `REMI_WORKING_MEMORY_ENABLED` | 是否启用显式 `workingMemory` prompt block（默认 `0`）。开启后会注入 `【当前上下文】`。 |
| `REMI_AVATAR_INTENT_ENABLED` | 是否启用 reply-based avatar intent 推断（默认 `1`）。设为 `0`/`false` 时不再发送 `avatar_intent`，但主回复/TTS/turn lifecycle 不变。 |
| `REMI_PERSISTENT_MEMORY_OVERLAY_ENABLED` | 是否启用持久记忆 overlay（默认 `1`）。数据库可用时，会话启动阶段预加载少量事实型记忆到本地副本；设为 `0`/`false` 则完全回到纯会话内 memory。 |
| `REMI_PERSISTENT_MEMORY_PRELOAD_LIMIT` | 持久记忆启动预加载上限（默认 `12`）。prompt 仍会继续受 `MAX_PROMPT_MEMORY_ENTRIES` 裁剪。 |
| `STT_PARTIAL_PREDICTION_ENABLED` | 是否启用 partial transcript 预判（默认关闭）。设为 `1`/`true` 后才会触发额外 prediction 调用。 |
| `STT_PREDICTION_PUSH_ENABLED` | 是否把 prediction 结果以 `stt_prediction` 推到前端（默认关闭）。只有 `STT_PARTIAL_PREDICTION_ENABLED` 已开启时才生效。 |
| `STT_PREDICTION_DEBOUNCE_MS` | partial prediction 的防抖毫秒数（默认 `300`）。 |
| `REMI_FAST_BRAIN_MODEL` | fast brain / prediction 单独使用的模型；不设则复用 `model`。适合只给实时链路切轻模型。 |
| `REMI_FAST_BRAIN_REASONING_EFFORT` | fast brain / prediction 调用的 reasoning 强度覆盖；本地默认可切 `minimal` 以压首个可见正文。 |
| `TURN_PROSODY_ENABLED` | 是否启用 prosody 辅助 turn-taking（当前默认 `1`）。关闭时退回无韵律旁路的规则判断。 |
| `NEXT_PUBLIC_VRM_URL` | （前端）自定义 VRM 路径；不设则使用 `web/public/vrm/` 下默认模型。根目录 `npm run dev:web:standalone` 时 `next.config` 会读取**仓库根** `.env`。 |
| `NEXT_PUBLIC_WS_URL` | WebSocket 地址，须含 `ws://` 或 `wss://`（勿写 `localhost:3000/ws` 无前缀）。 |
| `NEXT_PUBLIC_VRM_YAW` | VRM 绕 Y 轴旋转（弧度），模型背对镜头时可调。 |
| `NEXT_PUBLIC_VRM_FRAMING` | `full`（默认）全身；`upper` 上半身特写。 |
| `NEXT_PUBLIC_VRM_DISABLE_NODE_CONSTRAINT` | 默认禁用 `VRMC_node_constraint`（避免手臂被约束拉回展示姿势）；设为 `0` 恢复。 |
| `REMI_NEXT_HOSTNAME` | 传给 Next 的主机名（勿含端口）；见 `.env.example`。 |

前端排障与实现细节见 **`web/docs/FRONTEND_PITFALLS.md`**。

补充说明：
- default-user 的开发面板现在支持**当前 websocket 会话级**的 Volc 音色切换。
- 这只会覆盖当前连接里的 `VOLC_TTS_VOICE_TYPE`，不改 `.env`，也不需要重启服务。
- 断开连接后会自动回到环境默认音色，不会持久写进数据库或用户设置。
独立 3D 验收页见 **`/demo`**。

## 项目目录

```
remi/
├── server/
│   ├── server.ts              # 服务入口，负责全局初始化和网关启动
│   ├── gateway/               # HTTP + Next.js + WebSocket 网关（含 /health）
│   ├── session/               # 每连接会话、VAD、turn state、打断接入点
│   └── pipeline/              # runPipeline，LLM/TTS/持久化编排
├── agents/
│   └── conversation_agent.ts  # 对话 Agent 门面
├── brains/
│   ├── context_orchestrator.ts    # 上下文编排（情绪 + 记忆 + 快慢路径调度，原 brain_router）
│   ├── reply_stream.ts            # 低延迟流式 LLM 回复（原 fast_brain）
│   ├── background_analysis.ts     # 后台对话分析与长期上下文（原 slow_brain）
│   ├── background_analysis_store.ts # 分析结果存储（每连接实例）
│   ├── proactive_planner.ts       # V2 主动策略规划
│   └── remi_session_context.ts    # 每连接情绪 + 后台分析 + 历史 + 会话记忆
├── brain/
│   ├── personality.ts         # Remi 人设定义
│   ├── character_rules.ts     # 说话风格规则
│   └── prompt_builder.ts      # Prompt 组装（人设 + 规则 + 情绪 + 记忆 + 历史）
├── llm/
│   └── qwen_client.ts         # OpenAI 兼容流式 LLM 客户端
├── memory/
│   ├── memory_agent.ts        # 记忆召回（episode store 主路径 + 向量补充两层）
│   ├── memory_store.ts        # 内存 KV 记忆存储（InMemoryRepository）
│   ├── session_memory_overlay.ts # 会话内本地优先 overlay：启动预加载 + 异步写回持久层
│   ├── memory_repository.ts   # MemoryRepository 接口定义
│   └── memory_decay.ts        # 记忆衰减与遗忘（重要性 × 频率 × 时间）
├── emotion/
│   ├── emotion_engine.ts      # 情绪识别（关键词 + 标点）
│   ├── emotion_runtime.ts     # 每连接情绪状态与强度（C1）
│   └── emotion_state.ts       # Emotion 类型别名（8 种情绪）
├── voice/
│   ├── stt_stream.ts          # STT（Whisper API / whisper-cpp，WebM + PCM 双模式）
│   ├── tts.ts                 # TTS（Edge / Piper / OpenAI 三后端）
│   ├── tts_stream.ts          # TTS 管线封装（支持 AbortSignal + 情绪参数）
│   ├── tts_emotion.ts         # TTS 情绪语音适配（rate / pitch / speed 映射）
│   ├── vad_detector.ts        # 语音活动检测（RMS 能量阈值）
│   └── interrupt_controller.ts # 管线打断控制（AbortSignal 状态机）
├── utils/
│   └── sentence_chunker.ts    # 流式断句（用于逐句 TTS）
├── storage/
│   ├── database.ts            # PostgreSQL 连接池 + 健康检查
│   ├── redis.ts               # Redis 客户端（ioredis）+ 缓存封装
│   ├── schema.sql             # 数据表定义（users / sessions / messages / memories）
│   ├── types.ts               # 存储层类型（DbUser / DbSession / DbMessage / DbMemory）
│   ├── index.ts               # 存储层统一导出
│   └── repositories/
│       ├── message_repository.ts  # 消息持久化
│       ├── session_repository.ts  # 会话管理
│       └── memory_repository.ts   # 记忆持久化（pgvector 语义检索）
├── infra/
│   ├── auth.ts                # JWT 认证中间件 + WebSocket 认证
│   ├── rate_limiter.ts        # HTTP + WebSocket 限流
│   ├── logger.ts              # pino 结构化日志
│   ├── latency_tracer.ts      # 语音主链路延迟指标（speech_end→stt_final→llm→tts→playback）
│   └── emotion_logger.ts      # 情绪日志（环形缓冲区）
├── avatar/
│   ├── types.ts               # Avatar 驱动协议（FaceParams / Viseme / AvatarFrame）
│   ├── emotion_mapper.ts      # 情绪 → 表情映射 + 平滑过渡
│   ├── action_triggers.ts     # 语义 → 动作触发（点头 / 摇头 / 挥手等）
│   ├── avatar_controller.ts   # Avatar 控制器
│   ├── index.ts               # Avatar 统一导出
│   └── assets/                # SVG 表情头像（neutral/happy/curious/shy/sad）
├── public/                    # 旧版原生 JS 前端
├── web/                       # Next.js 前端（npm workspace）
│   ├── docs/                  # 前端踩坑与排障（FRONTEND_PITFALLS.md）
│   ├── src/components/        # RemiChatApp、Remi3DAvatar、输入栏等
│   ├── src/hooks/             # useRemiChat（WebSocket）、useAudioBase64Queue
│   ├── src/lib/               # wsUrl、rem3d（VRM viewer + Live2D viewer）
│   └── src/types/             # 消息类型定义
├── desktop/                   # Tauri v2 桌面客户端（npm workspace）
│   ├── src/                   # React 前端（双窗口：CharacterApp + ChatPanelApp）
│   └── src-tauri/             # Rust 后端（透明窗口 + 系统托盘 + 窗口联动）
├── ios/                       # 原生 Swift 客户端
│   └── RemiChatLite/          # iOS 主应用
│       ├── RemiChatLite/      # SwiftUI 界面 + WebSocket 传输 + 语音双工 + Live2D 骨架
│       ├── RemiWatch/         # watchOS 应用（情绪表情脸 + PTT 语音 + HealthKit）
│       └── RemiWatchWidget/   # watchOS 表盘 Complication（WidgetKit）
├── docker/                    # Dockerfile + compose 文件（见 docker/README.md）
├── package.json
├── tsconfig.json
└── docs/                      # 索引见 docs/README.md
    ├── ops/       # TASKS, CURRENT_FOCUS, LOCAL_PROD_DEPLOY
    ├── guides/    # NEW_DEVICE_SETUP, LOCAL_LLM, PLUGIN, TEST_MAP
    ├── design/    # ARCHITECTURE, PIPELINE, MEMORY_V2_DESIGN
    ├── evals/     # 手工测试与对话样例
    └── archive/   # 历史记录
```

## 开发进度

| 阶段 | 目标 | 状态 |
|------|------|------|
| P0 | 基础对话 + 流式回复 | **已完成** |
| P0 | 双脑架构（快脑 + 慢脑） | **已完成** |
| P0 | WebSocket 实时通信 + 打断控制 | **已完成** |
| P1 | 情绪识别与情感回复 | **已完成** |
| P1 | 语音输入（STT + VAD + 全双工 PCM） | **已完成** |
| P1 | 语音输出（TTS 多后端 + 情绪语调适配） | **已完成** |
| P1 | 内存记忆提取 + 记忆衰减 | **已完成** |
| P1 | SVG 表情头像 + 情绪映射 | **已完成** |
| P1 | Next.js 前端 | **已完成** |
| P2 | 记忆持久化（PostgreSQL + pgvector） | **已完成**（可选启用） |
| P2 | 语义记忆检索（向量数据库） | **已完成**（可选启用） |
| P2 | TTS 情绪语调适配 | **已完成** |
| P2 | 情绪日志记录 | **已完成** |
| P3 | Avatar 驱动协议 + 动作触发 + 控制器 | **已完成** |
| P3 | 口型同步（TTS lip sync cue → Live2D/VRM） | **已完成**（服务端 viseme 生成 + Web/iOS 消费） |
| P4 | JWT 认证 + Clerk 登录 + 限流 | **已完成** |
| P4 | 结构化日志（pino） | **已完成** |
| P4 | Docker 容器化部署 | **已完成** |
| P5 | Tauri v2 桌面客户端（透明角色窗 + 聊天面板） | **已完成**（脚手架 + 双窗口联动） |
| P5 | iOS 原生客户端（WebSocket + 语音双工 + Live2D 骨架） | **已完成**（Cubism SDK 待接入） |
| P5 | watchOS 客户端（情绪手环：表情脸 + PTT + HealthKit） | **已完成**（代码完成，待 Xcode 建 target） |
| P5 | watchOS Complication（WidgetKit 表盘组件） | **已完成** |

### 当前阶段判断

- **实时语音与打断体验**：已经不是 demo 级，属于可持续优化的 Beta 前期能力
- **Memory V1 / 关系层第一阶段**：已完成并验收
- **Memory V2 / relationship episode store**：基础设施已完成，正在验证写路径并准备迁移读路径
- **3D / 在场感表现层**：已有可用 MVP，但还不是最终沉浸态
- **多端覆盖**：Web + Desktop + iOS + watchOS 四端代码已就绪，服务端已支持 `web` / `ios_lite` / `watch` 三种客户端类型自动协商

如果只用一句话概括当前项目状态：

**Remi 已经从”能跑通的系统原型”进入”围绕活人感持续打磨的产品原型”阶段，并完成了跨终端存在的基础架构。**

> 主管线已拆分为 `server/gateway` / `session` / `pipeline`，多数模块已集成；细节见 [ARCHITECTURE.md](docs/design/ARCHITECTURE.md)。历史优化记录与阶段性工程日志已归档到 [docs/archive/OPTIMIZATION.md](docs/archive/OPTIMIZATION.md)。

## 当前已收口的体验/观测点

- 打断语义已收口：真实用户打断与 slow-brain cancel 已分离。
- turn lifecycle 已收口：`interrupt`、`chat_end`、`assistant_speaking`、`confirmed_end` 的职责不再混用。
- latency tracer 已固定输出 shape，便于做前后版本对比。
- duplex harness 已固定场景名，便于回归比较。
