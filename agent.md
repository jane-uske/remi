# Remi AI Agent Notes

这份文件给后续主控线程使用。
目标不是介绍整个仓库，而是帮助新线程快速接上当前项目状态，少走弯路。

## Repo Focus

当前用户最关注的是实时双向语音体验，重点链路：

- 前端采集: `/Users/rare/Desktop/remi-ai/web/src/lib/pcmCapture.ts`
- 前端会话状态: `/Users/rare/Desktop/remi-ai/web/src/hooks/useRemiChat.ts`
- 前端播放队列: `/Users/rare/Desktop/remi-ai/web/src/hooks/useAudioBase64Queue.ts`
- 服务端会话/VAD/STT 拼接: `/Users/rare/Desktop/remi-ai/server/session/index.ts`
- VAD: `/Users/rare/Desktop/remi-ai/voice/vad_detector.ts`
- STT: `/Users/rare/Desktop/remi-ai/voice/stt_stream.ts`
- TTS: `/Users/rare/Desktop/remi-ai/voice/tts.ts`
- LLM fast path: `/Users/rare/Desktop/remi-ai/brains/fast_brain.ts`
- Router/slow brain: `/Users/rare/Desktop/remi-ai/brains/brain_router.ts`
- 延迟打点: `/Users/rare/Desktop/remi-ai/infra/latency_tracer.ts`

## Current Runtime Shape

当前主链路大致是：

1. 前端 `AudioWorklet` 采集 PCM16 16k，上行优先走 binary WebSocket
2. 服务端规则 VAD 维护 utterance buffer
3. STT 使用 `whisper-cpp`，优先 `whisper-server`
4. LLM 走 Doubao OpenAI-compatible chat/completions
5. TTS 优先 Edge 流式，失败会降级到 buffered
6. 前端播放支持 streamed PCM 和 buffered `voice`

## Recent Commits

近期和体验直接相关的提交：

- `4f30bf1` `fix: stabilize duplex voice UX and llm latency tracing`
- `03e9a78` `fix(web): use html audio for buffered tts`
- `ab6f52b` `fix(web): resolve audio fallback init order`
- `305f509` `fix(web): restore tts playback fallback`
- `702c5f3` `fix(web): stop reconnect loop and scroll jitter`

如果后续线程要做回归，请重点从 `4f30bf1` 开始看。

## What Was Fixed

### 1. 语音输入体验

- `stt_partial` 不再一直跳 “录音中…0.xs”，前端改成稳定的 “正在听你说…”
- `vad_end` 做了前端去抖，减少 listening 状态抖动
- 近距离重复 `stt_final` 会在前端轻量合并，避免一条用户话显示两遍
- 服务端对 `嗯 / 那个 / 我想一下 / 让我想想` 这类犹豫词做了 tentative 保护，不会轻易直接落聊天和 LLM
- VAD 增加 speaking-phase hysteresis：已经进入 speaking 后，继续判定更宽松、静音 hangover 更长，减少一句话内部被切碎

### 2. 播放与打断

- 前端 buffered TTS 默认走更稳的 `HTMLAudio`
- interrupt 后会真正释放当前 fallback 播放 promise，不会把下一轮语音卡死
- `playback_start` 现在带 `generationId` 回传，服务端按 generation 对齐 trace

### 3. LLM 首 token 与日志

- slow brain 在新一轮开始时会取消，避免和主回复抢同一个 provider 通道
- history budget 默认从 `2600` 收到 `1400`
- prompt builder 对 memory 和 priority context 加了硬裁剪
- fast brain 现在会打印 `LLM prompt stats`
- latency tracer 不再输出负 duration

## Known Remaining Risks

### 1. VAD 仍是规则法

虽然已经加了迟滞和 tentative 保护，但底层仍然是 `energy + zcr + crest`。
如果用户麦克风环境很差，仍然可能误切。

后续若继续优化，优先级是：

1. 采集端加更多调试指标
2. 针对单连接打印 VAD frame stats
3. 再考虑更强的 VAD 方案

### 2. Doubao 首 token 波动

当前 `.env` 使用：

- `base_url=https://ark.cn-beijing.volces.com/api/coding/v3`
- `model=Doubao-Seed-2.0-lite`

这条链能用，但首 token 波动偏大。
如果后续继续优化 LLM 首 token，优先考虑：

1. 给 slow brain 单独模型或单独通道
2. 换更偏对话/低时延的模型接口
3. 继续压 prompt/context

### 3. Edge TTS 流式不稳定

日志里仍偶发：

- `Edge TTS WebSocket 意外关闭`

目前已有 fallback，所以不是阻塞项，但它会拖慢正式回答首音。

## Practical Debugging Rules

- 先看日志，不要先猜参数
- 用户说“我明明一直在说话却被截断”，优先看 `speech_start/speech_end` 是否在抖
- 用户说“有文本没声音”，优先对照 `tts_first_audio` 和 `playback_start`
- 用户说“Remi 回得慢”，优先拆：
  - `speech_end -> stt_final`
  - `stt_final -> llm_first_token`
  - `llm_first_token -> tts_first_audio`
  - `tts_first_audio -> playback_start`

## Files Most Likely To Change Next

- `/Users/rare/Desktop/remi-ai/server/session/index.ts`
- `/Users/rare/Desktop/remi-ai/voice/vad_detector.ts`
- `/Users/rare/Desktop/remi-ai/voice/stt_stream.ts`
- `/Users/rare/Desktop/remi-ai/web/src/hooks/useRemiChat.ts`
- `/Users/rare/Desktop/remi-ai/web/src/hooks/useAudioBase64Queue.ts`
- `/Users/rare/Desktop/remi-ai/infra/latency_tracer.ts`

## Working Agreements

- 不要把 `codex/3dllm` worktree 的未提交改动整包并进主线
- 不要一边修语音主链，一边把 `runTurn` 那套替代 pipeline 的路径混进来
- 用户明确说过：不要“修一个问题就提交一次”，更偏向攒一轮再统一提交
- 做 review 时，优先找行为回退，不要只看类型是否通过

## Quick Verification Checklist

改动语音链路后，至少复测这些场景：

1. `嗯……我想一下`
2. `我现在这个句子还没说完`
3. 说一段 4 到 6 秒，中间有轻微停顿
4. Remi 正在说话时，用户插入 `等下等下`
5. 文本发送后是否显示 `Remi 在想…`
6. 文本和语音回复是否都有 `playback_start`

## Notes On Naming

本仓库当前实际使用的是 `agent.md`。
如果后续外部工具要求 `AGENTS.md`，再做镜像或迁移；当前先以这份文件为准。
