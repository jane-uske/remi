# PIPELINE.md

## 这份文档在解释什么

这不是一份单纯的“数据流笔记”。
它解释的是：Rem 当前的实时交互主链路是怎么工作的，以及这条链路怎样服务三层总纲：
- 实时交互层
- 人格记忆层
- 跨终端存在层

当前原则很明确：
- live path 要快
- 记忆要有用，但不能卡 live path
- 当前主线程是 Memory V2 验证与读路径迁移，不是把慢脑塞进快路径

---

## 主链路数据流

```text
user input (text/audio)
    ↓
interrupt check (InterruptController)
    ↓
runPipeline()
    ↓
updateEmotion(runtime)
    ↓
(optional) thinking filler
    ↓
extractMemory() + retrieveMemory() / relationship context
    ↓
brain router
    ↓
fast brain
    ↓
LLM stream
    ↓
sentence chunker
    ↓
TTS synthesize
    ↓
audio stream → client
    ↓
slow brain (background only)
```

（可选）用户沉默超过 `REM_SILENCE_NUDGE_MS`
-> 服务端触发陪伴型 nudge 管线
-> 不写正常 user message 入库
-> 不跑完整慢脑分析

---

## 这条链路分别服务什么

### 1. 实时交互层
直接负责：
- 输入进入系统后的响应速度
- turn-taking
- interruption
- 开口时机
- 逐句播报与播放连续性

关键模块：
- `server/session/*`
- `server/pipeline/*`
- `voice/*`
- `brains/fast_brain.ts`
- 前端播放与状态同步

### 2. 人格记忆层
通过有限、受控的方式影响 live path：
- 检索与当前输入相关的关系上下文
- 注入 prompt
- 在 slow brain 中异步更新 episode / 关系状态 / 情绪轨迹

关键模块：
- `memory/*`
- `brains/slow_brain.ts`
- `brains/slow_brain_store.ts`
- `brain/prompt_builder.ts`

### 3. 跨终端存在层
当前还不是主链路重点，但这条 pipeline 必须给它留边界：
- reconnect restore
- session identity continuity
- 主动触达与陪伴搭话
- generation / playback / interrupt 语义可迁移到未来不同终端

关键模块：
- `server/gateway/*`
- `server/session/*`
- 持久层与恢复逻辑
- 前后端共享的 turn / playback 语义

---

## 当前语义约定

- `interrupt` 只表示“当前 active generation 被新输入抢占”
- `chat_end` 只表示文本流结束；客户端可能仍在播放最后一段 TTS
- 被打断的 assistant partial 只保留在 `lastInterruptedReply` 作为 carry-forward 上下文
- 被打断的 assistant partial 不进入正式 history、不进入 slow brain、也不按正常 assistant message 持久化
- `confirmed_end` 可以晚于 `chat_end`，因为它对应本地播放真正 drain 完成

这些约定很重要，因为它们不仅影响网页前端，也会影响未来多终端接续和跨设备播放语义。

---

## 当前阶段判断

过去这里曾经强调 relationship-state gap。
现在项目状态已经往前推进了一步：

### 已经成立的部分
- relationship continuity 的 V1 闭环已经完成
- Memory V2 基础设施已经完成
- V2 写路径已经接入
- proactive planner 已经存在
- session overlay / persistence 边界比以前更清楚

### 当前仍在做的事
- 用真实数据验证 V2 episode 写路径质量
- 将读路径从 V1 relationship episodes 迁移到 V2 episode store
- 让 proactive 行为逐步依赖 unresolved episode
- 在迁移期间保留 V1 fallback，避免 live UX 回退

所以当前不是“relationship 还没接进来”。
当前是“人格记忆层已经接进来，但正在从 V1 迁往更强的 V2，并且不能伤到实时交互层”。

---

## 详细步骤

1. **Interrupt Check**
   - 检查是否需要打断当前 generation
   - 如果是，发出真正语义上的 `interrupt`

2. **Emotion Update**
   - 根据用户输入更新情绪状态
   - 情绪会影响表达风格、语音参数和 avatar 状态

3. **（可选）Thinking Filler**
   - `rem_thinking_filler=1` 时，异步合成极短填充音
   - 作用是缓解感知停顿，但不能破坏节奏

4. **Memory / Relationship Context**
   - 提取结构化事实
   - 检索和当前输入相关的关系上下文
   - 当前正处于 V1 → V2 迁移过程中

5. **Fast Brain**
   - 面向用户的低延迟生成路径
   - 历史按 token 预算裁剪
   - 消费 prompt builder 注入的人格、关系、情绪与上下文

6. **Sentence Chunker**
   - 按稳定边界切句
   - 为 TTS 和播放连续性服务

7. **TTS**
   - 逐句合成语音
   - 带情绪与语调参数

8. **Audio Stream**
   - 将音频与文本流同步推给客户端
   - generation / playback 状态要保持可观察

9. **Slow Brain**
   - 只在后台异步执行
   - 负责 episode 写入、关系状态推进、长期上下文提炼
   - 中断轮次不触发正常完成态写回

---

## 中断与结束语义

- 文本被打断时，`runPipeline()` 仍可能发出 `chat_end`，但其 `content` 可能是 `"[interrupted]"`
- assistant 回复只有在 `!signal.aborted` 时才会走正常持久化
- 前端的 `confirmed_end` 允许晚于 `chat_end`，因为它要等本地播放队列真正排空

这套语义已经不只是“前端实现细节”。
它是未来跨设备播放、会话接续和存在层行为的基础协议。

---

## 观测与回归

- `/health`
  - 网关直接返回轻量 JSON（`ok` / `service` / `uptimeSec`）
  - 用于 smoke 和基础连通性检查，不表示 readiness
- `scripts/smoke.mjs`
  - 验证主页、`/health` 和一轮最小 WebSocket chat
- `infra/latency_tracer.ts`
  - 固定输出 `speech_end_to_stt_final`、`stt_final_to_llm_first`、`llm_first_to_tts_first`、`tts_first_to_playback` 等指标
- `test/server/session/duplex_harness.ts`
  - 固定语音链路场景，用于前后版本回归比较

观测性的意义不只是工程调试。
它是判断 Rem 有没有更像活人的证据基础。

---

## 当前最重要的边界

### 不要做的事
- 不要把重型记忆召回塞进 fast path
- 不要把 slow brain 的异步分析改成 live path 阻塞步骤
- 不要为了单端体验 hack 掉未来多终端接续需要的状态语义

### 必须守住的事
- live response 速度
- 打断语义正确性
- 正式 history 的干净边界
- 关系状态进入 prompt 的可控性
- reconnect / playback / generation 状态的清晰语义

---

## 目录结构

```text
server/
├── server.ts                    # 入口文件
├── gateway/
│   ├── index.ts                 # HTTP + WebSocket 网关
│   └── types.ts                 # ServerMessage 类型
├── session/
│   ├── index.ts                 # ConnectionSession 类
│   └── types.ts                 # 会话状态类型
└── pipeline/
    ├── index.ts                 # runPipeline 导出
    ├── runner.ts                # 管线执行逻辑
    └── types.ts                 # 管线类型
```
