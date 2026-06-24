# FULL_DUPLEX_SPEECH_RUNTIME_PLAN.md

> 目标：在**保留** Remi 现有 text LLM / 人设 / 记忆 / 工具链的前提下，在语音侧外挂
> 一层**模块化全双工语音控制层**，把 `VOICE_RUNTIME_AUDIT.md` 指出的三个瓶颈拆掉。
> 第一阶段**只做 audit + 设计 + 最小接口骨架**，不大规模替换 STT/TTS/VAD。
> 不绑定任何单一第三方库——provider 用接口隔离，先只落 legacy 适配。
> 前置阅读：`VOICE_RUNTIME_AUDIT.md`、`docs/design/PIPELINE.md`。
> **最后重评估**：2026-06-24，基于 main 合并后实际代码。变更见本文末 §7。

---

## 0. 设计原则

1. **不动 text 主链路**：`brains/reply_stream.ts`、`brain/prompt_builder.ts`、
   `server/pipeline/runner.ts` 的 LLM→切句→TTS producer/consumer 结构保留。
   本层只改“语音何时进、何时停、何时开口、用哪家 turn/tts”。
2. **接口隔离，不绑库**：`TurnDetectorProvider` / `TTSProvider` 是纯接口；
   第一阶段只实现 `legacy` 适配器（包住现有 `VadDetector`+`decideTurnTaking` 和
   `voice/tts.ts`）。LiveKit / SmartTurn / CSM / Kyutai 都是**后续可选** provider，
   走进程外推理服务（沿用项目已有的 MLX/whisper-server 外挂模式）。
3. **灰度可回退**：每个新 provider / 状态机都有 `off / shadow / on` 三档
   （复用 `brain/turn_interpreter.ts::structuredInterpreterMode` 的既有模式），
   shadow 只记录、不改行为。
4. **fast path 不退化**：所有新增推理（turn 模型、预生成）必须 off-live 或在
   listening 窗口内 amortize，不得给 `stt_final → llm_first` 加同步阻塞。

---

## 1. 三个抽象

### 1.1 TurnDetectorProvider（替换/包裹 turn-end 判断）

把“用户说完没 / 要不要被打断”从散落的声学启发式收成一个 provider 接口。
当前 `decideTurnTaking`（`server/session/turn_taking.ts:448`）+ `VadDetector`
事件（`index.ts:2577-2776`）成为第一个实现。

```ts
// server/session/voice/turn_detector/types.ts  (新增)
export type TurnDetectorMode = "off" | "shadow" | "on";

export interface TurnDetectorInput {
  audioWindowPcm: Buffer;          // 最近 N 秒 PCM（barge-in / EoT 都看它）
  sampleRate: number;
  partialTranscript: string;       // 来自 transcript.partial（无则空串）
  vad: { speaking: boolean; lastSpeechEndMs: number | null };
  assistantSpeaking: boolean;      // 用于 barge-in 语境
  prosody?: TurnTakingProsodyHint | null;
}

export interface TurnDetectorOutput {
  // turn-end：用户这一轮是否结束
  endpoint: "hold" | "maybe_complete" | "complete";
  endpointConfidence: number;      // 0–1
  // barge-in：播放中这段是否构成真正打断
  bargeIn: "none" | "candidate" | "confirmed";
  bargeInConfidence: number;
  source: "legacy" | "livekit_v1mini" | "pipecat_smartturn";
  latencyMs: number;
}

export interface TurnDetectorProvider {
  readonly id: TurnDetectorOutput["source"];
  readonly mode: TurnDetectorMode;
  evaluate(input: TurnDetectorInput): Promise<TurnDetectorOutput> | TurnDetectorOutput;
}
```

第一阶段要求实现的 provider（仅接口 + legacy 落地，其余留桩）：

| provider id | 第一阶段 | 说明 |
|-------------|---------|------|
| `legacy` (LegacyVadTurnDetector) | ✅ 实现 | 包 `decideTurnTaking` + VAD 事件；行为 1:1 等价于现状，作 fallback |
| `livekit_v1mini` | 🔜 留接口桩 | LiveKit Turn Detector v1-mini，语义 EoT，进程外推理 |
| `pipecat_smartturn` | 🔜 留接口桩 | Pipecat SmartTurn（看波形的语义 VAD，支持中文），进程外推理 |

选择由 `REMI_TURN_DETECTOR=legacy|livekit_v1mini|pipecat_smartturn` + mode 决定；
未配置或推理不可用 → 自动回退 `legacy`。**绝不静默丢 fallback。**

> **main 新增（`b89bd12c`）**：`sense-voice` STT provider 在 transcribe 结果中附带
> `emotion`/`event`/`lang` 标签。目前这些标签只用于 LLM prompt（`userVocalTone`），
> 不参与 turn-end 或 barge-in 决策。未来 PR5/PR6 可将 `TurnDetectorInput` 扩展以包含
> `sttEmotion` 字段，让语义 turn 模型也能利用情绪信号（例如：检测到哭声/愤怒时
> 降低 barge-in 阈值）。接口设计时预留该字段位置。

### 1.2 TTSProvider（形式化现有 TTS 路由）

现状已是事实上的多 provider（`voice/tts.ts` 路由 edge/volc/openai/mlx，
`voice/tts_stream.ts` 暴露 `synthesize`/`synthesizeResult`/`streamTextToSpeech`）。
本阶段只把它**收成显式接口**，不加新 provider、不改默认。

```ts
// voice/tts/types.ts  (新增，现有实现适配进来)
export interface TTSProvider {
  readonly id: “edge” | “volc” | “openai” | “mlx” | “csm” | “kyutai” | “qwen3”;
  readonly supportsStreaming: boolean;
  synthesize(text: string, ctx: TtsRequestContext, signal?: AbortSignal): Promise<Buffer>;
  streamSynthesize?(
    text: string, ctx: TtsRequestContext, signal?: AbortSignal,
  ): AsyncIterable<TtsPcmChunk>;   // 对应现有 streamTextToSpeech → voice_pcm_chunk
}
```

- 现有 edge/volc/openai/mlx 适配为 provider，行为不变。
- **main 新增（`48b345f4`）**：每会话 TTS 风格覆盖（`voice/tts_runtime_overrides.ts`）：
  speed/pitch/MLX preset/mute。PR3 做接口形式化时，`TtsRequestContext` 应把
  `sessionVoiceStyle` 纳入（已有字段，不需新建）。
- 未来 `csm`（CSM-MLX，Apple Silicon 本地，自带停顿/气口，治”朗读感”）、
  `kyutai`（220ms 流式、边来边合成）、`qwen3`（已有 `tts_mlx.ts` 雏形）按需接入，
  **不在第一阶段**。
- stop 语义沿用 AbortSignal + 前端 `clearQueue`（`tts.stop` 事件，见 §3）。

### 1.3 SpeechRuntime 状态机（统一现状散落的状态）

把当前散在“服务端 publishTurnState reason + 前端 RemiTurnState + presence phase”
三处的状态，收成一个**服务端权威 FSM**，并补两个缺失态。

```
        ┌─────────────────────────────────────────────────────────┐
        ▼                                                         │
      idle ──duplex_start──▶ listening ──vad.speech_start──▶ user_speaking
                               ▲                                  │
                               │                    turn.maybe_complete
        (turn.complete 且无预生成)                                  │
                               │                                  ▼
                         responding ◀──turn.complete──── thinking_while_listening
                               │                         (听窗内预生成/形成假设)
                          tts.chunk_start
                               ▼
                            speaking ──user.barge_in──▶ interrupted ──┐
                               │                                       │
                          tts 全部播完                      (carry-forward 塑形)
                               ▼                                       │
                           listening ◀───────────────────────────────┘
                               ▲
                  低置信/repair.requested
                               │
                           repairing ──澄清问句发出──▶ listening
```

| 状态 | 触发 | 对应现状 |
|------|------|---------|
| `idle` | 无 duplex | `confirmed_end` 且未录音 |
| `listening` | duplex 开、未检测到语音 | open_mic_idle / listening |
| `user_speaking` | `vad.speech_start` | VAD speaking + HOLD |
| `thinking_while_listening` | partial 稳定 + 预生成在跑 | **新**（接 `computeSessionPrediction`） |
| `responding` | `turn.complete`，LLM 生成中 | `assistant_entering` / awaiting_model |
| `speaking` | `tts.chunk_start` | `assistant_speaking` |
| `interrupted` | `user.barge_in` confirmed | `interrupted_by_user` |
| `repairing` | STT 低置信 / `repair.requested` | **新**（理解修复） |

FSM 是服务端权威源；`publishTurnState` 改为从 FSM 派生，前端
`useRemiTurnEngine.ts` 与 presence model 只做展示映射，不再各自判断。

---

## 2. 事件流（统一总线）

新增一个 `SpeechRuntime` 事件总线，把现有信号收口成命名事件。第一阶段
**只发事件 + 落日志（shadow）**，不改控制流。

| 事件 | 现状来源 |
|------|---------|
| `audio.frame` | duplex 二进制帧（`message_router.ts` / `index.ts` ingest） |
| `vad.speech_start` | `VadDetector` `speech_start`（`index.ts:2577`） |
| `vad.speech_end` | `VadDetector` `speech_end`（`index.ts:2668`） |
| `transcript.partial` | `SttStream` `streaming_partial`（需 sherpa/openai-realtime） |
| `transcript.final` | `SttStream` final → `stt_final`（`voice_submit.ts:110`） |
| `turn.maybe_complete` | `decideTurnTaking` → `LIKELY_END` |
| `turn.complete` | `decideTurnTaking` → `CONFIRMED_END` / speech_end 提交 |
| `response.token` | `chatStream` token（`runner.ts:370`） |
| `tts.chunk_start` | `voice` / `voice_pcm_chunk` 首帧发出（`runner.ts:614,686`） |
| `tts.chunk_end` | 句末 / `playback_end` |
| `user.barge_in` | `maybeConfirmPendingDuplexInterrupt`（`index.ts:1231`） |
| `tts.stop` | `interrupt()` + 前端 `clearQueue`（`useRemiChatMessageDispatch.ts:792`） |
| `repair.requested` | **新**：STT 低置信 / 语义不通触发 |

TurnDetectorProvider 消费 `audio.frame`/`transcript.partial`/`vad.*`，产出
`turn.maybe_complete`/`turn.complete`/`user.barge_in`；FSM 消费全部事件做状态迁移。

---

## 3. 最小 PR 切分

> 第一阶段 = PR0–PR2（audit + 设计 + 骨架），**不替换** STT/TTS/VAD。
> PR3 起为后续阶段，先列清楚边界，不在本次执行。

| PR | 范围 | 行为变化 | 阶段 |
|----|------|---------|------|
| **PR0** | 本两份文档 | 无 | ✅ 本次 |
| **PR1** | `TurnDetectorProvider` 接口 + `LegacyVadTurnDetector` 适配 + 播放中持续监听/可打断**验证**（见 §4） | 无（legacy 等价 + 验证脚本/日志） | ✅ 本次目标 |
| **PR2** | `SpeechRuntime` FSM 骨架 + 事件总线（shadow，仅日志） | 无 | 第一阶段 |
| PR3 | `TTSProvider` 接口形式化（现有 4 家适配进来） | 无 | 后续 |
| PR4 | 默认开启 interim（sherpa/openai-realtime 可用时）→ 喂 turn detector & 预生成 | 有，flag 控 | 后续 |
| PR5 | 接 `pipecat_smartturn` / `livekit_v1mini`（进程外），shadow 对比 legacy | shadow→on | 后续 |
| PR6 | `thinking_while_listening`：把 `computeSessionPrediction` 接进 user_speaking 窗 | flag 控 | 后续 |
| PR7 | `repairing` 态 + 低置信澄清门控 | flag 控 | 后续 |
| PR8 | 接 `csm`/`kyutai` TTSProvider（治朗读感） | flag 控 | 后续 |

依赖关系：PR1→PR2→(PR4↔PR5)→PR6→PR7；PR3→PR8 独立。

---

## 4. 第一个 PR（PR1）的具体改动范围

> 验收标准 #4 要求明确给出。PR1 = **TurnDetectorProvider 抽象 + 播放中持续监听/可打断能力验证**。
> 原则：**零行为变化**——legacy provider 必须与现状逐位等价，PR1 的价值是“收口接口 + 用证据确认全双工打断真的能工作”。

### 4.1 新增文件
- `server/session/voice/turn_detector/types.ts` — §1.1 的接口。
- `server/session/voice/turn_detector/legacy_vad_turn_detector.ts` —
  `LegacyVadTurnDetector implements TurnDetectorProvider`，内部直接调用现有
  `decideTurnTaking`（`turn_taking.ts:448`）与现有 barge-in 证据判断
  （把 `index.ts::hasReliableDuplexInterruptEvidence` 的判定逻辑抽成纯函数复用，
  **不改算法**），输出 `endpoint`/`bargeIn`。
- `server/session/voice/turn_detector/index.ts` — `resolveTurnDetector()`：
  读 `REMI_TURN_DETECTOR` + mode，未知/不可用一律回退 `legacy`。

### 4.2 接线（最小侵入）
- 在 `index.ts` 的 `decideTurnTaking` 调用点（`index.ts:2327`）和
  `maybeConfirmPendingDuplexInterrupt`（`index.ts:1231`）外面包一层：
  调 `turnDetector.evaluate()`；当 `mode==="on"&&id==="legacy"` 时其结果即现有路径，
  当 `mode==="shadow"` 时只 `logger.info` 对比、仍走原代码。**默认 `legacy/on`，等价现状。**
- 不改 VAD、不改 STT、不改 TTS、不改 pipeline。

### 4.3 “播放中持续监听 / 可打断”能力验证（PR1 的另一半，重在拿证据）
目的：用可复现的手段证明“播放时麦没停、且能在 X ms 内停下”，并量化当前 barge-in 延迟。
- 新增 harness：`test/server/session/barge_in_capability.test.ts`（沿用
  `test/server/session/duplex_harness.ts` 既有夹具），构造
  `assistantPlaybackActive=true` + 注入持续语音帧，断言：
  1. 播放期间 `audio.frame` 持续被 ingest（麦没被服务端忽略）；
  2. 满足 `duplexInterruptMinSpeechMs` + 证据门后触发 `user.barge_in` →
     `interrupt()` 被调用、`assistantPlaybackActive` 翻 false（`index.ts:1244-1248`）。
- 新增观测：在 `infra/latency_tracer.ts` 增补 `barge_in_speech_start_to_stop` 指标
  （speech_start → `interrupt()`），把“打断有多慢”变成可回归数字。
- 文档化手测脚本：用现有 `scripts/smoke.mjs` 路径起一轮 duplex，人工在 Remi 说话时
  插话，core 看 `[VAD] → interrupted pipeline` 日志与新指标。

### 4.4 PR1 退出标准
1. `npm run typecheck` 通过；`mocha test/server/session/**` 全绿（含新 harness）。
2. `legacy/on` 下，turn-taking 与 barge-in 行为与改动前**逐位一致**
   （用现有 `duplex_harness` 回归比对）。
3. `barge_in_capability.test.ts` 证明：播放中麦持续 ingest + 满足证据门即可停。
4. `latency_tracer` 输出 `barge_in_speech_start_to_stop`，给出当前基线数字
   （为 PR5 换语义 turn 模型提供 before/after 标尺）。
5. 不引入任何第三方语音库依赖。

---

## 5. 与三大瓶颈的对应

| 瓶颈（见 AUDIT §4） | 解它的 PR |
|---------------------|-----------|
| ① barge-in 慢且无 AEC | PR1（量化 + 接口化）→ PR5（语义 turn 模型降误报，可更激进停）→（AEC 作为独立专项，进程外或客户端 worklet，列入后续） |
| ② 默认无 interim 文本 | PR4（interim 默认开）→ 喂 PR5/PR6 |
| ③ turn-end 手写正则 + 打断分类没接 stop | PR5（语义 EoT provider）+ PR2/PR7（FSM 让打断分类参与迁移与修复） |

---

## 6. 明确不做（边界）

- 不重写 text LLM / prompt / 记忆链路。
- 第一阶段不替换 VAD/STT/TTS，不接任何外部语音库——只留接口与 legacy 适配。
- 不删任何现有 fallback（legacy turn detector、buffered_voice、噪声抑制启发式全部保留）。
- 不在 fast path 加同步阻塞的新推理。
- AEC（声学回声消除）是真窟窿但工程独立，单列专项，不混进 PR1。

---

## 7. main 合并后的计划评估（2026-06-24）

### 7.1 范围确认：SpeechRuntime 是 WS 专属

`551f32c7` 将文本聊天迁移到 SSE，WS 专供语音/全双工。这是对计划的**正向确认**：
`SpeechRuntime`、`TurnDetectorProvider` 的作用域从来都是 WS 语音会话，现在边界更清晰。
SSE 文本会话无需 SpeechRuntime，设计不受影响。

### 7.2 PR 表调整

| 状态变化 | 说明 |
|---------|------|
| **PR1/PR2 已完成**（`625bb1c2` `7f2c7a62`） | `LegacyVadTurnDetector` 接口 + `SpeechRuntime` shadow 骨架 + barge-in baseline 日志已落地；10 个测试全过。 |
| **PR3（TTSProvider）** | `voice/tts_runtime_overrides.ts`（每会话风格控制）已存在，PR3 形式化接口时直接把 `sessionVoiceStyle` 纳入 `TtsRequestContext`；不需要新字段。 |
| **PR4（interim 默认开）** | 不受 main 变更影响，SenseVoice 是 batch，不提供 interim。PR4 仍针对 `sherpa-onnx`/`openai-realtime` 在可用时自动切为 incremental provider。 |
| **PR5（SmartTurn/LiveKit provider）** | 不受影响。未来可考虑将 `sense-voice` 的 `sttEmotion` 作为可选输入字段注入 `TurnDetectorInput`。 |
| **PR6（thinking_while_listening）** | 注意：`REMI_TOOL_USE_ENABLED` 开启时工具调用在 LLM fast path 是阻塞的，PR6 实现 `thinking_while_listening` 时需确认工具调用不在预生成窗口内同步等待。 |
| **PR8（CSM/Kyutai TTS）** | `tts_runtime_overrides.ts` 每会话 style 控制是好的基础，CSM 的 `voice_preset` 可以复用同一覆盖机制。 |

### 7.3 三大瓶颈重评

main 的 21 个提交**均未修复**三大瓶颈：
- 瓶颈① barge-in 慢：仍是声学门控，900ms 默认 STT 无 interim 路径不变。
- 瓶颈② 无 interim 文本：SenseVoice 是 batch，不提供增量文本。
- 瓶颈③ turn-end 手写规则：`decideTurnTaking` 逻辑未变。

PR 路线图优先级不变。下一步是 PR3（TTSProvider 形式化）或 PR4（interim 默认开），
两者独立，可并行推进。

---

## 8. PR4 / PR5 / PR5b 实施记录（2026-06-24）

### 8.1 PR4 — interim STT（已完成）
- `voice/stt_stream.ts`：`getIncrementalProvider()` 自动检测 sherpa-onnx（模型在本地时），
  显式 `REMI_STT_INCREMENTAL_PROVIDER` 优先，`none` 可抑制；模块级缓存避免逐帧 `fs.existsSync`。
- `server/session/index.ts`：streaming partial tap `speechRuntime.observeEvent("transcript.partial")`；
  `duplex_start` 打 `[IntermSTT] interimSttActive` 日志。
- baseline：无 partial → 900ms 门槛；有 partial → 320ms 门槛。默认 STT 行为不变。

### 8.2 PR5a — turn detector shadow stub（已完成）
- `SmartTurnStub`（本地启发式）+ `ShadowTurnDetector`（primary 始终 legacy，stub 仅写比对日志）。
- `REMI_TURN_DETECTOR_SHADOW`（默认 0）+ `REMI_TURN_DETECTOR_SHADOW_PROVIDER`（默认 stub）。
- 每 session 独立 ShadowTurnDetector 实例携带 connId；legacy 单例缓存。
- 分歧场景（句末标点提前切 / 纯沉默 legacy 更合理 / 文本稳定 stub 更积极 / barge-in 有 partial 提前 30ms）。
- **stub 仅作测试 fixture，不作最终 provider。**

### 8.3 PR5b — 真实 provider shadow adapter（已完成）
- **异步缝**：新增 `AsyncTurnDetectorProvider`（`isAvailable` / `evaluateTurnEndAsync` /
  `evaluateBargeInAsync`，全部可返回 `null` = 不可用）。同步 primary 路径（legacy）**完全不动**。
- `LiveKitTurnDetectorAdapter`：HTTP → sidecar，探活缓存（TTL 10s）+ 超时（`REMI_TURN_DETECTOR_TIMEOUT_MS`，默认 150ms）+
  从不抛错；不可用 / 超时 / 5xx / 畸形 JSON → `null` → **自动 fallback legacy**。
- `ShadowTurnDetector` 在返回 primary 之后 **fire-and-forget** 跑真实 provider，只写
  `[TurnDetectorReal] turn_end_comparison` / `barge_in_comparison` 日志，**不影响 fast path**。
- `scripts/turn_detector_server.py`：sidecar，`livekit` 后端=真实 LiveKit turn-detector v2
  （`pip install onnxruntime transformers huggingface_hub numpy` + 下载权重），
  `reference` 后端=透明中文启发式（仅 dev 兜底，/health 标 `reference-heuristic`）。
- `scripts/turn_detector_shadow_eval.ts`：评测 harness，replay 中文场景 → 输出 5 张表
  （turn-end 分歧 / barge-in 分歧 / latency 分布 / 有无 partial 对比 / on 模式判断）。
- 约束全部满足：不接管 turn-taking、不改 VAD/barge-in 阈值、不碰 STT/TTS、不接端到端语音、
  不让 SpeechRuntime 接管状态、默认 off、provider 不可用必 fallback legacy。

**reference 后端示意数据**（非生产权重，仅验证管道）：turn-end 分歧率 7/10，p90 延迟 ~1ms
（真实 ONNX 预期 10–50ms），有 partial 一致 3/7、无 partial 一致 0/3。
**最终 on/off 判断须用 `--backend livekit` 真实权重在真实中文通话上重跑。**

### 8.4 PR5c — 真实 LiveKit 权重评测（已完成）
真实模型 `livekit/turn-detector` `onnx/model_q8.onnx@v0.4.1-intl`（多语种 EOU 头，输出 `prob`）。
报告见 `docs/voice/TURN_DETECTOR_LIVEKIT_SHADOW_EVAL.md`。要点：中文完整/未完句分离干净
（0.25–0.78 vs <0.02），p50=5ms/p90=8ms，**必须有 interim partial 才有效**，barge-in 不在职责内。
zh 阈值 0.0066 是 `unlikely_threshold`（低概率=该多等，非早切）。

### 8.5 PR5d — LiveKit limited_on（已完成，默认 off）
真实 EOU **仅调整 turn-END**，非对称、有真实 partial 才启用、不可用即回退 legacy：
- **异步缝**：`notePartial(text)` 在 partial 到达时异步算 EOU 并缓存（off fast path）；
  同步 `evaluateTurnEnd` 只读缓存（命中且新鲜且文本匹配才用），HTTP 永不进决策路径。
- **非对称规则**（`limited_on.ts` 纯函数）：
  - 低 EOU（<`EOU_LOW`=0.05）：只把 legacy `CONFIRMED_END`→`LIKELY_END`（延长耐心），
    **绝不早切**；有安全上限 `LOW_EOU_MAX_EXTRA_HOLD_MS`=700ms 防永久挂起。
  - 高 EOU（≥`EOU_HIGH`=0.6）：只把 legacy `LIKELY_END`→`CONFIRMED_END`（完整句更快 commit），
    **绝不提升 HOLD**（不切 legacy 认为未完的话）。
  - 中间区间：不干预。
- **gating**：`REMI_TURN_DETECTOR_MODE=limited_on`（默认 off）；无 partial / 无 endpoint /
  provider 超时/异常 / 缓存过期或文本不匹配 → 全部回退 legacy。**barge-in 一行未碰。**
- **latency 对比**（真实 legacy 时间线模拟）：完整句 legacy 800ms commit → limited_on 高 EOU
  **480ms（省 320ms）**；低 EOU **1500ms（加 700ms，正好安全上限）**。
- 24 个新测试 + 全 PR5 相关集 104 passing。下一步若上真实 A/B 才考虑放宽。

### 8.6 PR6 — thinking_while_listening（已完成，SHADOW ONLY）
现状：预生成（`runPrediction`→`computeSessionPrediction`）早已实现在线，但 SpeechRuntime
的 `thinking_while_listening` 状态从未被接入。PR6 **只把这个已发生的行为变成可观测状态**：
- SpeechRuntime 新增事件 `thinking.start` / `thinking.done` / `thinking.aborted`；
  用户在线（`user_speaking`/`listening`）时 `thinking.start` → 进入 `thinking_while_listening`，
  `done`/`aborted` → 回到思考前状态；记录"思考窗口"时长 + outcome（completed/aborted）。
- `runPrediction` 在开始/完成/中止处各打一个 `observeEvent`（3 行 tap）。
- **纯 shadow**：不改 prediction 何时/是否跑、不改 fast path、SpeechRuntime 仍只观察、
  prediction 不直接说话。`thinking_while_listening` 状态不驱动任何控制流。
- 工具调用坑（plan §7.2）：本 PR 不碰预生成行为，故 `REMI_TOOL_USE_ENABLED` 的 fast-path
  阻塞问题不在本 PR 触发；真要做"行为版"（用思考窗口结果抢跑降延迟）时再处理，留作后续 flag-gated。
- 9 个 FSM 单测 + 2 个真实控制流集成测试（stub computeSessionPrediction）；全 PR5/PR6 集 115 passing。
- **行为版（用 thinking 窗口实际降低 turn 延迟）= 未来 flag-gated 步骤，本 PR 不做。** repairing(PR7) 仍未接。
