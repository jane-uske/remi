# Remi AI — TASKS

## 这份文档的用途

这份文档只回答三个问题：
- 现在最重要的任务是什么
- 哪些事情已经做完了
- 哪些事情还没做，且现在不该和主线程混在一起

当前主线程与交付边界，始终以 [CURRENT_FOCUS.md](CURRENT_FOCUS.md) 为准。
如果 `TASKS.md` 和其他文档冲突，以 `CURRENT_FOCUS.md`、`AGENTS.md`、实际代码状态为准。

---

## 当前主线程

**Memory V2 验证 + 读路径迁移（V2.1）**

当前目标不是继续堆功能。
当前目标是把人格记忆层从 V1 平稳迁移到 V2，并且不伤害实时交互质量。

### Current Execution Board

| ID | Task | Status | Exit Criteria | Next |
|---|---|---|---|---|
| `R-V2.1-01` | 验证 V2 写路径 | `done` | 真实对话写入 `episodes` 成功，抽样数据质量通过 | `observe` |
| `R-V2.1-02` | 切换 episode 读路径 | `done` | `recallEpisodes` / prompt 注入走 V2，回归通过 | `R-V2.1-03` |
| `R-V2.1-03` | 接通 proactive planner 到主路径 | `done` | `fireSilenceNudge()` 走 `planProactiveNudge()` 且行为正确 | `R-V2.1-04` |
| `R-V2.1-04` | 清理 V1 episode 旧路径 | `done` | 旧 episode 主路径移除后，关系连续性与回归测试通过 | `R-V2.1-01` |

状态枚举只允许：`todo` / `in_progress` / `blocked` / `done`。
每次任务状态变化，先改这个表，再改下方详细说明。

### 当前正在做

- [x] **R-V2.1-01** 验证 V2 写路径
  - 已完成：修复 `embedding_client` 环境变量兼容（`REMI_*` / `REM_*` / `EMBEDDING_*`）并统一旧 `llm/embeddings.ts` 到同一 fetch 链路
  - 已完成：修复 session 初始化 race；`brain.userId` 在连接构造时即绑定标准化 UUID，避免 `dev-user` 落入 pgvector 查询
  - 已完成：真实 WS 文本会话验收通过；`episodes` 行稳定写入且同主题成功 merge，抽样 `summary/topics/mood/unresolved` 合理
  - 验收证据：同一真实会话后 `episodes.recurrence_count` 增长到 `5`，`last_seen_at` 更新；本轮未再出现 `invalid input syntax for type uuid: \"dev-user\"` 或 `192 -> 768` embedding 警告
  - 剩余观察项：浏览器/UI 层建议再补一次手工 spot-check，但这不再阻塞 V2.1 主链路收尾

- [x] **R-V2.1-02** 切换 episode 读路径
  - 已完成：`retrievePromptMemory()` 已优先使用 `episodeStore.findRelevant()`；失败时回退 snapshot，避免硬切导致线上退化
  - 涉及位置：`memory/memory_agent.ts`、`brains/brain_router.ts`、`server/session/index.ts`
  - 证据：新增 `test/memory/prompt_memory_episode_store.test.ts`

- [x] **R-V2.1-03** 接通 proactive planner 到主路径
  - 已完成：`fireSilenceNudge()` 已优先走 `planProactiveNudge()`，并保留 legacy plan 回退
  - 涉及位置：`server/session/index.ts`、`brains/proactive_planner.ts`
  - 证据：新增 planner user-message 生成测试；类型检查与相关回归已通过

- [x] **R-V2.1-04** 清理 V1 episode 旧路径
  - 已完成：`PersistentRelationshipStateV1` 不再写出旧 `episodes/topicThreads` JSON；`memory/memory_agent.ts`、`brains/remi_session_context.ts`、`brains/slow_brain_store.ts` 主要读取侧已转向 `sharedMoments`
  - 已完成：`brains/slow_brain_store.ts::buildEpisodes()` / `buildTopicThreads()` 已移出主派生链并删除
  - 兼容策略：旧 payload 读取仍保留，避免历史数据恢复回退

### 当前明确不优先做

- [ ] **T-032** 口型同步
- [ ] **T-035.4** 前端情绪控制
- [ ] **T-035.5** 前端 emoji 与展示策略
- [ ] **T-040** 助手侧情绪推断 + 多维表情协议
- [ ] 新的插件 / capability 系统实现
- [ ] 与主线程无关的单点 VAD 阈值微调
- [ ] 只为展示效果服务的前端扩展

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

对应早期任务：T-001 ~ T-039 中的大多数基础建设项。

### M1 · 实时交互主链路已成型

- [x] Fast Brain / Slow Brain 双脑架构已落地
- [x] VAD / STT / TTS 主链路已接通
- [x] turn-taking 状态机已引入 `hold / likely_end / confirmed_end`
- [x] 打断语义已收口：被打断 partial 不污染正式历史 / 慢脑 / 正常持久化
- [x] `chat_end` 与本地 playback drain 已分离
- [x] 延迟指标与 duplex harness 已稳定，可用于回归比较

关键提交：
- `ee54d14` 阶段1增量 STT 改造
- `516356b` turn-taking 与 interruption continuity 增强
- `3cbe3b2` 阶段2 turn-taking 完成 + 测试覆盖
- `d1ae06e` 关系状态恢复链路接通 + turn-taking 打断偏置

### M2 · 在场感 / Avatar 表现层已达到可用 MVP

- [x] Avatar 协议、动作触发、控制器已接通
- [x] 3D 互动 MVP 已完成，可做离线演示与人工验收
- [x] 语音、情绪、状态与形象之间已有基本联动

关键提交：
- `effaf00` 3D 互动 MVP
- `25037a0` 本地开发、Avatar、语音工作流收口

### M3 · 人格与关系连续性 V1 已完成验收

- [x] per-user relationship state
- [x] reconnect continuity
- [x] relationship-aware prompt consumption
- [x] interrupted partial pollution guard
- [x] relationship-aware retrieval
- [x] proactive ledger / style slots / continuity policy 已接入

关键提交：
- `0a2236a` 关系层第一阶段核心实现
- `a930599` 扩展 PersistentRelationshipStateV1
- `e125b91` SlowBrainStore 关系记忆分层与主动策略引擎
- `367563c` relationship-aware 分层召回
- `551b2e9` 关系上下文双层注入
- `b6e59a3` Memory V1 验收完成

### M4 · Persona 骨架已进入可用状态

- [x] 基础 persona / character rules 已稳定存在
- [x] 最小产品骨架 Layer 2 + Layer 4 已接入
- [x] 已修复 4-layer skeleton 的关键持久化缺口
- [x] 已移除不符合产品方向的成人化回复规则

关键提交：
- `b2c856b` 最小 persona 骨架
- `1738718` 修复 3 个持久化缺口
- `829d9d4` 移除成人内容规则

### M5 · Memory V2 主链路已完成单路径验收

- [x] `llm/embedding_client.ts`
- [x] `episodes` 表与 repository
- [x] `episode_store` 编排层
- [x] slow brain 写路径双写 V1 + V2
- [x] `proactive_planner` 已实现
- [x] 文档已明确：当前是验证写路径、准备切读路径，而不是一次性硬切换完成态
- [x] prompt 读路径已优先接到 `episodeStore.findRelevant()`
- [x] silence nudge 主路径已接到 `planProactiveNudge()`
- [x] 真实 WS 文本会话写路径已验收，`episodes` 可稳定写入并合并

关键提交：
- `e41543d` PR1 — embedding client + episodes 表 + repository
- `691bdb4` PR2 — episode store
- `960d231` PR3a — slow brain 写路径双写
- `c7bb685` PR4 — proactive planner
- `42d9893` 文档确认进入验证阶段

### M6 · 已完成的小修与稳定性收口

- [x] memory value 更新后会失效旧 embedding，避免语义检索用旧向量
- [x] 多个文档已统一到当前主线程和当前产品北极星
- [x] fallback 报错文本不再进入 formal history / DB / slow brain，避免被后续 prompt 复读污染
- [x] 用户明确“先不聊某话题（如项目）”后，slow brain 会在短窗口内抑制 continuity/proactive 回拉
- [x] 用户已进入共创场景时，回复不再退回成“要不要我陪你想象”的重新开场
- [x] 修复 `embedding_client` 与 LM Studio/OpenAI SDK 兼容问题，恢复 768 维写路径
- [x] 修复 session `userId` 初始化 race，避免 `dev-user` 进入 V2 pgvector 查询
- [x] 文本回复链路新增第一版 `tone contract` / `anti-assistant` 基础设施，并补了初始语气评测样本骨架
- [x] 决策型问题新增 `answer-first` 控制位：用户在要判断或明确嫌你老反问时，优先直接回答，不再让 follow-up 抢优先级
- [x] 收口本地/远程访问语义：远程强制 JWT，本机回环可无 token 调试
- [x] 修复 access gate 与 JWT 冲突：持 token 的 HTTP/WS 请求可直通，不再被 cookie 门禁误拦
- [x] 前端聊天本地缓存改为按 token 用户分桶，避免不同用户共享同一份本地历史
- [x] `/vrm/*` 资源加入鉴权放行，修复 3D VRM 401 导致的加载失败
- [x] 语音 `stt_final` 已补一层轻量热词级局部同音纠偏：仅作用于 voice final transcript，固定词表驱动、默认关闭、词表失败时 fail-open；当前价值是压住项目名 / 人名 / 术语这类高频错词，避免继续污染 reply / memory / slow brain，但这还不是开放域 STT 消歧

关键提交：
- `4ab7237` embedding 失效修复
- `42d9893` 当前焦点文档更新
- `7a1707b` 本地/远程访问稳定化与 per-user chat 隔离

### 运行链路约束（后续 agent 必看）

- 本机开发入口 `http://localhost:3000/` 视为“开发主入口”，默认无 token，必须保留历史连续性。
- 远程入口（如 `https://app-rem.remi.run`）视为“分用户入口”，必须带 token，并保证用户隔离。
- `user_001` / `user_002` 等 token 用户的聊天缓存与持久化必须隔离，禁止出现前端本地缓存串号。
- 当 Docker daemon 不可用时，`prod:local:*` 脚本会失败；此时只能走原生 `npm run dev` / `npm run dev:app:once`，并显式标注“DB/Redis 未连接”风险。

---

## 当前未完成项

这些事情还没做完，但优先级不同。

### A. 当前主线程未完成

- [ ] 浏览器/UI 层 spot-check（不再阻塞 Memory V2 主链路完成判断）

### B. 并行但非主线程

- [ ] **I-001** iOS v0（文本）5 人内测闭环
  - 目标：完成 TestFlight 分发、5 人可稳定聊天、断线恢复、无跨用户历史串号
  - 当前状态：`ios/RemiChatLite` 文本基线已完成；Xcode 模板工程已接入文本聊天 UI、WS 文本流式、自动重连、JWT 优先鉴权、dev-key 兜底，以及按 JWT user-id 本地缓存隔离；已补 `IOS_V0_TESTFLIGHT_CHECKLIST`；已通过本地缓存 `user_001` / `user_002` 桶隔离回归脚本。最近一轮 iOS 文本侧又补了可感知性收口：assistant 回复前 loading 占位、顶部自动加载老历史且 prepend 不再强滚到底/明显丢锚、聊天 bubble 改成液态玻璃并保留 iOS 原生文本菜单。这些改动提升的是文本体验和可验收性，不代表 iOS 语音链路已经通过；当前按住说话仍无转文字、无回复反应，因此不计入本任务验收范围
  - 验收标准：5 人试用通过、无 P0 崩溃、无串号反馈
- [ ] **I-002** iOS 按住说话语音链路收口
  - 目标：让 `ios/RemiChatLite` 的按住说话至少达到“松手后稳定拿到 `stt_final`，并触发回复/TTS”的单路径可用
  - 当前状态：UI 已有 mic press-and-hold 入口，iOS 端可本地录音并发送 duplex PCM；已在服务端补上“收到音频但 VAD 未起时，duplex_stop 后做一次受限 STT fallback”的兜底，并已补回归测试覆盖 no-VAD speech / silence / sparse-noise 场景。当前进度从“静默失败”推进到“最小单路径已有代码级兜底”，但仍缺真机 iOS 复测，不能先算 done
  - 验收标准：真机下按住说话可稳定出现 transcript 或最终用户气泡，并触发 assistant 回复；异常时有明确错误态，而不是静默失败
- [ ] **T-041** 结构化回合解释层观察期与 eval 扩充
  - 目标：继续用真实 bad case 校准 `TurnInterpretation -> ResponsePolicy`，减少答非所问、过度追问、场景出戏和边界回拉
  - 当前状态：文本主链路、语音预判候选点和语音最终转写候选点已接入第一版结构化解释层；legacy regex 仍保留为 fallback / guard
  - 验收标准：真实 bad case 中 `先答后问`、`现实约束更新判断`、`场景承接`、`边界尊重` 误判率下降，且不引入明显首音/流式回退
- [ ] **T-042** Prompt / latency budget 收口
  - 目标：把“感觉慢”拆成可量化阶段，并优先压掉 fast path 上不必要的 prompt 体积
  - 当前状态：已新增 `memory_recall_ms`、`structured_turn_analysis_ms`、`input_to_llm_request`、`input_to_llm_first_token`；文本普通回合 prompt memory 已收回到 4 条，默认 history token budget 由 `1400 -> 1200`，priority context 缺省裁剪由 `700 -> 500`；普通文本 fast path 现已把 `priorityContext` 分层为最多 3 个高价值动态块；分析路径也已改成精选动态块，不再整段灌入 `slowBrainContext`
  - 当前判断：动态 prompt 收口是有效的，决策路径已从上轮样本的 `priorityChars≈2694 / 首 token≈10.9s` 回落到 `priorityChars=388 / 首 token≈4.13s`；但常驻 `systemChars` 再收一轮后（最小样本约 `478 -> 449`），真实 TTFT 没有稳定跟着下降，普通文本样本甚至出现 `17.5s` 波动，决策样本 25s 内未出首 token。当前更大的现实瓶颈是模型首 token 波动和运行时稳定性
  - 验收标准：普通文本首 token 继续下降，且 prompt 压缩不引入记忆/场景/边界明显回退
- [ ] **T-043** 资源监控告警口径收口
  - 目标：把“内存 97%/98%”这类误导告警替换成真实可用的进程内存告警
  - 当前状态：已把告警口径从 `heapUsed / heapTotal` 改成进程 `rss`、`heapUsed / heapLimit` 与告警节流；已补纯函数测试覆盖“高堆填充但安全”“rss 超阈值”“heap limit 逼近”“重复告警节流”
  - 当前判断：旧告警更多反映 V8 已分配堆的填充率，不等于服务快 OOM；当前更值得关注的是进程 RSS 趋势和系统整体内存压力
  - 验收标准：开发日志不再因为 `heapUsed / heapTotal` 高填充率刷假警报；当进程 RSS 或 heap limit 逼近阈值时仍能及时告警
- [ ] **T-040** 助手侧情绪推断 + 多维表情协议
  - 价值：后续 2.5D / 3D、情绪驱动表现层会更自然
  - 现状：可以并行设计，但不应抢占 Memory V2 主线程

### C. 前端 / 表现层待办

- [ ] **T-032** 口型同步
- [ ] **T-035.4** 前端情绪控制
- [ ] **T-035.5** 前端 emoji 与展示策略

### D. 长期方向，暂不进入当前执行板

- [ ] 插件 / capability 系统
- [ ] 直播 / 游戏 / 机器人 / 设备接入
- [ ] 跨终端持续在线存在层的具体实现

这些方向已经进入产品目标与架构约束，但不是当前迭代任务。

---

## 与代码现状不一致、已归档的旧表述

下面这些说法已经过时，不应再作为当前任务判断依据：

- “当前主线程是关系层第一阶段”
- “R-001 的目标是让 agent 知道当前主线程是关系层第一阶段”
- “按旧 Phase 顺序推进就等于当前优先级”

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
