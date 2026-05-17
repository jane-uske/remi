# CURRENT_FOCUS.md

## 一句话

当前最高优先级是 **结构性止血**（[STRUCTURAL_DEBT.md](../design/STRUCTURAL_DEBT.md)），而非继续推进体验主线。原因：7 个结构性问题正在持续拖慢主线交付——无测试的 2044 行 hook、6 层不可靠的记忆 fallback、关键词匹配的情绪引擎、一句话的人格定义、130+ 无验证的 env vars、无迁移系统的数据库、误导性的命名。

Phase 0（env 治理 + DB 迁移 + 命名重构）完成后，进入 Phase 1（记忆收敛 + 情绪替换 + 人格增强 + hook 拆分）。  
Phase 1 完成后，回到原主线：Web 默认入口 10 分钟在场感体验。

---

## 当前执行优先级

```
Phase 0 (2天) → Phase 1 (1-2周) → 原主线 (W-PRES-01~04)
```

详见 [STRUCTURAL_DEBT.md](../design/STRUCTURAL_DEBT.md) 每个问题的具体步骤和验收标准。

---

## 原主线（Phase 0/1 完成后恢复）

## 为什么当前主线不是继续广撒网

最近真实对话和项目回顾已经证明两件事：

1. **当前不是“什么都没做出来”**
   - Memory V2、duplex runtime、Web auth、iOS lite、lip sync cue transport、mic pre-gate 都已经有真实代码，不是空话
2. **当前最缺的也不是“再多几个能力点”**
   - 真正缺的是：用户从轻松闲聊切到现实压力时，Remi 能不能稳住、不出戏、像同一个人一样接住

如果继续按现在的方式同时推进：
- memory
- iOS
- web stage
- auth
- persona presets
- docs / ops / scripts
- 语音 provider / 边角体验

会得到一个典型坏结果：
**每周都很忙，但每月都没有一个真正能证明 Remi 不是玩具的高光版本。**

## 当前阶段判断

### 已经确认成立的部分
- ✅ `memory/memory_agent.ts::retrievePromptMemory()` 已优先走 `episodeStore.findRelevant()`；召回失败时安全回退到 snapshot episode
- ✅ `server/session/index.ts::fireSilenceNudge()` 已优先走 `proactive_planner.planProactiveNudge()`；planner 失败时安全回退到 legacy nudge plan
- ✅ 写路径后端已直连验证通过：`runSlowBrain -> episodeStore.ingest -> Postgres episodes` 能落表
- ✅ 真实 WS 文本会话验收已通过：`episodes` 在真实连接上稳定写入并合并
- ✅ 文本链路已补第一版语气稳定性基础设施：`tone contract` 进入 prompt 主链路，文本回复新增轻量 `assistanty` review
- ✅ 已接入第一版结构化回合解释层：`TurnInterpretation -> ResponsePolicy` 进入文本主链路与语音候选点
- ✅ 4.19 已落地 Web 端 `tts_lip_sync` 传输、lip timeline 解析与 `MicTxGate`，说明口型 cue / mic pre-gate 已经不是口号
- ✅ Web / iOS 鉴权底座、缓存隔离和 session identity 已经有可运行骨架

### 当前真正缺的部分
1. **严肃场景承接**
   - 轻松闲聊、睡前陪伴、故事感对话已有表层魅力
   - 但用户一旦进入现实压力、财务压力、自责或委屈，系统仍可能轻飘、失焦或承接错位
2. **默认人格稳定**
   - 现在的问题不是 persona 不够多，而是同一个默认人格还不够稳
3. **Web 在场感统一**
   - 语音、口型、表情、播放态、idle 态已经有零件，但还没形成统一“她在”的感觉
4. **10 分钟体验可靠性**
   - 目前仍更像“会聊天的系统原型”，而不是“一个你愿意回来见的人”

### 记忆架构当前判断（更新）
- 方向上，`热层 / 温层 / 冷层` 这条路线是对的；当前不是架构选错，而是关键抽象还没收硬
- 当前真实阶段更接近：
  - 概念成立
  - 单路径可用
  - 还不是多场景稳定
  - 还不是生产可用
- 当前记忆线最真实的 3 个瓶颈：
  1. **热层边界还不够硬**
     - `working memory / current focus` 已有雏形，但还没有收成一个稳定、极薄的上下文层
  2. **温层事件表达还太粗**
     - `episode` 能写、能读、能 recall，但 schema 还不足以稳定表达复杂关系事件
  3. **冷层还没真正成型**
     - 现在更多是原始消息和回放基础，还没有 archive ledger / offline re-extract / audit 治理底座
- 因此，当前记忆线不该继续往 runtime 里补更多 case-specific 规则；坏样本该进 eval，runtime 只保少量硬边界

## 当前明确的执行取舍

### 现在主线只做什么
1. **默认人格稳定**
   - 收口口气、追问方式、边界感、安慰方式
   - 不再继续扩 persona presets 作为主价值
2. **严肃场景承接**
   - 优先修：事实承接错、情绪误判、场景切换失败、严肃时刻轻浮
3. **Web 在场感**
   - 说话态、停顿态、被打断态、口型和音频播放时间线统一
4. **10 分钟体验压测**
   - 睡前陪聊
   - 日常碎聊
   - 现实压力倾诉

### 当前主动降级的方向
- ⏸ iOS 新功能扩张（保底，不抢主线）
- ⏸ 多端连续性产品化闭环
- ⏸ 大而全 persona preset 扩展
- ⏸ 与当前主线无关的大量 docs / ops / infra 美化
- ⏸ “每条线都推进一点”的并行模式

## 未来服务路线（当前确定版）

当前已经明确：Remi 未来不应该走“全能 AI 助手服务路线”。

### 更可能成立的服务路线
1. **固定人格陪伴服务**
   - 核心卖点不是更强，而是“还是她”
2. **关系连续性服务**
   - 记住你、接上你、保持同一个人感
3. **夜间 / 日常缝隙陪伴服务**
   - 睡前、失眠、心烦、发呆、走路时的小入口
4. **少量隐身能力服务**
   - 时间、回顾、记忆、轻提醒
   - 这些能力只服务陪伴，不重写产品分类
5. **在主线成熟后，再扩跨端存在层**
   - 不是现在就做“大而全多端平台”，而是在单端高光成立后再扩

### 当前明确不走的服务路线
- ❌ 通用 agent 平台
- ❌ 什么都能做的 AI 助手
- ❌ 复杂多工具工作流优先
- ❌ 用能力宽度和 ChatGPT / 豆包正面竞争

## 当前状态（保留的事实）

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

### Runtime / voice / auth 当前状态
- ✅ Web 身份底座已补第一版 Clerk 接入口
- ✅ iOS 正式登录第一版已接上：`ios/RemiChatLite` 现已接 Clerk iOS SDK / `AuthView` 登录 gate
- ✅ iOS v0（文本）内测基线已建立：WS 文本流式、自动重连、Clerk session token 优先鉴权、legacy JWT / dev-key 兜底，以及按 Clerk/JWT user-id 本地缓存隔离
- ⏳ iOS 语音链路仍未验收通过；现阶段不要把 iOS 端语音输入误判为稳定可用能力
- ✅ `stt_final` 已补一层轻量热词级局部同音纠偏
- ⏳ turn-taking 已接入第一版实验性 prosody 旁路，但仍缺长时间真实 noisy 样本
- ✅ 4.19 新增 `tts_lip_sync` 传输、Edge metadata 解析、Web lip timeline 与 `MicTxGate`
- ⚠️ 这些说明“链路已写通”，不等于“体感已成熟”

## 下一步

1. **坏样本归类与默认人格承接修正**
   - 从真实聊天中抽取最痛 bad cases
   - 分类：事实承接错 / 情绪误判 / 场景切换失败 / 严肃时刻轻浮
   - 先修默认人格的 response policy / tone contract / structured interpretation
2. **Web 在场感收口**
   - 角色 idle / speaking / listening 状态统一
   - 音频、口型、表情、turn state 不互相打架
3. **10 分钟体验压测**
   - 睡前陪聊
   - 日常碎聊
   - 压力倾诉
   - 目标不是“更强”，而是“更少出戏”
4. **embedding 健康门槛**
   - 避免环境缺失时人格连续性静默掉级
5. **浏览器 duplex 实采 / runtime spot-check**
   - 当前仍缺更多真实浏览器 duplex/noisy 样本
6. **iOS 仅保底**
   - 继续保持文本/鉴权/缓存链路可验收
   - 不让新功能抢走 Web 主线资源
7. **记忆架构只做收边界，不做继续堆规则**
   - 热层：继续收成“当前主线 + 当前约束 + 不要踩的点”
   - 温层：优先补事件表达，而不是继续扩 topic / keyword 特判
   - 冷层：先补最小 archive / replay / offline 治理底座

## 自动推进规则

默认推进顺序改为：

1. **Web 默认人格稳定**
2. **Web 严肃场景承接**
3. **Web 在场感统一**
4. **10 分钟体验压测**
5. **在主线稳定后，再恢复 iOS / 多端 / 额外 persona 扩展**

推进规则：
- 当前步骤未达到 Exit Criteria 前，不自动跳下一步
- 当前步骤 `blocked` 时，先在 `TASKS.md` 标注阻塞原因，再转向并行任务
- 每完成一步，必须同步更新 `TASKS.md` 的 `Current Execution Board`
- 当前主线程下，不再让 iOS、多端闭环、persona 扩展抢走执行板顶部位置

## 这条主线程和终极目标的关系

当前不是放弃北极星。
恰恰相反，当前是在回答一个更根本的问题：

**为什么在人人都能直接找通用 AI 聊天的时代，用户还会回来找 Remi？**

只有当 Web 单端里先出现下面这件事，北极星才有继续投入的价值：

- 用户不是因为“她也挺聪明”回来
- 而是因为“我想回来见她”回来

所以判断当前任务价值时，优先问：
- 这是不是让用户更容易把 Remi 当成“她”，而不是“一个系统”？
- 这是不是让她在严肃时刻更可靠？
- 这是不是在增强固定人格、关系连续性和在场感？

## 当前明确的错误信息 / 过时判断

下面这些说法现在应视为错误信息，不该继续指导执行：

- “Remi 应该优先做成全能 AI 助手”
- “AI 伴侣的核心价值是会调用更多工具”
- “把更多历史塞进 prompt 就能解决记忆问题”
- “主 LLM 在语音主链路里像 agent 一样多轮 decide tool use 是合理方向”
- “只要底层链路接通，体验自然会成立”
- “当前最重要的是继续同时推进 memory、iOS、多端、persona 扩展和各种边角能力”

这些说法都会把产品重新拉回通用助手或广撒网路线。

## 当前非目标
- 不把 iOS 新功能作为主线
- 不把多端持续在线产品化闭环作为本阶段主线
- 不继续扩 persona preset 数量
- 不把 adult-mode / 边缘玩法当成当前产品突破口
- 不因为底层已接通，就把体验直接宣布为成熟
- 不把“复杂工具调用能力”当成 AI 伴侣的主价值

## 执行规则
- 当前主线程内的代码任务做完后，必须回写对应任务文档状态
- 至少更新 `TASKS.md` 中对应的任务状态
- 如果本次改动改变了当前主线程判断或交付边界，也要同步更新本文件
- 不要只改代码不改任务文档，否则下一个 agent 很容易误判当前进度
