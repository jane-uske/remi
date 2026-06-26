# VOICE_BEST_PRACTICES.md

> 语音链路的「守则」。`design/VOICE_ROADMAP.md` 回答**去哪**，这份回答**无论去哪都要守住什么**。
> 改 `voice/`、`server/session/`、`server/pipeline/runner.ts`、`brains/context_orchestrator.ts` 前先读本文，再按 `guides/TEST_MAP.md` 跑测试。

外部参照系：[`YeJe-cpu/talk-to-fengge`](https://github.com/YeJe-cpu/talk-to-fengge)——一个把「实时对话 + 声音克隆 + 说话风格」合在一起的轻量 Python/LiveKit demo。它的系统完整度远不及 Remi，但它在**少数关键工程取舍**上把话说死了，正好可以用来反向校验 Remi 的语音原则。本文每条原则都标注 talk-to-fengge 的对照结论：`✅ 它验证了我们`、`🔁 我们已做得更好`、`🚫 我们明确不学`。

---

## 0. 一句话原则

> **活人感 ≠ 延迟数字更低。** 但在「她像不像在场」这件事上，**首音之前的每一步都要么是有界并行、要么不该在关键路径上。**

talk-to-fengge 的工程目标是「链路延迟 < 1s（实际体感 2–3s）」。Remi 的目标不是赢这个数字，而是赢**感知**：开口时机、节奏、turn-taking、承接、回放稳定。延迟只是其中一个可被掩盖（thinking filler）、可被前移（partial 预热）的变量，不是唯一目标。详见 `VOICE_ROADMAP.md` 的「实时交互层设计原则」。

---

## 1. 关键路径 = 延迟追踪器的分段

不要凭感觉谈「慢」。Remi 在 `infra/latency_tracer.ts` 已经把一轮语音切成固定分段，**所有语音性能讨论都用这套词汇**：

```
vad_speech_end → stt_final → llm_first_token → tts_first_audio → playback_start
                 └ A ┘       └──── B ────┘     └──── C ────┘     └─ D ─┘
```

| 段 | tracer 指标 | 归谁管 | 当前阶段判断（见 VOICE_ROADMAP） |
|----|------------|--------|------------------------------|
| **A** | `speech_end_to_stt_final` | STT / sttChain / idle guard | 仍是更大的现实瓶颈之一 |
| **B** | `stt_final_to_llm_first`（= `pre_llm_overhead` + LLM TTFB） | 记忆召回 + 结构化分析 + fast brain | 受 `Promise.all` 并行约束，已收口但仍可前移 |
| **C** | `llm_first_to_tts_first` | 分句器 + TTS provider | **团队自评的第 4 号大拖点** |
| **D** | `tts_first_to_playback` | 传输模式 + 前端队列 | 取决于 `pcm_stream_v1` vs `buffered_voice` |

`B` 段还被进一步拆成 `llm_first_raw_chunk` / `llm_first_reasoning_chunk` / `llm_first_visible_content`——**这是 talk-to-fengge 没有的粒度**。它意味着「推理型 fast brain 在出第一个可发声字之前空想了多久」是可被单独测量的（见 §4）。

> **守则 1**：任何语音改动，先说它动的是 A/B/C/D 哪一段，再说预期指标怎么变。提交说明里引用真实 tracer 字段，不要写「感觉快了」。

---

## 2. C 段：`llm_first → tts_first`（首音，最高优先级）

这是团队自评的头号大拖点，也是 talk-to-fengge 工程取舍最密集的地方。

### 2.1 Remi 现状（已实现，别重造）

`server/pipeline/runner.ts` 已经是**生产者-消费者**结构，这是对的：

- LLM token 流是生产者：`chatStream` → `EmotionTagParser` → `SentenceChunker.pushDetailed()` → `pushSentence()` 入队。
- `ttsTask` 是消费者：边入队边合成，不等整段回复。
- **首句 eager 分句**：`chunker.setEager(true)`，首句允许在「足够长的软边界」(`，、；…`) 处提前出，不必等句号；出完第一个 `hard_end` 后 `setEager(false)` 回到正常整句节奏。
- `tts_first_audio` 在**首句第一个 PCM chunk** 落地时打点（`ttsSend` 内），度量口径精确。
- 流式传输失败时**只在首 chunk 尚未发出**的前提下回退到 buffered 合成（`ttsSend` 的 catch）——既要流式，又不牺牲 fallback。

`✅ talk-to-fengge 验证了我们`：它的全部价值就是「边生成边合成、首个可发声片段尽早下发」。Remi 的 producer-consumer + eager 首句就是这条原则的更完整实现。

### 2.2 首句要短，但不能碎

eager 分句的真实张力：**首句越短，首音越早；但太短会让 TTS 韵律垮掉、播放发飘。** Remi 用一组参数把这个张力调在中间（`utils/sentence_chunker.ts` + `.env.example`）：

| 行为 | 参数（env） | 默认 | 含义 |
|------|------------|------|------|
| eager 起评长度 | `TTS_EAGER_THRESHOLD` | 24 | buffer 到 24 字才开始找软边界 |
| eager 前瞻 | `TTS_EAGER_LOOKAHEAD_CHARS` | 10 | 在 24~34 字窗口里找软断点 |
| eager 软断最短 | `TTS_EAGER_SOFT_BREAK_MIN_CHARS` | 24 | 软断点不能早于 24 字 |
| eager 首块最短 | `TTS_EAGER_MIN_CHARS` | 8 | 比正常 `minTtsChars` 更短，让首音更早 |
| 正常整段上限 | `TTS_CHUNK_MAX_CHARS` | 120 | 无句末标点时强制切，避免 TTS 无限等 |

关键设计：**`SentenceChunker` 永远不会仅因字数阈值就硬切一个汉语小句**——它只在软/硬标点处断，短碎片用 `hold` 暂存并拼到下一块。这是 Remi 比 talk-to-fengge「一律短」更克制的地方：我们不为了首音牺牲句子完整度。

> **守则 2**：调首音先动 `TTS_EAGER_*`，**用 env 调、不要改默认值**。降 `TTS_EAGER_THRESHOLD` 会更早开口但更易碎；升 `TTS_EAGER_SOFT_BREAK_MIN_CHARS` 更稳但更晚。每次只动一个，对照 `llm_first_to_tts_first`。

### 2.3 感知延迟用 filler 掩盖，不是消灭

`runner.ts` 在 `REMI_THINKING_FILLER_DELAY_MS`（默认 **520ms**）后，若仍无首音，异步合成一个极短「嗯」垫场；首音一旦真的来了（`firstAudioSent`）立刻取消。默认 `REMI_THINKING_FILLER=0`（关）。

`✅ talk-to-fengge 验证了我们`：它明确区分「工程链路延迟 <1s」与「体感 2–3s」，承认体感是另一回事。filler 就是把体感和真实链路解耦的手段。

> **守则 3**：filler 是**遮罩**不是**优化**。它不能晚于真实首音、不能破坏节奏、不能变成每轮都响的口头禅。要压的是 C 段真实数字；filler 只负责盖住压不掉的那部分。

### 2.4 TTS provider 与传输

- provider 选择见 `voice/tts.ts`（5 家）。默认 Edge TTS 免费可用，但**流式首包依赖服务端 MP3→PCM 实时转码**——VOICE_ROADMAP 已把它标为「上游端点支持范围 + 运行时稳定性」的风险点。
- 传输模式见 `server/session/tts_transport.ts`：`ios_lite`/`watch_lite` 默认 `buffered_voice`（播放 base64 MP3，不解流式）；web 走 `auto` 协商 `pcm_stream_v1`。**D 段延迟由此决定**——buffered 一定比 pcm_stream 晚。

`🚫 我们明确不学`：talk-to-fengge 用 VoxCPM 做高质量声音克隆，但要 GPU ≥8GB。VOICE_ROADMAP「踩坑记录」已结论：本地重模型（Kokoro 等）当前**不值得优先**——语速慢、情绪弱。除非目标从「更像真人」切到「纯离线」，否则不要回到本地重 TTS。Remi 的默认声音策略是云端 Edge/Volc，不是克隆。

---

## 3. B 段：`stt_final → llm_first`（首 token 前不许串行）

talk-to-fengge 在这段留下了**最有价值的一行注释**：

> 「不再用 `function_tool` 走 `recall_memory`（auto-recall 直接拼 system prompt，避免 tool call 拖 1–2s 延迟）」

它的意思是：让 LLM 自己决定调「查记忆」工具 = 多一次往返 = 1–2s。改成**预召回 + 直接拼进 system prompt**。

### 3.1 Remi 现状：已经「无 tool-call 往返」，但召回仍在关键路径上

`brains/context_orchestrator.ts` 的真实结构：

```
stt_final
  ├─ analyzeTurn()         （结构化分析，gated: shouldAnalyzeTurn，仅高价值文本轮）
  └─ retrievePromptMemory()（记忆召回，maxEntries 有界）
        ↓  await Promise.all([memory, analysis])   ← 二者并行，但都挡在首 token 前
  fastBrainStream(...)      （fast brain 开始吐 token）
```

- ✅ **没有** function_tool 往返：记忆经 `retrievePromptMemory` → `prompt_builder` 直接进 prompt，正是 talk-to-fengge 想要的形态。tool_router 是独立能力路径，`toolRouterPrefilter` 是廉价预筛，不是每轮回复前的阻塞 LLM 调用。
- ✅ 召回与分析**并行**（`Promise.all`），不是串行链。
- ✅ `analyzeTurn` 被 `shouldAnalyzeTurn` 门控，绝大多数普通轮直接跳过（决策题 / 现实约束更新 / 边界敏感 / 场景承接才进）。
- ⚠️ 但召回**仍然挡在首 token 前**，构成 `pre_llm_overhead`；`text_deliberate` 预算下还可能触发第二次召回（行 909）。这正是 talk-to-fengge 警告的那段，只是 Remi 已经把它压成「有界并行」而非「工具往返」。

`✅/🔁 对照结论`：talk-to-fengge 的「别走 tool call」我们已落地；它的更深一层「把理解前移」我们**还没落地**——见 §6 的头号杠杆。

> **守则 4**：B 段只允许**有界、并行**的工作挡首 token。三条硬约束：
> 1. `analyzeTurn` 必须保持 `shouldAnalyzeTurn` 门控，**不许**对普通轮普遍开启。
> 2. `retrievePromptMemory` 必须保持 `maxEntries` 有界——记忆影响**风格/熟悉度**，不主导每轮回复（VOICE_ROADMAP「Memory 边界」）。
> 3. 任何新步骤进 B 段前，先证明它能塞进 `Promise.all` 且不拉长 worst-case；做不到就移出关键路径（后台 / 预热）。
> **绝不要**：把重型召回或慢脑分析改成串行阻塞步骤（CLAUDE.md / PIPELINE.md 双重禁令）。

### 3.2 历史预算

talk-to-fengge 用死值 `_MAX_CONTEXT_MESSAGES = 20` 截断。Remi 用 `history_budget.ts` 按 token 预算 + 轮次价值动态裁剪（`resolveHistoryTokenBudget`）。

`🔁 我们已做得更好`：固定条数截断在长短句混合时要么浪费预算要么切掉上下文；按 token + 价值预算更稳。不要为了「对齐参考实现」退回固定条数。

---

## 4. fast brain：先出可发声字，别先空想

`B` 段被 tracer 拆出 `llm_first_reasoning_chunk` vs `llm_first_visible_content`：**推理型模型在出第一个用户能听到的字之前，可能先吐一大段思维链**。对语音，这段思维 = 纯延迟。

- `.env.example` 已把推荐值写死：`REMI_FAST_BRAIN_REASONING_EFFORT=minimal`。
- fast brain 可用 `REMI_FAST_BRAIN_MODEL` 单独挂更轻的模型（CLAUDE.md §3）。

`✅ talk-to-fengge 验证了我们`：它选 MiniMax-M2.7-highspeed 的唯一理由就是 **TTFB 极低、无需 VPN**。对实时语音，**首字延迟 > 模型聪明度**。fast brain 的职责是反应，不是深思——深思交给慢脑后台。

> **守则 5**：fast brain 默认 `minimal` 推理。要换 fast brain 模型，先看 `llm_request_to_first_visible_content` 而不是离线 benchmark 分数。一个慢 800ms 出第一个字的「更聪明」模型，对语音是净负。

---

## 5. A 段与 turn-taking：Remi 已远超参照系

### 5.1 VAD

talk-to-fengge 的 `energy_vad.py` 是**纯能量**单特征：`speech_threshold` + `min_speech 0.25s` + `min_silence 0.6s` + 0.15s 抗抖窗。

Remi 的 `voice/vad_detector.ts` 是**四特征**状态机：

| 维度 | talk-to-fengge | Remi |
|------|----------------|------|
| 特征 | 能量 | 能量 + 过零率(ZCR) + 峰值因子(crest) + 活跃样本比 |
| 门限 | 单一阈值 | onset / continue **双门限**（迟滞，避免句中能量回落被切碎） |
| 噪声抑制 | 无 | ZCR/crest 专门挡键鼠脉冲噪声（键击 crest 30+，语音 <22） |
| 鲁棒 | 硬重置 | 渐进衰减 + `fallback_energy` 模式（真实麦克风条件兜底） |
| 句末静音 | 0.6s | `speakingSilenceFrames`≈10 帧（~500ms），可 env 调 |

`🔁 我们已做得更好`：这块 talk-to-fengge 没有任何可借的东西。**不要**因为参照实现「更简单」就去简化 Remi 的多特征 VAD——那些复杂度是真实 noisy localhost 验收逼出来的。

### 5.2 turn-taking 不能只靠静音

VOICE_ROADMAP 的核心判断：**「turn-taking 仍然过度依赖静音」是当前最大弱点之一。** Remi 已经有 `listening_hold / likely_end / confirmed_end` 三态、`prosody_fast_release`（尾部能量回落 + pitch 下行时把 release 收到 ~480ms）、以及 `非语音 transcript reject`（`[音乐]`/`谢谢观看` 不进正常 user turn）。

`✅ talk-to-fengge 验证方向`：它 `min_silence 0.6s` 是纯静音判定，正是「即使模型很强，糟糕的 turn-taking 也会毁掉活人感」的反面教材。Remi 的方向（VAD + transcript growth + 韵律 + 基础语义完成信号）是对的。

> **守则 6**：turn-taking 改动只看两个体感指标——**抢答率**（用户短停顿被打断）和**尾延迟**（说完到响应）。两者是跷跷板，任何一边的改善都要确认没把另一边顶上去。回归用 `test/server/session/duplex_harness.ts` 的固定场景做前后对比。

---

## 6. 还没落地的杠杆（按 ROI 排序）

这三条是 talk-to-fengge 的教训指向、但 Remi **尚未收口**的点。每条都绑定一个 roadmap 章节和一个可证明的 tracer 指标。

| # | 杠杆 | 段 | 为什么是它 | 验证指标 | roadmap |
|---|------|----|-----------|---------|---------|
| **1** | **partial transcript 预热召回/预反应** | B | 把 `retrievePromptMemory` 从「stt_final 后挡首 token」挪到「用户还在说时就跑」，让召回与说话重叠，关键路径上只剩 LLM TTFB | `pre_llm_overhead` 下降且 `stt_final_to_llm_first` 不被召回拖高 | A + D |
| **2** | **C 段 TTS 首音稳定性** | C | 团队自评第 4 号大拖点；Edge MP3→PCM 转码是已知风险点；首音抖动直接毁体感 | `llm_first_to_tts_first` 的 p95 收窄（不只均值） | C 段 §2 |
| **3** | **打断 = 对话分支切换，不是硬停** | — | 语义已对（只有真打断才置 interrupt state），缺的是 carry-forward 行为丰富度 | 打断后下一句的承接质量（人工验收 `evals/`） | C |

`✅ 对照`：杠杆 1 正是 talk-to-fengge「auto-recall 避免往返」的**下一层**——它把往返降到 0 之后，Remi 还能再把召回**移出关键路径**。这是参照系没走到、但 Remi roadmap 已经画好的一步。

> **守则 7**：做杠杆 1 时守住 VOICE_ROADMAP 的硬边界——「final transcript 仍是唯一真值」「fallback 模式保留」「热词后处理默认关闭可回退」。预热是为了**更早准备**，不是用 partial 冒充 final。

---

## 7. 配置速查（全部已在 `.env.example`）

调语音体感时，**优先动 env，不要改代码默认值**。每个旋钮都有反向代价。

| 变量 | 默认 | 调高 | 调低 | 影响段 |
|------|------|------|------|--------|
| `TTS_EAGER_THRESHOLD` | 24 | 首音更晚、更整 | 首音更早、更易碎 | C |
| `TTS_EAGER_SOFT_BREAK_MIN_CHARS` | 24 | 首句更稳 | 首句更短更早 | C |
| `TTS_CHUNK_MAX_CHARS` | 120 | 整段更长、段间隙更少但首延高 | 切得更碎 | C |
| `REMI_THINKING_FILLER` | 0(关) | 开 → 盖住感知停顿 | — | C 遮罩 |
| `REMI_THINKING_FILLER_DELAY_MS` | 520 | filler 更晚（停顿更久才垫） | filler 更早（易和真首音打架） | C 遮罩 |
| `REMI_FAST_BRAIN_REASONING_EFFORT` | minimal* | 更聪明但首字更慢 | — | B |
| `VAD_THRESHOLD` | 0.04 (env 示例 0.06) | 更难触发（漏） | 更易误触（噪声） | A |
| `VAD_SPEAKING_SILENCE_FRAMES` | ~10 | 句末等更久（更不易抢断用户） | 响应更快（更易抢答） | A / turn |

\* `.env.example` 推荐值；schema 中该项无默认（`optional`），未设时由上游模型决定。

---

## 8. 绝不要做（与 CLAUDE.md / VOICE_ROADMAP 一致）

1. **不要在 fast path 塞阻塞性工作**——重型记忆召回、慢脑分析、工具往返。B 段只准有界并行。
2. **不要静默移除 fallback**——TTS 流式回退 buffered、VAD fallback_energy、STT degraded window，都是真实坏场景逼出来的，不是冗余。
3. **不要为了对齐参照实现而退化**——固定条数历史截断、纯能量 VAD、一律短分句，都是比 Remi 现状**更弱**的形态。
4. **不要把 partial 当 final**——final transcript 是唯一真值，预热只许更早准备。
5. **不要为 demo 堆表演型语音功能**——本地重模型换声、炫技 TTS，VOICE_ROADMAP 已列为非目标。
6. **不要改热点文件而不看 MODULE.md**——`server/session/index.ts`、`web/src/hooks/useRemiChat.ts` 等改前先看对应 `MODULE.md`，并按下方跑测试。

---

## 9. 改完跑什么（TEST_MAP 摘录）

| 改了 | 跑 |
|------|----|
| `server/pipeline/*`（runner、首音、分句接线） | `mocha --require ts-node/register/transpile-only "test/server/pipeline/**/*.test.ts"` |
| `server/session/*`（turn-taking、duplex、打断） | `mocha ... "test/server/session/**/*.test.ts"`（含 `duplex_harness`） |
| `voice/*`（VAD、STT、TTS、分句） | `mocha ... "test/voice/**/*.test.ts"` |
| `brains/*`（context_orchestrator、fast brain、记忆注入） | `mocha ... "test/brains/**/*.test.ts" "test/brain/route_message_memory_overlay.test.ts"` |
| 关闭前必跑 | `npm run typecheck` · `npm test` · `npm run test --prefix web` |

观测：每轮语音在 `infra/latency_tracer.ts` 输出固定形状的 `[Latency]` JSON；用 `guides/DUPLEX_DATA_ANALYSIS.md` / `guides/LOG_DATA_ANALYSIS.md` 做前后版本对比。**先有 tracer 证据，再下「更像活人」的结论。**

---

## 10. 与 talk-to-fengge 的总账

| 维度 | 谁强 | 结论 |
|------|------|------|
| 边生成边合成 / 首音尽早 | 同向 | ✅ 它验证；Remi 的 producer-consumer + eager 首句更完整 |
| 记忆不走 tool-call、直拼 prompt | 同向 | ✅ 已落地；下一层（partial 预热移出关键路径）是 Remi 独有杠杆 |
| fast brain 低 TTFB 优先 | 同向 | ✅ `minimal` 推理已是默认推荐 |
| VAD / 噪声抑制 | **Remi** | 🔁 四特征 + 双门限 + fallback，碾压纯能量 |
| turn-taking | **Remi** | 🔁 三态 + 韵律 release + 非语音 reject，参照系只有静音阈值 |
| 历史预算 | **Remi** | 🔁 token+价值预算 vs 固定 20 条 |
| 观测粒度 | **Remi** | 🔁 分段 + reasoning/visible 拆分 vs 单点计时 |
| 声音克隆 / 本地重 TTS | talk-to-fengge | 🚫 明确不学：与「真人陪伴」目标不符，且本地重模型已验证不值得 |
| 双脑 / 慢脑 / 主动性 / 多端 | **Remi** | 参照系完全没有 |

**真正从 talk-to-fengge 拿走的，只有「把少数关键取舍说死」这个态度本身**——而本文就是把 Remi 已有的、散在代码和 roadmap 里的语音取舍，收成一份能照着守的规则。其余它有的，Remi 的自研方案都更优；它没有的，Remi 早就有了。
