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

执行层面的短说明见 [CURRENT_FOCUS.md](CURRENT_FOCUS.md)。

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

### 最近一轮语义收口后的状态
- `interrupt` 现在表示“真实在途 generation 被抢占”，而不是泛化清队列信号
- `chat_end` 现在表示文本流结束；本地播放未排空前，前端仍可保持 `assistant_speaking`
- 被打断的 assistant partial 已不再进入 formal history / slow brain / 正常 assistant 持久化
- `/health`、latency tracer snapshots、duplex harness 场景键都已能作为稳定基线
- 下一阶段的主要瓶颈，已经不只是语音本身，而是语音如何和人格记忆层共同工作

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

#### 为什么
这是杠杆最高的一步，因为它把“理解”前移了。

#### 成功信号
- 系统更早进入可响应状态
- final transcript 落地后，first-token 延迟更低
- final transcript 状态不被污染
- 回滚仍然容易

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
