# CURRENT_FOCUS.md

## 一句话

Memory V2 基础设施、prompt 读路径和 proactive planner 主路径已接通；当前还差真实会话验收，以及 V1 旧路径清理。

这条主线程服务的不是“再做一个记忆功能”，而是终极目标里最重要的一层之一：
让 Rem 更像一个持续存在的人，而不是每轮都重置的聊天框。

放进当前总纲里看，它属于三层路线图中的“人格记忆层”：
- 实时交互层
- 人格记忆层
- 跨终端存在层

当前先把第二层做扎实，后面的多端接续和持续在线存在感才有真正可靠的基础。
未来的 plugin / capability 扩展，也必须建立在这个基础之上，而不是反过来污染核心链路。

## 当前最高优先级

Memory V2 最终验证 + V1 旧路径收口（V2.1 尾声）

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
- ✅ `llm/embedding_client.ts` 已绕开 LM Studio / OpenAI SDK 兼容问题；直接请求本地 endpoint，并强校验 768 维
- ⏳ 写路径后端已直连验证通过：`runSlowBrain -> episodeStore.ingest -> Postgres episodes` 能落表
- ⏳ 真实会话链路验收还没完成：本地裸 WebSocket 调试命中 `401`，需要在真实前端会话里再验一次
- ⏳ V1 旧 episode 路径仍在：`buildEpisodes` / `buildTopicThreads` / `PersistentEpisode` 尚未收口

### 下一步
1. **真实会话验收**：在前端真实对话里确认 episode 数据稳定写入，且 prompt 能消费 V2 结果
2. **V1 旧路径收口**：删除 `buildEpisodes` / `buildTopicThreads` / `PersistentEpisode` 主逻辑
3. **T-040**：情绪推断 + 多维表情协议（可并行）

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
- 只有 `R-V2.1-04` 为 `done`，才允许切换主线程

## 这条主线程和终极目标的关系

当前不是在单独优化“数据库里的记忆结构”。
当前是在补 Rem 的“持续存在感”：

- 用户下次回来时，她还能像同一个人一样接上
- 她记得的不只是事实，还包括关系主线、未完结话题、情绪轨迹
- 这些连续性必须进入 prompt 和主动策略，但不能拖慢实时对话

所以判断当前任务价值时，优先问：

- 这是不是让 Rem 更像同一个人持续活着？
- 这会不会破坏她像真人一样即时接话？

## 当前非目标
- 不先做前端口型同步（T-032）
- 不先做前端 emoji 展示（T-035.5）
- 不做 V1 episode 路径的强制删除（等读路径切完后自然清理）

## 环境变量新增（Memory V2）
- `REM_EMBEDDING_BASE_URL` — embedding 服务地址（如 `http://localhost:11434/v1`）
- `REM_EMBEDDING_API_KEY` — API key（Ollama 可填任意值）
- `REM_EMBEDDING_MODEL` — 模型名（默认 `nomic-embed-text`）

## 执行规则
- 当前主线程内的代码任务做完后，必须回写对应任务文档状态
- 至少更新 `TASKS.md` 中对应的任务状态
- 如果本次改动改变了当前主线程判断或交付边界，也要同步更新本文件
- 不要只改代码不改任务文档，否则下一个 agent 很容易误判当前进度
