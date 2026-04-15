# Remi AI — 系统架构

## 产品总纲与架构映射

Remi 的终极目标，不是做一个更会聊天的 App。
而是成为一个跨终端持续在线、具备人格连续性与长期记忆、能像真人一样自然交流并长期陪伴用户的 AI 存在。

所以理解这份架构文档时，不要只看模块分层，还要看它们分别服务哪一层产品目标：

### 1. 实时交互层
回答的问题是：“她现在像不像一个真的在和我说话的人？”

对应模块：
- `server/session/*`
- `server/pipeline/*`
- `voice/*`
- `brains/fast_brain.ts`
- 前端播放、turn state、打断与 avatar 状态同步

### 2. 人格记忆层
回答的问题是：“过一段时间回来，她还是不是同一个人？”

对应模块：
- `memory/*`
- `brains/slow_brain.ts`
- `brains/slow_brain_store.ts`
- `brain/prompt_builder.ts`
- `storage/repositories/*`

### 3. 跨终端存在层
回答的问题是：“我换了设备、场景和入口后，她还能不能持续存在并接上？”

当前这层还不是主线程，但架构已经要为它留边界。
对应关注点：
- gateway / session 的身份与连接语义
- reconnect restore
- 持久化状态与会话恢复
- proactive / nudge 的服务端触发能力
- generation / playback / interrupt 语义未来能否迁移到多终端

当前主线程是“人格记忆层”的 Memory V2 验证与读路径迁移，但它必须在不伤害“实时交互层”的前提下推进，并给“跨终端存在层”留下演进空间。

## 长期扩展方向：插件 / Capability / Integration Boundary

Remi 后期不只会存在于网页聊天界面。
它需要能接入：
- 直播平台
- 游戏
- 机器人
- IoT / 穿戴设备
- 特殊硬件

这会给架构带来一个明确要求：
核心系统必须和外部能力系统解耦。

推荐边界是：
- `core conversation loop`
  - session
  - pipeline
  - fast / slow brain
  - memory / relationship state
- `capability layer`
  - 对外提供标准化动作、感知、事件和状态接口
- `integration / plugin layer`
  - 具体平台 SDK、机器人驱动、游戏桥接、直播平台桥接

原则：
- 核心 loop 不直接依赖具体平台 SDK
- 设备控制与平台 API 不直接散落在 session / pipeline 里
- 外部能力应尽量通过 adapter / plugin 方式注册
- capability 的输入输出语义要稳定，便于未来跨终端复用

## 架构总览

```
┌─────────────────────────────────────────────────────────────┐
│                     Client Layer                            │
│         Next.js (web/)  ·  Legacy (public/)                 │
│  ┌──────────┐ ┌──────────┐ ┌────────┐ ┌────────────────┐   │
│  │ ChatWindow│ │ InputBar │ │ Avatar │ │VoiceIndicator  │   │
│  └──────────┘ └──────────┘ └────────┘ └────────────────┘   │
│       useRemiChat (WebSocket)  ·  useAudioBase64Queue        │
│       pcmCapture (16kHz mono Int16)                         │
└────────────────────┬────────────────────────────────────────┘
                     │ WebSocket (ws)
                     │ text / audio_stream / duplex_start|stop
                     ▼
┌────────────────────────────────────────────────────────────────┐
│                    server/gateway/                             │
│          HTTP + Next.js + WebSocket Gateway                    │
│  ┌───────────────┐  ┌──────────────┐  ┌─────────────────────┐ │
│  │ 消息路由       │  │ 会话创建      │  │ send() to client    │ │
│  │ (type-based)  │  │ onConnection  │  │                     │ │
│  └───────┬───────┘  └──────────────┘  └─────────────────────┘ │
└──────────┼─────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│                  server/session/                           │
│              ConnectionSession (per conn)                   │
│  RemSessionContext: emotion + slow brain + history + memory │
│  ┌──────────────┐ ┌──────────────┐ ┌───────────────────┐  │
│  │ STT Stream   │ │ VAD Detector │ │ InterruptCtrl     │  │
│  │ bootstrap/*  │ │ message_router│ │ AvatarController │  │
│  │ continuity/* │ │ duplex_audio  │ │ turn_state/*     │  │
│  └──────┬───────┘ └──────┬────────┘ └─────────┬─────────┘  │
└─────────┼────────────────────┼────────────────────┼────────────┘
          │                    │                    │
          └────────────────────┼────────────────────┘
                               │
                               ▼
                    ┌──────────────────┐
                    │ server/pipeline/ │
                    │   runPipeline()  │
                    └────────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
    ┌──────────────┐ ┌──────────────┐ ┌────────────────┐
    │ Emotion      │ │ Memory       │ │ Brain Router   │
    │ Engine       │ │ Agent        │ │                │
    │              │ │              │ │ ┌────────────┐ │
    │ updateEmotion│ │ extractMemory│ │ │ Fast Brain │ │
    │ decayEmotion │ │ retrieveMemory│ │ │ (streaming)│ │
    │              │ │              │ │ └────────────┘ │
    │ ┌──────────┐ │ │ ┌──────────┐ │ │ ┌────────────┐ │
    │ │ Emotion  │ │ │ │ Memory   │ │ │ │ Slow Brain │ │
    │ │ State    │ │ │ │ Store    │ │ │ │(background)│ │
    │ └──────────┘ │ │ └──────────┘ │ │ └────────────┘ │
    └──────┬───────┘ └──────┬───────┘ └───────┬────────┘
           │                     │                      │
           │              ┌──────┘                      │
           ▼              ▼                             ▼
    ┌─────────────────────────────┐        ┌─────────────────────┐
    │    Prompt Builder           │        │   LLM Client        │
    │ personality + rules +       │───────►│   (OpenAI compat)   │
    │ emotion + memory + history  │        │   streamTokens()    │
    └─────────────────────────────┘        └──────────┬──────────┘
                                                      │
                                            streaming tokens
                                                      │
                                                      ▼
                                           ┌─────────────────────┐
                                           │ SentenceChunker     │
                                           │ (逐句切分)           │
                                           └──────────┬──────────┘
                                                      │
                                                      ▼
                                           ┌─────────────────────┐
                                           │ TTS Service         │
                                           │ Edge/Piper/OpenAI   │
                                           │ (with emotion params)│
                                           └──────────┬──────────┘
                                                      │
                                            base64 audio chunks
                                                      │
                                                      ▼
                                                   Client
                                           (text + audio + emotion)
```

## 模块详解

### 1. Gateway — `server/gateway/`

HTTP + Next.js + WebSocket 网关层，负责创建服务器、连接升级和基础健康检查。

| 职责 | 实现 |
|------|------|
| HTTP 服务 | Node.js `http` + Next.js 集成 |
| WebSocket | ws 库 noServer 模式，`/ws` 路径升级 |
| 健康检查 | `GET /health` 直接返回轻量 JSON |
| `send()` | 向客户端发送 WebSocket 消息 |
| ServerMessage | 消息类型定义 |

### 2. Session — `server/session/`

每个 WebSocket 连接独立的会话管理。

| 职责 | 实现 |
|------|------|
| ConnectionSession 类 | 仍是每个连接的主 orchestrator；含 `brain: RemiSessionContext`、turn state、duplex state、prediction state |
| `bootstrap.ts` / `history.ts` / `lifecycle.ts` | 负责 async bootstrap、history 分页发送、close/cleanup 边界 |
| `message_router.ts` | 按 type 分发 WS 消息，并解析 RAUD/legacy PCM binary frame |
| `continuity.ts` / `developer.ts` | 负责 silence nudge、relationship continuity 持久化、dev preset/reset helpers |
| `voice_submit.ts` / `turn_state_protocol.ts` / `duplex_audio.ts` | 负责 voice final 提交、turn_state 协议发布、duplex raw-buffer/no-vad helper |

当前判断：
- `server/session/index.ts` 仍然是高风险热点，但已经不再同时承载 bootstrap/history/cleanup/turn_state protocol/dev preset 这些外围层。
- 真正的实时复杂度仍然主要在 VAD event flow、prediction、duplex state machine、turn-taking 决策。

### 3. Pipeline — `server/pipeline/`

核心对话管线执行逻辑。

| 职责 | 实现 |
|------|------|
| `runPipeline()` | 情绪更新 → LLM 流式 → 逐句 TTS → 推送客户端 |
| 情绪更新 | `updateEmotion()` + Avatar 表情过渡 |
| 消息持久化 | DB 可用时保存 user 消息；assistant 仅在非中断完成态保存 |
| Avatar 动作 | 从回复文本检测动作并推送 |
| 情绪衰减 | 回复后调用 `decayEmotion()` |

### 4. Server 入口 — `server/server.ts` (~80 行)

系统入口，负责全局初始化和启动。

| 职责 | 实现 |
|------|------|
| Bootstrap | 导入并启动各层 |
| 全局初始化 | Memory Decay 定时器、DB、Redis（可选）|
| 优雅关闭 | SIGINT/SIGTERM 清理资源 |
| 网关回调 | `onConnection()` → `createSession()` |

**WebSocket 消息协议：**

```
// 客户端 → 服务端
{ type: "chat", content: string }                // 文本消息
{ type: "duplex_start", sampleRate?: number }    // 开始实时语音
<RAUD PCM binary frame>                          // PCM 音频流（主路径）
{ type: "audio_stream", audio: base64 }          // 兼容回退路径
{ type: "duplex_stop" }                          // 结束实时语音
{ type: "playback_start", generationId?: number } // 客户端确认本地播放开始

// 服务端 → 客户端
{ type: "emotion", emotion: string }
{ type: "chat_chunk", content: string, generationId: number }
{ type: "chat_end", generationId: number, emotion?: string, content?: "[interrupted]" }
{ type: "voice", audio: base64, generationId?: number }
{ type: "voice_pcm_chunk", audio: base64, sampleRate: number, generationId: number }
{ type: "interrupt", generationId?: number }
{ type: "stt_partial", content: string }
{ type: "stt_prediction", status: "finished", preview: string }
{ type: "stt_final", content: string }
{ type: "vad_start" }
{ type: "vad_end" }
{ type: "turn_state", state: RemTurnState, reason: RemTurnStateReason, generationId?: number }
{ type: "avatar_frame", frame: ... }
{ type: "avatar_intent", intent: ..., beats?: [...] }
{ type: "error", content: string }
```

**协议语义约定：**

- `interrupt` 只在抢占一个已激活 generation 时发送，不再用于 idle 文本发送时的“清队列”。
- `chat_end` 只表示文本流结束，不表示客户端本地播放已经完成。
- `turn_state` 是前后端共享的主状态语义，`confirmed_end` 允许晚于 `chat_end`。

### 5. 双脑系统 — `brains/`

核心对话架构，分为快脑和慢脑协同工作。

**Brain Router (`brain_router.ts`)**

中央调度器，每次用户消息触发：
1. 更新情绪状态
2. 提取 + 检索记忆
3. 获取慢脑上下文（上一轮分析结果）
4. 调用快脑流式生成回复
5. 仅在非中断完成态维护正式对话历史（滑动窗口，最近 10 轮）
6. 仅在非中断完成态异步触发慢脑后台分析

**Fast Brain (`fast_brain.ts`)**

低延迟路径，直接面向用户：
- 通过 Prompt Builder 组装完整 prompt
- 注入慢脑上下文作为"长期观察"
- 调用 LLM 流式生成
- 支持 AbortSignal 中断

**Slow Brain (`slow_brain.ts`)**

后台异步分析，不阻塞回复：
- 维护 `longTermContext` 缓冲区（最多 10 条，去重）
- 二次记忆提取
- 对话分析：话题识别、里程碑检测（每 5 轮）、情绪倾向判断
- 结果在下一轮对话中被快脑消费

### 6. Prompt 构建 — `brain/`

**Personality (`personality.ts`)** — Remi 的核心人设定义

**Character Rules (`character_rules.ts`)** — 说话风格规则（简短、自然、会提问）

**Prompt Builder (`prompt_builder.ts`)** — 组装完整 prompt：

```
System Prompt:
├── 人设（personality）
├── 说话规则（character rules）
├── 情绪风格（EMOTION_STYLE map）
├── "用中文回复"
└── 用户记忆（key-value 列表）

Messages:
├── [system prompt]
├── [对话历史 ...]
└── [用户最新消息]
```

情绪风格映射（`EMOTION_STYLE`）让 AI 根据当前情绪调整回复语气。

### 7. LLM 客户端 — `llm/qwen_client.ts`

OpenAI 兼容的流式聊天客户端。

| 特性 | 说明 |
|------|------|
| 接口 | OpenAI SDK，兼容 LM Studio / Qwen / 任意 OpenAI 兼容 API |
| 流式输出 | `streamTokens()` 异步生成器，逐 token yield |
| `<think>` 过滤 | 自动剥离模型的 `<think>...</think>` 推理标签 |
| 中断支持 | 接受 AbortSignal |
| 参数 | temperature 0.7, max_tokens 1024 |

### 8. 记忆系统 — `memory/`

**Memory Agent (`memory_agent.ts`)**

从用户消息中通过正则匹配提取结构化信息：
- 姓名、城市、年龄、职业
- 偏好（喜欢/不喜欢）
- 其他模式匹配
- 慢脑二次提取补充

**Memory Repository (`memory_repository.ts`)**

统一记忆存储接口：
- `upsert(key, value)` / `getAll()` / `getByKey()` / `delete()` / `touch()` / `getStale()`
- `InMemoryRepository`（`memory_store.ts`）：进程内基础实现
- `SessionMemoryOverlayRepository`（`session_memory_overlay.ts`）：每连接本地优先 overlay，支持启动预加载和异步写回持久层
- `PostgreSQL 实现`（`storage/repositories/memory_repository.ts`）：持久化 + pgvector 向量语义检索

**Relationship State（关系层持久化）**

- `memory/relationship_state.ts`：定义用户级 `PersistentRelationshipStateV1` 持久化契约、序列化/反序列化、功能开关
- `brains/slow_brain_store.ts`：聚合 `relationship` / `topic` / `mood` / `proactive` 运行时状态，并输出 `synthesizeContext()` 与 `buildConversationStrategyHints()`
- `brains/slow_brain.ts`：在**非中断完成态**结束后异步写回 relationship state 到持久层
- `brains/rem_session_context.ts`：提供 `hydratePersistentRelationshipState(...)` 作为恢复入口，将持久化状态注入 `SlowBrainStore` 和 `persona.liveState`
- `server/session/index.ts`：session 初始化时异步加载并恢复（见下文恢复链路）

### 关系状态恢复链路 (R-002)

**恢复入口与执行时机：**
- 链路位置：`ConnectionSession.initializeAsync()` → 数据库就绪后 → `loadPersistentRelationshipState()` → `brain.hydratePersistentRelationshipState()`
- 执行时机：新 WebSocket 连接建立、session 创建之后，等待 first user input 之前
- 调用方：服务端 session 初始化异步流程，不阻塞连接建立

**降级行为（恢复失败时）：**
- 数据库不可用 → 跳过恢复，使用空初始状态
- 加载抛出异常 → 打 warn 日志，跳过恢复，使用空初始状态
- 加载返回 null（无持久化状态）→ 跳过，使用空初始状态
- 反序列化验证失败 → 打 warn 日志，跳过恢复，不影响新建连接使用
- 无论加载成功与否，后续正常交互时仍会在每轮结束后写回新状态

**谁持有状态：**
- 持久化：存在 `MemoryRepository` 中，key 为 `__rem_relationship_state_v1`（系统键，用户可见记忆不混存）
- 运行时：每个 connection 的 `brain.slowBrain: SlowBrainStore` 持有反序列化后的运行时状态
- 写回：仅在**非中断完成态**（interrupted = false）结束后异步调用 `savePersistentRelationshipState()`

### Prompt 消费链路 (R-003)

关系状态通过两个步骤进入 prompt：

1. **`slow_brain_store.synthesizeContext()` → 长期关系上下文**
   - 输出完整字符串，包含：
     - 关系阶段总结（familiarity / emotional bond / turn count）
     - 最近话题连续性（last topic summary / mood trajectory）
     - 共享重要时刻（shared moments 按 salience 排序，取 top 2）
     - 活跃话题线程（active episodes / core episodes）
   - 放在 system prompt 的**高优先级位置**（personality 之后，记忆之前）
   - 由 `fast_brain.ts` 消费，拼接到 prompt 中作为 `slowBrainContext`

2. **`slow_brain_store.buildConversationStrategyHints()` → 本轮说话策略**
   - 输出针对当前交互的策略提示：
     - 是否应该追问用户
     - 关系熟悉度对应的说话语气建议
     - 情绪轨迹提示（最近用户情绪变化）
     - 主动开口的线索提示
   - 由 `prompt_builder.ts` 消费，放在 system prompt 最前段，LLM 能第一时间读到

**分层原则：**
- 长期上下文 → `synthesizeContext()` → 一次性注入整段文字
- 本轮策略 → `buildConversationStrategyHints()` → 针对当前交互的动态建议

### 中断污染保护规则 (R-005)

**哪些状态绝对不能被 interrupted partial 修改：**

| 状态 / 数据 | 是否允许 interrupted partial 写入 | 原因 |
|-----------|----------------------------------|------|
| `formal history` | ❌ 不允许 | 被打断的半句不完整，不能作为正式历史 |
| `slow_brain` 分析 | ❌ 不允许 | slow brain 需要完整对话才能分析，partial 会产出垃圾分析 |
| `relationship_state` 持久化 | ❌ 不允许 | 关系状态是累积的正式状态，只在完整一轮结束后写入 |
| 持久层 `MemoryRepository` | ❌ 不允许 | 只有完整 user + 完整 assistant 才能提取记忆 |
| `lastInterruptedReply` | ✅ 允许 | 用于 carry-forward 上下文，这是预期用途 |
| `currentAssistantDraft` | ✅ 允许 | 正在生成中的草稿，用于打断瞬间承接 |

**保护机制已经在代码中实现：**
- `runPipeline` 仅在 `!isInterrupted` 时才会调用 `persistRelationshipContinuityState()`
- `slow_brain.ts` 的分析仅在 `!interrupted` 时才会写回 `relationshipState`
- 这一规则不改变现有 interrupt 语义，只是明确持久化边界

当前已确认现状（Memory V1 完成后）：
- relationship state 的持久化写回 ✅ 已完成
- relationship 恢复链路 ✅ 已完成（session init → load → hydrate）
- 记忆召回 ✅ 已升级为 relationship-aware 分层召回（`core facts → core episode → active episode → recent shared moment → fallback facts`）
- prompt 消费 ✅ 已完成（`synthesizeContext` + `buildConversationStrategyHints` 双层注入）
- 中断污染保护 ✅ 已完成（仅非中断完整轮次才写回正式状态）

**Memory Decay (`memory_decay.ts`)**

记忆衰减与遗忘：
- `decayScore`：重要性 × 访问频率 × 时间衰减
- `runDecay`：超出上限淘汰低分条目 + 清理极低分条目
- `startDecayTimer` / `stopDecayTimer`：定时任务

### 9. 情绪系统 — `emotion/`

**Emotion Engine (`emotion_engine.ts`)**

| 功能 | 实现 |
|------|------|
| 情绪识别 | 关键词规则：开心词 → happy，疑问词 → curious，难过词 → sad，害羞词 → shy |
| 标点辅助 | `?` → curious, `!` → happy, 默认 → neutral |
| 情绪衰减 | `decayEmotion()`：happy→neutral, curious→neutral, shy→neutral, sad→neutral |
| 情绪日志 | EmotionLogger 记录状态变化 |

**Emotion type (`emotion_state.ts`) + `EmotionRuntime` (`emotion_runtime.ts`)**

- `emotion_state.ts`：仅导出 `Emotion` 类型（5 种标签）。
- `EmotionRuntime`：每条连接独立实例，持有当前情绪与强度；`updateEmotion` / `decayEmotion` 接收 runtime 而非全局变量。

```
              ┌───────────┐
       ┌─────►│  happy    ├──decay──┐
       │      └───────────┘         │
       │                            ▼
  ┌────┴─────┐              ┌───────────┐
  │ neutral  │◄──decay──────│   sad     │
  └────┬─────┘              └───────────┘
       │                            ▲
       │      ┌───────────┐         │
       ├─────►│ curious   ├──decay──┘
       │      └───────────┘
       │      ┌───────────┐
       └─────►│   shy     ├──decay──┘
              └───────────┘
```

### 10. 语音输入 — `voice/stt_stream.ts` + `voice/vad_detector.ts`

**SttStream**

| 模式 | 说明 |
|------|------|
| 旧版 WebM | `feed(chunk)` + `end()` — 收集 WebM 块后一次性识别 |
| 双工 PCM | `feedPcm(base64)` + `endPcm()` — 实时 PCM 流，VAD 触发后识别 |

| 后端 | 说明 |
|------|------|
| `openai` | Whisper API，临时文件上传 |
| `whisper-cpp` | 本地 whisper-cli，支持 ffmpeg 重采样 |

**VadDetector**

能量阈值 VAD：
- 计算 16-bit PCM 帧的 RMS 能量
- 超过阈值连续 N 帧 → `speech_start` 事件
- 低于阈值连续 M 帧 → `speech_end` 事件
- 语音开始时可触发管线打断

### 11. 语音输出 — `voice/tts.ts` + `voice/tts_stream.ts` + `voice/tts_emotion.ts`

**TTS 多后端支持：**

| 后端 | 说明 |
|------|------|
| `edge` (默认) | node-edge-tts，微软 Edge 免费语音 |
| `piper` | 本地 Piper TTS，spawn 子进程生成 WAV |
| `openai` | OpenAI TTS API |

**流式处理链：**

```
LLM tokens → SentenceChunker（按 。！？.!? 断句）→ 逐句 TTS → base64 音频 → 客户端
```

**文本预处理** (`normalizeTtsText`)：剥离 emoji，限制最大字符数，智能在标点处截断。

**情绪语音适配** (`tts_emotion.ts`)：
- Emotion → EmotionVoiceParams 映射（rate / pitch / lengthScale / speed）
- Edge TTS：情绪状态 → rate + pitch 参数
- Piper：情绪状态 → length_scale + noise_scale
- OpenAI：情绪状态 → speed
- `synthesize` 支持 emotion 参数透传

### 12. 打断控制 — `voice/interrupt_controller.ts`

管线状态机：`idle` → `generating` → `speaking` → `idle`

| 方法 | 说明 |
|------|------|
| `begin()` | 创建新 AbortController，进入 generating |
| `markSpeaking()` | 转为 speaking 状态 |
| `finish()` | 回到 idle |
| `interrupt()` | 调用 abort()，立即回到 idle，发出 interrupted 事件 |

用户在 AI 回复过程中发送新消息或开始说话时，触发 `interrupt()` 终止当前管线。
被打断的半句回复会进入 `lastInterruptedReply` 供 carry-forward 使用，但不会进入正式 history / slow brain / assistant 持久化。

### 13. Avatar — `avatar/`

**AvatarController (`avatar_controller.ts`)**

虚拟形象控制器：
- `setEmotion(emotion)` → 生成情绪过渡帧数组
- `processReply(text)` → 从文本检测动作
- `getFrame()` → 获取当前帧

**情绪映射 (`emotion_mapper.ts`)**

5 种 SVG 表情：neutral / happy / curious / shy / sad
- `EMOTION_FACE_MAP`：情绪 → FaceParams 映射
- `createTransition()`：生成平滑过渡帧

**动作触发 (`action_triggers.ts`)**

6 种动作规则：点头 / 摇头 / 挥手 / 歪头 / 耸肩 / 惊讶
- 关键词匹配检测动作

### 14. 前端 — `web/` (Next.js)

**组件：**

| 组件 | 职责 |
|------|------|
| `RemiChatApp` | 主布局：头部（连接状态 + 头像 + 语音指示器）+ 聊天窗 + 输入栏 |
| `ChatWindow` | 消息列表 + 流式回复气泡 + 打字指示器，自动滚动 |
| `MessageBubble` | 气泡样式（rem / user / error / sys 四种角色） |
| `InputBar` | 文本输入 + 发送 + 麦克风切换（IME 兼容） |
| `Avatar` | 情绪驱动 SVG 头像，5 种表情映射 |
| `VoiceIndicator` | TTS 播放动画（4 条跳动的竖条） |

**核心 Hook：**

`useRemiChat` — 管理全部实时状态：
- WebSocket 连接/重连
- 消息收发与流式渲染
- 双工语音录制（pcmCapture → 16kHz Int16 → base64）
- 音频播放队列（useAudioBase64Queue）
- 情绪状态同步

### 15. 旧版前端 — `public/`

原生 HTML/CSS/JS 实现，功能基本对应 Next.js 版本但不支持双工语音和打断控制。由当前 HTTP 网关兼容托管。

## 全局数据流

一次完整交互（语音输入 → 语音输出）：

```
1. 用户按住麦克风说话
   Client ──(duplex_start)──► Server
   Client ──(audio_stream: PCM base64)──► Server

2. VAD 检测语音活动
   VadDetector ──(speech_start)──► 打断当前管线（如有）
   VadDetector ──(speech_end)──► 触发 STT

3. STT 语音转文本
   SttStream ──(final: text)──► ConnectionSession.runPipeline()

4. 管线执行
   updateEmotion(text)                    → 更新情绪
   Client ◄──(emotion)──                  → 推送情绪给客户端
   extractMemory(text)                    → 提取记忆
   retrieveMemory()                       → 检索已有记忆

5. 快脑流式回复
   Brain Router → Fast Brain → Prompt Builder → LLM
   LLM ──(tokens)──► SentenceChunker
   Client ◄──(chat_chunk)──              → 逐 token 推送

6. 逐句 TTS
   SentenceChunker ──(完整句子)──► TTS Service
   TTS ──(base64 audio)──►
   Client ◄──(voice)──                   → 推送音频

7. 后台慢脑分析
   Slow Brain ──(异步)──► 分析对话 + 二次记忆提取

8. 文本流结束
   Client ◄──(chat_end)──                → 文本完成，可提交消息
   （若仍在播音频，前端继续保持 assistant_speaking）

9. 播放真正结束
   Client 本地音频队列 drain             → confirmed_end
   decayEmotion()                        → 情绪衰减
```

### 16. 存储层 — `storage/`

| 模块 | 说明 |
|------|------|
| `database.ts` | PostgreSQL 连接池（`pg`），健康检查，query 封装 |
| `redis.ts` | Redis 客户端（`ioredis`），cacheGet / cacheSet / cacheDel |
| `schema.sql` | 数据表定义：users / sessions / messages / memories，pgvector 扩展 |
| `types.ts` | 存储层类型：DbUser / DbSession / DbMessage / DbMemory |
| `repositories/message_repository.ts` | 消息持久化：saveMessage / getSessionMessages |
| `repositories/session_repository.ts` | 会话管理：createSession / endSession / getSession |
| `repositories/memory_repository.ts` | 记忆持久化 + pgvector 向量语义检索：findSimilarMemories |

### 17. 基础设施 — `infra/`

| 模块 | 说明 |
|------|------|
| `auth.ts` | JWT 认证中间件 + generateToken / verifyToken / wsAuthenticateOnce |
| `rate_limiter.ts` | HTTP 限流（100/min per IP）+ WebSocket 限流（30/10s per conn） |
| `logger.ts` | pino 结构化日志，开发模式 pretty-print，createLogger(module) |
| `emotion_logger.ts` | 情绪日志环形缓冲区（1000 条），log / getHistory / getStats |

### 18. 部署 — `Dockerfile` + `docker-compose.yml`

| 组件 | 说明 |
|------|------|
| Dockerfile | 多阶段构建：backend-build → frontend-build → production |
| docker-compose.yml | App + pgvector/pgvector:pg16 + Redis 7 |
| schema.sql | 数据库自动初始化 |

## 模块集成状态

**已完成 wiring（Phase 1 + Phase 2）：**

| 模块 | 状态 |
|------|------|
| Logger 结构化日志 | ✅ 已集成 |
| Emotion Logger | ✅ 已集成 |
| TTS Emotion 情绪语调 | ✅ 已集成 |
| Memory Decay 定时任务 | ✅ 已集成 |
| Storage (PostgreSQL + Redis) | ✅ 已集成（可选，环境变量配置时启用）|
| Avatar Controller | ✅ 已集成 |
| WebSocket Rate Limiter | ✅ 已集成 |
| Server 重构 | ✅ 已拆分为 gateway/session/pipeline |

## Server 重构（Phase 2）

`server/server.ts` 已重构为更小的模块，每个文件 ≤ 500 行：

```
server/
├── server.ts                    # 入口文件 (~80 行)
├── gateway/
│   ├── index.ts                 # HTTP + WebSocket 网关
│   └── types.ts                 # ServerMessage 类型
├── session/
│   ├── index.ts                 # ConnectionSession 类
│   └── types.ts                 # 会话状态类型
└── pipeline/
    ├── index.ts                 # runPipeline 导出
    ├── runner.ts                # 管线执行逻辑
    └── types.ts                 # 管线类型
```

新增 `PIPELINE.md` 文档，描述完整数据流。

## 当前局限与后续演进

| 领域 | 当前状态 | 演进方向 |
|------|---------|---------|
| 记忆存储 | PostgreSQL + pgvector 已集成，可选启用 | 向量语义检索集成到记忆检索流程 |
| 情绪识别 | 关键词规则 + 强度/惯性 + EmotionLogger | LLM 辅助识别 + 多维情绪（见 OPTIMIZATION C5） |
| 虚拟形象 | Avatar 协议 + 控制器已集成，SVG 表情切换 | Live2D / Three.js + VRM，口型同步（T-032） |
| 语音打断 | 全双工 VAD + 打断控制已实现 | 优化回声消除、VAD 阈值、TTS 分段 |
| 认证限流 | WebSocket 限流已集成，HTTP 限流待集成 | 完整集成 Auth + HTTP Rate Limiter |
| TTS 工程 | Edge 默认同参数连接池 + 短句缓存 + 全链路重试；`edge_tts_pool=0` 可关闭池化 | 极端负载下池化策略与多音色隔离可再调 |
| 每连接对话状态 | `RemSessionContext`：情绪 / 历史 / 慢脑 / session memory overlay（**C1 ✅**） | relationship state 需接入 session init 恢复；相关召回需替换当前 `getAll()` live retrieval |
| 部署 | Dockerfile + Docker Compose 已完成 | 生产环境验证 + CI/CD |

**文档：** 已完成与待办的工程项清单见 [docs/archive/OPTIMIZATION.md](docs/archive/OPTIMIZATION.md)（含 M1–M9、S9/S10、C1–C5 状态）。
