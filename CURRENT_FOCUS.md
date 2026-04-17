# CURRENT_FOCUS.md

## 一句话

Memory V2 基础设施、prompt 读路径、proactive planner 主路径和真实 WS 文本会话写路径验收都已完成；V1 旧 episode 派生主路径也已收口。当前阶段不再是“主链路未通”，而是“单路径已验证，进入观察与前端 spot-check”。

这条主线程服务的不是“再做一个记忆功能”，而是终极目标里最重要的一层之一：
让 Remi 更像一个持续存在的人，而不是每轮都重置的聊天框。

放进当前总纲里看，它属于三层路线图中的“人格记忆层”：
- 实时交互层
- 人格记忆层
- 跨终端存在层

当前先把第二层做扎实，后面的多端接续和持续在线存在感才有真正可靠的基础。
未来的 plugin / capability 扩展，也必须建立在这个基础之上，而不是反过来污染核心链路。

## 当前最高优先级

Memory V2 验收收尾与观察期

## 当前进度

### Memory V2 基础设施（已完成）
- ✅ `llm/embedding_client.ts`：OpenAI 兼容 embedding 客户端（nomic-embed-text, 768 维）
- ✅ `storage/schema.sql`：新增 `episodes` 表 + 向量索引；`memories.embedding` 改为 768 维
- ✅ `storage/repositories/episode_repository.ts`：insert / update / findSimilar / getByUser / getUnresolved / delete
- ✅ `storage/repositories/vector_utils.ts`：共享向量工具函数
- ✅ `memory/episode_store.ts`：ingest（语义合并 / 新建） / findRelevant（综合分排序） / listUnresolved / markReferenced
- ✅ `brains/proactive_planner.ts`：关系阶段门控 + 退避门控 + 冷却门控 → care / follow_up / presence
- ✅ `brains/slow_brain.ts`：写路径双写 — V1 recordSharedMoment + V2 episodeStore.ingest
- ✅ `brains/slow_brain_store.ts`：getSnapshot() 派生缓存 memoize
- ✅ 22+ 单测全部通过

### 当前状态
- ✅ `memory/memory_agent.ts::retrievePromptMemory()` 已优先走 `episodeStore.findRelevant()`；召回失败时安全回退到 snapshot episode
- ✅ `server/session/index.ts::fireSilenceNudge()` 已优先走 `proactive_planner.planProactiveNudge()`；planner 失败时安全回退到 legacy nudge plan
- ✅ 观察期补强第一轮已落地：V2 recall / proactive 成功路径都会回写 `last_referenced_at`，prediction-only 保持只读；latency trace 也已能记录 `episodeRecallSource / episodeRecallIds / episodeReferenceApplied / episodeRecallFallback`
- ✅ `episode` lifecycle 第一版已落地，并通过 `REMI_EPISODE_LIFECYCLE_ENABLED` 控制：`active / cooling / resolved` 与 `unresolved` 同步，开始解决“episode 只积累、不收口”的问题；默认仍关闭，这仍只是状态机接通，不等于真实多天关系质量已经验收
- ✅ 短期显式 `workingMemory` 已接入文本主链路：作为独立 `【当前上下文】` prompt block 注入，并通过 relationship-state payload 做 reconnect 恢复；当前受 `REMI_WORKING_MEMORY_ENABLED` 控制，默认仍关闭。它解决的是“当前这几轮到底在处理什么”更稳定，不是 full cross-device continuity
- ✅ 人格 live state 已补第一版 `relationalStance`：由 slow brain relationship / proactive state 派生 `boundary / soothingStyle / proactiveCadence / expressionDirectness`，并注入 persona prompt；这解决的是“同一个人怎么接”的稳定性，不是“更会写人设文案”。当前仍只是轻量姿态层，不是长期自我模型
- ✅ `llm/embedding_client.ts` 已绕开 LM Studio / OpenAI SDK 兼容问题；直接请求本地 endpoint，并强校验 768 维
- ✅ embedding 依赖已补运行时健康快照与降级观测：配置缺失 / endpoint 不可达 / 维度异常时，slow brain 写路径与 prompt recall 回退都会打结构化告警；这解决的是“静默退化看不见”，不等于已经建立生产级 embedding 健康治理
- ✅ 访问链路已收口：远程域名要求 JWT token，本机回环地址允许无 token 调试
- ✅ `REMI_ACCESS_PASSWORD` 与 JWT 共存时，持有效 token 的请求可直通，不再被 access-cookie 门禁误拦
- ✅ 前端本地聊天缓存已按 token `id` 隔离；无 token 继续使用默认缓存（保留开发者本地历史）
- ✅ iOS v0（文本）内测基线已建立：`ios/RemiChatLite` 具备 WS 文本流式、自动重连、JWT 优先鉴权、dev-key 兜底，以及按 JWT user-id 本地缓存隔离
- ⏳ iOS 语音链路仍未验收通过：此前真机反馈是“无转文字、无回复反应”；本轮已把 iOS 前端语音入口拆成独立 `按住说话` 与实验性 `duplex` 按钮，并让 `duplex` 进入独立 full-screen voice demo scene，作为后续 3D Rem / voice mode 的壳；录音/TTS 也已收口到共享 `AVAudioSession`，前端本地不再天然把录音和播报互相打死。最新又沿关键路径补了两层收口：一是 iOS 端 stop/drain 时序修复，PCM 改为串行发送队列，`duplex_stop` 会短暂等待尾包发送，避免 stop 抢在末尾音频之前把服务端输入直接截断；二是服务端开始区分 `push_to_talk` 与开放式 `duplex`，对 `push_to_talk` 放宽弱语音/no-preview/no-VAD fallback 抑制，避免把显式按住说话的低能量 iPhone 输入整段吞掉。现阶段这只能说明代码级主怀疑点已继续收口，不代表真机上的回声消除、转写稳定性和打断体验已经成立。除该点外，iOS 文本/连接/鉴权/缓存主链路已基本打通。现阶段不要把 iOS 端语音输入误判为稳定可用能力
- ✅ 写路径后端已直连验证通过：`runSlowBrain -> episodeStore.ingest -> Postgres episodes` 能落表
- ✅ 真实 WS 文本会话验收已通过：`episodes` 在真实连接上稳定写入并合并，同主题 `recurrence_count` 持续增长；本轮未再出现 `dev-user` UUID 查询报错或 `192 -> 768` embedding 降级
- ⏳ 浏览器/UI 层已补一轮正向文本 spot-check：决策更新、话题切换、边界尊重、轻松话题切换、刷新后接续都没看到明显回退，记录见 `docs/MEMORY_V2_BROWSER_TEXT_SPOTCHECK_2026-04-17.md`；但这还不是完整前端手工回归
- ⏳ 这轮 browser text spot-check 里 `currentContextChars` 仍为 `0`，说明新 `workingMemory` prompt 注入还没在真实浏览器样本里被验收
- ✅ V1 旧 episode 派生主路径已收口：`buildEpisodes` / `buildTopicThreads` 已移出主派生链；旧 `PersistentEpisode` JSON 已停写，仅保留向后兼容读取；`memory_agent` / `RemiSessionContext` / `slow_brain_store` 主要读取侧已转向直接消费 `sharedMoments`
- ✅ 文本链路已补第一版语气稳定性基础设施：`tone contract` 进入 prompt 主链路，文本回复新增轻量 `assistanty` review，且已有初始 eval fixture
- ✅ 已接入第一版结构化回合解释层：`TurnInterpretation -> ResponsePolicy` 进入文本主链路与语音预判/最终转写候选点；当前规则层开始从“决定回复方向”降级为 fallback / guard，而不是继续堆主解释逻辑
- ✅ 文本/语音主链路已补分段延迟指标：`memory_recall_ms`、`structured_turn_analysis_ms`、`input_to_llm_request`、`input_to_llm_first_token` 已进入统一 latency trace；同时已收紧 prompt budget（history / priority context / prompt memory）
- ✅ 已补 Memory V2 启发式审计工具：`npm run memory:v2:audit -- --user <user-id>` 可从真实 `episodes + messages` 生成 `mergeSuspectRate / duplicateLineRate / unresolvedHitRate / repeatedResurfaceRate` 报告。它的价值是把“只看落表”推进到“开始看质量”，但它仍只是观察工具，不构成体验验收证明
- ✅ `2026-04-18` 观察期第二轮补强已落地：`episode_store` 已补“宽 episode 不再继续跨 topic 吞并”的守门，`findRelevant()` 已开始压制“宽 topic + 刚被提过 + 当前 query 没锚点”的统治型召回，`memory_agent` 也不再让低 rank core 回填 prompt，且低权重混合-topic active episode 不再被轻易抬成 `长期关系主线`
- ⚠️ 这不等于 Memory V2 质量已经验收：当前真实样本里 `repeatedResurfaceRate` 已从 `0.923` 降到 `0`，说明“同一脏 episode 反复霸榜”的问题明显收住；但 `duplicateLineRate` 仍高（主样本 `6.214`），说明存量脏 episode / 碎片 episode 还在，当前只是“停止继续恶化 + 收窄 prompt 放大器”，不是“历史污染已清理”
- ✅ latency / turn-taking 证据链已补到样本级：trace 现可携带 `scenarioKey`、`sessionId`、`releaseReason`、`releaseStableMs`、`prosodyApplied`、`usedNoVadFallback`、`previewText` / `finalTranscript` 摘要、关键 `turnState` 转移与 `interruptionType`；`duplex_soak_report` 也已新增浏览器 duplex 的 3 个验收场景、最小 trace 数门槛、`p50/p95` 对比、误判 taxonomy 与样本表
- ✅ 已补一条窄时间问答能力：直接时间问题（`现在几点` / `今天几号` / `今天星期几`）会优先按客户端上报的用户时区直答；拿不到有效客户端时区时再回退服务器时区；但这仍不等于“完整时间概念”，当前没有相对时间推理和泛化时间感
- ✅ 已补第一版按日期回顾聊天能力：显式问题（`今天/昨天/前天/4月14号我们聊了什么`）会优先按用户时区把日期解析成自然日范围，直接查原始 `messages` 做受控摘要，而不是让 memory / LLM 去猜；当前仍不支持 `上周/最近几天/整个月` 这类宽时间范围
- ✅ `stt_final` 已补一层轻量热词级局部同音纠偏：固定词表驱动、默认关闭、词表失败时直接回退原始 transcript，并且命中纠偏时会关闭当轮 prediction reuse，避免 partial 错词继续污染 final transcript；但这仍只覆盖项目名 / 人名 / 术语等已知热词，不等于通用 STT 消歧能力
- ⏳ turn-taking 已接入第一版实验性 prosody 旁路：`TURN_PROSODY_ENABLED` 当前默认开启，仅在边界处用 `pitch slope / voiced tail / tail energy drop` 修正 HOLD/LIKELY_END；当前已改为本地轻量 F0 检测实现，不再依赖外部 GPL pitch 库；单测与 duplex 回归已覆盖 rising tail / falling tail / no-VAD 观测，但还没有共享环境或真机上的长时间观察数据
- ✅ 当前延迟判断已更清楚：普通文本回合预处理约 `157ms`，决策类文本回合预处理约 `188ms`（其中结构化解释约 `182ms`）；当前主瓶颈仍主要是主模型首 token，不再是“结构化解释把所有文本都拖住”
- ✅ 普通文本 fast path 已做 `priorityContext` 分层：普通文本只保留最多 3 个高价值动态块；最新探针里普通文本 `priorityChars` 已降到 `320`、`slowBrainContextChars` 为 `0`，首 token 约 `3.89s`
- ✅ 分析路径也已改成“精选动态块”而不是整段 `slowBrainContext` 灌入：决策类样本 `priorityChars` 已从约 `2694` 降到 `388`、`slowBrainContextChars` 为 `0`、`systemChars` 降到 `1103`，首 token 从约 `10.9s` 降到 `4.13s`
- ⚠️ 常驻 `systemChars` 又收了一轮（最小样本约 `478 -> 449`），但真实 TTFT 没有稳定跟着下降；最新普通文本样本甚至飘到 `17.5s`，决策样本 25s 内没出首 token。结论是：继续死磕静态 prompt 已进入明显收益递减区，当前更大的现实问题是模型首 token 波动和运行时稳定性
- ✅ 资源监控已改口径：内存告警不再看 `heapUsed / heapTotal` 这种误导指标，而是改看进程 `rss`、`heapUsed / heapLimit` 和告警节流；当前旧日志里的 “97%/98%” 不应再被当作“服务快 OOM”的证据

### 下一步
1. **Memory V2 真实质量观察**：先用 `memory:v2:audit` 对真实用户样本做抽样，重点看 `episode` 错合并、漏召回、重复回捞、`unresolved` 命中；这一步比继续改 persona 文案更接近北极星
   当前重点已经从“有没有工具”切到“怎么处理存量污染”：继续抽样人工复核 `duplicateLineRate` 高的用户，判断是需要补拆分/归档脚本，还是继续收紧 ingest/merge 阈值
2. **浏览器 spot-check**：再补一轮显式打开 `workingMemory` 的前端对话，确认 `【当前上下文】` 注入、V2 recall feedback、history/local cache 与文本主链路没有交互回退
3. **embedding 健康门槛**：基于新告警补最低可运行门槛与 dashboard/日志口径，否则人格连续性仍会在环境缺失时直接掉级
4. **iOS 内测验收**：按 `ios/RemiChatLite/checklists/IOS_V0_TESTFLIGHT_CHECKLIST.md` 完成 5 人 TestFlight 文本基础闭环；实验性 duplex voice 单独跟踪，不计入本轮 v0 done
5. **T-040**：情绪推断 + 多维表情协议（可并行，不抢主线程）
6. **延迟收口**：先别继续深挖静态 prompt 压缩；重点转向模型侧波动、本地模型预设和运行时稳定性（尤其是高内存与首 token 波动）
7. **浏览器 duplex 实采**：当前 `p50/p95 + 误判样本` 只把口径和聚合链路做完了，仍缺真实浏览器 duplex trace 与人工复核；在拿到真实样本前，不要把 turn-taking 说成“已基本稳定”
8. **语气/理解观察期**：继续收集“回答优先级、现实约束更新、场景承接、边界尊重”真实 bad cases；本轮已补 `不要一直问我` / `你又不会帮我做` 一类样本，但还不代表整条线稳定
9. **STT 热词词表观察**：先用真实语音对话收集 10-20 个最痛热词错例，验证轻量词表纠偏的收益；在出现明确开放域 bad case 之前，不建议把它扩成上下文推断或 LLM 纠错

## 自动推进规则

默认推进顺序：
1. `R-V2.1-01` 验证写路径
2. `R-V2.1-02` 切读路径
3. `R-V2.1-03` 接 proactive planner
4. `R-V2.1-04` 清理 V1 旧路径

推进规则：
- 当前步骤未达到 Exit Criteria 前，不自动跳下一步
- 当前步骤 `blocked` 时，先在 `TASKS.md` 标注阻塞原因，再转向并行任务
- 每完成一步，必须同步更新 `TASKS.md` 的 `Current Execution Board`
- 只有 `R-V2.1-01 ~ R-V2.1-04` 全部为 `done`，才允许切换主线程

## 这条主线程和终极目标的关系

当前不是在单独优化“数据库里的记忆结构”。
当前是在补 Remi 的“持续存在感”：

- 用户下次回来时，她还能像同一个人一样接上
- 她记得的不只是事实，还包括关系主线、未完结话题、情绪轨迹
- 这些连续性必须进入 prompt 和主动策略，但不能拖慢实时对话

所以判断当前任务价值时，优先问：

- 这是不是让 Remi 更像同一个人持续活着？
- 这会不会破坏她像真人一样即时接话？

## 当前非目标
- 不先做前端口型同步（T-032）
- 不先做前端 emoji 展示（T-035.5）
- 不做 V1 episode 路径的强制删除（等读路径切完后自然清理）

## 环境变量新增（Memory V2）
- `REMI_EMBEDDING_BASE_URL` — embedding 服务地址（如 `http://localhost:11434/v1`）
- `REMI_EMBEDDING_API_KEY` — API key（Ollama 可填任意值）
- `REMI_EMBEDDING_MODEL` — 模型名（默认 `nomic-embed-text`）

## 执行规则
- 当前主线程内的代码任务做完后，必须回写对应任务文档状态
- 至少更新 `TASKS.md` 中对应的任务状态
- 如果本次改动改变了当前主线程判断或交付边界，也要同步更新本文件
- 不要只改代码不改任务文档，否则下一个 agent 很容易误判当前进度
