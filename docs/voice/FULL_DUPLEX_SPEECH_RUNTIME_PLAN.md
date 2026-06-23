# FULL_DUPLEX_SPEECH_RUNTIME_PLAN.md

> 目标：在**保留** Remi 现有 text LLM / 人设 / 记忆 / 工具链的前提下，在语音侧外挂
> 一层**模块化全双工语音控制层**，把 `VOICE_RUNTIME_AUDIT.md` 指出的三个瓶颈拆掉。
> 第一阶段**只做 audit + 设计 + 最小接口骨架**，不大规模替换 STT/TTS/VAD。
> 不绑定任何单一第三方库——provider 用接口隔离，先只落 legacy 适配。
> 前置阅读：`VOICE_RUNTIME_AUDIT.md`、`docs/design/PIPELINE.md`。

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

### 1.2 TTSProvider（形式化现有 TTS 路由）

现状已是事实上的多 provider（`voice/tts.ts` 路由 edge/volc/openai/mlx，
`voice/tts_stream.ts` 暴露 `synthesize`/`synthesizeResult`/`streamTextToSpeech`）。
本阶段只把它**收成显式接口**，不加新 provider、不改默认。

```ts
// voice/tts/types.ts  (新增，现有实现适配进来)
export interface TTSProvider {
  readonly id: "edge" | "volc" | "openai" | "mlx" | "csm" | "kyutai" | "qwen3";
  readonly supportsStreaming: boolean;
  synthesize(text: string, ctx: TtsRequestContext, signal?: AbortSignal): Promise<Buffer>;
  streamSynthesize?(
    text: string, ctx: TtsRequestContext, signal?: AbortSignal,
  ): AsyncIterable<TtsPcmChunk>;   // 对应现有 streamTextToSpeech → voice_pcm_chunk
}
```

- 现有 edge/volc/openai/mlx 适配为 provider，行为不变。
- 未来 `csm`（CSM-MLX，Apple Silicon 本地，自带停顿/气口，治“朗读感”）、
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
