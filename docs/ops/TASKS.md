# Remi AI — TASKS

## 这份文档的用途

这份文档只回答三个问题：
- 现在最重要的任务是什么
- 哪些事情已经做完了
- 哪些事情还没做，且现在不该和主线程混在一起

当前主线程与交付边界，始终以 [CURRENT_FOCUS.md](./CURRENT_FOCUS.md) 为准。
如果 `TASKS.md` 和其他文档冲突，以 `CURRENT_FOCUS.md`、`CLAUDE.md`、实际代码状态为准。

---

## 🎯 2026-07-03 当前篇章：使用与收缩期（最新，覆盖以下所有旧篇章的优先级）

> 两天大改造（07-02/03）后项目进入新阶段。全景与复杂度诊断见
> [STATE_OF_THE_PROJECT_2026-07.md](./STATE_OF_THE_PROJECT_2026-07.md)，
> 当前唯一北极星：**每周真实聊天的天数与轮数**。

### ✅ 已完成并部署（2026-07-02/03，16 commits，全部在 local-prod :3000 运行）

| 主题 | 内容 | 验证 |
|---|---|---|
| LIVE-01 解释器 | 三层死因修复（旧变量名/180ms/220token），llm_structured 首次上线 | 生产日志 |
| LIVE-02 内容层 | CANON 人生底稿 + 离线人生主动化 + 贡献义务 + 敷衍台阶 | 真机验收 |
| LIVE-03 开场收场 | greeting_opener（>30min/防抢话/跨通道去重）+ SSE events 通道建活 + 收场钩子 | 真机开场语 |
| LIVE-04 身份 | loopback 设备身份 + 周期保存；双 Clerk 账号确认为"失忆"主因 | DB 审计 |
| MEM-01 时效系统 | 提炼归一化 + 渲染带日期 + MEMORY_USAGE_CONTRACT + 时间锚 | 坏样本复测 |
| MEM-02 构造层 | fact_postprocess（状态补日期/key 去时间词/低置信过滤） | LCCC 200 段 0/528 |
| MEM-03 边界 | 具身边界 + 追问诚实 + 诱导不顺从 + 问句非陈述 | 探针 PASS |
| MEM-04 历史层 | 历史时段断层标记 + 脏数据清创（18 消息+10 毒 KV） | BC-T7 PASS |
| EVAL-01 防御 | memory_polish_eval（五毒率）+ memory_probe_eval（7 探针）+ chat_vitality_eval + memory_backfill | 常驻 |
| VOICE-01 TTS | MLX TTS 环境重建+端口修复，成为主 TTS | 生产日志 |
| DOC-01 审计 | MEMORY_ARCHITECTURE_AUDIT_2026-07（六路勘察） | 已提交 |
| SHRINK-01 | 「最小可爱 Remi」收缩：`test:core` 子集（44 文件排除）+ CLAUDE.md 冻结区标注 | 2026-07-04 执行：全量 1324 测试/118 失败；`test:core` 887 测试/828 通过/59 失败（活跃区真实存量失败，非冻结污染） |
| EVAL-02 评测隔离 | 「周一」案根因之一：6 个打真实服务的评测脚本改走替身用户（loopback-identity 机制复用，零服务端改动），根治"每轮回归给记忆喂假人生"循环 | 2026-07-04：实测跑探针后真实用户三表零新增 |
| MEM-08 清创 v2 | 匿名桶整桶清空（214 msg/34 mem/17 ep，含影视假人设全套）+ 主桶删「姓名=阿兵」（小说角色穿越）与「明天周一」毒 episode；删前全量备份 `~/remi-db-backups/` | 毒残留全库 0 |
| GUARD-01 出口时间守卫 | 「周一早起/凌晨说黄昏」构造性防御：句级同步正则核对星期/时段断言（`REMI_REPLY_TIME_GUARD` 默认 drop）+ silence_nudge 实时时间锚 | BC-T7/T8 生产实打 PASS |
| MEM-09 虚构隔离 | 「阿兵」案根治：身份类画像键（33 词根）入库需第一人称直陈证据，虚构语境轮直接拒写（拒绝可观测）；NSFW/小说/扮演不进用户画像 | BC-T9 PASS；polish_eval 对照五毒率持平、拦截 1→18 |
| TIME-01 时区总病根 | **全部星期案的上游真凶**：时间锚 fallback UTC（SSE 文本会话不带 timeZone → 时间叙事整体活在容器 UTC：「周一早起」案发时锚=周五傍晚、「凌晨四点半」=UTC 04:27 忠实读锚）。修复：锚 fallback→REMI_TZ + 容器 TZ 对齐 + 守卫持久化删句标点容错（生产实测漏删「反正周一还远着呢」） | 端到端：生产替身问"现在几点"→「星期六，现在是 12:48」✓ |
| GUARD-02 定稿覆盖 | chat_end 携带守卫终稿 finalContent（仅真 drop 时），web 定稿覆盖流式残影——坏句从"留在屏幕上"变为"只闪现几秒"；/api/ext/chat 同步；历史手术：当日存档 3 句毒「周一」摘除+会话池清空 | 生产复读法实测：流式见坏句→定稿只剩「晚安。」✓ |

### ⏳ 当前任务（按序）

| ID | Task | Status | 说明 |
|---|---|---|---|
| USE-01 | 真实使用一周攒体感 | `in_progress` | 唯一关键路径；坏样本→探针流水线待命（探针已 9 根且已隔离，随便跑） |
| MEM-05 | 对话史边界合同（BC-T6 残留） | `backlog` | 等体感排序 |
| MEM-06 | CoreMemory rightNow 过期治理 | `backlog` | 时效改造唯一盲区 |
| MEM-07 | 入库前 LLM 复核（幻觉精化） | `backlog` | 慢脑异步可承受 |
| MEM-10 | relationship_state 自由文本虚构渗入（conversationSummary 等 blob 路径不受 MEM-09 门槛保护，已实测渗入） | `backlog` | 需自由文本实体处理，另一把刀 |
| GUARD-03 | 守卫误杀扩大化：守卫粒度=TTS chunk，短坏句（<minTtsChars）与邻句合并后整块陪葬；修法=drop 前按真句边界重判只丢违规子句 | `backlog` | 2026-07-04 实测发现 |
| MEM-11 | 名字空洞诚实：姓名删除后问"我叫什么"她答自己的名字（应答"你还没告诉过我"）；追问诚实合同没兜住名字类提问 | `backlog` | 2026-07-04 生产坏样本 |
| EVAL-03 | chat_vitality 既有 2 RED（minimal_user / serious_interlude，07-04 确认为遗留非新退化） | `backlog` | 与今晚改动无关，待查 |
| OPS-01 | push origin | `todo` | 07-04 凌晨新增 5 提交（收缩+隔离+守卫+虚构+探针），等用户点头 |
| OPS-02 | 8 个历史身份归并 | `blocked` | SQL 已备，需用户人工确认归属（07-04 清创后仍见 42740f8f 等小桶） |

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
| `W-PRES-02` | 严肃场景承接修正 | `in_progress` | 现实压力 / 财务压力 / 自责 / 委屈类 bad case 明显减少轻浮、失焦和错位 | `W-PRES-03` |
| `W-PRES-03` | Web 在场感统一 | `in_progress` | 说话态 / 停顿态 / 被打断态 / 口型与音频播放时间线不再互相打架 | `W-PRES-04` |
| `W-PRES-04` | 对话质量数据驱动验收 | `todo` | 各场景自动化评分通过率达标，持续无回归 | `observe` |

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
  - 6.23 第一刀（漏检修复，落点 `brain/tone_policy.ts` + `brain/turn_interpreter.ts`，与另一条会话 `brains/` 零冲突）：
    - 根因：`shouldAnalyzeTurn` 门控过窄，**自责/无价值感、反讽、夜间财务倾诉、被批评否定**四类严肃输入整条绕过回合解释层 → 退化轻聊（=严肃时刻轻浮）。这正是 `scripts/live_chat_probe.mjs` 的 serious_pivot / sarcasm / financial_stress 场景
    - 新增 `emotional_distress` 场景类：区别于 `practical_judgment`（要判断），它是"稳稳陪着、不硬塞建议"（bans: `no_jokes`/`no_topic_pivot`/`no_shallow_reassurance`，questionBudget=0，shouldGiveJudgment=false）
    - 新增 5 个宽类别检测器（自责/反讽/求陪伴非建议/被批评否定/重情绪倾诉）+ 组合器 `detectEmotionalDistressSignal`；`detectPracticalDistressSignal` 补 `房贷/车贷`；修 `detectDeliverableRequest` 对"做的/写的方案"过去式描述的误判
    - 坏样本进 eval：`test/brain/serious_scene_carry.test.ts`（15 单测全绿，含回归保护）；tsc 零错误；既有 3 个 turn_interpreter 失败为**改动前既存**（与本刀无关）
    - 待跟进（在另一条会话 owner 的文件里，1 行加法）：`context_orchestrator.ts` 的 `text_deliberate` 预算应纳入 `emotional_distress`（让情绪承接走更深推理）；`background_analysis_store.ts` 可加情绪承接的 working-memory 线程标签做多轮承接连续性
    - 未做：尚未 `prod:local:rebuild` 上线实测（避免把另一条会话的在途代码一并部署，需协调）
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

- [ ] **W-PRES-04** 对话质量数据驱动验收
  - 目标：用数据驱动替代主观感觉，持续量化和提升对话质量
  - 方法：
    1. **拉真实日志** — 从生产 DB 拉用户聊天记录，按场景分类（碎聊/压力倾诉/睡前/NSFW/生图/音色…）
    2. **补盲区场景** — 上网搜陪伴 AI 典型对话场景和常见翻车 case，补到场景库
    3. **自动化刷评** — 逐场景向 Remi 发消息，拿回复，用 LLM 评分（像不像人 / 有没有接住 / 有没有飘）
    4. **逐类修+回归** — 针对低分场景修复，修完自动回归验证通过率
  - 持续运行：部署后用户正常使用，定期拉日志分析 tone guard 警告率、assistanty 频率、场景覆盖率
  - 验收标准：各场景自动化评分通过率达标，且持续无回归

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
  - ✅ `RW-P2-3` 天气 v0（2026-06-23）：`web/src/lib/world/weather.ts` 确定性天气（clear/cloudy/rain/snow，6 小时 hash slot）；`behavior.ts` 天气感知行为池过滤（雨雪→室内）；`script.ts:buildSituationalContext` 天气情境注入 + `buildWorldOpener` 组合开场白；5 天气单测 + 24 world 单测零回归
  - ✅ `RW-P2-4` 主动开场白（2026-06-23）：`buildWorldOpener()` 组合时间+天气+离线时长为进入世界时的自动问候文本
  - **Phase 2 全部完成**。
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
  - 2026-06-23 新增根因 7（NSFW 脏词 TTS 静默）：`voice/tts_helpers.ts` 加 `NSFW_PHONETIC_SUBS` 音译替换表（贱屄→贱婢、骚逼→骚比、鸡吧→几把、肉便器→肉瓶器、挨操→挨草等），MLX/Qwen3-TTS 训练数据无这些词的语音样本导致输出静音；替换后平均静默率 37%→19%、严重静默 2/10→0/10。同时测试了 Qwen3-TTS bf16 全精度（无改善，问题在训练数据不在量化）、Fish S2-Pro 4B MLX 8bit（更差+慢 10 倍）、IndexTTS-2（已下载待集成）

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

### 设计支线（2026-06-22 北极星 / 架构文档成文，任务条目本日同步）

> 五份设计文档于 2026-06-22 成文：[DIGITAL_LIFE_NORTH_STAR.md](../design/DIGITAL_LIFE_NORTH_STAR.md)（契约）+ [DIGITAL_LIFE_AUDIT.md](../design/DIGITAL_LIFE_AUDIT.md)（现状快照）+ [ROLEPLAY_LAYER_DESIGN.md](../design/ROLEPLAY_LAYER_DESIGN.md)（Performance 下钻）+ [CONTEXTUAL_INTENT_ORCHESTRATOR_PLAN.md](../design/CONTEXTUAL_INTENT_ORCHESTRATOR_PLAN.md) + [COMMERCIAL_COMPASS.md](../design/COMMERCIAL_COMPASS.md)。外加昨日落地的 [MEMORY_V3_DESIGN.md](../design/MEMORY_V3_DESIGN.md)。这些文档都要求"任务挂 TASKS.md 并行支线、不抢 W-PRES 主线、P1 不碰热点文件"。**以下状态经本日代码复核（非文档自述）。**

- [ ] **M3- Memory V3**（设计：[MEMORY_V3_DESIGN.md](../design/MEMORY_V3_DESIGN.md)；代码在工作区，未提交）
  - `M3-P0` 立刻不笨 + 时间感入门 — `done`：递归摘要喂回累积 + `clipSummary` 封顶 + `now`/gap 注入动态尾部 + 窗口放大可配 + 缓存断点接口；单测绿
  - `M3-P1` Core Memory 差分编辑块 — `done`：`brains/core_memory.ts`（差分 apply / 有界淘汰 / 稳定 render）；慢脑 `core_memory_edits → applyCoreMemoryEdits`；读路径 `coreMemory.render() → context_orchestrator.ts:875 → prompt Tier1`；NSFW 跳过；**读写闭环**，单测绿
  - `M3-P2` bi-temporal 时序层 — `done`（2026-06-23 部署）：写入 + 召回读路径均接通，已部署 local-prod 并经端到端日志验证；38 单测绿
  - `M3-P3a` 主动搭话仲裁门控 — `done`（2026-06-23）：`brains/arbitration_gate.ts`（6 级门控：候选数/亲密度/退避/冷却/安静时段/会话后冷却）；3 个 env 配置变量；13 单测绿
  - `M3-P3b/c` 调度循环 / 离线推送 — `todo`：需 `prospective_intents` 表 + 用户级调度器 + APNs/Web Push 基建

- [ ] **DL- 数字生命**（契约：[DIGITAL_LIFE_NORTH_STAR.md](../design/DIGITAL_LIFE_NORTH_STAR.md)）
  - `DL-P0-1` 北极星契约文档 — `done`
  - `DL-P0-2` `RemiSelf` interface 草稿 — `done`：`server/session/types/remi_self.ts`（MoodVector / WorldPresenceState / RemiSelf，纯契约 + `// TODO: implement`，注明与现状 PersonaLiveState 的 gap）
  - `DL-P0-3` `IdentityEnvelope` interface 草稿 — `done`：`persona/types/identity_envelope.ts`（Core[Constitution+Character] / Disposition / Performance 三层）
  - `DL-P0-4` 本表同步 DL- 条目 — `done`（2026-06-22）
  - `DL-P0-5` episodes 加 `scope` 列 — `done`（代码）：`migrations/004_episodes_scope.js`（ADD COLUMN IF NOT EXISTS scope DEFAULT 'core'）+ `MomentInput.scope?: EpisodeScope`；写入路径未改、无运行时变更。**migration 待执行**（同 M3-P2 攒批部署）。ROLEPLAY 线前置已就位
  - → **DL-P0 阶段全部完成**；后续 P1a/P1b/P2 全部 `🔒` 卡 W-PRES-01 验收
  - `DL-P1a` NSFW 替换 → 包裹（`brain/prompt_builder.ts`，单 owner）— `todo`，前提 W-PRES-01 验收。2026-06-23 代码审计：25 生产文件涉 NSFW（2 纯 NSFW 可整文件搬、5 含 NSFW 逻辑块需切 hook、3 深度交织需新增引擎 hook 点 [PersonaOverride / MemoryWriteFilter / TtsTextResolver / TtsInstructOverride / ImageGenParams / SessionLifecycle]、8 薄引用改 plugin event）；~600 行 NSFW 专属逻辑、预估 2-3 天；现有 `plugin/registry.ts` hook 雏形不够（缺 TTS / memory 层 hook）。包裹化同时完成 `CC-P0-2`（NSFW 明文移出引擎）
  - `DL-P1b` RemiSelf 最小持久化（mood / energy / currentFocus 跨会话）— `todo`，前提 W-PRES-01
  - `DL-P2` Disposition 旋钮 + 世界状态服务端化 — `todo`，前提 P1a + P1b

- [ ] **CIO- 上下文意图编排器**（设计：[CONTEXTUAL_INTENT_ORCHESTRATOR_PLAN.md](../design/CONTEXTUAL_INTENT_ORCHESTRATOR_PLAN.md)；上位契约 DL）
  - `CIO-P0` 设计文档 — `done`
  - `CIO-P1` shadow-mode 意图分类器 + 日志（`brains/contextual_intent/`，行为零变化）— `done`（2026-06-23）：`classifier.ts`（纯 regex/heuristic，<1ms）+ `types.ts`（ShadowContextualIntent schema）+ `index.ts`；`context_orchestrator.ts` fire-and-forget hook（`REMI_CIO_SHADOW_ENABLED` flag 默认开）；32 单测绿；tsc 零错误
  - `CIO-P2` ImageRegistry + 指代消解 — `done`（2026-06-23）：`image_registry.ts`（有序多图栈 + 4 规则指代消解纯函数）；types.ts 扩展 `ImageRegistryEntry` + `ShadowImageAxis.reference`；classifier.ts 接入指代消解；`image_generation_capability.ts` 生成图入栈 + `context_orchestrator.ts` 上传图入栈 + registry 传分类器；15 单测绿；仍 shadow-only
  - `CIO-P3` 接生图 + 看图消歧（flag）— `done`（2026-06-23）：`ShadowVisionAxis`（wantsLook/hasAttachment/referenceOnly）+ `classifyVision()` + `REFERENCE_IMAGE_RE`；`context_orchestrator.ts` 分类移到 vision sidecar 之后（解时序依赖坑），wired 模式 `REMI_CIO_WIRED_ENABLED`（默认关）下 `vision.wantsLook=true` 跳过 `resolveImageIntent`；10 单测绿
  - `CIO-P4` Performance Envelope（flag，单 owner）— `todo`，前提 P3 + DL-P1a + W-PRES-01
  - `CIO-P5` session voice override（flag）— `todo`，前提 P4

- [ ] **ROLEPLAY Performance 层**（设计：[ROLEPLAY_LAYER_DESIGN.md](../design/ROLEPLAY_LAYER_DESIGN.md)）
  - 沉淀过滤器（双层判定）+ Performance 生命周期 + 关系记忆隔离 — `todo`，前置 DL-P0-5（scope 列）+ DL-P1a（包裹化）

- [ ] **CC- 商业化 / 开源**（指南针：[COMMERCIAL_COMPASS.md](../design/COMMERCIAL_COMPASS.md)）—— 长线，P0 为开源前硬前置，当前不抢主线
  - `CC-P0-1` 移除私有依赖 `@jane-uske/yepanywhere` — `todo`（仍在 `package.json:56`，in-tree 零 import）
  - `CC-P0-2` NSFW 明文移出引擎 — `todo`（`brain/prompt_builder.ts` 仍含 `NSFW_PERSONA_BLOCK`）
  - `CC-P0-3` 清理 Live2D Hiyori Pro 版权 — `todo`（`web/public/live2d/hiyori-pro/` 仍在）
  - `CC-P0-4` 协议版本化 + dev 消息隔离 — `todo`
  - `CC-P0-5` Persona Package 格式 schema（`docs/design/PERSONA_PACKAGE_SPEC.md`）— `todo`（未建）
  - `CC-P0-6` 品牌视觉资产接入 + `BRAND_LICENSE.md` — `todo`（未建；需用户提供立绘源文件 + 定 CC 协议 W-6）
  - `CC-P1~P3` 架构拆分 / 商业化上线 / 生态 — 长线，暂不进执行板

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
- [ ] 对话质量数据驱动验收

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
