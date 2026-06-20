# Remi AI — TASKS

## 这份文档的用途

这份文档只回答三个问题：
- 现在最重要的任务是什么
- 哪些事情已经做完了
- 哪些事情还没做，且现在不该和主线程混在一起

当前主线程与交付边界，始终以 [CURRENT_FOCUS.md](./CURRENT_FOCUS.md) 为准。
如果 `TASKS.md` 和其他文档冲突，以 `CURRENT_FOCUS.md`、`CLAUDE.md`、实际代码状态为准。

---

## ✅ 结构性止血（Phase 0 + Phase 1）— 已完成（2026-06-11 按实际代码核对）

**七项结构性技术债已全部落地，本节仅作记录。详见 [STRUCTURAL_DEBT.md](../archive/STRUCTURAL_DEBT.md)。**

| ID | Task | Status | 代码证据 |
|---|---|---|---|
| `SD-01` | 环境变量治理（zod schema + 统一命名 + env 模板拆分） | `done` | `server/config/schema.ts`、`.env.localhost.example` |
| `SD-02` | 数据库迁移系统（node-pg-migrate） | `done` | `migrations/`、`npm run migrate:up` |
| `SD-03` | "双脑"命名重构 → context_orchestrator/reply_stream/background_analysis | `done` | `brains/` 下旧文件名已不存在 |
| `SD-04` | 记忆系统收敛（6层→2层） | `done` | `memory/memory_agent.ts`（episode store 主路径 + vector supplement 两层，291 行） |
| `SD-05` | 情绪引擎替换（关键词→LLM自标注） | `done` | `brain/prompt_builder.ts` `<emotion>` 指令 + `utils/emotion_tag_parser.ts`；流式跨 chunk 闭合标签 bug 已于 2026-06-11 修复（`35a174bc`）并经真实链路验证（11 轮 0 泄漏，情绪通道与内容一致） |
| `SD-06` | 人格深度增强（一句话→结构化persona） | `done` | `persona/`（index/presets/remi_default/style_override） |
| `SD-07` | useRemiChat.ts 拆分（2044行→子hook+组合层） | `done` | `web/src/hooks/` 拆为 connection/messages/voice/avatar/protocol/turn 等子 hook，主 hook ~500 行 |

注意：`done` 指"代码已落地且主路径在用"，不代表各项的体验指标已最优。遗留小尾巴记在各模块 MODULE.md / STRUCTURAL_DEBT.md 内。

---

## 当前主线程

**Web 端 10 分钟在场感体验（默认人格 + 严肃场景承接 + Web 在场感统一）**

当前目标不是继续堆功能。
当前目标是把已经接通的记忆、语气、承接、语音和表现层压成一个单端高光体验，让用户第一次明显觉得 Remi 不只是聊天框。

### Current Execution Board

| ID | Task | Status | Exit Criteria | Next |
|---|---|---|---|---|
| `W-PRES-01` | 默认人格稳定 | `in_progress` | 轻松聊 / 睡前聊 / 日常碎聊时，口气、边界、追问强度明显更稳定 | `W-PRES-02` |
| `W-PRES-02` | 严肃场景承接修正 | `todo` | 现实压力 / 财务压力 / 自责 / 委屈类 bad case 明显减少轻浮、失焦和错位 | `W-PRES-03` |
| `W-PRES-03` | Web 在场感统一 | `in_progress` | 说话态 / 停顿态 / 被打断态 / 口型与音频播放时间线不再互相打架 | `W-PRES-04` |
| `W-PRES-04` | 10 分钟体验压测 | `todo` | 睡前陪聊 / 日常碎聊 / 压力倾诉三个场景中，10 分钟体验明显不再像普通聊天框 | `observe` |

状态枚举只允许：`todo` / `in_progress` / `blocked` / `done`。
每次任务状态变化，先改这个表，再改下方详细说明。

### 当前正在做

- [ ] **W-PRES-01** 默认人格稳定
  - 目标：先把“同一个默认人格”做稳，而不是继续扩 persona preset 数量
  - 当前重点：收口口气、亲近方式、边界感、追问方式、安慰方式
  - 4.29 修正：收紧记忆 callback 触发边界，避免普通新话题里反复用“对了 / 你之前 / 上次你说”式开场硬拉旧记忆；仍保留睡眠/压力等真实相关未完线的自然承接
  - 4.30 修正：记忆召回改为先过表达门控；低信号确认句不再触发 episode recall，prompt-facing episode/shared moment 文案去除“上次你提到”式话术，`当前状态/当前诉求/当前行为` 等 volatile 记忆只在直接相关或显式 recall 时进入 prompt
  - 修复后手测清单：见 [MEMORY_RECALL_EXPRESSION_MANUAL_TESTS_2026-04-29.md](../archive/MEMORY_RECALL_EXPRESSION_MANUAL_TESTS_2026-04-29.md)，重点验收记忆显性化、话题边界、过期 current state、严肃场景不被轻松 callback 打断
  - 当前不做：大而全 persona presets 扩展、free-form persona authoring、额外风格玩法
  - 验收标准：轻松闲聊 / 睡前陪聊 / 普通碎聊时，不再频繁出现“像客服 / 像老师 / 像另一个系统”的漂移

- [ ] **W-PRES-02** 严肃场景承接修正
  - 目标：优先修“最伤关系可靠感”的 bad cases，而不是继续扩 memory 功能面
  - 当前重点：
    - 事实承接错
    - 情绪误判
    - 场景切换失败
    - 严肃时刻轻浮
    - 交付物请求必须直接在当前聊天输出正文，不能编造附件、压缩包、收件框或“已发送”
  - 当前边界：优先通过 `TurnInterpretation -> ResponsePolicy`、`tone contract`、默认人格提示和坏样本回归收口
  - 验收标准：用户从轻松聊切到现实压力、财务压力、自责、委屈时，Remi 明显更稳，不再轻飘飘错位

- [ ] **W-PRES-03** Web 在场感统一
  - 目标：让角色从“会说话的系统”更接近“在场的她”
  - 当前重点：
    - 说话态、停顿态、听你说态更清楚
    - 口型、音频、表情、turn state 不互相打架
    - 打断时不出现明显错位
  - 6.20 进展（Web 壳层）：
    - 移动端舞台优先：聊天区上移 + 顶部强渐隐（`remi-chat-mobile-immersive`）+ 右侧 `RemiMobileControlRail` 状态岛
    - `ConversationPerformanceModel` 深化：`speaking_active` 状态标签、VoiceIndicator / ChatWindow / Portrait fallback 共用同一 performance contract
    - PWA 可安装：`manifest.ts` + `sw.js` shell 缓存 + `RemiPwaRegister`（生产环境注册）
    - 仍待验收：真实浏览器 duplex 长时对话中口型/音频/打断时间线是否完全对齐
  - 已有基础：4.19 已接通 `tts_lip_sync`、lip timeline、`MicTxGate`
  - 4.29 试改：`MicTxGate` 增加稳定环境噪声自适应底噪门控，服务端 no-preview idle guard 加严；已过单测/duplex 回归，仍需真实浏览器噪声场景验收
  - 新增 SDK 接入：`useRemiChat` 的 WebSocket 创建、`client_context`、原始消息镜像、runtime reducer、`sendText`、语音协议出口（duplex start/stop、audio frame/fallback、playback start/end）已通过 `runtime/RemiRuntimeClient` 进入 SDK 边界；Web 仍保留 UI、麦克风采集、音频播放、口型、history 和 avatar 执行
  - 新增 World SDK bridge：`world/src/remiWorldBridge.ts` 复用 `RemiRuntimeClient`，提供 World client_context、runtime state mirror、`sendText`、WorldEvent -> RemiWorldEvent 转换；`world_event` 默认不发后端，等待专用 server route
  - 5.1 新增 `/vrm` 真实链路验证页与 SDK avatar projection：`runtime/selectRemiAvatarRuntimeModel()` 统一输出 emotion / avatarIntent / avatarFrame / lipSync / phase；真实浏览器已验证 LLM intent、TTS cue 与 playback 收口能进入同一个 SDK model，Web `/vrm` 与 World bridge 可共用；这仍是验证入口，不等于完整 3D 表演成熟
  - 验收标准：从视觉和听感上，角色状态已经明显比当前更像“有人在”

- [ ] **W-PRES-04** 10 分钟体验压测
  - 目标：先证明一个单端、单场景、单默认人格的高光体验
  - 场景固定为：
    - 睡前陪聊
    - 日常碎聊
    - 压力倾诉
  - 验收标准：至少在一个默认入口里，用户和她待 10 分钟后，不再自然把她归类成普通聊天框

### 当前明确不优先做

- [ ] iOS 新功能扩张
- [ ] 多端持续在线产品化闭环
- [ ] 大而全 persona preset 扩展
- [ ] 与当前主线无关的大量 docs / ops / infra 美化
- [ ] 继续按“memory / web / iOS / auth / avatar / voice 全线一起推”的模式工作
- [ ] 把复杂工具调用 / agent 能力当作陪伴产品的主卖点

### 并行支线（不抢主线程）

- [ ] **RW-P1 RemiWorld 终局线 Phase 1："她在生活"（in_progress，2026-06-12 开工）**
  - 终局方向、硬约束与阶段定义：[REMIWORLD_NORTH_STAR.md](../design/REMIWORLD_NORTH_STAR.md)
  - 定位：**在场感主线的空间化载体**，不是第二条主线；吃 W-PRES-01/02 大脑侧产出，复用 W-PRES-03 的语音/口型/表情零件
  - 已有基建：RemiWorld v0.1 已可玩（`/world`：小岛/房间/庭院/记忆墙、剧本任务线、localStorage 存档、像素纹理+逐顶点AO+bloom 日落渲染、剧本状态机 6 单测）；对话接缝在 `web/src/lib/world/script.ts` 的 `ScriptUi.openDialogue`
  - 决策记录（2026-06-12）：`RW-P1-0` VRM 用本地文件不走 CDN（缺失时体素兜底）；W-PRES-03 笔记中的 world SDK bridge 在冻结分支上**暂不合并、不依赖**，对话接入以 `web/src/hooks/useRemiChat.ts` 为接缝
  - ✅ 已完成（2026-06-13）：`RW-P1-1` 行为调度器（`web/src/lib/world/behavior.ts`：5 行为+墙钟+路点BFS行走）/ `RW-P1-2` 注意力（task/attend/talk 三模式）/ `RW-P1-5` 打断恢复；12 单测全过（worldBehavior 6 + worldScript 6），tsc/lint/build 绿，截图验证她在书架/电脑前做事且靠近抬头
  - ✅ `RW-P1-3a` 对话接真管线·文本流（2026-06-13）：`/world` 包 `RemiAuthProvider`、消费 `useRemiChat`（同一个 Remi/连接/记忆/人格）；开场白后 `talkToRemi`→`openLiveChat`；世界内实时对话面板（输入框+流式回复，引擎 `setChatActive` 挂起 FPS 控制让鼠标去打字）；`chat.emotion`→`actor.setEmotion`（VRM happy/sad/angry/relaxed/surprised 平滑过渡）。真机验证：连本地后端 :3000，发"你刚在做什么"→ 真实 LLM 回复带人格+记忆（提到用户的猫/昨天的杯子），行为进 talking 态。14 单测全过、tsc/lint/build 绿
  - ✅ `RW-P1-3b` 语音口型（2026-06-13）：`engine.setLipSource(chat.lipSignalRef)` 每帧喂 actor；VRM 用 `Aa`/`Oh` 表情（viseme 优先，否则 envelope）、体素头加可缩放嘴；TTS 自动播放路径复用 `useAudioBase64Queue`。render 映射已注入验证（envelope 0.85→嘴 scale.y 6.5、oh viseme→加宽 1.54、闭合→1）。⚠️ **未在 headless 预览里看到真实 TTS 音频播放**（fresh AudioContext 已 running、userActivation 有，排除 autoplay；疑后端 Edge TTS 在该 Docker local-prod 未出声）——口型代码正确，待用户在真机/正常 dev 栈确认声音+嘴动
  - ✅ `RW-P1-4a` 感知→大脑（2026-06-13）：世界情境注入 prompt。`web/src/hooks/useRemiChat.ts` 的 `sendText(text, situational?)` 加可选第二参 → `chat` 消息带 `situational` 字段 → `server/session/text_chat.ts`（封顶 600 字）→ `runPipeline` 的 `situationalContext` → `RouteMessageOptions` → `context_orchestrator` 前置进 `strategyHints` → reply_stream priorityContext → prompt `【你此刻的处境】`。世界端 `buildSituationalContext({activity,save})` 拼"她在做什么/用户在身边/花·灯·第几天"。验证：服务端 2 单测证明情境进 strategyHints、web 3 单测验内容、tsc(前后端)/build 绿、brains+pipeline 0 回归（失败用例 stash 对比确认为环境性既存）。⚠️ 待真机：她口头引用情境需后端跑本分支（当前 :3000 是旧 Docker 不含本改动）
  - ✅ `RW-P1-4b` 世界事件进记忆（2026-06-13）：`world_event` WS 消息 → `server/session/world_event.ts`（纯函数 `buildWorldEventMoment` 映射 种花/点灯/回访 → `MomentInput`）→ `episodeStore.ingest()`（复用慢脑同一 episode store，语义合并去重，异步 fire-and-forget，无 DB 优雅降级）。message_router 加 `world_event` case，index.ts 加 `handleWorldEvent`（即发即忘）。客户端 `useRemiChat.sendWorldEvent` + RemiWorld 连接前缓冲补发。验证：4 服务端单测、前后端 tsc/build 绿、brains 71/9（+6 新测，失败数不变）pipeline 11/1 → 0 回归
  - **Phase 1 全部完成**（RW-P1-1~4b）。用户已验收 P1，当前已直接进入 Phase 2。
  - ✅ `RW-P2-1/2` 时间与日常第一刀（2026-06-14）：`web/src/lib/world/worldTime.ts` 定义清晨/午后/黄昏/深夜；`scheduledBehaviorAt()` 按时间段行为池调度；HUD / prompt 情境不再固定黄昏；`WorldSave.lastSeenAt` + `buildOfflineReturnOpener()` 让离线回来后的首轮真实对话带入"你不在的时候…"。24 个 world 单测、web lint/build 绿。
  - 下一步：`RW-P2-3` 天气 v0（本地视觉 + prompt 情境，不阻塞 fast path）或 `RW-P2-4` 主动开场白（复用 `proactive_planner` 的关系阶段/退避/冷却门控）
  - 验收：四项活人感基准（隔天回来/打断恢复/十分钟观察/记忆回指）+ 2 分钟连续体验录屏

- [ ] **Memory V2 真实质量观察（observe / blocked）**
  - 当前状态：主链路已接通，但真实样本不足；继续围绕 `audit / hygiene` 扩工具，只会得到低信号 proxy 结论
  - **2026-06-20 记忆层优化已落地**：
    - ✅ P0 NSFW 内容隔离：NSFW 模式下 slow brain 不再持久化 interests/personalityNotes/conversationSummary/proactiveTopics/user_facts 到 DB，防止成人对话内容污染正常人格画像
    - ✅ P1 PG importance 参数化：`upsertMemory` 的 importance 从硬编码 `1.0` 改为参数传入，调用方的 confidence 值不再被丢弃
    - ✅ P1 断连关系状态保存：WebSocket 断开时 fire-and-forget 保存 relationship state，不再丢失会话中积累的亲密度/话题/情绪轨迹
    - ✅ P2 记忆衰减 TTL 接入：`runDecay` 接上了 `maxAgeMs`+`minImportance` 联合过滤，超龄低重要度记忆自动清理
    - ✅ 已有保护：瞬时键过滤（`isVolatileMemoryKey`）、interests 近重复去重（`subsumes`+FIFO 12 条上限）、personalityNotes 上限 5 条、lazy session creation（首条消息才建 DB session）
  - 当前真实判断：
    - 热层方向对，但 `working memory / current focus` 还没收成稳定、极薄的层
    - 温层主链路已通，但 `episode` 事件表达还太粗
    - 冷层还没真正成型，当前仍缺 archive / replay / offline 治理底座
  - 当前边界：
    - 保留现有 readiness，不再为“验证而验证”扩脚本或规则
    - 不继续把真实 bad case 直接补进 runtime 主逻辑
    - 不继续扩越来越厚的 topic / keyword / case-specific 特判
  - 解锁条件：出现新的真实 `episodes` 样本，或出现足够多样的真实用户对话可供抽样人工复核
  - 下一阶段最小动作：
    - `M-ARCH-01` 收硬 Layer 2 边界：只保“当前主线 / 当前约束 / 不要踩的点”
    - `M-ARCH-02` 升级 warm-layer schema：让 `episode` 能表达 `pressure_source / relational_impact / user_stance / unresolved_level`
    - `M-ARCH-03` 补最小 cold-layer：archive ledger / replay / offline re-extract / audit

- [ ] **I-001** iOS v0（文本）5 人内测闭环
  - 当前状态：文本基线、鉴权、缓存隔离骨架已具备
  - 边界：只保底，不抢当前 Web 主线
  - 验收标准：5 人试用通过、无 P0 崩溃、无串号反馈

- [ ] **I-002** iOS 按住说话语音链路收口
  - 当前状态：代码级主怀疑点已继续收口，但真机可用性仍未成立
  - 边界：不计入本轮主线 done 判定
  - 验收标准：真机按住说话能稳定出现 transcript 或最终用户气泡，并触发 assistant 回复

- [x] **I-WATCH-01** watchOS Blob 在场感主屏 — `done`（2026-06-20）
  - 设计来源：`ios/RemiWatch/design/Blob.dc.html`（Claude Design 稿落地）
  - 已落地：暖阳渐变 blob 动画（`RemiBlobView` / `RemiBlobShape`）、波形条（`RemiWaveformView`）、OLED 黑底主屏（`RemiBlobScreen`）、`RemiPresencePhase` 说话/倾听态、`WatchChatSheet` 聊天气泡历史
  - 语音输入：真机走 WatchKit `presentTextInputController` 系统听写；Simulator 无 `WKInterfaceController` 时降级 `TextFieldLink`
  - 表盘：`RemiComplication` 改为迷你渐变 blob（替换 SF Symbol）
  - 模拟器已 build + install 验收（Apple Watch Series 11 46mm）
  - 下一步（不抢 Web 主线）：
    - `I-WATCH-02` WatchConnectivity：iPhone `RemiChatLite` Clerk token → `WatchAuth.store(token:)`
    - 真机 LAN WS URL（`REMI_WATCH_WS_URL=ws://<Mac-IP>:3001/ws`，勿用 `127.0.0.1`）
    - Complication 接 App Group 实时情绪数据

- [ ] **T-042** Prompt / latency budget 收口
  - 当前判断：这仍重要，但不能继续稀释”像她”的主线
  - 当前边界：只做对 Web 默认体验直接有帮助的压缩和稳定性修复

- [x] **T-043** TTS 长对话中间跳过句子 — `done`（2026-06-20）
  - 已修复根因 1-5：见 `remi-nsfw-tts-skipping-fixes.md`
  - 已修复根因 6（MLX TTS 短文本循环）：`voice/tts_mlx.ts` 新增音频时长上限截断（`MAX_AUDIO_SEC_PER_CHAR=1.5`，最低 2 秒），buffered + streaming 两条路径都做
  - 客户端 `useAudioBase64Queue` 增加 `hasPendingPlaybackWork` 统一判定 + `serverTtsStreaming` 双保险，不再在 TTS gap 期间误判播放结束

- [x] **T-044** 音色风格切换 — `done`（2026-06-20）
  - 聊天命令：`用御姐音` / `换成萝莉音` / `恢复原来的声音` 等 regex 匹配 → DirectCapability 拦截 → 设 per-session instruct override
  - UI 面板：🎵 按钮 → VoiceStylePicker（7 预设 + 语速/音调调节）→ WS `set_voice_style` 消息
  - 6 预设：默认 / 御姐 / 萝莉 / 温柔 / 元气 / 冷酷 / 妩媚；每种带情绪修饰后缀
  - MLX TTS only；instruct 优先级：用户风格 > NSFW > env 覆盖 > 情绪默认

- [x] **T-045** 生图 3 步管线重构 — `done`（2026-06-20）
  - Step 1: hybrid intent（regex 预过滤 + fast-brain 确认，fallback regex-only）
  - Step 1.5: Qwen scene-prompt writer（LLM 生成 ComfyUI 正面提示词）
  - Step 2: assembleImagePrompt（角色风格锁定 + 续图/重画/换风格拼接）
  - Step 3: invokeComfyUI（提交 + 渲染 + 返回 markdown 图片）
  - 新增 bundled workflow（z_image_turbo + pony_v6_xl），Docker 镜像内置
  - 新增 `refine` intent（更骚点 / 脱掉 → 增量编辑上一张图）

- [x] **T-046** Qwen3 reasoning 兼容层 — `done`（2026-06-20）
  - `llm/qwen_client.ts`: `resolveReasoningRequest` 统一 reasoning_effort → API 参数 + `<think>` 过滤
  - `collectStreamTokens` 替代 `streamTokens`：返回 content/reasoning 统计，支持空流诊断
  - `recoverVisibleReply`: 空流回退→重试（加 DIRECT_ANSWER_DIRECTIVE）→ 从 reasoning 中 salvage 中文正文
  - fast brain 不再单独配模型（`REMI_FAST_BRAIN_MODEL` 已废弃）

### 当前禁止并行修改的热点文件

- `server/session/index.ts`
- `brains/slow_brain_store.ts`
- `web/src/hooks/useRemiChat.ts`
- `memory/memory_agent.ts`

规则：
- 同一迭代周期内，一个热点文件只能有一个 owner。
- 任何 agent 在改热点文件前，先看对应目录的 `MODULE.md` 和根目录 `TEST_MAP.md`。
- 如果任务必须同时涉及两个以上热点文件，优先拆成“单 owner 主改 + 其他人只补测试 / fixture / 文档”。

---

## 已完成里程碑

下面不是“所有历史小任务”的逐项流水账，而是按主线整理后的已完成事实。
这些结论基于当前代码状态与最近主线提交。

### M0 · 基础系统已完成

- [x] Node.js + TypeScript 全栈项目建立完成
- [x] HTTP + WebSocket 网关完成
- [x] PostgreSQL + Redis 接入完成
- [x] 基础日志、认证、限流、Docker 化完成
- [x] Next.js 前端、旧版前端、基础音频链路完成

### M1 · 实时交互主链路已成型

- [x] Fast Brain / Slow Brain 双脑架构已落地
- [x] VAD / STT / TTS 主链路已接通
- [x] turn-taking 状态机已引入 `hold / likely_end / confirmed_end`
- [x] 打断语义已收口：被打断 partial 不污染正式历史 / 慢脑 / 正常持久化
- [x] `chat_end` 与本地 playback drain 已分离
- [x] 延迟指标与 duplex harness 已稳定，可用于回归比较

### M2 · 在场感 / Avatar 表现层已达到可用 MVP

- [x] Avatar 协议、动作触发、控制器已接通
- [x] 3D 互动 MVP 已完成，可做离线演示与人工验收
- [x] 语音、情绪、状态与形象之间已有基本联动
- [x] 4.19 已补 client lip sync transport、Web lip timeline、`MicTxGate`

### M3 · 人格与关系连续性 V1 已完成验收

- [x] per-user relationship state
- [x] reconnect continuity
- [x] relationship-aware prompt consumption
- [x] interrupted partial pollution guard
- [x] relationship-aware retrieval
- [x] proactive ledger / style slots / continuity policy 已接入

### M4 · Persona 骨架已进入可用状态

- [x] 基础 persona / character rules 已稳定存在
- [x] 最小产品骨架 Layer 2 + Layer 4 已接入
- [x] 已修复 4-layer skeleton 的关键持久化缺口

### M5 · Memory V2 主链路已完成单路径验收

- [x] `llm/embedding_client.ts`
- [x] `episodes` 表与 repository
- [x] `episode_store` 编排层
- [x] slow brain 写路径双写 V1 + V2
- [x] `proactive_planner` 已实现
- [x] prompt 读路径已优先接到 `episodeStore.findRelevant()`
- [x] silence nudge 主路径已接到 `planProactiveNudge()`
- [x] 真实 WS 文本会话写路径已验收，`episodes` 可稳定写入并合并
- [x] 记忆路线已明确：不是“把更多历史塞给模型”，而是“短上下文 + 当前重点 + 长期按需检索”

### M6 · 多端与运行底座已有骨架

- [x] Web Clerk / legacy 双桥接入
- [x] iOS lite 文本聊天骨架已接通
- [x] per-user cache / auth identity / session continuity 基础已接通
- [x] 本地 dev / local-prod 运行口径已拆分，避免互相污染

### M7 · 服务路线与产品边界已收口

- [x] 已明确：Remi 不走“全能 AI 助手”路线
- [x] 已明确：工具调用只作为隐身配角，不作为陪伴主价值
- [x] 已明确：实时语音里的“我想想”必须绑定真实内部检索/整理，而不是台词表演
- [x] 已明确：首要任务是让用户想“回来见她”，而不是“用一下一个 AI”

---

## 当前未完成项

### A. 当前主线程未完成

- [ ] 默认人格稳定
- [ ] 严肃场景承接修正
- [ ] Web 在场感统一
- [ ] 10 分钟体验压测

### B. 并行但非主线程

- [ ] Memory V2 真实质量观察
- [ ] iOS 内测验收
- [ ] iOS 按住说话语音链路收口
- [ ] Prompt / latency budget 收口（只保留对当前主线直接有价值的部分）

### C. 长期方向，暂不进入当前执行板

- [ ] 多端持续在线存在层的具体实现
- [ ] 插件 / capability 系统
- [ ] 直播 / 游戏 / 机器人 / 设备接入
- [ ] 更大范围 persona / character ecosystem

---

## 与代码现状不一致、已归档的旧表述

下面这些说法已经过时，不应再作为当前任务判断依据：

- “当前主线程仍然是 Memory V2 验证 + 读路径迁移”
- “继续所有方向一起推进也能自然长出高光体验”
- “当前最缺的是更多能力点，而不是把已有能力压成体验”
- “Remi 应该优先做成全能 AI 助手”
- “AI 伴侣的核心价值是会调用更多工具”
- “主 LLM 在语音主链路里像 agent 一样多轮 decide tool use 是合理方向”
- “只要底层链路接通，体验自然会成立”

这些旧内容不再保留为主文。
它们已经被当前代码状态、当前提交历史和 [CURRENT_FOCUS.md](CURRENT_FOCUS.md) 取代。

---

## 任务更新规则

今后更新这份文档时，遵守下面规则：

1. 先更新“当前主线程”
2. 再更新 `Current Execution Board` 的状态与 `Next`
3. 再更新“已完成里程碑”
4. 不再把早期基础建设任务逐条往下累加
5. 当前优先级变化时，必须同步 `CURRENT_FOCUS.md`
6. 如果只改了历史说明、没改当前主线程，不要改顶部执行板
