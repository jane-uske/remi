# VOICE_ROADMAP.md

## 总目标

语音不是 Remi 的全部，但它是“活人感”的第一入口。

这份路线图的目标不是单独把语音做强，
而是把 Remi 从“一个会说话的 pipeline”推进成“一个具备在场感、人格连续性和可持续陪伴能力的 AI 存在”的实时交互层。

因此，语音路线图必须放在更大的三层总纲里看：
- 实时交互层
- 人格记忆层
- 跨终端存在层

其中这份文档主要覆盖第一层，并说明它和另外两层怎么衔接。

---

## 三层总纲中的位置

### 1. 实时交互层
这份文档的主战场。
目标是让用户在当下这一刻感觉：她像真的在和我说话。

### 2. 人格记忆层
语音行为不能脱离关系状态。
如果没有持续记忆，语音再顺滑，也只会像一个更高级的语音机器人。

### 3. 跨终端存在层
未来 Remi 不会只存在于网页里。
语音链路今天的设计，也要给未来手机、耳机、车机、穿戴设备等场景留出接续空间。

---

## 当前优先级

在继续扩展语音行为前，当前主线程仍然是：
- Memory V2 验证 + 读路径迁移（V2.1）

为什么它要先做：
- fast brain 的行为升级，只有在关系状态能稳定消费时才真正有价值
- 主动行为只有在 proactive hooks 能跨重连保留时才自然
- 否则系统只会变成“更顺滑的语音机器人”，而不是“更连续的陪伴角色”

当前关注点：
- 验证 V2 episode 写路径在真实对话里是否可靠
- 将读路径从 V1 relationship episodes 迁到 V2 episode store
- 让主动策略逐步依赖 unresolved episode，而不是旧的 V1 结构

执行层面的短说明见 [CURRENT_FOCUS.md](../ops/CURRENT_FOCUS.md)。

---

## 当前实时交互层架构概览

当前大致链路：

用户语音 / 文本输入
-> websocket gateway
-> session instance
-> pipeline runner
-> VAD / STT
-> fast / slow brain
-> memory update
-> sentence chunking
-> TTS
-> frontend playback

当前主要优势：
- 双工传输已存在
- fast / slow brain 分层明确
- interrupt controller 已接通
- 逐句 TTS 已存在
- memory layer 已存在
- avatar controller 已存在
- 打断语义已更干净
- turn lifecycle 语义更明确
- 延迟与回放基线可用于迭代比较

当前主要弱点：
- turn-taking 仍然过度依赖静音
- STT 和实时理解还不够早
- interruption carry-forward 的行为丰富度还不够
- fast brain 进入时机仍偏晚
- 整体 voice UX 仍然有 pipeline 感
- `voice_pcm_chunk` 虽已恢复，但当前 Edge consumer 流式首包依赖服务端 MP3 -> PCM 实时转码；这说明 TTS 流式的主要风险点已从“前端协议没接好”变成“上游端点支持范围和运行时稳定性”

### 最近一轮语义收口后的状态
- `interrupt` 现在表示“真实在途 generation 被抢占”，而不是泛化清队列信号
- `chat_end` 现在表示文本流结束；本地播放未排空前，前端仍可保持 `assistant_speaking`
- 被打断的 assistant partial 已不再进入 formal history / slow brain / 正常 assistant 持久化
- `/health`、latency tracer snapshots、duplex harness 场景键都已能作为稳定基线
- duplex 语音链路现在会在 `speech_end` / `duplex_stop` 立刻冻结 immutable utterance job，并把 STT decode 从 assistant `pipelineChain` 拆到独立 `sttChain`；`stt_final` 与 `assistant_entering` 不再被上一轮 LLM/TTS 收尾串行卡住
- 每条语音回合现在都带 `utteranceSeq` / `sttJobSeq` / `ingressSampleRate` / `normalizedSampleRate`，interrupt 后晚到的旧 STT 会被明确标记为 `[STT] dropped_stale_utterance`，而不是继续污染后续 turn
- 非 16k ingress 现在会先在服务端归一化到 16k 再进入 VAD/STT；`audio_without_vad` 也不再是一个模糊黑箱，而会明确区分真静音、弱语音、语音形态未确认和“48k 已归一化后仍没起 VAD”
- 当前 dev 已切到 `whisper-server + ggml-medium.bin`，真实样本里 `transcribeMs` 已明显下降；同时 `fallback_energy` 下被 pre-STT suppress 的短片段不再直接丢弃，而会在 `duplex_stop` 走一条 recovered-fallback STT 补救路径，优先挽回短反馈/短笑声/软声插话
- duplex UI / state 边界这轮也收了两刀：弱 `fallback_energy` 起点不再立刻把前端拉进“正在听…”，而是延后到更可信的 promotion / partial 证据；同时 correction 句子在 `semantic_hold` 里不再被一个很弱的 fallback restart 轻易冲掉，前端在 `vad_end` 到 `stt_final` 之间也会明确显示“识别中…”，避免用户误以为系统已经空闲
- noisy duplex 这轮新增的三个真实回归点也已锁住：1) interrupted run abort 后不再继续把 `pipelineChain` 卡在未 settle 的 TTS promise 上，下一条语音不会明明已有 `stt_final` 却还要在 `llm_request_start` 前被旧 generation 拖几秒；2) `fallback_energy` 的 duplex interrupt 现在要求更强证据，弱键盘/环境噪声不再轻易把 Remi 从 `assistant_speaking` 打断；3) 即便噪声已经走进 `speech_buffer -> STT` 主路径，像“谢谢!”、“谢谢观看!”这类短、弱、无 preview 支撑的 hallucination 也会在 post-STT suppression 被拦下，不再直接当用户 turn 提交
- turn-taking Phase 1 现已进入“规则+韵律优先”的硬收口阶段：final STT 新增了 non-speech transcript reject，`"[音乐]"` / `"[笑声]"` / `谢谢观看` 这类文本不会再进入正常 user turn；`decideTurnTaking()` 新增了 `prosody_fast_release`，对尾部能量明显回落、pitch 下行且无新 growth 的句末，把 release target 收到约 `480ms`；同时 recovered fallback 对 `2–6` 字的弱短假词改为默认 suppress，只保留主路径短反馈正常通过。另已定义 `TurnTakingPredictor.score()` 的 heuristic 接口，当前只用于 interrupt / recovered-fallback / non-speech reject 的辅助门控，轻量模型仍是后置选项，不算已落地
- 这轮再收两条更接近真实 bad case 的边界：assistant-speaking 下的 `strict` burst 不再自动绕过噪声门槛，低置信 strict 噪声现在也会延后 `vad_start` / preview 外显，并要求更强证据后才允许真正 interrupt；同时 `runPipeline()` 在 abort 后不再继续傻等 `avatarIntentTask`，被打断的旧 generation 不该再把下一条像“刚起床”“喂喂喂”这种已经完成 STT 的回合卡到 `llm_request_start` 前几秒才放行。这里的状态仍然只是“代码和 regression 已收口”，不是 noisy localhost 已通过真实验收
- 这轮又补了一个之前容易忽略、但真实用户体感很差的边界：`interrupt.active` 和“客户端其实还在播音频”不再被混为一谈。前端现在会在 playback drain/clear 时主动回传 `playback_end`，服务端单独维护 `assistantPlaybackActive / playbackGenerationId`；因此即使服务端 generation 已结束、客户端还在播缓冲音频，后续强语音也仍然可以针对当前播放 generation 发真正的停播 `interrupt`。同时 recovered fallback 的 stop-time 规则对短礼貌词更保守，`谢谢!`、`喂喂喂` 这类弱、无 preview 的幻觉不该再漏成正常用户 turn。这里依旧只是代码 + regression 收口，不算 noisy localhost 已验收通过
- 最新一轮又把“长时间 open-mic 空闲后再开口变慢”的 runtime 堵点往前移了一层：session 现在有 `idle guard`，长时间空闲后先挡住低价值环境噪声，不再让它们轻易形成 STT job；同时 STT job 新增 `high|low` 优先级、可中断抢占和 request-level degraded window，`whisper-server` 一旦超时/abort，低价值 job 会直接 skip，高价值 job 才允许走 degraded CLI 路径，避免 idle 噪声先把 `sttChain` 和 CLI fallback 一起拖爆。latency trace 也补了 `sttPath / sttFallbackReason / sttJobPriority / sttQueueBlockedByPriorJob / idleGuardActive / sttPreemptReason / sttRequestDegraded`，但这仍然只是代码与 regression 层收口，不代表 localhost 长时间开麦实测已经过线
- 下一阶段的主要瓶颈，已经不只是语音本身，而是语音如何和人格记忆层共同工作

### 当前剩余待优化点

这些是已经被日志和真实样本证明、但还没收口的剩余瓶颈：

1. **STT job priority 仍然不够准**
- `idle guard` 已经能挡住一部分弱噪声
- 但已经进入 `speech_buffer` 的 job 里，仍有不少会被过早标成 `high`
- 一旦 `whisper-server` 超时，这些 job 还是会继续占住 degraded / CLI 路径

2. **进入 CLI fallback 前的“值不值得继续转”仲裁还不够硬**
- 现在最伤体感的情况不是单条语句慢，而是坏 job 先跑进 CLI，把后面真实语句拖成 `10s+`
- 需要继续把“before / during transcribe”的抢占和 skip 做得更保守

3. **`speech_end -> stt_final` 仍然偏慢**
- 当前已经不是最混乱时的 `10s+` 常态
- 但在真实 localhost 场景里，这一段仍经常是最大的单段瓶颈之一

4. **`llm_first -> tts_first_audio` 还是大拖点**
- 当前文本和语音的主观体感里，TTS 首音波动仍明显
- 这已经不是 turn-taking 的锅，而是下一阶段要单独打的关键路径

5. **真实 noisy localhost 仍未验收通过**
- 当前代码和 regression 已经比之前更接近正确
- 但项目阶段仍然只是：
  - `单路径可用`
  - 不是 `多场景稳定`
  - 更不是 `生产可用`

---

## 实时交互层设计原则

不要只优化“延迟数字更低”。
要优化“用户主观感受到她像不像一个活人”。

这意味着下面这些和模型质量同样重要：
- 开口响应时机
- 节奏
- turn-taking
- 打断行为
- 承接感
- 情绪语气
- 回放稳定性

---

## 路线图结构

### A. 输入更早被理解
#### 目标
从“等用户说完再理解”转向“用户还在说时就开始理解”。

#### 主要改动
- 支持 partial / incremental transcript 流
- 保留 final transcript 作为唯一真值
- 允许 fast brain 提前做预计算 / 预反应准备
- 保留 fallback 模式
- 对已知项目名 / 人名 / 术语允许做轻量热词级 `stt_final` 后处理，但必须默认关闭、可回退，且不能冒充开放域 STT 消歧

#### 为什么
这是杠杆最高的一步，因为它把“理解”前移了。

#### 成功信号
- 系统更早进入可响应状态
- final transcript 落地后，first-token 延迟更低
- final transcript 状态不被污染
- 回滚仍然容易

#### 当前补充说明
- 当前已落一版轻量热词纠偏：固定词表驱动，只作用于 `stt_final`，命中后统一进入前端显示、pipeline、memory 与 slow brain
- 这版的真实定位是“压住高频专有词错写”，不是“让 STT 普遍更懂上下文”
- 在拿到 `n-best`、词级置信度或时间戳之前，不要把它继续包装成更大的语音理解能力

### B. Turn-taking 更像真人
#### 目标
不要再主要依赖静音阈值。
转向 VAD + transcript growth + 基础语义完成信号。

#### 主要改动
- 增加 turn manager / turn detector
- 把 turn state 分类为 hold / likely_end / confirmed_end
- 减少用户短暂停顿时被 AI 抢答

#### 当前实现说明
- 项目已经暴露了 `listening_hold / likely_end / confirmed_end` 这类 turn states
- 剩下的问题不是“有没有这些名字”，而是这些判断质量够不够好

#### 为什么
即使模型很强，糟糕的 turn-taking 也会直接毁掉活人感。

#### 成功信号
- 抢答更少
- 打断用户的尴尬时刻更少
- 响应时机仍然足够快

### C. 打断从硬停升级为对话分支切换
#### 目标
从“interrupt = 硬停”进化为“interrupt = 对话分支发生变化”。

#### 主要改动
- 分类 interruption type
- 保留 interruption context
- 针对 correction / continuation / topic switch / emotional interruption 生成不同的 carry-forward 行为

#### 当前实现说明
- interruption types 与 carry-forward hints 已经存在
- 最近一次修复主要解决的是正确性：
  - 只有真实打断才应设置 interruption state
  - 被打断的 partial 不应污染正式 history
- 剩下的问题是行为丰富度，而不是基础语义有没有

#### 为什么
真人被打断时不是简单停下，而是会顺势调整。

#### 成功信号
- 打断更像对话，而不是播放器 stop
- hard reset 感更少
- 下一句回复更有上下文承接感

### D. 把 Fast Brain 变成实时行为引擎
#### 目标
把 fast brain 从“低延迟回复器”升级成“实时行为引擎”。

#### 主要改动
- 支持短 ack、filler、backchannel
- 让情绪状态和关系状态影响表达方式
- 允许 avatar 和 voice 行为耦合
- 保持 slow brain 继续负责深层认知和记忆提炼

#### 为什么
活人感来自行为节奏，不只是 prompt 文字内容。

#### 成功信号
- 同样语义的回复，会因为关系和情绪不同而表现不同
- 短反馈听起来是角色本人在反应
- 语音和 avatar 状态能互相强化

### E. 为跨终端语音存在打基础
#### 目标
让语音能力未来能自然进入手机、耳机、车机、穿戴设备等不同终端。

#### 主要改动方向
- 抽离更稳定的 session / playback / interruption 语义
- 避免把关键状态绑定到单一网页生命周期
- 让 reconnect / restore / identity mapping 更清楚
- 给主动触达和设备切换预留状态边界

#### 为什么
如果今天的语音系统只能在单端网页里成立，未来会反过来限制 Remi 的存在层。

#### 成功信号
- 设备切换时语义边界清晰
- 重连恢复更稳定
- 同一用户在不同入口下能保持一致状态

---

## 当前非目标

当前不要优先优化这些方向：
- 最大化后端兼容性
- 巨型重写
- 过宽的多模态扩张
- 过度助手化的工具能力扩张
- 只为 demo 效果堆表演型语音功能

这些都可以以后再做，只要它们不伤到核心活人感与存在感。

---

## 最近踩坑记录

### 1. 本地重模型换声目前不值得优先做
- 已验证 `Kokoro-ONNX` 在当前 Apple Silicon 开发机上可以跑通，但试听结论明确：语速偏慢、语调单调、情绪感弱
- 这类本地模型现在最多算“单路径可运行”，不等于“适合 Remi 的默认声音”
- 后续如果再讨论“换个更好听的声音”，默认不要先回到 `Kokoro` / 同类本地重模型，除非目标从“更像真人陪伴”切换成“纯本地离线可运行”

### 2. Edge 换声试听前先检查缓存维度
- 曾出现过“不同 `edge` 中文音色试听结果一模一样”的假象，根因不是微软声音真的一样，而是短句 TTS 缓存 key 漏掉了 `voice / rate / pitch`
- 结论：后续做任何 `edge` 声线对比时，先确认缓存键包含声线参数，否则试听结果不可信

### 3. Edge consumer 路线不适合大批量高频切 voice
- 当前这条 `speech.platform.bing.com/consumer/.../edge/v1` 路线在高频批量切换 voice 时，WebSocket 稳定性一般，容易出现意外关闭
- 结论：后续 shortlist / A-B 听感验证应优先走小批量、串行、少样本方式，不要一次性 sweep 很多 voice

---

## 需要守住的架构边界

### Fast brain
负责：
- 低延迟反应
- 开口时机
- 短确认与短承接
- interruption carry-forward
- 行为节奏

不应负责：
- 重型召回
- 长分析
- 大阻塞任务

### Slow brain
负责：
- 记忆提取
- 更深层推理
- 关系摘要
- 话题分析
- 情绪分析

不应阻塞：
- 实时语音响应主链路

### Memory
应该影响：
- 风格
- 熟悉度
- 互动习惯
- 关系语气
- 主动跟进的自然度

不应该：
- 把 prompt 塞爆
- 阻塞 live interaction
- 主导每一轮回复

### Presence / Cross-device
应该逐步承接：
- 会话恢复
- 用户身份连续性
- 多端接续
- 主动触达边界

不应该：
- 靠单端 hack 临时拼接
- 让关键语义只存在于前端局部状态中

---

## 产品层解释

真正的目标不是：
“让语音系统在技术上更先进。”

真正的目标是：
“让 Remi 像一个真的在场、会继续记得你、并且不会被某个设备壳子限制住的角色一样存在。”

所以语音路线图永远不是孤立的。
它服务的是：
- 当下这一刻的活人感
- 跨时间的人格连续性
- 跨终端的持续存在
