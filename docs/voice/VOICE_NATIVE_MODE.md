# VOICE_NATIVE_MODE.md — 端到端语音模式 / Voice Native Mode（调研 + 架构）

> 状态：**架构提案 + 选型调研**。本文不实现任何代码，不属于阶段 1 的交付物。
> 目的：把「如果引入端到端 / 实时语音模型，它在 Remi 里的位置、应该接哪家、第一步怎么落」一次性说清，
> 避免日后把它误当成「换一个更聪明的 Remi」。
> 前置：`VOICE_RUNTIME_AUDIT.md`（现状逐段审计）、`FULL_DUPLEX_SPEECH_RUNTIME_PLAN.md`（已落地的可插拔语音层）、`docs/design/VOICE_ROADMAP.md`。
> **最后重评估**：2026-06-24。§5 模型对比的事实截至 2026-06，经独立 web 调研 + 对抗校验，区分了「官方宣称 / 厂商自评 benchmark / 第三方实测」。

---

## 0. 一句话立场（不变）

**端到端语音模型（Moshi / Qwen-Omni / 豆包 e2e / gpt-realtime 这类）只是 Remi 的「实时语音外壳」，不是
Remi 的「灵魂」。** 它负责听感与口感（turn-taking、打断、语气、口型节奏），
**不负责** Remi 是谁。Remi Brain 始终保留：identity / memory / role / tools /
preference / **final reply authority（最终发言权）**。

如果哪天把「她说什么、她是谁、她记得什么」交给一个语音大模型自己即兴，那就不再是
Remi，只是一个会说话的通用语音模型。这条线不能越。

> **这次调研把这条立场从「态度」变成了「可证伪的工程判据」**——见 §2：不是所有端到端外壳
> 都能在架构上把发言权交还 Brain；能不能交还，是模型**类别**属性，不是调参能解决的。

---

## 0.5 调研结论速览（先读这一节）

1. **方向对，但要换个问法。** 这条分支已经确立「外壳 vs 灵魂」的立场（本文 §0）。调研要回答的不是
   「要不要全换成端到端」——那个答案明确是**否**——而是「端到端外壳在 Remi 里能不能既升级听感、又
   保住发言权」，以及「该接哪一类、第一步怎么落」。

2. **决定性判据：文本控制注入点（text-control injection point）。** 一个实时语音方案能不能当 Remi 的
   合格外壳，取决于它有没有一个「在出声之前，能让 Remi Brain 拍板最终措辞」的钩子。据此把所有方案分三类
   （§2）：**无注入点**（纯 audio-token 端到端，发言决策在音频侧，外部 Brain 改不动）、**事后/读稿口**
   （能强制它念 Brain 给的文本，但逐字保真不可靠、且浪费端到端价值）、**事前文本可控**（冻结 LLM 式
   / 交替 text-audio 式 / 级联式——Brain 是唯一文本决策者）。**Remi 只接受第三类。**

3. **「端到端 = 低延迟」和「Brain 保留发言权」是直接 trade-off。** 你越想让 Brain 有最终否决权，就越要
   等它出词、越接近级联延迟。把这条曲线画出来，比单看厂商「理论首包 234ms / 200ms」诚实得多——那些数字
   是 cold-start 单并发理论值，第三方实测端到端普遍 0.5–0.7s（云 S2S）到 2–3s（含网络/电话栈）。

4. **对中文为主、要本地、要人格连续的 Remi，最高杠杆不是换端到端模型，而是「把级联做对 + 升级嘴 + 情绪走旁路」。**
   现状级联的「朗读感」「打断慢」很可能不是架构病，而是实现病（Edge TTS 弱 + 默认批量 STT 无 interim +
   barge-in 纯声学）。把 `FULL_DUPLEX_SPEECH_RUNTIME_PLAN.md` 的语义 turn 检测 / interim / barge-in 收口，
   再把「嘴」从 Edge 升级到 CosyVoice2 / 火山（带情绪指令）、把用户语气走 SenseVoice 旁路 metadata 喂 Brain，
   大概率拿到 80% 收益、零人格风险。**这条（学界叫「优化的模块化级联」，见 X-Talk）必须作为正式候选 A，
   和「端到端外壳」并列评分，而不是默认它不行。**

5. **端到端外壳的合理定位：可选的、灰度的、第二条平行实时通道**，挂在 `VoiceEngine` 抽象后面（§6），
   默认 `legacy`，永远保留级联 fallback。第一个值得做 PoC 的不是 OpenAI Realtime，而是
   **火山 RTC「CustomLLM」模式**（中文母语 + 能把 Remi Brain 当那个 LLM 接进去 = 保住发言权）。

6. **抽象层级要对齐。** 用户提的 `VoiceEngine`（整壳替换）是比已落地的 `TurnDetectorProvider` / `TTSProvider`
   **更高一层**的抽象。两者不打架：`LegacyPipelineEngine` 内部就由现有的 `SpeechRuntime` +
   `TurnDetectorProvider` + `TTSProvider` 组成（§6.1）。用户提的 9 事件协议是现有 `SpeechRuntime` 12 事件
   总线的**超集 / 泛化**（§6.2）。

---

## 1. 两层分工（不变）

```
┌──────────────────────────────────────────────────────────────┐
│  Voice Shell（实时语音外壳，可替换）                            │
│  - 听：连续音频 in、turn-end 检测、barge-in                     │
│  - 说：低延迟、有气口/停顿的语音 out、可被瞬间打断              │
│  - 候选：本地端到端语音模型 / 级联(STT+TTS+turn detector)       │
│  - 输出：候选「该说什么」的草稿 + 韵律/时机信号                  │
└───────────────┬───────────────────────────────▲───────────────┘
                │ 候选意图 / 草稿 / 时机           │ 最终文本 + 情绪 + 边界
                ▼                                 │
┌──────────────────────────────────────────────────────────────┐
│  Remi Brain（灵魂，不可替换，最终权威）                          │
│  - identity：她是谁、人格内核、关系阶段                          │
│  - memory：长期记忆、关系连续性、core memory                     │
│  - role / tools：能力只服务陪伴，受人格约束                      │
│  - preference：用户偏好、风格指令、边界（NSFW / 严肃场景）       │
│  - FINAL REPLY AUTHORITY：最终说什么由 Brain 拍板               │
└──────────────────────────────────────────────────────────────┘
```

关键约束：**Voice Shell 可以「提议」，但不能「拍板」。**
最终发言权（措辞、人格、记忆引用、边界）永远在 Remi Brain。

---

## 2. 决定性判据：文本控制注入点（谁拍板「说什么」）

> 这是本次调研最该写进结论页的一句话：**「端到端外壳能不能把最终发言权交还 Brain」不是调参问题，
> 是模型类别问题。** 选型必须先按这个判据筛，再谈延迟/中文/本地。

按「在出声之前，外部 Brain 能否决定/否决/替换最终措辞」把所有实时语音方案分三类：

| 类别 | 机制 | 发言权能否归 Brain | 代表 | 对 Remi |
|------|------|-------------------|------|--------|
| **C1 无注入点** | 纯 audio-token 自回归，发言决策在音频侧，文本转写只是事后旁路 | **否**（结构上拿不到「出声前」的钩子） | Moshi；OpenAI/Gemini/豆包 e2e/Nova 的 **native 自由对话模式** | ❌ 直接淘汰：要么交出发言权，要么强行降级成 C2 |
| **C2 事后 / 读稿口** | 可强制它「念 Brain 给的这段文本」 | **可以，但脆**：逐字保真不可靠（会 paraphrase/截断/加前言），需「输出转写 vs Brain 原文」逐字校验兜底；且丢掉了端到端大部分价值 | OpenAI Realtime（`item.create`+`response.create`）、Qwen Talker、豆包 `ChatTTSText` | 🟡 只能当「嘴」，必须配逐字校验 + fallback |
| **C3 事前文本可控** | Brain 是唯一文本决策者，模型只把文本变成语音 | **是**（干净） | ① 级联（STT→Brain→TTS）② 冻结 LLM 式（Freeze-Omni）③ 交替 text-audio 式（GLM-4-Voice / Baichuan-Audio，文本 token 先于/引导音频，可截获替换） | ✅ Remi 唯一应走的类别 |

**两个被忽视的关键参照（这次补进来）：**

- **Freeze-Omni**（ICML 2025，腾讯/西工大，`arxiv.org/abs/2411.00774`）：speech encoder/decoder 接到一个
  **全程参数冻结的文本 LLM** 上，"keep the original intelligence of the LLM backbone"。它**证明了**「端到端
  低延迟」与「外部 Brain 保留智能/发言权」不是只能靠级联拼——是 C3 的端到端参考实现。Remi 的目标架构在学术上的对应物。
- **X-Talk**（2025-12，上海交大 X-LANCE，`arxiv.org/abs/2512.18706`，《On the Underestimated Potential of
  Modular S2S》）：论证系统化优化的**级联** pipeline 能做到 sub-second 而不牺牲模块灵活性，并点名端到端三宗罪：
  训练成本高、**智能退化（intelligence degradation）**、不可靠不适合真实部署。它就是 Remi 现状级联链路的
  「理想升级版蓝图」（带情绪/环境声理解 + RAG + 工具的事件驱动编排）。

**C3 的代价（必须显式承认）：** 交替 text-audio 式（C3③）「可截获文本流」听起来完美，但有时序陷阱——你拦截文本
token 去插 Brain 决策时，模型可能已基于自己的文本继续生成音频，替换会造成音画不同步或要丢弃已生成音频（=延迟/重生成）。
**这就是 §0.5#3 的「发言权 ↔ 延迟」trade-off 的微观来源。**

---

## 3. 三种 Voice Shell 形态（都服从同一边界）

| 形态 | Shell 做什么 | Brain 做什么 | 注入点类别 | 取舍 |
|------|-------------|-------------|-----------|------|
| **A. 级联（现状方向，最该先做对）** | STT + 语义 turn detector + 流式 TTS（+ 情绪旁路） | 全部内容与人格，唯一文本决策者 | C3① | 控制力最强、最像 Remi、零人格风险；延迟靠工程压（X-Talk 证明可 sub-second） |
| **B. 端到端「听」+ Brain「想」+ TTS「说」** | 端到端模型只做实时听感/打断/情绪感知/草稿；嘴可独立 | Brain 改写草稿为最终回复 | C3②③ 或 C2 | 听感升级，灵魂仍归 Brain；时序与逐字保真要处理 |
| **C. 全端到端语音对语音** | 模型直接听→说 | 仅事后约束/纠偏（弱） | C1 | 听感最好，但**结构上丢灵魂**；Remi 默认不走 |

**默认路线是 A→B**：先把可插拔 turn detector / TTS provider（见 PLAN 的 `TurnDetectorProvider` /
`TTSProvider`）做扎实；只有在 Brain 仲裁层足够强、能保证 final reply authority 时，才在 B 形态里灰度引入
端到端外壳（且只接 C3 / C2，绝不接 C1）。**形态 C 永远是禁区。**

---

## 4. 不可协商的红线（不变 + 补强）

1. **最终发言权在 Brain**：任何端到端模型的语音输出，涉及身份、记忆、关系、边界、人格时，必须能被 Brain
   改写或否决。**工程化**：C2 模式必须做「输出转写 vs Brain 原文」逐字校验，偏离则降级。
2. **记忆/身份不下放**：Voice Shell 不持有长期记忆、不定义 Remi 是谁。
3. **可回退**：端到端模式必须能退回级联（legacy）路径，不删 fallback。
4. **边界继承**：严肃场景承接、NSFW 开关、安全红线由 Brain 统一裁决，Shell 不自行决定。
5. **她不变**：换 Shell 不能让用户感觉「换了一个人」。这是产品底线（见 `docs/ops/CURRENT_FOCUS.md`：核心价值是「还是她」）。
   **新增风险点（§9）**：端到端模型的「智能退化」会**伪装成人格漂移**——用户感知不到「模型变笨」，只感觉
   「Remi 不像她了」。这正中人格连续性红线。
6. **情绪走旁路，不挤进文本流**：用户语气（SenseVoice 的 emotion/event 标签）和 Brain 的情绪意图，走独立
   metadata 通道，不和文本同流——否则「语音→文本→语音」会让副语言信息**不可逆丢失**（双向）。外壳必须支持
   「文本 + 情绪向量」双输入（must-have），TTS 侧用支持情绪 prompt 的 provider（CosyVoice2 / IndexTTS-2 / 火山）。

---

## 5. 模型 / 方案对比（2026-06，已对抗校验）

> 这些是不同**架构类别**，不能塞进同一行横比（尤其延迟口径完全不同）。按「类别」分表。
> 标注口径：⊙官方宣称 / ⊘厂商自评 benchmark / ●第三方实测。延迟一律区分「理论首包」与「端到端实测」。

### 5.1 实时 S2S / 端到端外壳候选（主表）

| 方案 | 开源/License | 实时 IO / 全双工 | 打断 | 中文 | 本地部署 | 工具调用 | 情绪(入/出) | 延迟 | 注入点 | 对 Remi 的角色 | fit |
|------|------|------|------|------|------|------|------|------|------|------|----|
| **OpenAI Realtime**<br>(gpt-realtime / -2) | 闭源云 | 真 S2S，WebRTC/WS/SIP | 原生（需自处理 cancel+truncate 时序，VAD 对噪声敏感） | multilingual，**无官方中文基准**；第三方 code-switch 退化 34–75%，音色跨版本回退 | ❌ 不可，纯云 | 原生 FC，ComplexFuncBench-audio 66.5%⊙（别当 100%） | 入：强；出：指令级软控（非数值），1.5 版表现力回退 | ●首包~500ms、voice-to-voice~800ms⊙；含网络/电话栈每轮中位 2.24–3.4s● | **C2** | 可选高端云「嘴」（外部-Brain 读稿模式 + 逐字校验）；非默认 | 5 |
| **Gemini Live**<br>(native audio) | 闭源云 | 真 S2S，WSS（无原生 WebRTC，需 Pipecat/LiveKit 桥） | 原生 VAD + Proactive Audio | 97 语含简繁中文⊙，但 12-2025 模型有 raspy/timbre 漂移/杂音负评●，**陪伴音色必须自测** | ❌ 不可，纯云 | native audio 档 FC **极不可靠**（2.5 ComplexFuncBench-audio 71.5%，社区报~50:1 假执行）；half-cascade 档 90.8% | 入：Affective Dialog 强；出：30+ 音色，system instruction 对 native 档曾受限 | ⊙sub-second（无硬 SLA）；●区间 250ms–960ms 不等，须自测 | **C1/C2** | 同上，且工具更不可控；会话可经上下文压缩延长 | 5 |
| **豆包 e2e 实时语音大模型**<br>(火山 路径A) | 闭源云 | 真 S2S，自有二进制 WS；2026 升级 Seeduplex 全双工「边听边说」 | 原生「平滑打断」 | **native，中文第一优先**（方言/口音/唱歌）；满意度 4.36 vs GPT-4o 3.18⊘(厂商自评) | ❌ 不可（「本地」仅 Demo 跑本地，推理在云） | **无 tools/function/MCP 字段，模型不可控** | 强（情绪承接 + speaking_style 文本） | ⊙裸模型~700ms（未含网络/Brain 往返） | **C1**（`ChatTTSText` 退化成 C2 纯 TTS） | ❌ 路径A 不要碰：人设上限 1500 字、交出发言权 | 6（指路径B） |
| **火山 RTC 对话式 AI**<br>(CustomLLM 路径B) | 闭源云编排 | RTC/WebRTC 当采集/ASR/打断/TTS | 原生（音频帧级 VAD，全双工） | native ASR + 火山 TTS 中文强 | ❌ 推理在火山云 | **FC + MCP + 长期记忆在 RTC 编排层**，但工具决策应留 Brain | 火山 TTS 情绪可控 | ●需 PoC（Brain 插入 CustomLLM 回调会再加一次 LLM 往返，预期 >700ms） | **C3①**（Brain = 那个 CustomLLM） | ✅ **唯一保住发言权的火山路径，中文外壳首选 PoC** | 6 |
| **Qwen3-Omni**<br>(30B-A3B) | **Apache-2.0**（Thinking 变体无 audio-out） | 真 S2S（Thinker-Talker）；云 DashScope Realtime / 自托管 vLLM | 云 Realtime VAD；3.5 加 semantic interruption | **native，开源 SOTA 梯队**（Fleurs-zh WER 2.20●，语音输出 10 语含中文） | 🟡 门槛高：BF16~79GB；AWQ4 需~48GB（24GB 未证实）；**自托管 audio-out 不成熟**（vLLM 修 bug 中）；**MLX 无 Omni 路径** | 原生 `<tool_call>`；3.5-Omni BFCL-V4 63.3%（低于纯文本 baseline，印证别全交它） | 入：强；出：自然语言指令控情绪/语速，开源 3 音色 | ⊙理论 234ms（cold-start）；●vLLM audio→text~516ms、DashScope TTFA~685–702ms | **C2/C3②** | 可拆开用：当「耳朵」（带情绪 ASR + 打断）或「嘴」（Talker 读 Brain 文本）；先用云 Realtime 灰度 | 6 |
| **MiniCPM-o**<br>(2.6 / 4.5) | **Apache-2.0** | 2.6 = **half-duplex（轮流，无原生打断）**；**真全双工是 4.5**（2026-02，TTFT 0.6s●） | 2.6 无；4.5 原生 | **native 强**（AISHELL-1 CER 1.6●，碾压 GPT-4o-realtime 中文 7.3） | ✅ **最强卖点**：4.5 论文称 <12GB RAM 边缘设备可实时全双工；有 MLX；4.5 已上云 API | **官方确认不支持 FC**（训练无 FC 数据）→工具必须留 Brain | 出：emotion/speed/style 控 + voice cloning（保「还是她」）；入：ASR 超 GPT-4o-realtime | 2.6 无实测；4.5 TTFT 0.6s● | **C2/C3②** | ✅ **本地中文语音外壳候选（耳+嘴）**；评估直接看 **4.5 不是 2.6**；Ollama 路径只跑图像不含语音 | 6 |
| **Step-Audio 2**<br>(mini 开源 / 2.5-realtime 闭源) | partial：mini Apache-2.0；旗舰闭源 API | mini 端到端但 turn-based（外部 VAD）；2.5-realtime WS（**官方未声称 full-duplex/barge-in**） | 均**无原生 barge-in 背书**（连 2.5） | **native 最强中英+副语言**（CER 3.08⊘） | mini 可本地但 **CUDA-only（无 MLX）**，8B；2.5 闭源不可本地 | mini tool-call 86.8%⊘（StepFun 自评，无第三方复现） | **入向副语言最强**（83.09⊘ vs GPT-4o 43）；出：情绪/风格可控 | **全程无对话延迟 ms 数字**（仅 ASR RTF），须自测 | **C2/C3②** | ✅ 最佳定位=**「耳朵 + 语气感知层」**，把用户语气结构化喂 Brain（补强 SenseVoice）；别让它端到端发声 | 6 |
| **GLM-4-Voice** | 开源（GLM-4-9B 基座） | **turn-based + 可打断，非双流全双工**；交替 text-audio，10 token 起播 | turn 内可打断 | native 中英双语 | ✅ 9B 消费级工作站卡 | 走文本侧 | 指令调情绪/语调/语速/方言 | 10 voice token 起播（理论） | **C3③**（文本 token 引导音频，可截获） | 🟡 C3③ 参考实现（中文 + 可截获文本流），但有时序陷阱 | — |
| **Moshi**（Kyutai） | CC-BY-4.0 权重 | **真双流全双工**，sub-200ms● | 原生（双流） | ❌ **无中文**（STT en/fr，TTS 6 欧语） | ✅ 单 GPU / iPhone 15 Pro，有 MLX | ❌ 无 | 入：有情绪智能；出：—— | ●理论 160ms / 实测 ~200ms（p95 250ms） | **C1**（Helium 烤进权重，不可换脑） | ❌ **出局**：不能插 Brain + 无中文 + 无工具；但「双流全双工 200ms」是听感天花板参照 | 5 |
| **Amazon Nova 2 Sonic** | 闭源（Bedrock） | 真 S2S 全双工（HTTP/2 双向流） | 原生（VAD 灵敏度可配） | ❌ **仅 7 语，无中文** | ❌ 不可 | 原生 FC + 异步工具（决策在 Nova） | 自动 prosody，无手动旋钮 | ●官方仅证实转写<300ms；端到端 TTFA~1s 量级 | **C1** | ❌ 哲学对立：自带脑+工具+turn-taking = 「换了个人」 | 2 |
| **Freeze-Omni** | 开源（论文/权重） | 端到端，冻结 LLM | 支持 | 取决于接的 LLM | 论文级 | 由冻结 LLM 决定 | 端到端保留韵律 | 论文级低延迟 | **C3②（冻结 LLM）** | ⭐ **Remi 目标架构的参考实现**（端到端低延迟 + Brain 不动）；研究价值 > 直接落地 | 参考 |

### 5.2 「嘴」：表现力 TTS 输出层（不是 S2S，只升级口感，零发言权威胁）

| 方案 | 开源 | 中文 | 本地/MLX | 情绪/身份控制 | 对 Remi |
|------|------|------|---------|--------------|--------|
| **CosyVoice 2 / 2-0.5B**（阿里） | ✅ | **中文流式 TTS 事实标准**，含方言 | ✅，对 MLX 基建对得上 | 自然语言指令控 emotion/pitch/speed/副语言，150ms 流式 | ⭐ **先用它排查「现状朗读感是不是只因 Edge TTS」**；级联升级嘴的首选 |
| **IndexTTS-2**（B站） | ✅ | ✅ | ✅ | **emotion 与 speaker identity 解耦**（独立 prompt 控音色/情绪 + 控时长） | ⭐ 对「人格音色稳定 + 情绪可变」（换壳不像换人）直接相关；已下载待集成（见 TASKS） |
| **Sesame CSM**（~1.1B） | ✅ Apache-2.0 | ❌ 基本不可用（官方称非英语「likely won't do well」） | ✅ 有**社区** MLX 端口（非官方，需自验） | RVQ 建模停顿/口腔音，表现力强；**无显式情绪旋钮**，靠上下文 | 🟡 哲学最契合（物理上 cannot generate text → 零发言权威胁），但中文阻塞，短期进不了主链路 |
| **Kyutai TTS / Pocket TTS** | ✅ MIT/CC-BY | ❌ 6 欧语无中文 | ✅ Pocket 100M 可 CPU | 多情绪音色 + 克隆 | ❌ 中文缺失 |

### 5.3 「耳朵」：语音理解输入层（audio-in → text/标签，喂 Brain）

| 方案 | 形态 | 中文 | 对 Remi |
|------|------|------|--------|
| **SenseVoice**（现状已接） | 批量 ASR + emotion/event/lang 标签 | native | ✅ 现状基线，情绪标签已进 Brain prompt；**就是「情绪走旁路」的现成通道** |
| **Step-Audio 2 mini** | 端到端，副语言理解最强 | native | ✅ 当「语气感知耳朵」，补强 SenseVoice（见 §5.1） |
| **Ultravox**（Fixie） | audio-in → **text-out（不出音频）**，砍掉 STT | 官方 42 语含中文 | 🟡 是「耳朵+脑」合一，response text 由它生成 → **抢 final reply authority**；要退化成纯 STT 才安全（不如直接用 SenseVoice） |

### 5.4 编排框架（不是模型，是把级联做对的工具）

| 框架 | License | 语义 turn / 打断 | 中文 turn 检测 | 工具调用归属 | 对 Remi |
|------|------|------|------|------|--------|
| **Pipecat**（Daily） | BSD-2 | Smart Turn v3（Whisper-tiny，**音频原生**，8MB CPU 友好，23 语含中文）；Interruptible Frame | ✅ | **LLM 决策、框架执行**（base_url 指向 Remi Brain） | ⭐ **最契合**：纯框架无 SFU 绑定、WebSocket transport 对接现有客户端、Brain 当那个 LLM = 保住发言权。**摩擦：纯 Python，与 Remi Node 后端异构，需 sidecar** |
| **LiveKit Agents** | Apache-2.0 | turn-detector v1-mini（**文本模型 Qwen2.5-0.5B**，14 语含中文）；adaptive interruption（拒 51% VAD 误触，end-of-turn 误打断相对降 39%） | ✅ | 同上（@function_tool，LLM 决策） | 🟡 适合未来要电话/SIP/多人房间；学习曲线陡，最佳体验要整套 LiveKit stack |
| **Kyutai Unmute** | MIT | 语义 VAD（仅 Rust server） | ❌ 无中文 | 无内置（靠你接的文本 LLM） | 🟡 **架构模板**（「任意 OpenAI 兼容 LLM 套流式 STT/TTS」正是想要的可插拔外壳），但无中文、无工具 → 只能借鉴不能直接用 |

> **关键诚实点（校验后）：** ① 框架延迟「750–950ms」是单篇营销博客的示意估计，非严谨第三方实测，Remi 用
> 国内链路 + Edge TTS + 中文 STT 的真实值未知，瓶颈在所选 provider 的 TTFT。② 走框架的 **S2S（RealtimeModel）模式会
> 取代而非补充自带 LLM**（官方确认）→ 一旦贪 S2S 自然语气就丢 final reply authority。**框架只在级联模式下对 Remi 成立。**

---

## 6. 推荐架构：`VoiceEngine` 抽象（叠加在现有 SpeechRuntime 之上）

### 6.1 与已落地 seam 的关系（不是另起炉灶）

用户提的 `VoiceEngine` 是**整壳替换**层，比 `FULL_DUPLEX_SPEECH_RUNTIME_PLAN.md` 已落地的
`TurnDetectorProvider` / `TTSProvider` / `SpeechRuntime` **更高一层**。两层是**包含关系**，不是竞争：

```
VoiceEngine（新增：选哪个「壳」当前生效）
 ├─ LegacyPipelineEngine  ← 包住整条现有级联
 │    └─ 内部 = SpeechRuntime(FSM) + TurnDetectorProvider + STT + Brain + TTSProvider
 │       （= 现状，PR1/PR2 已落地的东西，行为不变，默认）
 ├─ VolcRtcEngine          ← 后续：火山 RTC CustomLLM（C3①，中文壳 PoC）
 ├─ RealtimeMouthEngine    ← 后续：OpenAI/Qwen/MiniCPM 读稿模式（C2，逐字校验）
 └─ RealtimeVoiceEngine    ← 阶段1 只放「占位 stub」，不接任何厂商
```

**一句话：** `VoiceEngine` 决定「现在用哪条实时通道」；`LegacyPipelineEngine` 内部仍由现有的
`SpeechRuntime` + `TurnDetectorProvider` + `TTSProvider` 组成。新增抽象**不替换**已落地的代码，只在它外面收一个口。

### 6.2 统一事件协议（用户 9 事件 ↔ 现有 12 事件）

用户提的 9 个事件是现有 `SpeechRuntime`（`server/session/voice/speech_runtime.ts`）12 个事件的**超集 / 泛化**——
泛化的目的是让**同一套事件既能被级联引擎产出、也能被端到端引擎产出**。映射：

| 用户提的 VoiceEngine 事件 | 现有 SpeechRuntime 事件 | 级联引擎来源 | 端到端引擎来源 | 备注 |
|---|---|---|---|---|
| `user_audio_frame` | `audio.frame` | duplex 二进制帧 | 同 | |
| `partial_user_text` | `transcript.partial` | STT interim（sherpa/openai-realtime） | 模型原生 ASR | 默认 openai/SenseVoice 无 interim（见 AUDIT 瓶颈②） |
| `assistant_partial_text` | `response.token` | **Brain** chatStream token | **Brain**（C2/C3 下仍来自 Brain，非语音模型） | 关键：这条永远是 Brain 的草稿/最终文本 |
| `assistant_audio_chunk` | `tts.chunk_start` / `tts.chunk_end` | TTSProvider 逐句 PCM/MP3 | 模型音频 out | |
| `interruption_detected` | `user.barge_in` | `maybeConfirmPendingDuplexInterrupt` | 模型原生 VAD | 仅 `confirmed` 触发 stop |
| `user_emotion_hint` | （新增，旁路 metadata） | **SenseVoice** emotion/event 标签 | 模型副语言信号 | §4#6 的旁路通道，不进文本流 |
| `turn_committed` | `turn.complete` | `decideTurnTaking`→CONFIRMED_END | 模型 turn 结束 | |
| `tool_request` | （新增） | **Brain** function-calling | **永远来自 Brain，绝不来自语音模型** | §2：工具决策不下放（行业共识：调工具退回文本侧） |
| `memory_write_candidate` | （新增） | **Brain / slow brain**（`background_analysis`/`core_memory`） | **永远来自 Brain** | 记忆写入永不下放给语音外壳 |

> 三个新增事件（`user_emotion_hint` / `tool_request` / `memory_write_candidate`）刻意**只由 Brain 或旁路通道
> 产出**——这从协议层面就守住了「记忆/工具/发言权不下放」的红线：无论底下是哪个引擎，这三条事件的源头都不是语音模型。

### 6.3 引擎能力契约（让红线变成类型约束）

每个 `VoiceEngine` 必须**声明**它的控制语义，让 §2 的判据变成代码层的准入条件：

```ts
// server/session/voice/engine/types.ts  (阶段1 新增，纯接口)
export type VoiceEngineId =
  | "legacy" | "volc_rtc" | "openai_realtime" | "gemini_live"
  | "qwen_omni" | "minicpm_o" | "moshi" /* moshi 仅占位，实际禁用 */;

export interface VoiceEngineCapabilities {
  finalReplyAuthority: "brain" | "shell";   // Remi 只接受 "brain"
  textControlInjection: "none" | "post_hoc" | "pre_hoc"; // §2 的 C1/C2/C3
  fullDuplex: boolean;
  nativeBargeIn: boolean;
  chinese: "native" | "multilingual" | "none";
  localDeployable: boolean;
  emitsUserEmotion: boolean;                 // 是否提供 user_emotion_hint
  requiresVerbatimGuard: boolean;            // C2 必为 true：要逐字校验
}

export interface VoiceEngine {
  readonly id: VoiceEngineId;
  readonly capabilities: VoiceEngineCapabilities;
  start(ctx: VoiceEngineContext): Promise<void>;
  pushAudioFrame(frame: Buffer, sampleRate: number): void;
  // Brain 把「最终该说的文本 + 情绪意图」交给引擎；引擎只负责变成语音
  speak(finalText: string, emotion: EmotionIntent, signal: AbortSignal): Promise<void>;
  stop(): void;                              // barge-in / interrupt
  on(event: VoiceEngineEventType, cb: (e: VoiceEngineEvent) => void): void;
  dispose(): Promise<void>;
}
```

**准入门**：`resolveVoiceEngine()` 拒绝 `finalReplyAuthority !== "brain"` 的引擎（即 §2 的 C1 自由对话模式直接
被类型挡住）；`textControlInjection === "post_hoc"` 的引擎强制 `requiresVerbatimGuard === true`。

### 6.4 架构图

```
   ┌──────────────── ConnectionSession (WS 语音会话) ────────────────┐
   │                                                                 │
   │   duplex 二进制帧 ──▶ VoiceEngine（resolveVoiceEngine, flag 控） │
   │                          │  emits 统一 VoiceEngineEvent          │
   │        ┌─────────────────┼──────────────────────────────┐       │
   │        ▼                 ▼                               ▼       │
   │  user_audio_frame  partial_user_text / turn_committed  user_emotion_hint
   │        │                 │ (interim, 旁路 metadata)      │       │
   │        └────────────┐    ▼                               │       │
   │                     ▼  ┌──────────── Remi Brain ─────────▼─────┐ │
   │                        │ identity·memory·persona·preference    │ │
   │   assistant_partial_text ◀── chatStream（唯一文本决策者）       │ │
   │   tool_request ────────│ function-calling（工具不下放）         │ │
   │   memory_write_candidate│ slow brain（记忆不下放）              │ │
   │                        └──────────────┬────────────────────────┘ │
   │                                       │ speak(finalText, emotion) │
   │   assistant_audio_chunk ◀──── VoiceEngine 把文本变语音（C3①级联   │
   │   interruption_detected ◀────  TTSProvider / C2 读稿口 / 火山RTC）│
   │                                       │                          │
   │   ★ legacy fallback 永远在：引擎失败 → 回退 LegacyPipelineEngine ★ │
   └─────────────────────────────────────────────────────────────────┘
```

---

## 7. 第一阶段最小可落地（VoiceEngine 抽象 + 占位，不接厂商）

> 原则：**不推翻现有语音链路、不直接替换 Brain、不接任何具体厂商模型、零行为变化（默认 legacy）。**
> 这一阶段只做「整壳抽象」这层口，和 `FULL_DUPLEX_SPEECH_RUNTIME_PLAN.md` 的 PR3/PR4 独立、可并行。

| 项 | 范围 | 行为变化 |
|----|------|---------|
| **VE-0** | 本文档（已含调研 + 架构 + 计划） | 无 |
| **VE-1** | `server/session/voice/engine/types.ts` — §6.3 的 `VoiceEngine` 接口 + 能力契约 | 无 |
| **VE-2** | `LegacyPipelineEngine` — 包住现有 `SpeechRuntime`+`TurnDetectorProvider`+STT+Brain+`TTSProvider`，**re-emit 统一 VoiceEngineEvent**；行为与现状逐位等价，作 fallback | 无（等价） |
| **VE-3** | `RealtimeVoiceEngine` **占位 stub**：实现接口、声明 capabilities，但 `start/speak` 在阶段1 **不接任何厂商**，仅 shadow 落日志「would route to realtime」 | 无 |
| **VE-4** | `resolveVoiceEngine()` — 读 `REMI_VOICE_ENGINE`（`legacy`\|`realtime_shadow`，默认 `legacy`）+ 准入门（拒非 `brain` 发言权引擎）；未知/不可用一律回退 `legacy` | 无 |
| **VE-5** | Web「语音原生模式（实验）」开关 — `RemiSettingsPanel.tsx` 新增一个 `Section`+`Toggle`，写 runtime overlay（`/api/settings` → `REMI_VOICE_ENGINE`）；运行时切换沿用 `set_voice_style` 的 WS 消息先例（新增 `set_voice_engine` case，`message_router.ts`） | UI 多一个开关；默认关 |
| **VE-6** | 统一事件总线把 `tool_request`/`memory_write_candidate`/`user_emotion_hint` 三个新增事件接到现有 Brain/SenseVoice 源（shadow，仅日志） | 无 |

**VE 退出标准**：① `npm run typecheck` 通过、`mocha test/server/session/**` 全绿；② `legacy` 下行为与改动前
**逐位一致**（用现有 `duplex_harness` 回归）；③ `realtime_shadow` 下只落日志、不发任何客户端消息、不碰 fast path；
④ 切换开关能在 `legacy ↔ realtime_shadow` 间切，且 `realtime_shadow` 永远能回退 `legacy`；⑤ **不引入任何厂商语音 SDK 依赖**。

**明确不做（阶段1 边界）**：不接 OpenAI/Gemini/Qwen/火山任何模型、不替换 VAD/STT/TTS、不改 Brain、不在 fast path 加阻塞、不删任何 fallback。

### 7.1 阶段1 已落地（VE-1~VE-6 ✅）

| 项 | 落地位置 |
|----|---------|
| **VE-1** | `server/session/voice/engine/types.ts`（`VoiceEngine`/`VoiceEngineCapabilities`/统一事件协议/`isAllowedEventOrigin` 守卫）+ `engine/base.ts`（`BaseVoiceEngine`：listener 注册 + item-12 `emit` 守卫） |
| **VE-2** | `engine/legacy_pipeline_engine.ts`：薄封装 `SpeechRuntime`，`observe()` 为 no-op → `legacy` 与改动前等价 |
| **VE-3** | `engine/realtime_voice_engine.ts`：占位 stub，把 observation 映射成统一事件并 **shadow log**，不接厂商、不发客户端、不碰 fast path |
| **VE-4** | `engine/index.ts` `resolveVoiceEngine()`：默认 `legacy`；未知 id / 构造失败 / 非 `brain` 发言权 **一律回退 legacy**；`REMI_VOICE_ENGINE` 入 `config/schema.ts` + `config/overlay.ts` 白名单 |
| **VE-5** | `RemiSettingsPanel.tsx` 新增「实时语音外壳（实验）」`Section`（写 `REMI_VOICE_ENGINE` overlay，下次语音会话生效）；WS `set_voice_engine` 消息（`message_router.ts` + `index.ts handleSetVoiceEngine` → `voice_engine_ack`）支持每会话热切换 |
| **VE-6** | 统一事件 `assistant_partial_text`/`tool_request`/`memory_write_candidate`/`user_emotion_hint` 由 origin 标注归属；item-12 守卫保证语音壳（`shell`）不能伪造这四类事件（`emit()` 拒绝 + 计数 + 告警）。**新增事件接入 index.ts 的 4 个 additive observe 接缝（turn_state / duplex 起停 / partial），不改动现有 `speechRuntime` 调用点** |

> 接口范围：阶段1 的 `VoiceEngine` 只含**观察面**（`observe`/`on`/`snapshot`/`capabilities`）。§6.3 草拟的接管面（`start`/`pushAudioFrame`/`speak`/`stop`/`dispose`，即引擎真正接管音频路径）属**阶段2**，刻意不在此实现——现在加会立刻违反「不改变现有行为」。
>
> 测试：`test/server/session/voice_engine.test.ts`（22 例：resolver 默认/切换/回退、legacy no-op、shadow 事件映射 + origin、item-12 守卫）。`legacy` 等价性由现有 `speech_runtime_shadow`/`duplex_regression` 回归覆盖。

---

## 8. 后续接入优先级（按「对 Remi 的杠杆 ÷ 风险」排序）

> 优先级**不是**按「模型多先进」，而是按「中文 + 保发言权 + 本地价值 + 工程量」。

| 优先级 | 动作 | 为什么 | 依赖 |
|---|---|---|---|
| **P0（最高杠杆，非换模型）** | 收口 `FULL_DUPLEX` 计划：语义 turn detector（Pipecat SmartTurn / LiveKit v1-mini）+ 默认 interim + barge-in 量化；同时把「嘴」从 Edge 升级到 **CosyVoice2 / 火山（带情绪指令）**，用户语气走 **SenseVoice 旁路**喂 Brain | X-Talk 论证：优化级联可 sub-second、零人格风险。**先证明现状的差是实现病不是架构病**，大概率拿 80% 收益 | 已有 PLAN PR3–PR7 |
| **P1（中文实时壳 PoC）** | **`VolcRtcEngine`**：火山 RTC「CustomLLM」模式，RTC 当耳朵+嘴+打断，Remi Brain 当那个 OpenAI 兼容 LLM | C3①、中文母语、唯一保住发言权的火山路径；Remi 已用火山 TTS | VE-1~4 + iOS RTC SDK |
| **P2（本地中文壳，等成熟）** | `MiniCpmOEngine`（看 **4.5** 不是 2.6）/ `QwenOmniEngine`（云 Realtime 当耳朵先行） | 开源 + 本地 + 中文 native；对 Remi MLX 基建有现实价值。等 audio-out 成熟 / 4.5 落地 | VE + 本地推理基建 |
| **P3（高端云壳，可选）** | `RealtimeMouthEngine`：OpenAI Realtime / Gemini Live **读稿模式（C2）** + 逐字校验 | 英文场景 / 高端音色；但闭源、贵、中文非强项、需 verbatim guard | VE + 逐字校验器 |
| **P-out** | **Moshi / Nova Sonic / Step 2.5-realtime 自由对话 / 豆包 e2e 路径A** | 无中文 或 不可换脑（C1）或 自带 persona → 违反红线 | 不接 |
| **侧路** | 把 **IndexTTS-2** 接成 TTSProvider（情绪/身份解耦）；评估 **CSM** 中文微调 | 治「朗读感」「换壳像换人」，零发言权威胁 | TTSProvider（PLAN PR3） |

---

## 9. 风险点

1. **智能退化伪装成人格漂移**（最隐蔽）：任何参与语义生成的端到端壳，会从音频侧引入推理退化（学界已有
   **S2SBench** / **VoxEval** 量化），用户只感觉「Remi 不像她了」。**对策**：任何端到端候选必须先跑 S2SBench
   量化退化，且只用 §2 的 C3/C2（语义零参与或纯读稿）。
2. **逐字保真不可靠**（C2 通病）：读稿口会 paraphrase/截断/加前言（OpenAI 官方已知问题）。**对策**：强制
   「输出转写 vs Brain 原文」逐字校验，偏离则降级到级联。
3. **发言权 ↔ 延迟 trade-off**：越要 Brain 否决权越接近级联延迟（§2 时序陷阱）。**对策**：别拿厂商「理论
   首包」对用户/对内承诺；以端到端实测为准；接受「保发言权 = 不追求 sub-200ms」。
4. **副语言双向丢失**：语音→文本→语音不可逆丢韵律。**对策**：§4#6 情绪旁路 metadata 通道 + 支持「文本+情绪
   向量」双输入的 TTS（must-have）。
5. **供应商锁定 + 云依赖 + 成本**：OpenAI 音频出 $64/1M（~$0.07–0.11/min）、豆包/Gemini 同量级，对「持续在场」
   长时陪伴成本敏感；闭源云与「本地/边缘价值」和「不把外部 SDK 耦进核心循环」相悖。**对策**：云壳隔离在
   VoiceEngine 层、默认本地/级联、PoC 实测成本。
6. **中文质量被「支持语言清单」高估**：OpenAI/Gemini「支持中文」≠ 中文陪伴音色达标（code-switch 退化、timbre
   漂移）。**对策**：任何云壳上线前强制中文 A/B，对比 Edge/火山/Qwen3-TTS。
7. **会话/记忆边界**：云 Realtime 跨会话记忆不可靠回灌（OpenAI 单会话 60min、需每次注入）。**对策**：记忆永远
   由 Remi 记忆层注入，不依赖外壳上下文。
8. **栈异构**：最成熟的编排框架（Pipecat）是 Python，与 Remi Node 后端异构 → sidecar 进程 + 桥接成本。
9. **fast path 阻塞**：工具调用、记忆检索绝不能进 `thinking_while_listening` / `sttFinal→llm_first` 同步窗口
   （`REMI_TOOL_USE_ENABLED` 开启时工具是阻塞的，见 AUDIT §6）。
10. **fallback 静默丢失**：任何引擎失败必须无缝回退级联，且要有可观测的回退日志（不静默移除降级）。

---

## 10. 验收标准

**抽象层（阶段1，VE）**：见 §7 退出标准（typecheck/测试绿、legacy 逐位等价、shadow 零行为、可回退、零厂商依赖）。

**任何端到端候选进「灰度 on」前，必须过这些闸（缺一不可）**：

1. **发言权**：`finalReplyAuthority === "brain"`，且 C2 引擎的逐字校验偏离率 < 阈值（实测「输出转写 vs Brain 原文」）。
2. **人格连续性 / 智能退化**：候选在 **S2SBench / VoxEval** 上的退化幅度低于约定阈值；长对话**音色身份不漂移**
   （cross-turn voice identity drift 实测，参照 IndexTTS-2 的 emotion/identity 解耦维度）。
3. **turn-taking 质量**（不只测延迟）：用 **Full-Duplex-Bench v1.5/v2 / MTR-DuplexBench** 测 barge-in / backchannel /
   不抢话 / 背景人声免疫——这是在场感主线第一优先级。
4. **中文**：中文 ASR/TTS 自然度 A/B 不劣于现状（Edge/火山/SenseVoice）。
5. **打断延迟**：`infra/latency_tracer` 的 `barge_in_speech_start_to_stop` 不劣于 legacy 基线（PLAN PR1 已埋点）。
6. **情绪旁路**：`user_emotion_hint` 端到端能影响 Brain 回复语气（接住语气），且不挤进文本流。
7. **fallback**：注入引擎故障，能无缝回退 `LegacyPipelineEngine`，有回退日志，用户无感知中断。
8. **成本/会话**：实测每分钟成本、会话上限、跨会话记忆注入路径，均在产品可接受范围。
9. **「还是她」主观验收**：复用 `scripts/conversation_quality_eval.mjs` / 10 分钟在场感压测，换壳前后用户不应感到「换了个人」。

---

## 11. 与 `FULL_DUPLEX_SPEECH_RUNTIME_PLAN.md` 的关系

`FULL_DUPLEX` 计划（`TurnDetectorProvider` / `SpeechRuntime` shadow / `TTSProvider`，PR1/PR2 已落地）做的是
**「把级联做对」**——也就是本文 §3 的**形态 A** 和 §8 的 **P0**。它是地基，也是 fallback。

本文的 `VoiceEngine` 抽象（§6）在它**之上**收一个「整壳替换」的口：`LegacyPipelineEngine` 内部就是
`FULL_DUPLEX` 的产物；端到端外壳（形态 B）作为这条路的**远端可选项**挂在同一个抽象后面，默认不启用、永远可回退。

**两份文档的分工**：`FULL_DUPLEX` = 现在就做、把级联做扎实（P0）；本文 = 把「未来如果引入端到端壳」的位置、
判据、选型、第一步抽象一次性说清，确保它永远是「外壳」，不是「替代」。**今天该投入的是 P0，不是急着接厂商模型。**
