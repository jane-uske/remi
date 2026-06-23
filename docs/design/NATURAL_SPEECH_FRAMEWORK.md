# NATURAL_SPEECH_FRAMEWORK.md — 让 Remi「学会像人一样说话」的框架重构

> 状态：设计提案（draft）。本文不改 runtime，只重定义「像人一样说话」这件事的实现框架。
> 关联主线：W-PRES-01（默认人格稳定）/ W-PRES-02（严肃场景承接）。
> 关联约束：`CLAUDE.md` 改动优先级、热点文件单 owner、不破坏 fast path / fallback。

---

## 0. 一句话

当前的「像人」是**用规则去描述人味**（几百条正则 + 冻结的人格文本 + 一次性 tone 评分）；
本框架把它换成**用数据和反馈去习得人味**——三条不同时间尺度的学习回路，让「加好样本 / 给反馈」就能让她说话更像人，而不是「再加一段 if」。

---

## 1. 问题诊断（基于现有代码，不是泛泛而谈）

现状链路（按 `docs/design/PIPELINE.md` 第 5~7 步）：

```
user turn
  → tone_policy.ts / style_override.ts  正则探测信号（decision/distress/bedtime/style…）
  → turn_interpreter.ts  LLM 出 JSON：TurnInterpretation → ResponsePolicy（有 heuristic fallback）
  → prompt_builder.ts    把 persona + tone contract + emotion style + memory 拼成一坨 system prompt
  → reply_stream.ts      fast brain 流式生成
  → reviewReplyTone()    正则给「助手味」打分（只打分，不回流）
```

四个结构性瓶颈：

1. **它不学习，只积累规则。**
   `tone_policy.ts` 里 `ASSISTANTY_PATTERNS`、`detectHighRiskDistressSignal`、`detectPracticalDistressSignal` 等是一串手写正则，每条只命中一种措辞。换个说法就漏。`CURRENT_FOCUS.md` 的下一步明确写着「抽 bad case → 分类 → 改 response policy / tone contract」——这是**人肉打补丁的循环**，永远追不上真实语言的长尾。

2. **人格是冻结文本，不随关系成长。**
   `persona/remi_default.ts` 的 `traits` / `behavioral_rules` / `emotional_responses` 全是常量字符串。所谓「关系阶段」只有 early/warm/close 三档粗粒度（`tone_policy.ts::classifyRelationshipDistance`）。她不会**向这个具体用户的语言习惯收敛**（语言学上的 entrainment / alignment——真人对话会互相靠拢用词和节奏）。

3. **人味被编码成「禁止项」，而非「正向风格」。**
   prompt 里大量是「少用 X」「不要 Y」（`buildToneContract` 的 `lines`）。负向约束能压掉助手腔，但压不出**个人声音**（idiolect：口头禅、句长分布、语气词、半句、自我修正）。结果是「不像客服」但也「没有谁」。

4. **没有反馈闭环。**
   `reviewReplyTone()` 算了个分就丢了——不挡生成、不回流、不训练。真实信号（用户有没有追问、纠正、冷场、继续热聊）完全没被采集成学习信号。

5. **结构脆 + prompt 互相打架。**
   `turn_interpreter.ts` 用 `JSON.parse(raw)` 解析模型自由文本（`parseInterpretation`），格式漂了就掉 fallback。同时 prompt 里「不要每次问句结尾」和 policy 的 `followupPermission: one_light_question` 会同框给模型矛盾指令。

**结论**：方向（结构化解释 + fast/slow 分脑 + 情绪标注 + presence 模型）是对的，缺的是**让这套东西可学习、可个性化、可度量**的底座。

---

## 2. 重新定义「像人一样说话」

把模糊目标拆成 4 个可分别建模、分别度量的能力：

| 能力 | 含义 | 当前归属 | 缺什么 |
|------|------|---------|--------|
| **A. 语言风格 idiolect** | 词选、句长、节奏、语气词、半句、自我修正——「这是 Remi 的声音」 | persona 文本 + emotion style | 正向风格建模、可个性化 |
| **B. 语用 pragmatics** | 何时答 / 何时先接情绪 / 何时沉默 / 何时给判断 / backchannel | turn_interpreter + tone_policy | 用学习模型替正则、可度量 |
| **C. 适应 adaptation** | 随时间向**这个用户**收敛（entrainment）、记住相处方式 | slow brain relationship state | per-user 语言画像 + register 收敛 |
| **D. 投递 delivery** | 词以外的人味：停顿、不流畅、嗯/对的搭话、turn-end 时机 | presence model + turn_taking | disfluency/backchannel 作为一等生成目标 |

「学会像人」= 这 4 项都接上**采集 → 评分 → 改进**的回路，且改进主要靠喂数据，不是加代码。

---

## 3. 核心转变：从「规则描述」到「三条学习回路」

```
                 ┌─────────────────────────────────────────────┐
                 │              对话发生 (live path)             │
   user turn ───▶│  解释(B) → 风格条件化生成(A) → 投递(D)        │───▶ Remi 说话
                 └───────────────┬─────────────────────────────┘
                                 │ 采集：context + 解释 + 回复 + 用户反应信号
                                 ▼
        ┌────────────────────────────────────────────────────────────┐
        │                      学习飞轮 (off live path)                 │
        │                                                              │
        │  回路1 (小时级)  bad case → 风格样本库(检索)        立即生效   │
        │  回路2 (周级)    偏好对  → DPO/SFT 微调风格模型      换权重     │
        │  回路3 (持续)    每用户  → 语言画像 + register 收敛  慢脑写回   │
        │                                                              │
        │  共享底座：① 习得式 reward model（替正则评分）                 │
        │            ② golden 对话评测集（回归闸门）                     │
        └────────────────────────────────────────────────────────────┘
```

三条回路对应三个时间尺度，缺一不可：
- **回路1**：当天就能让她改口（加样本，不动代码）。
- **回路2**：真正「学会说话」——把风格写进模型权重。
- **回路3**：让她对**你**越来越像「认识的人」。

---

## 4. 目标架构（分层 + 每层的可学习点）

### Layer 0 — 风格样本库与检索（替代「正则 tone contract」）

不再手写「少用 X」，而是维护一个**好样本语料库**：每条是 `(情境标签, 用户话, Remi 的好回法)`，带 embedding。

- 运行时：用 `(turn 解释 + 用户话)` 的 embedding 做 kNN，取 top-k 注入 prompt 当 few-shot——**示范**而非**禁令**。
- 学习点：bad case 修好后直接进库 → 下一次相似情境立刻拿到正例。**加样本即改行为**，零代码。
- 复用：`pgvector`（已在用）+ `llm/embedding_client.ts`（已有 768 维）。新增 `style_exemplars` 表 + 一个检索函数。

### Layer 1 — 习得式回合解释器（收编所有正则）

`turn_interpreter.ts` 的方向保留（`TurnInterpretation`/`ResponsePolicy` schema 很好），但：
- **把 `tone_policy.ts`/`style_override.ts` 的全部正则探测收编进这一层**，runtime 只保留极少硬边界（高危自伤、成人模式开关这种必须确定性命中的）。
- **用结构化解码消灭 `JSON.parse` 脆性**：换成 schema-constrained decoding（见 §6），从「祈祷模型吐合法 JSON」变成「语法保证合法」。
- **可学习**：把解释器输出 + 后续真实结果落日志，攒成训练集，蒸馏出一个**小而快**的分类器（embedding 分类 / 小 cross-encoder），fast 路径用它，慢路径偶尔用大模型校准。延迟和质量同时改善。

### Layer 2 — 风格条件化生成 + 异步自评

- fast brain 仍然首要保延迟（不动 `reply_stream.ts` 的流式契约）。
- 生成的**条件**从「一坨负向 prompt」变成：`persona 内核（稳定身份）` + `Layer0 检索到的正例` + `Layer3 的 per-user register` + `Layer1 的 policy`。各司其职，减少自相矛盾。
- **异步 critic**（不在 fast path）：用习得式 reward model 给刚说出口的话打分；低分样本自动进 bad-case 队列 → 回路1/2。这是 `reviewReplyTone` 的进化体——从「正则打分丢掉」变「学习信号回流」。

### Layer 3 — per-user 适应（entrainment）

- 慢脑（`brains/background_analysis*.ts`）扩一个轻量 **用户语言画像**：句长偏好、爱用的词、正式度、表情/语气词密度、回应节奏。
- 生成时注入一个 **register 提示**：让 Remi 的语域向用户**互补性收敛**（不是模仿，是「相处久了自然对上了频道」）。
- 这是「还是她，但更懂你」的技术载体，正对 `CURRENT_FOCUS.md` 的「关系连续性服务」定位。

### Layer 4 — 投递 / delivery（词以外的人味）

- 把 **disfluency / backchannel** 变成一等目标：短停顿、「嗯…」「对」「等下」、半句自我修正——由生成层可控产出，`utils/sentence_chunker.ts` 与 presence model 负责把它们演出来。
- turn-end 时机：现有 `turn_taking_predictor.ts` 的 prosody 旁路保留；可选引入 VAP（Voice Activity Projection）类模型做更像人的接话时机（research-grade，列为可选，不进主线预算）。

---

## 5. 学习飞轮的三个共享部件（这是「学会」的真正引擎）

1. **采集 capture**
   每个 turn 落一条结构化记录：`context, interpretation, policy, reply, 用户反应信号`。
   反应信号 = 隐式标签：用户是否重述/纠正（「我是在问你」这类已有探测可复用做标签）、是否冷场、是否继续热聊、是否手动调风格（`style_override` 触发即强负反馈）。

2. **reward / 评分**
   用**习得模型**替正则：先用 LLM-as-judge + 现有 bad-case 集做冷启动标注，再蒸馏成小 reward model。它输出「像人/合适度」分，服务 critic、样本筛选、评测。

3. **评测闸门 eval gate**
   把 `scripts/live_chat_probe.mjs` 升级成 **golden 对话套件**（睡前 / 碎聊 / 现实压力 / 场景切换 / 被嫌一直问，对应 §当前 bad case 分类）。任何改动（加样本、换权重、动 prompt）都要先过这套回归，避免「修一个崩三个」。

**回路如何闭合：**
- 小时级：critic/人工标的 bad case → 进 Layer0 样本库 → 立即生效 → golden 套件回归。
- 周级：累积的 `(好回法 > 坏回法)` 偏好对 → DPO/ORPO 微调一个开源小模型当 fast-brain 风格模型 → 评测达标才换权重。
- 持续：每用户信号 → Layer3 画像 → 慢脑写回。

---

## 6. 现成库选型（用户明确说「哪怕用现成库」）

| 用途 | 库 | 为什么 | 落点 |
|------|----|--------|------|
| 风格样本检索 | **pgvector**（已用）+ 现有 embedding client | 已有底座，零新依赖 | 新 `style_exemplars` 表 + 检索函数 |
| 解释器结构化解码 | **Outlines** / **llguidance** / OpenAI structured outputs（JSON schema） | 语法级保证合法 JSON，干掉 `turn_interpreter.ts` 的 `JSON.parse` fallback | 包住 `runInterpreterLlm` |
| 对话评测 | **promptfoo** 或 **DeepEval**（LLM-as-judge） | 现成 golden 套件 + 判官，CI 可跑 | 升级 `scripts/live_chat_probe.mjs` |
| 偏好微调（回路2） | **TRL**（DPO/ORPO/SFT）+ 一个开源小模型（Qwen2.5-7B 类） | 把风格写进权重，本地可训，配 `REMI_FAST_BRAIN_MODEL` 直接挂 | 离线训练，产出新 fast-brain 权重 |
| reward / 风格分类 | **sentence-transformers** 微调（小 cross-encoder） | 快、便宜、可蒸馏，替正则评分 | critic + 样本筛选 |
| 接话时机（可选） | **VAP** 类 turn-taking 模型 | 比能量 VAD 更像人的 turn-end 预测 | 接 `turn_taking_predictor.ts` 旁路，flag 控 |

选型原则：**先用已有底座（pgvector + embedding + fast/slow 分脑），新依赖只在「检索 / 评测 / 离线训练」三处引入，绝不进 fast path 的同步链路。**

---

## 7. 迁移路径（守住 `CLAUDE.md` 约束：不破 fast path、不删 fallback、高敏改动挂 flag、热点文件单 owner）

复用 `turn_interpreter.ts` 已有的 `off / shadow / on` 模式做每一步的灰度。

- **P0 采集 + 评测（不改行为）**：给现有链路加结构化日志；把 bad case 整成 golden 套件。零风险，先建度量。
- **P1 Layer0 样本库（shadow→on）**：检索 few-shot，先 shadow 比对再开。`tone_policy` 正则**保留作 fallback**，不静默删。
- **P2 critic 回流**：习得 reward model 异步评分，喂 bad-case 队列。只读不挡 fast path。
- **P3 Layer1 收编正则 + 结构化解码**：把散落探测搬进解释器，runtime 只留硬边界。
- **P4 Layer3 per-user register**：慢脑加语言画像，生成注入；flag 控。
- **P5 回路2 微调**：攒够偏好对后 DPO，golden 达标才换 fast-brain 权重。

每步退出标准 = golden 套件不回退 + 关键延迟指标（`infra/latency_tracer.ts` 的 `llm_first` 等）不劣化。

热点文件（`web/src/hooks/useRemiChat.ts`、`server/session/index.ts`、`brains/slow_brain_store.ts`、`memory/memory_agent.ts`）按 §CLAUDE 规则单 owner、分步触碰。

---

## 8. 验收：怎么知道她「更像人」而不是「自我感觉良好」

- **客观**：golden 套件 reward 分上升；助手腔命中率下降；per-user register 收敛度（用户语言画像与 Remi 输出的风格距离随轮数下降）。
- **行为信号**：冷场率、用户手动改风格（`style_override` 触发）频率、追问/纠正率下降；续聊深度上升。
- **体验**：对齐主线 KPI——「单端 10 分钟后不再被当成普通聊天框」（`CLAUDE.md` §0）。

---

## 9. 风险与取舍（不藏着）

- **微调成本/门槛**：回路2 需要训练能力和数据量；冷启动期靠回路1（检索）+ 强 few-shot 顶上，微调是「成熟后再上」。
- **个性化跑偏**：per-user 收敛可能放大坏习惯或越界——必须受 persona 内核和硬边界约束，register 只调语域不改身份。
- **延迟**：检索、评分、判官一律 off live path 或异步；fast path 的同步链路只允许「小而快的解释器 + 风格条件化 prompt」。
- **隐私**：采集对话做训练数据，需符合产品隐私边界（匿名化、用户可关），落地前确认。
- **别过度学习**：reward model 会被刷分（学会取悦而非真诚）。golden 套件需含「该说不/该沉默/该承认不知道」的负例守住人格底线。

---

## 附：与现有文件的对应关系（给下一个 agent）

| 现有 | 本框架里的去向 |
|------|---------------|
| `brain/tone_policy.ts` 正则 | 收编进 Layer1 解释器；硬边界留少量；其余转 Layer0 样本 + 习得 reward |
| `persona/style_override.ts` | 触发即作为「用户改风格」强负反馈信号采集；探测逻辑并入 Layer1 |
| `brain/turn_interpreter.ts` | 保留 schema；换结构化解码；蒸馏小分类器；收编散落探测 |
| `brain/prompt_builder.ts` | 从「负向一坨」改为「persona 内核 + 检索正例 + register + policy」分槽 |
| `reviewReplyTone()` | 升级为习得 critic + 回流 |
| `brains/background_analysis*.ts` | 扩 per-user 语言画像（Layer3） |
| `scripts/live_chat_probe.mjs` | 升级为 golden 评测套件（闸门） |
| `persona/remi_default.ts` | 保留为「稳定身份内核」，但风格细节交给习得层，不再靠堆 behavioral_rules |
