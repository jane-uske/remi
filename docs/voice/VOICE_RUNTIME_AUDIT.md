# VOICE_RUNTIME_AUDIT.md

> 目的：在动任何重构前，先把 Remi 当前语音链路逐段读清楚，标出阻塞点。
> 方法：直接读代码，不靠印象。所有结论都附 `文件:函数/行` 证据。
> 关联：`docs/design/PIPELINE.md`、`docs/design/VOICE_ROADMAP.md`、`server/session/MODULE.md`。

---

## 0. 现状一句话

Remi 的语音链路是**“连续采集 + 声学半双工”**：麦克风在播放时确实没停，但
“用户说完没 / 要不要被打断 / 要不要修正” 全靠**声学启发式 + 正则**判断，没有
语义 turn 模型、没有声学回声消除、默认 STT 没有 interim 文本。结果是 turn 边界
不稳、打断慢且保守、她说话偏“朗读”。

---

## 1. 现状链路（实测）

```text
[浏览器] getUserMedia(echoCancellation/noiseSuppression/autoGainControl=true)
  → startPcmCapture 持续回调 PCM16
  → (可选) MicTxGate 客户端预门控  [默认关闭]
  → ws.send(RAUD 二进制帧)                      ……连续发送，播放时不停
        │
        ▼
[服务端 ConnectionSession]  server/session/index.ts
  duplex 二进制帧 → resample → VadDetector.feed()         voice/vad_detector.ts
        │  speech_start / speech_end (能量+ZCR+crest+activeRatio)
        ▼
  speechBuffer 累积 + preRoll + 合并短停顿
        │  speech_end
        ▼
  噪声抑制启发式（shouldSuppress* / idleGuard）
        │
        ▼
  decideTurnTaking()  HOLD/LIKELY_END/CONFIRMED_END     server/session/turn_taking.ts
        │   (正则 SEMANTIC_END_RE + 标点 + prosody_detector 提示)
        ▼
  SttStream.transcribePcmSnapshot()  [默认 openai 批量整段]  voice/stt_stream.ts
        │   stt_final
        ▼
  prepareVoicePipelineTurn → runPipeline                server/session/voice_submit.ts
        │   (预判命中则复用 predictedReply)
        ▼
  chatStream(LLM) → SentenceChunker → TTS 逐句           server/pipeline/runner.ts
        │   voice (整句 base64 MP3) | voice_pcm_chunk (逐句 PCM 流)
        ▼
[浏览器] useAudioBase64Queue 播放；收到 interrupt → clearQueue→src.stop()
```

并行：`computeSessionPrediction()`（`server/session/prediction.ts`）在拿到 partial
时可提前生成回复；`interrupt`（`voice/interrupt_controller.ts`）用 AbortController
统一中止 LLM+TTS。

---

## 2. 八问逐条核查（带证据）

### Q1. TTS 播放时麦克风是否仍持续监听？ → **是，连续采集；但“是否上送”取决于一个默认关闭的门控**

- `web/src/hooks/useRemiVoice.ts::startDuplex` 只调用一次 `getUserMedia`，之后
  `startPcmCapture` 的回调**持续**把 PCM16 帧 `ws.send` 出去（`useRemiVoice.ts:248-308`），
  播放期间不停。
- 客户端预门控 `MicTxGate` 仅在 `NEXT_PUBLIC_REMI_CLIENT_MIC_PRE_GATE === "1"` 时启用
  （`useRemiVoice.ts:28-29, 247`），**默认关闭**。开启时它在 `assistant_speaking`
  期间压制上送，除非本地能量门打开（本地 barge-in 预判）。
- 服务端用 `assistantPlaybackActive`（`server/session/index.ts:370, 3459, 3500`）跟踪播放态，
  VAD 在播放期间照常 `feed`。
- **结论**：传输层是全双工的（播放时麦没关）。但这把回声/自打断的风险全部压到了
  下游声学判断和浏览器原生 AEC 上。

### Q2. 如何判断用户说完？只是 silence timer / energy VAD 吗？ → **不止；是“能量 VAD + 正则语义 + 韵律提示”三层启发式，但没有学习型 EoT 模型**

- 底层：`voice/vad_detector.ts::VadDetector.feed()` = RMS 能量 + 过零率 + crest +
  activeRatio。`speech_end` 在连续 `speakingSilenceLimit`（默认 ~10 帧/约 500ms，
  `vad_detector.ts:113-114`）静音后触发。
- 上层：`server/session/turn_taking.ts::decideTurnTaking()` 输出 HOLD/LIKELY_END/
  CONFIRMED_END，依据是标点 `endsWithSentencePunctuation`、语义结尾正则
  `SEMANTIC_END_RE`（`turn_taking.ts:129`）、开放尾 `OPEN_TAIL_RE`、续接词、以及
  `voice/prosody_detector.ts` 的升降调/能量尾提示（`turn_taking.ts:520-555`）。
- **结论**：不是裸 silence timer，已有相当复杂的启发式；但本质仍是**手写规则**，
  没有 §VAP/SmartTurn 那类从真实对话学出来的语义端点模型。规则在长尾措辞上会飘。

### Q3. STT 是否支持 partial / interim？ → **支持，但被 provider 门控；默认 provider 没有真 interim 文本**

- `voice/stt_stream.ts::SttStream.canStreamPartials()` 仅当
  `getIncrementalProvider()` 为 `openai-realtime` 或 `sherpa-onnx` 时为真
  （`stt_stream.ts:218-223`）；此时 `feedStreamingPcm` → `streaming_partial` 事件
  给出**真实增量文本**。
- 默认 provider 是 `openai`（批量），走 `endPcm`/`transcribePcmSnapshot`
  整段上传（`stt_stream.ts:155-188`）。它的 `feedPcm` 发的 “partial” 只是
  `录音中… 1.2s` 的**字节计数占位符**（`stt_stream.ts:146-152`），**不是文本**。
- **结论**：interim 文本能力存在，但默认配置下没有。turn-taking 与“边听边想”
  都依赖 partial 文本——默认配置下两者都在挨饿。

### Q4. TTS 是否流式合成？能否按语义 chunk 播放？能否快速 stop？ → **逐句流式（非逐 token）；能 stop**

- 语义切句：`server/pipeline/runner.ts` 用 `utils/sentence_chunker.ts::SentenceChunker`
  在 LLM 流上**边来边切句**（`runner.ts:405, 429`）。
- 两种传输（`server/session/tts_transport.ts`）：`buffered_voice`（整句 base64 MP3
  `voice`，`runner.ts:686`）与 `pcm_stream_v1`（`streamTextToSpeech` → 逐句 `voice_pcm_chunk`
  PCM 流，`runner.ts:601-639`，Edge 走 MP3→PCM 实时转码）。
- **粒度**：流式是**句级**的——每句仍是先合出一段再播；不是真正的逐 token /
  逐音素流式合成模型。所以句内无法变速、无法插停顿气口。
- Stop：`voice/interrupt_controller.ts::InterruptController.interrupt()` abort
  AbortSignal（服务端停发后续句）+ 服务端发 `interrupt` → 前端
  `web/src/hooks/useRemiChatMessageDispatch.ts:792 case "interrupt"` → `clearQueue()`
  → `useAudioBase64Queue.ts:650 src.stop()` 停掉正在播的 WebAudio 源。**stop 链路是通的**。

### Q5. interruption.ts 的分类是否真的接入“播放中打断”？ → **没有接入“是否打断”的决策，只用于打断之后的回复塑形**

- `server/session/interruption.ts::classifyInterruption()`（correction/continuation/
  topic_switch/emotional_interrupt）被用在
  `server/session/prediction.ts:97-100` 和 `voice_submit.ts::classifyCarryForward`，
  目的是生成 `buildCarryForwardHint`——也就是**打断发生之后**，塑造下一句怎么接。
- 真正“要不要停、何时停”的 barge-in 触发在
  `index.ts::maybeConfirmPendingDuplexInterrupt()`（`index.ts:1231-1258`）和
  `vad.on("speech_start"/"speech_end")`（`index.ts:2577-2776`），它**完全是声学判断**
  （时长 `duplexInterruptMinSpeechMs` + `hasReliableDuplexInterruptEvidence` 的
  RMS/strong-frame 证据门），并且发布 turn state 时**硬编码** `interruptionType:
  "emotional_interrupt"`（`index.ts:1255`）。
- **结论**：丰富的打断分类**没有**参与 stop 决策；所有 barge-in 被一视同仁。

### Q6. prediction.ts / fastBrainPredictOnly() 能否复用为“边听边想”？ → **能，种子已存在**

- `server/session/prediction.ts::computeSessionPrediction()` 用 partial transcript
  跑 `retrievePromptMemory` + `analyzeTurn` + `brains/reply_stream.ts::fastBrainPredictOnly`
  提前生成整句回复，并可 push `stt_prediction`。
- `voice_submit.ts::runPreparedVoicePipelineTurn` 在
  `finalText.startsWith(predictionPartialText)` 时复用 `predictedReply`
  （`voice_submit.ts:150-180`）。
- **结论**：投机式预生成已实现，挂在 partial 上（因此同样受 Q3 限制）。它目前是
  “预测整句回复”，还不是“听的过程中持续推理/形成假设”，但正是“边听边想”的接入点。

### Q7. 回声消除 / 噪声抑制现状？ → **只有浏览器原生；服务端无 AEC，只有“拒噪转写”启发式**

- 唯一的 AEC/NS 是浏览器 `getUserMedia` 约束
  `echoCancellation/noiseSuppression/autoGainControl: true`（`useRemiVoice.ts:233-235`）。
- 服务端**没有声学回声消除**。有的是大量“拒绝噪声话语”的启发式：
  `voice/vad_detector.ts`（crest/activeRatio 拒脉冲噪声）、
  `server/session/turn_taking.ts::shouldSuppress*`（弱 RMS/短文本抑制）、
  `index.ts` idleGuard、以及可选的客户端 `MicTxGate`。
- **结论**：这是全双工最脆的一环。门控关闭（默认）时，Remi 自己的 TTS 会漏进麦克风，
  只能靠浏览器 AEC + RMS/时长门来避免“自己打断自己”——这正是 barge-in 既慢又保守的根因。

### Q8. 前端状态机（listen/thinking/speaking/interrupted/backchannel）是否明确？ → **状态存在，但分散在三处，且缺两个关键态**

- 服务端经 `publishTurnState(state, reason)` 推送（`assistant_entering`/
  `assistant_speaking`/`interrupted_by_user` 等 + reason `user_interrupt`/`tts_prepare`…）。
- 前端 `web/src/hooks/useRemiTurnEngine.ts` 维护 `RemiTurnState`；表现层
  `web/src/lib/presence/conversationPerformanceModel.ts` 再映射成
  listening/thinking/speaking_prepare/active/tail/yield/open_mic_idle 等 phase。
- backchannel：服务端有 `evaluateBackchannelDecision` / `chooseBackchannelText`
  （`turn_taking.ts:344-400`，"嗯"/"我在听"），但它不是一个独立的前端状态。
- **结论**：没有单一、命名清晰的 SpeechRuntime 状态机。状态散在
  `服务端 reason` + `RemiTurnState` + `presence phase` 三层；**缺失** `thinking_while_listening`
  和 `repairing` 两个一等状态。

---

## 3. 现状能力清单（一句话定级）

| 维度 | 现状 | 定级 |
|------|------|------|
| 播放中持续采集 | 连续 getUserMedia，帧不停 | ✅ 有 |
| 声学 VAD | 能量+ZCR+crest+activeRatio | ✅ 有，但纯声学 |
| 语义 turn 检测 | 正则+标点+韵律启发式 | 🟡 有但手写、会飘 |
| 学习型 EoT 模型 | 无 | ❌ 缺 |
| STT interim 文本 | 仅 sherpa/openai-realtime；默认 openai 无 | 🟡 门控、默认无 |
| TTS 流式 | 句级 PCM 流；非逐 token | 🟡 半 |
| TTS 快速 stop | abort + clearQueue + src.stop | ✅ 有 |
| barge-in 触发 | 纯声学时长/RMS 门 | 🟡 慢且保守 |
| 打断分类接入 stop | 未接（只塑形后续回复） | ❌ 缺 |
| 边听边想 | 预生成整句，挂 partial | 🟡 种子在 |
| 回声消除 | 仅浏览器原生 | ❌ 无服务端 AEC |
| 统一状态机 | 散在三层，缺 2 态 | 🟡 半 |

---

## 4. 前三个工程瓶颈（按对“自然说话”的杀伤力排序）

> 这是验收标准 #2 要求的结论。

### 瓶颈一：barge-in 是“纯声学 + 保守门控 + 无 AEC”，所以打断慢且不可靠
播放时要么门控关、Remi 的 TTS 漏进麦，系统只能靠
`duplexInterruptMinSpeechMs` + `hasReliableDuplexInterruptEvidence`（`index.ts:1239`）
的 RMS/时长证据避免自打断 → 真人插话也要攒够“证据”才停；要么门控开、
`assistant_speaking` 期间干脆压制上送 → 根本来不及被打断。**这是“被打断会不会停”
体验差的首因。**

### 瓶颈二：默认 STT 没有 interim 文本，turn-taking 和“边听边想”同时挨饿
`decideTurnTaking`（`turn_taking.ts:448`）和 `computeSessionPrediction`
（`prediction.ts:36`）都吃 partial 文本，但默认 `openai` provider 只在 final 出文本
（`stt_stream.ts:146-152` 的 partial 是占位符）→ 端点判断只能退回“声学静音 + 整段文本”，
延迟高、早切/晚切都多。

### 瓶颈三：turn-end 是手写正则+silence timer，且打断分类没接进 stop 决策
`decideTurnTaking` 靠 `SEMANTIC_END_RE`/标点/韵律启发式；barge-in 硬编码
`emotional_interrupt`（`index.ts:1255`），不区分 correction/continuation/topic_switch。
→ 她要么抢话、要么干等，并且对所有打断同样处理。**这是“什么时候开口/什么时候不说”
飘的根因。**

---

## 5. 已经具备、可被复用的“好底子”（不要推倒）

- 句级流式 TTS + 快速 stop 链路（`runner.ts` + `interrupt_controller.ts` +
  前端 `clearQueue`/`src.stop`）——这是很多系统都没做对的部分，**保留**。
- 打断后的回复塑形（`interruption.ts::buildCarryForwardHint` 的四分类）——
  分类已经写好，缺的是接到 stop 决策上。
- 投机预生成（`prediction.ts` + `fastBrainPredictOnly`）——“边听边想”的现成接入点。
- backchannel 脚手架（`evaluateBackchannelDecision`/`chooseBackchannelText`）——
  “什么时候不说、只回个嗯”的现成钩子。
- 句级 PCM 传输协商（`tts_transport.ts` 的 `pcm_stream_v1`）——未来接流式 TTS 的口子。

改造方向因此明确：**不是重写，而是在这些好底子外面，补一层“语义 turn 检测 +
统一状态机 + 可插拔 provider”**，并把已有但没接通的能力（打断分类、预生成、interim）接起来。
详见 `FULL_DUPLEX_SPEECH_RUNTIME_PLAN.md`。
