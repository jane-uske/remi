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
  - 已完成：V2 prompt recall 已补“引用反馈”闭环；被选中的 `episode` 会回写 `last_referenced_at`，prediction-only 路径保持只读，不污染真实引用信号
  - 已完成：召回 trace 已补 `episodeRecallSource / episodeRecallIds / episodeReferenceApplied / episodeRecallFallback`
  - 涉及位置：`memory/memory_agent.ts`、`brains/brain_router.ts`、`server/session/index.ts`
  - 证据：新增 `test/memory/prompt_memory_episode_store.test.ts`

- [x] **Runtime defaults** 本地验证口径与 TTS 默认值收口
  - 已完成：`npm run dev` 现在会在默认 Memory V2 配置下先自动拉起 `postgres` / `redis`；Docker 不可用时直接报错停掉，而不是继续让 `3001` 跑在“DB/Redis 断开”的假验证态
  - 已完成：`.env.localhost` / `.env.local-prod` 默认 TTS 已收回 `edge`；`volc` 改成手动注释入口，避免额度耗尽时继续默认走 `403 -> fallback` 坏链路
  - 已完成：local-prod 入口已拆成 `prod:local:start / build / rebuild`；`start` 不再默认重建镜像，`.dockerignore` 也已排除 `node_modules / web/.next / .git / artifacts / dist` 等大目录，减少 production-like 本地验证的伪等待
  - 证据：新增 `test/scripts/dev_storage_bootstrap.test.ts`、`test/scripts/local_env_defaults.test.ts`、`test/scripts/local_prod_scripts.test.ts`

- [x] **R-V2.1-03** 接通 proactive planner 到主路径
  - 已完成：`fireSilenceNudge()` 已优先走 `planProactiveNudge()`，并保留 legacy plan 回退
  - 已完成：planner 选中的 V2 `episode` 在搭话成功后会补 `markReferenced()`，避免 unresolved 线只会被反复捞起、不会产生引用反馈
  - 涉及位置：`server/session/index.ts`、`brains/proactive_planner.ts`
  - 证据：新增 planner user-message 生成测试；类型检查与相关回归已通过

- [x] **R-V2.1-04** 清理 V1 episode 旧路径
  - 已完成：`PersistentRelationshipStateV1` 不再写出旧 `episodes/topicThreads` JSON；`memory/memory_agent.ts`、`brains/remi_session_context.ts`、`brains/slow_brain_store.ts` 主要读取侧已转向 `sharedMoments`
  - 已完成：`brains/slow_brain_store.ts::buildEpisodes()` / `buildTopicThreads()` 已移出主派生链并删除
  - 已完成：补了显式 `workingMemory` 层（3 turn TTL、reconnect-only 持久化、独立 `【当前上下文】` prompt block），让短期上下文不再只靠 `history + sharedMoments` 拼出来
  - 已完成：V2 lifecycle 已加第一版 flag 化状态机：`active / cooling / resolved` 与 `unresolved` 同步，解决 episode 只积累不收口的问题
  - 兼容策略：旧 payload 读取仍保留，避免历史数据恢复回退
  - 已完成：persona live state 已补第一版 `relationalStance`，当前会沿 relationship/proactive snapshot 稳定派生关系姿态，并透传到 prompt / proactive planner；这属于“关系表达方式”增强，不是大规模 persona 重写

- [ ] **Memory V2 真实质量观察（observe / blocked）**
  - 当前状态：本地/开发环境缺少新的可审计 `episodes` 与足够多样的真实用户样本；继续围绕 `memory:v2:audit / hygiene` 扩工具，只会得到低信号 proxy 结论
  - 当前边界：保留现有 `audit / hygiene` readiness，不再为了“验证而验证”继续扩脚本或规则
  - 解锁条件：出现新的真实 `episodes` 样本，或出现足够多样的真实用户对话可供抽样人工复核
  - 空窗期更该做：embedding 健康门槛、browser duplex runtime spot-check、iOS 内测验收

### 当前明确不优先做

- [ ] **T-032** 口型同步
- [ ] **T-035.4** 前端情绪控制
- [ ] **T-035.5** 前端 emoji 与展示策略
- [ ] **T-040** 助手侧情绪推断 + 多维表情协议
- [ ] 新的插件 / capability 系统实现
- [ ] 与主线程无关的单点 VAD 阈值微调
- [ ] 只为展示效果服务的前端扩展
- [ ] 在当前阶段扩成自建邮箱密码 / 找回密码 / RBAC / 账号设置中心

### 并行支线（不抢主线程）

- [x] **A-011** Web 登录底座（Clerk, Web First）
  - 已完成：服务端认证模式收口到 `disabled / legacy_jwt / clerk`，并保留 legacy JWT 兼容
  - 已完成：新增 `user_auth_identities`，正式身份会先映射到内部 UUID，再继续落 `sessions/messages/memories/episodes`
  - 已完成：Web 主入口已接入 Clerk Provider / sign-in 页面 / client gate；聊天 WS 会优先带 Clerk session token 建连
  - 已完成：前端本地缓存已支持按 Clerk user id 分桶；legacy query token 仍保留兜底
  - 已完成：本地开发与 local-prod 入口已在脚本层拆开：`npm run dev` 默认 `3001` 且走 `.env.localhost`，`npm run prod:local:start` 固定 `3000` 且走 `.env.local-prod`，避免域名 tunnel 与本地开发继续抢同一端口
  - 已完成：`npm run prod:local:start` 不再偷偷重建镜像；要吃新前后端代码时，必须显式跑 `npm run prod:local:build` 或 `npm run prod:local:rebuild`
  - 未完成：真实邮箱双账号 smoke、账号管理页
  - 结论边界：这只是“正式身份闭环第一版”，不是完整账号系统，更不是多端连续性验收

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
- [x] 文档已明确：Memory V2 主链路已完成单路径验收，当前进入观察期与补证据阶段，而不是一次性硬切换完成态
- [x] prompt 读路径已优先接到 `episodeStore.findRelevant()`
- [x] silence nudge 主路径已接到 `planProactiveNudge()`
- [x] 真实 WS 文本会话写路径已验收，`episodes` 可稳定写入并合并
- [x] Memory V2 启发式审计工具已落地：`npm run memory:v2:audit -- --user <user-id>` 可生成 episode 质量观察报告
- [x] Memory V2 存量治理最小脚本已落地：`npm run memory:v2:hygiene -- --user <user-id> [--lang zh] [--apply]` 可按规则包做 dry-run / apply 级别归档；当前仅内置中文规则，但接口已按多语言扩展形态组织
- [x] embedding 降级观测已补到主链路：写路径 / 召回失败会带结构化健康状态，不再只是零散报错
- [x] V2 recall / proactive 引用反馈已接通：prompt recall 与 silence nudge 成功路径都会更新 `last_referenced_at`
- [x] `episode` lifecycle 第一版已落地：`active / cooling / resolved` 受 `REMI_EPISODE_LIFECYCLE_ENABLED` 控制，默认仍关闭，不再长期只靠 `unresolved` 布尔值漂移
- [x] 短期显式 `workingMemory` 已接入文本主链路：仅用于 prompt 当前上下文与 reconnect 恢复，受 `REMI_WORKING_MEMORY_ENABLED` 控制，默认仍关闭；它不扩 prompt 预算，也不当作长期 episode 写入
- [x] 浏览器 text `workingMemory` spot-check 已通过：在正确的本地 `3001` 进程并显式打开 `REMI_WORKING_MEMORY_ENABLED` 后，真实浏览器样本已观察到 `currentContextChars = 109 / 116 / 113`，覆盖决策题、现实约束更新和 reload / reconnect 后继续追问；记录见 `docs/MEMORY_V2_BROWSER_TEXT_SPOTCHECK_2026-04-19.md`

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
- [x] 用户可选 persona presets V1 的表达层链路已接通并完成定向回归：Web 端可读写并恢复 4 个规范化表达风格预设，session/bootstrap/prompt 会消费同一 preset 状态；当前实现边界仍是“共享同一套 memory / relationship state，只改表达风格”，这不等于所有 continuity 场景都已被充分验证；当前也不支持 free-form persona prompt authoring
- [x] persona prompt 表现层已补 `灵魂底色 / 关系偏向 / 风格执行` 三层提示：开始把 preset 从“表达标签”推进到“关系偏向 + 风趣/浪漫执行规则”，并让 closeness / mood / relational stance 共同约束亲密度与风格力度；当前仍只是 prompt 控制增强，不等于真实聊天体感已经完成验收
- [x] persona prompt 已补第一版“比喻型抱怨”执行规则：像 `像被谁偷偷拔了电源`、`像开了十个标签页`、`像工伤` 这类用户自带画面的抱怨，会在 prompt 里额外得到 `【比喻接梗执行】` 指令，要求先顺着原句画面接一句，再决定是否追问；这能减少直接掉回 `泛化安抚 + 盘问原因` 模板，但当前仍只是 prompt 级收口，不等于幽默风趣体感已经验收通过
- [x] persona prompt 已补第一版“用户显式风格指令 override”：用户自然说 `有趣点 / 毒舌一点 / 别这么像助手 / 像熟一点的人一样说话 / 扮演更会撩更会贫的人` 这类话时，会在当前 session 内形成一个短期 style override，并通过 `【当前风格要求】` 进入后续几轮 prompt；它解决的是“用户一句话能不能立刻把说话风格掰过来”这个效果层问题，不涉及 memory 归属变更，也还不等于长期人格进化能力已经成立
- [x] persona style override 已迁入 `turn_interpreter` 主链路的第一版 `styleIntent`：当前会优先由 LLM/heuristic structured analysis 识别“更有趣 / 少一点助手味 / 更像熟人 / 轻一点毒舌 / 更会撩 / 说话做事风格扮演”这类短期风格意图，再写入 session 级 `styleOverride`；旧 regex 已收缩成显式设置/清除 fallback。与此同时，slow brain 会把这些要求记成弱候选 `responseStyleNotes`，跨 session 仅作低优先级参考，不会自动恢复成 override；当前这仍属于效果层控制增强，不等于多轮聊天体感已经稳定验收
- [x] OpenClaw `SOUL.md / IDENTITY.md / USER.md` 已完成一轮 A/B 提炼实验：原始注入能显著增强偏爱感，但会把 Remi 带偏成强角色人格；提炼后的 `Remi-safe soul overlay` 在保持风趣/偏爱增益的同时，明显更贴近 Remi 自身边界。记录见 `docs/evals/2026-04-19-remi-soul-overlay-ab.md`
- [x] `/vrm/*` 资源加入鉴权放行，修复 3D VRM 401 导致的加载失败
- [x] 语音 `stt_final` 已补一层轻量热词级局部同音纠偏：仅作用于 voice final transcript，固定词表驱动、默认关闭、词表失败时 fail-open；当前价值是压住项目名 / 人名 / 术语这类高频错词，避免继续污染 reply / memory / slow brain，但这还不是开放域 STT 消歧
- [x] 已补一个真实 TTS 踩坑结论：本地 `Kokoro-ONNX` 在当前 M5 开发机上虽然能跑，但试听结果证明“语速偏慢、语调单调、情绪弱”，不适合作为 Remi 默认声线方向；现阶段不再继续投入本地重模型换声方案
- [x] 已发现并修复一个 `edge` TTS shortlist 验证 bug：短句 TTS 内存缓存曾只按 `provider + emotion + text` 命中，未把 `voice / rate / pitch` 纳入 key，导致“切不同 Edge 声线却听起来完全一样”的假象；后续做换声验证时，必须先确认缓存维度包含声线参数
- [x] 已确认当前 `edge` consumer WebSocket 路线在高频批量切 voice 时稳定性一般；因此后续声线试听应优先走小批量、串行验证，不要再一次性批量 sweep 很多 voice

关键提交：
- `4ab7237` embedding 失效修复
- `42d9893` 当前焦点文档更新
- `7a1707b` 本地/远程访问稳定化与 per-user chat 隔离

### 运行链路约束（后续 agent 必看）

- 本机开发入口 `http://localhost:3001/` 视为“开发主入口”，默认无 token，必须保留历史连续性。
- 本机 production-like 入口 `http://localhost:3000/` 视为 local-prod / tunnel 目标，默认保持 Clerk 或正式 auth 口径，不要再让 dev 进程抢占它。
- 远程入口（如 `https://app-rem.remi.run`）视为“分用户入口”，当前默认应落到本机 `3000` 上的 local-prod 进程，并保证用户隔离。
- `user_001` / `user_002` 等 token 用户的聊天缓存与持久化必须隔离，禁止出现前端本地缓存串号。
- 当 Docker daemon 不可用时，`prod:local:*` 脚本会失败；默认 `npm run dev` 也会因为拉不起 `postgres` / `redis` 而直接失败。只有显式设 `REMI_DEV_AUTO_STORAGE=0` 时，才允许退回原生无存储 dev，并明确标注“DB/Redis 未连接，不是完整 Memory V2 运行口径”。

---

## 当前未完成项

这些事情还没做完，但优先级不同。

### A. 当前主线程未完成

- [ ] Memory V2 真实质量审计
  - 目标：不只确认 `episodes` 会写，还要确认“写得像同一条关系主线”
  - 当前状态：`memory:v2:audit` 入口现已可直接吃 `.env`；第一轮真实样本已暴露 `episode` 过度合并与 repeated resurfacing，随后已补写入口守门、召回反统治和 core 判定收紧。主样本 `repeatedResurfaceRate` 已从 `0.923` 降到 `0`
  - 当前补强：人工复核后已落地最小存量治理脚本 `memory:v2:hygiene`，会把中文开发测试 / meta prompt / 低价值 filler episode 标成 `archived` 并从 recall 排除；真实样本 dry-run 当前能抓到最明显的一批污染候选，且不会误伤已确认的工作/财务压力主线
  - 当前剩余：`duplicateLineRate` 仍高（主样本 `6.214`），说明存量脏 episode / 碎片 episode 还在；但当前推进也受制于新数据不足。现阶段这条任务的真实状态应视为 `blocked / observe`，不是继续硬推 apply / 规则扩充
  - 验收标准：至少一批真实样本产出审计报告，并能回答错合并 / 漏召回 / 重复回捞 / unresolved 命中四类问题的量级
- [ ] 浏览器/UI 层 duplex/runtime spot-check（不再阻塞 Memory V2 主链路完成判断）
  - 当前状态：浏览器文本 workingMemory spot-check 已通过，记录见 `docs/MEMORY_V2_BROWSER_TEXT_SPOTCHECK_2026-04-19.md`；文本主链路里 `【当前上下文】` 注入与 reconnect 承接已不是当前缺口
  - 已确认：决策更新、话题切换、边界尊重、轻松话题切换、刷新后接续都没有明显文本回退；`workingMemory` 注入也已在真实浏览器样本里成立
  - 剩余缺口：仍缺更多真实浏览器 duplex/noisy runtime 样本；当前不能把 turn-taking 和 open-mic 体验直接说成稳定
- [ ] embedding 运行时健康门槛
  - 目标：把“环境缺失时人格连续性静默掉级”变成可见、可判定、可追踪的问题
  - 当前状态：已补 health snapshot 与降级告警；还没有形成正式的运维阈值、报警策略或 dashboard 口径

### B. 并行但非主线程

- [ ] **I-001** iOS v0（文本）5 人内测闭环
  - 目标：完成 TestFlight 分发、5 人可稳定聊天、断线恢复、无跨用户历史串号
  - 当前状态：`ios/RemiChatLite` 文本基线已完成；Xcode 模板工程已接入文本聊天 UI、WS 文本流式、自动重连、JWT 优先鉴权、dev-key 兜底，以及按 JWT user-id 本地缓存隔离；已补 `IOS_V0_TESTFLIGHT_CHECKLIST`；已通过本地缓存 `user_001` / `user_002` 桶隔离回归脚本。最近一轮 iOS 文本侧又补了可感知性收口：assistant 回复前 loading 占位、顶部自动加载老历史且 prepend 不再强滚到底/明显丢锚、聊天 bubble 改成液态玻璃并保留 iOS 原生文本菜单。这些改动提升的是文本体验和可验收性，不代表 iOS 语音链路已经通过；当前按住说话仍无转文字、无回复反应，因此不计入本任务验收范围
  - 验收标准：5 人试用通过、无 P0 崩溃、无串号反馈
- [ ] **I-002** iOS 按住说话语音链路收口
  - 目标：让 `ios/RemiChatLite` 的按住说话至少达到“松手后稳定拿到 `stt_final`，并触发回复/TTS”的单路径可用
  - 当前状态：UI 已有 mic press-and-hold 入口，iOS 端可本地录音并发送 duplex PCM；已在服务端补上“收到音频但 VAD 未起时，duplex_stop 后做一次受限 STT fallback”的兜底，并已补回归测试覆盖 no-VAD speech / silence / sparse-noise 场景。本轮继续沿关键路径收口了两层：1) iOS 客户端 PCM 改为串行发送队列，`duplex_stop` 不再在松手瞬间立刻发出，而是短暂等待尾部音频 frame 尽量送完，避免 stop 抢在末尾 PCM 之前导致服务端把尾包直接丢掉；2) 服务端现在明确区分 `push_to_talk` 和开放式 `duplex`，对 `push_to_talk` 放宽“弱语音 / no-preview / no-VAD fallback”抑制，避免把显式按住说话的低能量 iPhone 输入整段吞掉。相关 session 回归测试已覆盖 `push_to_talk` 低能量 no-VAD 样本并通过，但仍缺真机复测和当次服务日志证据，不能先算 done
  - 验收标准：真机下按住说话可稳定出现 transcript 或最终用户气泡，并触发 assistant 回复；异常时有明确错误态，而不是静默失败
- [ ] **T-041** 结构化回合解释层观察期与 eval 扩充
  - 目标：继续用真实 bad case 校准 `TurnInterpretation -> ResponsePolicy`，减少答非所问、过度追问、场景出戏和边界回拉
  - 当前状态：文本主链路、语音预判候选点和语音最终转写候选点已接入第一版结构化解释层；legacy regex 仍保留为 fallback / guard
  - 验收标准：真实 bad case 中 `先答后问`、`现实约束更新判断`、`场景承接`、`边界尊重` 误判率下降，且不引入明显首音/流式回退
- [ ] **T-042** Prompt / latency budget 收口
  - 目标：把“感觉慢”拆成可量化阶段，并优先压掉 fast path 上不必要的 prompt 体积
  - 当前状态：已新增 `memory_recall_ms`、`structured_turn_analysis_ms`、`input_to_llm_request`、`input_to_llm_first_token`；文本普通回合 prompt memory 已收回到 4 条，默认 history token budget 由 `1400 -> 1200`，priority context 缺省裁剪由 `700 -> 500`；普通文本 fast path 现已把 `priorityContext` 分层为最多 3 个高价值动态块；分析路径也已改成精选动态块，不再整段灌入 `slowBrainContext`
  - 已完成：voice final turn 进入 `runPipeline()` 前会先取消 partial prediction，避免后台预判继续占用同一 LLM/runtime 把正式回复首 token 人为拖慢；已补回归测试锁住“先 cancel，再 final，已完成预判仍可复用快照”。另外已确认 Edge consumer 端点当前拒绝 PCM `outputFormat`，流式 TTS 已改为请求受支持的 MP3 流并在服务端实时转成 `pcm16le` 后继续发送 `voice_pcm_chunk`；直接 `streamTextToSpeech()` 实测首个 PCM chunk 约 `1.75s`，重启服务后的 live duplex probe 已重新收到 `voice_pcm_chunk`，短句样本 `duplex_stop -> firstVoice` 约 `5.24s / 5.16s`
  - 已完成：duplex 语音链路这轮继续收口了三个真实回归点，不再让 `pipelineChain` 把 STT 排队放大。服务端现在会在 `speech_end` / `duplex_stop` 立即冻结 `DuplexUtteranceJob`，把 STT decode 从 assistant pipeline 串行链里拆到独立 `sttChain`，并给每条 utterance 打 `utteranceSeq` / `sttJobSeq`；`prepareVoicePipelineTurn()` 负责提前发出 `stt_final` 与 `assistant_entering`，只有真正的 LLM/TTS 生成仍挂在 `pipelineChain` 后。这样一来，`queueWaitMs` 只反映 STT 自己的等待，不再被上一轮回复拖成 `7s / 22s`。同时已补上非 16k ingress 的服务端线性重采样与诊断日志，`audio_without_vad` 现在会明确区分 `true_silence`、`weak_low_energy_audio`、`speech_shape_not_confirmed`、`non_16k_normalized_still_no_vad`，并会在 stale job 晚到时明确记录 `[STT] dropped_stale_utterance`
  - 已完成：开发环境 logger 现在默认自动落盘到 `artifacts/live/dev_server_*.log`，不再依赖额外 `tee` 才能复盘 localhost 实例；`logs:data-entry` 与 `duplex:data-entry` 也已经把这些 live logs 提升为主入口，避免继续误读过期的 `rem-ai.log`
  - 已完成：LLM 流式打点口径已进一步拆开，新增 `llm_first_raw_chunk`、`llm_first_reasoning_chunk`、`llm_first_visible_content` 及对应 duration；这样可以明确区分“上游已开始流”“上游正在吐 reasoning”“用户真正看到正文”三件事，避免继续把 reasoning stream 误当成正文首包
  - 已完成：已确认当前 `api/coding/v3` 路线支持在顶层传 `reasoning_effort=minimal` 来压掉 fast path 的 reasoning stream；此前 `extra_body` 试法无效，导致误以为路由不支持。现在 fast brain / partial prediction 已支持通过 `REMI_FAST_BRAIN_REASONING_EFFORT` 显式覆盖推理强度，本地默认已切到 `minimal` 以优先压 `llm_first_visible_content`
  - 已完成：本机损坏的 `ggml-medium.bin` 已替换为官方可加载版本，dev 语音链路已切到 `whisper-server + ggml-medium.bin`。真实语音样本里 `transcribeMs` 已从 `2328 / 2498ms` 降到 `924 / 1082 / 1413ms` 量级；同时服务端现在会把 `fallback_energy` 下被 pre-STT suppress 的短片段暂存到 `duplex_stop`，再用一条更保守的 recovered-fallback 规则做一次补救式 STT，避免“短笑声 / 短反馈 / 软声插话”被整段吞掉，同时继续压住长垃圾 hallucination。相关 turn-taking / duplex regression 已补回归测试通过，但这仍只是 dev 单路径收口，不代表多场景稳定
  - 已完成：已针对两条真实 duplex 状态机误判做了成对修复。服务端现在不会再把弱 `fallback_energy` 开口立刻广播成 `vad_start`，而是等到它拿到更像真实说话的证据后才把前端拉进“正在听”；同时在 correction 句子已进入 `semantic_hold` 的窗口里，极弱 fallback restart 不再轻易打断 pending commit，避免“明明已经说完、preview 也对了，却一直不提交，最后被 stale drop”的情况。前端也补了本地 `识别中…` 占位状态和超时兜底，不再在 `vad_end` 后立刻假装空闲。相关回归已锁住“弱噪声不再误触发 listening UI”和“pending correction commit 不再被弱重开口冲掉”
  - 已完成：这轮继续针对真实 noisy duplex 样本收了三条更贴近体感的回归。1) interrupted assistant run 现在在 abort 后不会再傻等卡住的 TTS promise，`pipelineChain` 会更早释放，避免下一条像“等一下,等一下,我让你记录一下。”这种语音明明已出 `stt_final`，却还要在 `llm_request_start` 前被旧 generation 清理/收尾硬拖数秒；2) duplex interrupt 确认现在不会只靠 `fallback_energy + 时长` 成立，弱能量、弱 speech shape、无 meaningful preview 的键盘/环境噪声不再轻易打断 Remi；3) 即使弱噪声已经走进 `speech_buffer -> STT` 主路径，`谢谢!`、`谢谢观看!` 这类短、弱、无上下文支撑的 hallucination 也会在 post-STT suppression 被拦下。相关 session / pipeline regression 已补测通过，但这仍只是“单路径回归已收口”，还缺新的 localhost 真实噪声日志来证明多场景稳定
  - 已完成：turn-taking Phase 1 这轮继续沿“规则+韵律优先”收口。final STT 现在会在提交前拒绝 `"[音乐]"`、`"[笑声]"`、`"谢谢观看"` 这类非语义 transcript，并把 `rejectedReason / rejectedTranscript / rejectedSource` 写进 latency trace；`TURN_PROSODY_ENABLED` 缺省改为开启，`decideTurnTaking()` 新增了基于尾部能量下降 + pitch 下行 + 短静音的 `prosody_fast_release`，把这类明确句末的 release target 收到约 `480ms`；同时 recovered fallback 对 `2–6` 字弱、无 preview 的短假词改为默认 suppress，而正常 `speech_buffer` 主路径的短真实反馈仍可通过。还新增了 `TurnTakingPredictor.score()` 的 heuristic 接口，但当前只作为 interrupt / recovered-fallback / non-speech reject 的辅助门控，不引入模型 sidecar，不代表 Phase 2 已启动
  - 已完成：这轮又补了两个更接近真实 noisy localhost 的漏洞。1) assistant-speaking 下的 duplex interrupt gate 不再让 `strict` 路径直接绕过噪声门槛，低置信 strict burst 现在也会延后 `vad_start` / preview 外显，并要求更强证据后才允许真正 interrupt；这条是为 `Teddy`、键盘声、环境音把 Remi 提前打断的坏样本服务的。2) `runPipeline()` 在 abort 后不再继续傻等 `avatarIntentTask`，`avatar intent` 改成和 abort 做竞态等待，避免像“刚起床”这类语音 STT 明明很快，却还在 `llm_request_start` 前被上一轮被打断的 generation 卡上 `7s+`。相关 regression 已补过，但这仍只证明代码层回归收口，不代表 noisy 实机链路已经验收通过
  - 已完成：这轮继续收了两个更贴近真实用户抱怨的剩余边界。1) server 现在单独维护 `assistantPlaybackActive / playbackGenerationId`，并接上前端 `playback_end` 回传，所以即使服务端 generation 已经自然结束、客户端还在播缓存音频，用户再说“等一下先别说”也仍然能向对应 generation 发出真正的停播 `interrupt`，不再要求 `interrupt.active` 还活着。2) recovered fallback 现在对短礼貌词更保守，`谢谢`、`谢谢呀`、`喂喂喂` 这类弱、无 preview 的 stop-time 幻觉会直接 suppress，不再像之前那样漏成 `[用户·语音 fallback/recovered] 谢谢!`。相关 duplex regression 与 typecheck 已通过，但这仍只证明“代码 + 回归”收口，尚未证明 noisy localhost 实测已经过线
  - 已完成：这轮继续把“长时间开麦空闲后再开口变慢”的 runtime blocker 往前收口。服务端新增了 `duplexIdleGuardActive / duplexIdleSince / lastMeaningfulSpeechAt / lastAcceptedSpeechAt`，在 duplex 长时间空闲后会先挡住低价值环境噪声，不再让它们轻易形成 `speech_buffer -> STT` job；同时每条 STT job 现在都显式带 `high|low` 优先级、`allowCliFallback`、可中断 `AbortController`，新的高价值语音到来时会优先抢占正在转写的低价值 job，并把 stale 仲裁前移到 `before/during transcribe`，而不是等坏 job 先跑完十秒再判 stale。`whisper-server` 运行时也新增了 request-level degraded window：一旦请求超时/abort，短时间内低价值 job 会直接 skip，不再反复先吃一轮 server timeout 再掉到 `whisper-cli`；高价值 job 则直接走 degraded 路径，避免真实用户语句被前面几条 idle 噪声一起拖慢。latency trace / session log 也已补上 `sttPath`、`sttFallbackReason`、`sttJobPriority`、`sttQueueBlockedByPriorJob`、`idleGuardActive`、`sttPreemptReason`、`sttRequestDegraded`。相关 regression 与 runtime 测试已通过，但这仍只证明“代码层 + 回归层已收口”，并不等于 localhost 长时间 open-mic 场景已经验收通过
  - 当前判断：这轮修复解决的是“语音链路既慢又乱”的真实回归点，不是把整条语音体验拉回生产可用。现在 `voice_pcm_chunk` 已恢复、STT 不再被旧 pipeline 串行卡住、interrupt 后的旧转写也会被硬丢弃；但 live trace 里 `speech_end -> stt_final` 和 `stt_final -> llm_first_token` 仍是更大的现实瓶颈，说明剩余关键路径已经收敛到 STT 终结延迟和远程 LLM 首 token 波动，而不是协议层和调度边界
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
