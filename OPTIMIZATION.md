# Rem AI — 系统架构分析、优化点与提升方案

> 这份文档主要记录历史优化项、已完成改进与工程层待办。
> 阅读时请以最新产品总纲为准：Rem 当前不只是“聊天机器人优化”，而是在推进一个以活人感、人格连续性和跨终端持续存在为目标的存在感系统。
> 因此，下面所有优化项都应该优先映射到三层路线图理解：
> - 实时交互层
> - 人格记忆层
> - 跨终端存在层

## 已完成优化

### 简单任务 S1–S10（2026-04-03 ~ 2026-04）


| 任务  | 说明                                               | Commit                                |
| --- | ------------------------------------------------ | ------------------------------------- |
| S1  | 修复 fast_brain.ts 中 AbortSignal 未传递给 streamTokens | d44b5e4                               |
| S2  | 修复 brain_router.ts 中重复调用 updateEmotion           | d44b5e4                               |
| S3  | 统一 console.log → pino logger (6 个文件)             | d44b5e4                               |
| S4  | ServerMessage.type 改为严格联合类型                      | d44b5e4                               |
| S5  | emotion_engine.ts 增加否定词前缀检测                      | d44b5e4                               |
| S6  | memory_agent.ts 扩展正则规则集                          | d44b5e4                               |
| S7  | SentenceChunker 增加字数阈值强制输出                       | d44b5e4                               |
| S8  | 丰富 personality.ts 和 character_rules.ts 内容        | d44b5e4                               |
| S9  | 前端「Rem 在想…」等待态（首 token 前）                        | `web/src/components/ChatWindow.tsx` 等 |
| S10 | 短句 TTS 内存 LRU 缓存                                 | `voice/tts.ts`                        |


### 中等任务 M1–M9（2026-04）


| 任务  | 说明                                                                                                 | 主要文件                                                                                |
| --- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| M1  | 情绪强度 + 惯性：同情绪叠加强度，回复后 `weakenEmotionAfterReply` 再回落                                                | `emotion/emotion_state.ts`, `emotion/emotion_engine.ts`, `emotion/decay_emotion.ts` |
| M2  | Slow Brain LLM 提取的 `user_facts` 同步写入 `MemoryRepository`                                            | `brains/slow_brain.ts`                                                              |
| M3  | 对话历史按估算 token 裁剪（`MAX_HISTORY_TOKENS`，默认 2600）                                                     | `brains/history_budget.ts`, `brains/brain_router.ts`                                |
| M4  | 轻量对话策略提示（关系阶段、情绪轨迹、短句、冷场话题）注入 system 最前段                                                           | `brains/slow_brain_store.ts`（`buildConversationStrategyHints`）                      |
| M5  | LLM `complete`/`stream`、TTS `textToSpeech`、STT OpenAI 转写 `withRetry`；whisper-cpp 转写失败时 **一次** 延迟重试 | `utils/retry.ts`, `llm/qwen_client.ts`, `voice/tts.ts`, `voice/stt_stream.ts`       |
| M6  | 慢脑画像 + 策略合并为 `priorityContext`，置于 system 最前                                                        | `brain/prompt_builder.ts`, `brains/fast_brain.ts`                                   |
| M7  | Edge TTS **连接池**：同 voice/lang/rate/pitch/fmt 复用 WebSocket，仅 SSML 多轮；`edge_tts_pool=0` 关闭           | `voice/tts.ts`                                                                      |
| M8  | 可选服务端短填充音：环境变量 `rem_thinking_filler=1` 时与 LLM 并行异步播「嗯」                                             | `server/pipeline/runner.ts`                                                         |
| M9  | 前端 user/rem 消息 localStorage 持久化（最近 50 条）                                                           | `web/src/hooks/useRemChat.ts`                                                       |
| M10 | 打断语义修复：被打断 partial 不进 formal history / slow brain / assistant 持久化；`wasInterrupted` 仅由真实打断触发 | `brains/brain_router.ts`, `brains/rem_session_context.ts`, `server/pipeline/runner.ts` |
| M11 | 观测性收口：网关 `/health`、稳定 latency snapshot、固定 duplex harness 场景名                                  | `server/gateway/index.ts`, `infra/latency_tracer.ts`, `test/server/session/duplex_harness.ts` |
| M12 | turn lifecycle 收口：idle text send 不再误发 `interrupt`；`chat_end` 与 playback drain 分离                    | `server/session/index.ts`, `web/src/hooks/useRemChat.ts`                           |


---

## 体验与 DX（vibe 向）


| 项       | 说明                                                                                                                                                                                       |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 前端      | `prefers-reduced-motion` 下关闭气泡/打字点/语音条/麦克波动效；「Rem 在想…」条带 `rem-thinking-bubble` 轻呼吸动画                                                                                                     |
| Hook    | 移除未使用的 Legacy `MediaRecorder` 路径，麦克风仅全双工 PCM；导出 `stopVoice` 供需要时显式结束会话                                                                                                                   |
| 脚本      | 根目录 `npm run typecheck` → `tsc --noEmit`                                                                                                                                                 |
| **陪伴**  | **沉默搭话**：`REM_SILENCE_NUDGE_MS`（如 45000）开启后，用户久未发消息则串行触发 `runPipeline(..., { silenceNudge: true })`，文案由 `buildSilenceNudgeUserMessage()` 生成；不写 DB user 条、不跑慢脑；历史里 user 占位为「［你主动开口陪对方聊天］」 |
| **关系感** | `synthesizeContext` 中 **【陪伴阶段提示】**：按熟悉度分三档（初识 / 加深 / 很熟）写说话方式                                                                                                                            |


---

## 尚未完成 / 待办（摘录）


| 类别          | 内容                                                                                                                                                                                              |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **§3 其他**   | 全局 per-session 状态（C1）、流式 STT（C3）、**HTTP 限流**：网关 `createServer` 已对非 WebSocket 请求做 IP 桶（100/min），与 `infra/rate_limiter` 中 Express 中间件互补；生产可再调 `JWT` + 反向代理；ServerMessage 更细字段约束等，见下文与 **🔴 复杂任务** |
| **产品**      | 口型同步（TASKS **T-032**）、向量记忆检索与对话历史的深度整合                                                                                                                                                          |
| **3.15 体验** | 语音结束淡入淡出、断线后 **服务端上下文恢复**（仅本地消息已持久化）                                                                                                                                                            |
| **已收口**     | `interrupt` / `chat_end` / `confirmed_end` 语义边界，见 `README.md` / `PIPELINE.md`                                                                                                                                      |


---

## 一、系统架构总览

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Client (Next.js / Legacy HTML)                                        │
│  useRemChat → WebSocket → PCM 16kHz / text                            │
└───────────────────────────┬─────────────────────────────────────────────┘
                            │ WebSocket
                            ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Gateway (server/gateway/)                                              │
│  Express + WSS noServer · HTTP 限流 · JWT 认证 · 消息路由               │
└───────────────────────────┬─────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Session (server/session/)  — 每连接独立实例                             │
│  STT Stream · VAD Detector · InterruptController · AvatarController     │
│  pipelineChain 串行队列                                                 │
└───────────────────────────┬─────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Pipeline (server/pipeline/)                                            │
│                                                                         │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────────────┐      │
│  │ Emotion      │  │ Memory Agent │  │ Brain Router              │      │
│  │ (关键词规则)  │  │ (正则提取)    │  │                           │      │
│  └──────┬──────┘  └──────┬───────┘  │  ┌────────┐ ┌──────────┐ │      │
│         │                │          │  │Fast    │ │Slow      │ │      │
│         │                │          │  │Brain   │ │Brain     │ │      │
│         │                │          │  │(流式)   │ │(后台异步) │ │      │
│         │                │          │  └────────┘ └──────────┘ │      │
│         │                │          └──────────────┬────────────┘      │
│         └────────────────┼─────────────────────────┘                   │
│                          ▼                                              │
│  ┌─────────────────────────────────────────┐                           │
│  │ Prompt Builder                          │                           │
│  │ personality + rules + emotion + memory  │                           │
│  └─────────────────┬───────────────────────┘                           │
│                    ▼                                                    │
│  ┌─────────────────────────┐      ┌──────────────────┐                │
│  │ LLM Client (OpenAI SDK) │─────►│ SentenceChunker  │                │
│  │ streamTokens()          │      │ (逐句断句)        │                │
│  └─────────────────────────┘      └────────┬─────────┘                │
│                                            ▼                           │
│                                   ┌──────────────────┐                │
│                                   │ TTS (Edge/Piper)  │                │
│                                   │ + 情绪语调映射     │                │
│                                   └────────┬─────────┘                │
│                                            ▼                           │
│                                    base64 audio → Client               │
└─────────────────────────────────────────────────────────────────────────┘
```

### 核心数据流

```
用户语音 → PCM 16kHz → VAD 检测 → speech_end → STT 转文字
    → updateEmotion(关键词) → extractMemory(正则) → retrieveMemory
    → Brain Router → Fast Brain(流式 LLM) → SentenceChunker → TTS → 音频推送
                   → Slow Brain(后台分析，下轮可用)
```

---

## 二、当前架构优点


| 维度              | 已做得好的地方                                            |
| --------------- | -------------------------------------------------- |
| 双脑架构            | Fast Brain 低延迟流式回复 + Slow Brain 后台深度分析，设计合理        |
| 打断控制            | InterruptController 状态机 + AbortSignal 贯穿管线，用户可随时打断 |
| 流式 TTS          | Producer-Consumer 模型，LLM token 和 TTS 合成并行执行        |
| SentenceChunker | Eager 模式首句提前、后续按完整句断句，优化了首次出声延迟                    |
| 延迟追踪            | LatencyTracer 覆盖完整链路（VAD → STT → LLM → TTS），便于性能诊断 |
| 模块化拆分           | Gateway/Session/Pipeline 分层清晰，每个文件 ≤ 500 行         |
| VAD 降噪          | 能量阈值 + 零过率双重过滤，抗键盘/鼠标误触发                           |
| 情绪语调            | TTS 参数随情绪动态调整 (rate/pitch/speed)                   |


---

## 三、核心问题与优化方案

### 问题分类说明

- **🟢 简单 (S)**: 改动明确，单文件局部修改，适合快速模型处理
- **🟡 中等 (M)**: 涉及 2-3 个文件联动，需理解上下文
- **🔴 复杂 (C)**: 架构级改动，涉及多模块重构或新模块引入

---

### 3.1 全局单例状态 — 无多用户隔离 🔴C

**原问题（已解决）：** 情绪、对话历史、慢脑、正则记忆曾放在进程级单例，多连接会互相污染。

**实现（C1 ✅）：** `ConnectionSession` 持有 `RemSessionContext`（`brains/rem_session_context.ts`）：每连接一份 `EmotionRuntime`（`emotion/emotion_runtime.ts`）、`SlowBrainStore` 实例、`PromptMessage[]` 历史、`InMemoryRepository` 会话记忆。`runPipeline` / `routeMessage` / `chatStream` 均传入该上下文。`emotion_state.ts` 仅保留 `Emotion` 类型别名。

**说明：** 进程级 `getMemoryRepository()`（如 Postgres）仍用于服务端衰减等全局逻辑；**对话热路径上的检索与正则写入** 使用连接内 `InMemoryRepository`，与「每连接隔离」一致。若需跨会话持久化用户记忆，可后续按 `userId` 作用域或双写。

**涉及文件：** `emotion/emotion_runtime.ts`, `emotion/emotion_state.ts`, `brains/rem_session_context.ts`, `brains/brain_router.ts`, `brains/slow_brain_store.ts`, `brains/slow_brain.ts`, `memory/memory_agent.ts`, `agents/conversation_agent.ts`, `server/session/index.ts`, `server/pipeline/runner.ts`

---

### 3.2 情绪识别过于粗糙 🟡M

**现状问题：**

`emotion_engine.ts` 纯关键词匹配，存在严重缺陷：

- "我不喜欢你" 命中 "喜欢你" → 误判为 happy ✅ (已修复)
- "你为什么这么厉害" 命中 "为什么" → curious，但实际是赞美
- "笑死了，这也太糟糕了" 命中 "笑死" → happy，但实际可能是讽刺/无奈
- 无法识别复合情绪 ("开心但有点担心")
- 每次回复后立即 decay 回 neutral，情绪没有持续性

**优化方案（分两步）：**

**Step 1 (🟢S)** — 改进规则引擎：✅ 已完成

- ✅ 增加否定前缀检查 (`不|没有|别|不要` + 正面词 → 反转)
- 支持情绪强度 (intensity: 0-1)，不再每次立即 decay
- 增加情绪惯性：相同情绪连续触发时增加持续轮次

**Step 2 (🔴C)** — LLM 辅助情绪分析：

- 利用 Slow Brain 的 `emotional_undertone` 结果反馈修正
- 或在 Fast Brain 的 system prompt 中要求输出情绪标签，从回复首 token 解析

**涉及文件：** `emotion/emotion_engine.ts`, `emotion/emotion_state.ts`

**状态：** Step 1 ✅ 已完成 (Commit d44b5e4)

---

### 3.3 记忆提取能力薄弱 🟡M

**现状问题：**

`memory_agent.ts` 仅有 7 条固定正则：

```typescript
const PATTERNS = [
  { pattern: /我(?:叫|的名字是)\s*([^\s，。]+)/, key: "名字" },
  { pattern: /我喜欢\s*(.+?)(?:[，。]+|$)/, key: "喜好" },
  // ... 仅 7 条
];
```

- "我叫小明，在北京上班" → 只能提取名字，丢失工作地点 ✅ (已扩展)
- "我有一只猫叫咪咪" → 完全无法提取 ✅ (已支持)
- "我每天六点起床" → 无法提取日常习惯 ✅ (已支持)
- "我不喜欢吃辣" → 提取为 "喜好: 吃辣"（丢失否定）✅ (已支持)

**优化方案：**

**Step 1 (🟢S)** — 扩展正则规则集：✅ 已完成

- ✅ 增加否定句处理 (`不喜欢` → `不喜好`)
- ✅ 增加宠物、习惯、家人、故乡、专业、学校等维度
- ✅ 增加否定词检测，避免在否定句中提取正面信息
- ✅ 增加关联提取（一句话多个信息）

**Step 2 (🟡M)** — 利用 Slow Brain 现有分析补充：

- `slow_brain.ts` 已经有 LLM 分析提取 `user_facts`，但结果只存在 `slow_brain_store` 中
- 应该将 `user_facts` 同步写入 `memory_store`，实现持久化

**涉及文件：** `memory/memory_agent.ts`, `brains/slow_brain.ts`, `brains/slow_brain_store.ts`

**状态：** Step 1 ✅ 已完成 (Commit d44b5e4)

---

### 3.4 AbortSignal 未透传到 LLM 调用 🟢S ✅ 已完成

**现状问题：**

`fast_brain.ts` 接收 `signal` 但未传递给 `streamTokens()`：

```typescript
// fast_brain.ts
for await (const token of streamTokens(messages)) {  // ← signal 没传！
  hasContent = true;
  yield token;
}
```

即使用户打断，LLM 请求仍在后台继续消耗 token 和网络资源，直到 `for await` 自然退出。

**修复：**

```typescript
for await (const token of streamTokens(messages, input.signal)) {
```

**涉及文件：** `brains/fast_brain.ts`

**状态：** ✅ 已完成 (Commit d44b5e4)

---

### 3.5 对话体验不够自然 🔴C

**现状问题：**

1. **人设过于简单：** ✅ (已丰富)
  ```typescript
   // personality.ts — 仅 4 个特质词 → 已扩展为 8 个
   REM_PERSONALITY_TRAITS = ["温柔", "稍微害羞", "关心用户", "说话自然"];

   // character_rules.ts — 仅 4 条规则 → 已扩展为 10 条
   CHARACTER_RULES = ["句子不要太长", "不要像客服", "语气自然", "会主动提问"];
  ```
   缺乏具体行为指导，LLM 容易回到通用对话模式。
2. **无对话策略管理：**
  - 不知道什么时候该追问、什么时候该分享自己的想法
  - 不会自然转换话题
  - 不会根据关系深度调整说话方式
3. **无 backchanneling（回应词）：**
  人类对话中有大量 "嗯"、"对"、"然后呢" 等回应信号，当前完全缺失
4. **情绪表达风格单一：**
  `EMOTION_STYLE` 只有 5 种固定描述，无法表达微妙的情绪变化

**优化方案：**

**Step 1 (🟢S)** — 丰富人设和规则：✅ 已完成

```typescript
// 更具体的行为规则
const CHARACTER_RULES = [
  "回复不超过 2-3 句话，除非用户明确要求详细解释",
  "适当使用语气词（嗯、啊、呢、吧、呀）",
  "不说 '作为AI' '我是AI' 等破角色的话",
  "用户说了有趣的事情，先回应感受，再展开",
  "用户情绪低落时，先共情，不急着给建议",
  "偶尔分享自己的'小想法'增加互动感",
  "遇到不懂的，坦诚说不知道而不是编造",
  "适当用 '你呢？' '是吗？' '然后呢？' 等引导用户继续说",
];
```

**Step 2 (🟡M)** — 对话策略引擎：

```typescript
interface ConversationStrategy {
  shouldAskFollowUp: boolean;    // 是否追问
  shouldShareSelf: boolean;      // 是否分享自身想法
  shouldChangeTopic: boolean;    // 是否换话题
  suggestedTopic?: string;       // 建议话题
  responseStyle: "empathize" | "discuss" | "playful" | "supportive";
}
```

基于 Slow Brain Store 的关系状态和话题历史，在 Prompt 中注入对话策略指令。

**Step 3 (🔴C)** — 关系阶段化说话风格：

根据 `relationship.familiarity` 动态调整人格表现：

- 0-0.2 (初识)：礼貌但保持距离，多提问
- 0.2-0.5 (渐熟)：开始分享想法，偶尔开玩笑
- 0.5-0.8 (亲密)：随意自然，可以撒娇/吐槽
- 0.8-1.0 (默契)：简短但懂你，有专属互动模式

**涉及文件：** `brain/personality.ts`, `brain/character_rules.ts`, `brain/prompt_builder.ts`, `brains/slow_brain_store.ts`

**状态：** Step 1 ✅ 已完成 (Commit d44b5e4)

---

### 3.6 STT 延迟优化 🟡M

**现状问题：**

当前 STT 是 "攒完再转"——VAD 检测 speech_end 后，才把整段 PCM 组装成 WAV 发给 Whisper API。对于 3 秒的一句话：

```
说话 3s + VAD 确认结束 0.7s + PCM→WAV 编码 + 网络上传 + Whisper 处理
≈ 总延迟 4-5 秒才能开始 LLM
```

**优化方案：**

**Step 1 (🟢S)** — 减少 VAD silence 确认时间：

- 当前 `silenceFrames=14` (700ms) 可以在对话模式下降到 10 (500ms)
- 环境变量已支持 `VAD_SILENCE_FRAMES`，但可以做自适应：连续对话时减少，单句模式保持

**Step 2 (🟡M)** — 流式 STT：

- 使用支持流式的 STT 服务（如 Deepgram、AssemblyAI、Google Cloud Speech）
- 在用户说话过程中就开始逐步转文字，speech_end 时直接获得最终结果
- 可以在 speech 过程中就发送 `stt_partial` 预览给客户端

**涉及文件：** `voice/stt_stream.ts`, `voice/vad_detector.ts`

---

### 3.7 TTS 性能与质量 🟡M

**现状问题：**

- Edge TTS 每句话建立一次 WebSocket 连接（完整 TLS 握手）
- 没有连接复用或连接池
- 没有常用短句缓存（"嗯"、"好的"、"我知道了" 等出现频率很高）
- 无预合成机制

**优化方案：**

**Step 1 (🟢S)** — 短句 TTS 缓存：

```typescript
const ttsCache = new Map<string, Buffer>(); // key = text+voice+emotion
const MAX_CACHE_SIZE = 50;

async function synthesizeWithCache(text: string, emotion: Emotion): Promise<Buffer> {
  const key = `${text}|${emotion}`;
  if (ttsCache.has(key)) return ttsCache.get(key)!;
  const audio = await synthesize(text, undefined, emotion);
  if (text.length < 20) { // 只缓存短句
    ttsCache.set(key, audio);
    if (ttsCache.size > MAX_CACHE_SIZE) {
      ttsCache.delete(ttsCache.keys().next().value);
    }
  }
  return audio;
}
```

**Step 2 (🟡M)** — Edge TTS 连接复用：

- 维持一个持久 WebSocket 连接到 Edge TTS
- 通过 RequestId 区分不同请求
- 连接断开时自动重连

**涉及文件：** `voice/tts.ts`, `voice/tts_stream.ts`

---

### 3.8 Pipeline 中 Emotion 被调用两次 🟢S ✅ 已完成

**现状问题：**

`runner.ts` 中调用 `updateEmotion(text)`，同时 `brain_router.ts` 中也调用 `updateEmotion(userMessage)`，导致情绪更新被执行两次且结果可能不一致（因为 runner 在 router 之前运行）。

```typescript
// runner.ts line 29
const replyEmotion = updateEmotion(text);

// brain_router.ts line 27 (通过 chatStream → routeMessage 调用)
const emotion = updateEmotion(userMessage);
```

**修复：** 移除 `brain_router.ts` 中的 `updateEmotion` 调用，让 router 接收 emotion 参数而非自行计算。

**涉及文件：** `brains/brain_router.ts`, `server/pipeline/runner.ts`, `agents/conversation_agent.ts`

**状态：** ✅ 已完成 (Commit d44b5e4)

---

### 3.9 console.log 与结构化日志混用 🟢S ✅ 已完成

**现状问题：**

部分模块使用 `createLogger()` 的 pino 结构化日志，部分仍直接用 `console.log/warn`：

```typescript
// slow_brain.ts
console.warn("[slow_brain] LLM 分析失败...");
console.log(`[slow_brain] 分析完成 (${Date.now() - t0}ms)`);

// fast_brain.ts
console.warn("[fast_brain] LLM 返回内容为空");

// memory_agent.ts
console.log(`[memory] 记住了：${key} = ${value}`);

// emotion_state.ts
console.log(`[emotion] ${currentEmotion} → ${emotion}`);
```

**修复：** 统一替换为 `createLogger("module_name")` 调用。✅ 已完成

**涉及文件：** `brains/slow_brain.ts`, `brains/fast_brain.ts`, `memory/memory_agent.ts`, `emotion/emotion_state.ts`, `memory/memory_decay.ts`, `voice/tts.ts`

**状态：** ✅ 已完成 (Commit d44b5e4)

---

### 3.10 首次回复延迟（Time to First Audio）🟡M

**现状问题：**

完整链路延迟分析：

```
VAD speech_end                    0ms
  → STT 转文字                   +800~2000ms (Whisper API)
  → extractMemory (正则)          +~0ms
  → retrieveMemory               +~0ms (内存) / +50ms (PG)
  → LLM 首 token                 +300~1500ms
  → 首句积累完成 (SentenceChunker) +200~800ms
  → TTS 合成首句                  +300~800ms (Edge TTS)
  → 客户端开始播放                +~50ms
─────────────────────────────────────
  总延迟：约 1.6s ~ 5s
```

对于人类对话，回复延迟超过 2 秒就会感觉不自然。

**优化方案：**

**Step 1 (🟢S)** — 更激进的 Eager 模式：✅ 已完成

- ✅ 当前 SentenceChunker eager 模式在逗号处断句，增加 char count 阈值 (20 字)
- 达到 15-20 字没遇到任何标点也强制输出，避免 LLM 生成长句时等太久

**Step 2 (🟡M)** — 预测性回应：

- VAD speech_start 时就准备一个 "thinking" 状态音频（轻微 "嗯" 声）
- 在 STT 和 LLM 处理期间播放，填充空白期
- 给用户 "AI 在思考" 的感觉，而非沉默等待

**Step 3 (🟡M)** — 并行化 STT 和准备阶段：

- STT 转文字期间可以预加载记忆、预热 LLM 连接
- 使用 streaming STT 时，可以在 partial 结果上提前开始 LLM 推理（投机执行）

**涉及文件：** `utils/sentence_chunker.ts`, `server/pipeline/runner.ts`, `server/session/index.ts`

**状态：** Step 1 ✅ 已完成 (Commit d44b5e4)

---

### 3.11 对话历史管理不当 🟡M

**现状问题：**

`brain_router.ts` 用全局数组维护历史，固定 10 条 shift 丢弃：

```typescript
const MAX_HISTORY = 10;
const history: PromptMessage[] = [];
while (history.length > MAX_HISTORY) history.shift();
```

问题：

- 丢弃的是最早的消息，但可能包含关键信息（用户名字、重要背景）
- 10 轮对话约 20 条消息，prompt 可能已经很长
- 没有做 token 预算控制，如果单条消息很长可能超出 LLM context window
- 全局共享，多用户互相看到对方的历史

**优化方案：**

**Step 1 (🟢S)** — Token 预算控制：

- 对历史消息按 token 估算（中文约 1.5 token/字），设置 token 上限
- 超出时从最早开始删除，但保留第一轮（通常包含自我介绍）

**Step 2 (🟡M)** — 智能摘要压缩：

- 超出 token 预算时，用 Slow Brain 生成历史摘要
- 将摘要作为 system message 的一部分注入，替代被删除的历史
- `conversationSummary` 已经在生成，但没有用于替代历史

**涉及文件：** `brains/brain_router.ts`, `brain/prompt_builder.ts`

---

### 3.12 Slow Brain 分析结果利用不足 🟡M

**现状问题：**

Slow Brain 已经在做深度分析（话题识别、情绪倾向、关系信号、主动话题建议），但：

- `proactiveTopics` 生成了但从未触发主动发言
- `personality_note` 只存 5 条，没有优先级
- 分析结果仅在 Fast Brain 的 system prompt 末尾追加，LLM 可能忽略
- `relationship_signal` 的 cooling 仅减少 0.03，实际不影响对话风格

**优化方案：**

**Step 1 (🟢S)** — 在 Prompt 中更强调慢脑上下文：

- 将慢脑上下文从 system prompt 末尾移到更显眼的位置
- 使用更具指令性的格式（"你必须注意" 而非 "以下是观察"）

**Step 2 (🟡M)** — 主动话题触发：

- 当用户连续发送简短消息（无聊信号）时，从 `proactiveTopics` 中选取话题主动发起
- 实现 "沉默检测"：用户超过 N 秒没说话 → AI 主动说点什么

**涉及文件：** `brains/fast_brain.ts`, `brains/slow_brain_store.ts`, `server/session/index.ts`

---

### 3.13 ServerMessage 类型不严格 🟢S ✅ 已完成

**现状问题：**

```typescript
// gateway/types.ts
export interface ServerMessage {
  type: string;        // ← 不是联合类型
  content?: string;
  emotion?: string;
  audio?: string;
  frame?: AvatarFrame;
}
```

`type` 是宽泛的 string，无法在编译期检查消息类型的正确性。

**修复：** ✅ 已完成

```typescript
type ServerMessageType =
  | "emotion" | "chat_chunk" | "chat_end" | "voice"
  | "interrupt" | "stt_partial" | "stt_final"
  | "vad_start" | "vad_end" | "avatar_frame" | "error";

interface ServerMessage {
  type: ServerMessageType;
  // ...
}
```

**涉及文件：** `server/gateway/types.ts`

**状态：** ✅ 已完成 (Commit d44b5e4)

---

### 3.14 无错误恢复与重试机制 🟡M

**现状问题：**

- LLM 调用失败直接返回 fallback 文本，无重试
- TTS 失败只 log warning，该句音频直接丢失
- Edge TTS WebSocket 意外关闭无重连
- STT 失败直接报错给用户

**优化方案：**

**Step 1 (🟢S)** — 关键路径增加重试：

```typescript
async function withRetry<T>(fn: () => Promise<T>, retries = 2, delay = 500): Promise<T> {
  for (let i = 0; i <= retries; i++) {
    try { return await fn(); }
    catch (err) {
      if (i === retries) throw err;
      await new Promise(r => setTimeout(r, delay * (i + 1)));
    }
  }
  throw new Error("unreachable");
}
```

- LLM 调用：重试 1 次
- TTS 合成：重试 1 次
- STT 转写：重试 1 次

**涉及文件：** `llm/qwen_client.ts`, `voice/tts.ts`, `voice/stt_stream.ts`

---

### 3.15 前端体验优化 🟡M

**现状问题：**

- 无 "AI 正在思考" 的状态反馈（STT → LLM 之间的空白期）
- 语音播放完后没有自然过渡（突然停止）
- 无历史消息本地持久化，刷新页面丢失所有聊天
- 断线重连后没有恢复上下文

**优化方案：**

**Step 1 (🟢S)** — 思考状态动画：

- 收到 `stt_final` 后显示 "Rem 在想..." 气泡
- 收到第一个 `chat_chunk` 后消失

**Step 2 (🟢S)** — 本地消息缓存：

- 使用 localStorage 保存最近 50 条消息
- 页面加载时恢复

**状态：** Step 2（localStorage）与 Step 1（「Rem 在想…」气泡，**S9**）均已落地。

**涉及文件：** `web/src/hooks/useRemChat.ts`

---

## 四、任务分级清单

### 🟢 简单任务 (适合快速模型)


| #   | 任务                                                   | 文件                                                       | 预计耗时   | 状态    |
| --- | ---------------------------------------------------- | -------------------------------------------------------- | ------ | ----- |
| S1  | 修复 `fast_brain.ts` 中 AbortSignal 未传递给 `streamTokens` | `brains/fast_brain.ts`                                   | 5 min  | ✅ 已完成 |
| S2  | 修复 `brain_router.ts` 中重复调用 `updateEmotion`           | `brains/brain_router.ts`, `agents/conversation_agent.ts` | 10 min | ✅ 已完成 |
| S3  | 统一 console.log → pino logger (6 个文件)                 | 多文件                                                      | 15 min | ✅ 已完成 |
| S4  | `ServerMessage.type` 改为联合类型                          | `server/gateway/types.ts`                                | 5 min  | ✅ 已完成 |
| S5  | `emotion_engine.ts` 增加否定词前缀检测                        | `emotion/emotion_engine.ts`                              | 15 min | ✅ 已完成 |
| S6  | `memory_agent.ts` 扩展正则规则集                            | `memory/memory_agent.ts`                                 | 20 min | ✅ 已完成 |
| S7  | `SentenceChunker` 增加字数阈值强制输出                         | `utils/sentence_chunker.ts`                              | 10 min | ✅ 已完成 |
| S8  | 丰富 `personality.ts` 和 `character_rules.ts` 内容        | `brain/personality.ts`, `brain/character_rules.ts`       | 15 min | ✅ 已完成 |
| S9  | 前端增加 "思考中" 状态提示                                      | `web/src/hooks/useRemChat.ts`                            | 10 min | ✅     |
| S10 | TTS 短句缓存                                             | `voice/tts.ts`                                           | 15 min | ✅     |


### 🟡 中等任务 (需要上下文理解)


| #   | 任务                                       | 文件                                                          | 预计耗时   | 状态     |
| --- | ---------------------------------------- | ----------------------------------------------------------- | ------ | ------ |
| M1  | 情绪引擎增加强度和惯性机制                            | `emotion/emotion_engine.ts`, `emotion/emotion_state.ts`     | 30 min | ✅      |
| M2  | Slow Brain 的 user_facts 同步到 memory_store | `brains/slow_brain.ts`, `memory/memory_store.ts`            | 25 min | ✅      |
| M3  | 对话历史 token 预算控制                          | `brains/brain_router.ts`, `brain/prompt_builder.ts`         | 30 min | ✅      |
| M4  | 对话策略提示（轻量规则，非完整策略引擎）                     | `brain/prompt_builder.ts`, `brains/slow_brain_store.ts`     | 45 min | ✅ 部分*  |
| M5  | 关键路径重试机制                                 | `llm/qwen_client.ts`, `voice/tts.ts`, `voice/stt_stream.ts` | 30 min | ✅      |
| M6  | Slow Brain 上下文在 prompt 中的位置和格式优化         | `brains/fast_brain.ts`, `brains/slow_brain_store.ts`        | 20 min | ✅      |
| M7  | Edge TTS 连接复用                            | `voice/tts.ts`                                              | 45 min | ✅      |
| M8  | 预测性回应（思考音/填充词）                           | `server/pipeline/runner.ts`（可选 env）                         | 40 min | ✅ 服务端* |
| M9  | 前端消息本地持久化                                | `web/src/hooks/useRemChat.ts`                               | 20 min | ✅      |


 **M4**：已实现 `buildConversationStrategyHints`（规则化提示），未实现完整 `ConversationStrategy` 状态机。 **M8**：已实现服务端短「嗯」填充（需 `rem_thinking_filler=1`）；**S9**（前端「Rem 在想…」）已落地。

### 🔴 复杂任务 (架构级改动)


| #   | 任务                     | 文件                                               | 预计耗时   | 状态  |
| --- | ---------------------- | ------------------------------------------------ | ------ | --- |
| C1  | 全局状态重构为 per-session 实例 | 见 §3.1 涉及文件                                      | 2-3 hr | ✅   |
| C2  | 关系阶段化动态人格系统            | `brain/`, `brains/`, 新增文件                        | 2 hr   |     |
| C3  | 流式 STT 集成              | `voice/stt_stream.ts`, `server/session/index.ts` | 2 hr   |     |
| C4  | 沉默检测 + 主动话题发起          | `server/session/index.ts`, `brains/`, 新增定时器      | 1.5 hr |     |
| C5  | LLM 辅助情绪识别             | `emotion/`, `brains/`, `server/pipeline/`        | 2 hr   |     |


---

## 五、推荐执行顺序

### Phase 1：基础修复（立即生效）

```
S1 → S2 → S3 → S4 → S5 → S6
```

修复 bug，统一代码质量，改善情绪和记忆的基础能力。

### Phase 2：对话体验提升（核心价值）

```
S7 → S8 → S10 → M1 → M2 → M3 → M6
```

优化延迟，丰富人设，让 AI 回复更自然、更有记忆。

### Phase 3：对话策略（接近人类）

```
M4 → M8 → S9 → M9 → C2
```

引入对话策略引擎，预测性回应填充空白期，关系阶段化。

### Phase 4：架构升级（规模化）

```
C1 ✅ → C3 → C4 → C5
```

多连接状态隔离（C1），流式 STT，主动对话，LLM 情绪识别。（M5/M7 已陆续落地，见上文「已完成优化」。）

---

## 六、关键度量指标

优化效果应通过以下指标衡量：


| 指标                         | 当前估计                    | 目标             |
| -------------------------- | ----------------------- | -------------- |
| Time to First Audio (TTFA) | 2-5s                    | < 1.5s         |
| 情绪识别准确率                    | ~60% (关键词)              | > 85% (规则+LLM) |
| 记忆提取覆盖率                    | ~30% (7 条正则)            | > 70% (规则+LLM) |
| 用户觉得在和"人"聊天                | 低                       | 高 (通过 A/B 测试)  |
| 多连接状态隔离                    | `RemSessionContext`（C1） | 无跨连接共享情绪/历史/慢脑 |
| TTS 缓存命中率                  | 0%                      | > 30% (短句)     |
