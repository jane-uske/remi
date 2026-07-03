# Remi 记忆系统架构审计快照（2026-07-03）

> 六路并行代码勘察 + 当日改造记录合成。反映 commit `8a14e98f` 时点的**实际实现**（非设计愿景）。
> 上游设计文档：MEMORY_V2_DESIGN.md / MEMORY_V3_DESIGN.md；本文是"现在到底是什么样"的审计。

## 0. 一图总览

```
                    写入端（每轮异步，fire-and-forget）
 用户轮 ──► runSlowBrain ──► light-touch 门禁 ──► LLM 8 字段分析（ANALYSIS_PROMPT 全字段时间归一化）
                                │                        │
                    localAnalysis(本地启发)     fact_postprocess 构造层（四规则，null=双路丢弃）
                                │                        │
              ┌─────────────────┴───────┬────────────────┼──────────────┬─────────────┐
              ▼                         ▼                ▼              ▼             ▼
        Tier1 CoreMemory        Tier2 KV facts    Tier3 episodes  Tier4 temporal  滚动摘要/话题
        (aboutYou20/aboutUs10   (memories 表,     (向量+四态      _facts(bi-     (关系信封
         /rightNow6 槽位,        embedding,       生命周期,       temporal 三元组  v1+v2 分键,
         差分编辑+salience 淘汰)  日期入库)        merge≥0.85)     t_valid/invalid) 每8轮+销毁时存)

                    召回端（每轮同步，预算制 4-5 条）
 retrievePromptMemory: L0 核心KV(2条,白名单6键) → L1 episodes(findRelevant 打分+跟进豁免) → L2 向量补充(300ms 硬超时)
 + synthesizeContext(慢脑快照→slowBrainContext) + buildConversationGuidance(→strategyHints) + warm recall(语音预热)
 + timelineFacts(Tier4, 热路径唯一动态项, 超时静默降级)

                    注入端（prompt 区块序）
 [可缓存前缀] L0护栏 → persona(IDENTITY/SOUL/EXAMPLES/CANON) → coreMemoryBlock → projectMemory
   → 【记忆背景】+MEMORY_USAGE_CONTRACT+日期后缀渲染 → memory_expression_rules → remiSelfFocus → offlineReturnAnchor
   → history(15条加载+会话累积)
 [动态尾部→拼进最后一条 user 消息] timelineFacts → backgroundTask → 【历史时段】断层标记 → 【此刻】时间锚
```

## 1. 五层记忆（Tier 0-4）

| Tier | 介质 | 内容 | 时效机制 | 今日改造覆盖 |
|---|---|---|---|---|
| 0 短期 | ctx.history（内存） | 加载 15 条 + 会话累积 | **【历史时段】断层标记**（>3h 标注时段+换算指令） | ✅ 新增 |
| 1 核心 | CoreMemoryStore（信封内） | aboutYou(20)/aboutUs(10)/rightNow(6) 槽位，LLM 差分编辑 | salience 淘汰；**rightNow 无过期机制** | ⚠️ 归一化规则覆盖其输出字段，槽内容过期未治理 |
| 2 事实 | memories 表 KV | 用户事实（importance+embedding+created_at） | 提炼归一化+构造层补日期+渲染带"（X月X日记录）"+decay 每小时 | ✅ 全链 |
| 3 情节 | episodes 表 | 事件（标题/摘要/主题/情绪/768 维质心/v3 列） | 四态生命周期(active→cooling→resolved→archived)+hygiene 归档+引用惩罚/跟进豁免 | ✅ 召回反转+回填时间戳 |
| 4 时序 | temporal_facts 表 | (subject,predicate,object) 三元组 | **原生 bi-temporal**：t_valid/t_invalid，新值自动失效旧值（Graphiti 模式） | 天生免疫时态穿越；object 文本已被全字段归一化覆盖 |

另有：关系信封（`__rem_relationship_state_v1` 全量 + `_core/_topic_state/_proactive_v2` 分键）存慢脑理解（摘要/共享时刻/主动话题/情绪轨迹）；remi_self 表（心情/精力/挂念/lastSeenAt+离线漂移纯函数）；cold_layer JSONL（审计日志，非召回源）。

## 2. 写入端要点

- 触发：每轮对话后异步；light-touch（≤12 字问候/确认）跳过 LLM 分析；NSFW 模式跳过 6 字段持久化（user_facts 仅留内存不落库）。
- **时间归一化（2026-07）**：ANALYSIS_PROMPT 全部输出字段禁指示性时间词，按【观察日期】换算绝对表述；摘要增量更新时改写遗留瞬时表述；observationDateOverride 供离线回填锚定事发日期。
- **构造层 fact_postprocess（2026-07）**：key 去时间词/截断 → 状态类（STATE_WORDS 判定）自动补"（M月D日记）" → value 残留时间词兜底补日期 → 低置信(<0.6)+assistant 推断过滤。词表与体检判定器共用导出。200 段 LCCC 实测：状态缺日期 0/155、fact 时间毒 0/528、拦截率 9.6%。

## 3. 召回端要点

- 预算：text_normal 4 条 / deliberate·voice 5 条；light-touch 轮只走 L0（显式记忆查询除外）。
- episode 打分：`0.6·cosine + 0.2·salience + 0.1·recency + 0.1·unresolved + lexicalBoost − 惩罚`。
- 近期引用惩罚（6h 窗）：强 0.32（闲聊漂移）/ 基础 0.18（词面锚点）/ **跟进豁免 0.08（2026-07）**：批内最高余弦 ≥0.55 且结构可信（非宽泛+非弱锚）——"用户主动重提"变最易召回。
- warm recall：语音 partial 预测期召回缓存，8s 新鲜度+bigram 50% 重叠验证后复用。

## 4. 注入端要点

- 【记忆背景】区块头部带 **MEMORY_USAGE_CONTRACT**（单一出处 persona/remi_default.ts，三渲染点共用）：旧状态不当现状/相对时间按记录日期换算/绝不基于记忆猜此刻/具身边界（相处只在对话里，扮演场景除外）/追问诚实（记不清就请对方补充）/诱导性前提不顺从。
- KV 渲染 renderMemoryLine 自动附"（X月X日记录）"（createdAt 全链路透传，含水合与语义补充两路）。
- 动态尾部（时间敏感块）拼进**最后一条 user 消息**（Qwen3 模板不许对话中插 system；prompt_builder 顶部注释已陈旧）；prompt_cache 以 TIME_CONTEXT_MARKER 字符串定缓存断点。
- 顺序设计：【历史时段】（否定旧当下）紧邻【此刻】（给出真当下），组合拳压制历史穿越。

## 5. 短期记忆与连续性

- 历史加载：bootstrap/pool 共用 initializeSessionStorage → hydrateHistoryFromDb（单点，2026-07 在此记录 lastHistoryAt 供断层标记）；"距上次互动"取页末条（2026-07 修复取 [0] 的方向 bug）。
- 会话：SSE 池 30min TTL；销毁时 + 每 8 轮周期保存关系信封（REMI_RELATIONSHIP_PERIODIC_SAVE）。
- working memory（WorkingMemoryV2）：决策线/约束跨轮 carry，flag 控制。
- 重连恢复链：关系信封（含 CoreMemory/摘要/共享时刻）+ remi_self（含离线漂移）+ 15 条历史 → 全部 awaited 于首轮前。

## 6. 防御与评测体系（全部 2026-07 新建/加固）

| 防线 | 位置 | 作用 |
|---|---|---|
| 构造层 | brains/fact_postprocess.ts | 入库前代码级校验（不依赖模型服从） |
| hygiene | memory/episode_hygiene.ts | 三类垃圾 episode 归档（中文规则包） |
| decay | memory/memory_decay.ts | 每小时：年龄×重要性清理+100 条上限 |
| 写入端体检 | scripts/memory_polish_eval.ts | LCCC 语料五毒率指标（与生产共用词表） |
| 对话端探针 | scripts/memory_probe_eval.ts | BC-T1~T5（生产坏样本固化），打真实 :3000 |
| 历史回填 | scripts/memory_backfill.ts | dry-run/apply 双模，observationDate 锚事发日 |
| 聊死率 | scripts/chat_vitality_eval.ts | 抑制/贡献平衡标尺 |

## 7. 已知弱点清单（按风险排序）

1. **CoreMemory rightNow section 无过期机制**——存"当前上下文"（6 槽）却没有时效治理，是时效改造的盲区残留；onEvict 回调未接线（P2）。
2. **decay 的 recency 评分退化**——PgMemoryRepository.getAll() 的 accessCount 恒为 0，评分实际只剩年龄×重要性。
3. 历史层修复是概率性收口——断层标记是元指令，对抗的是模型自己说过的原话（强 few-shot）；坏对话物理删除才是确定性方案。
4. temporal_facts embedding 生成 fire-and-forget 无重试，批量写入会累积缺 embedding 的行。
5. moment 引语内指示词（~11-18%）——引语形态危害低，加固方向是 sharedMoments 渲染带日期。
6. 幻觉判定为字符级（26% 名义、真毒约 8-11%）——精化需入库前 LLM judge（慢脑异步路径可承受）。
7. 词表/标点集在生产与评测间手工同步（fact_postprocess ↔ polish_eval）；两处 light-touch 规则口径可能漂移。
8. persona pack 多 pack 记忆隔离未实装（单 pack 无害）；messages 表无清理机制。
9. prompt_builder 顶部"动态尾部是独立 system 消息"注释陈旧（实际拼 user 消息）；prompt_cache 断点靠字符串匹配。
