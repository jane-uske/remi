另请参阅：
- CURRENT_FOCUS.md
- TASKS.md
- PROJECT_CONTEXT.md
- VOICE_ROADMAP.md
- ARCHITECTURE.md
- PIPELINE.md

# AGENTS.md

## 这份文档的用途

这份文档只做三件事：
- 定义 Rem 的北极星
- 给出当前主线程
- 约束 agent 改代码时的决策边界

不要把它当成完整产品说明。
产品全貌看 [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md)。
当前执行优先级看 [CURRENT_FOCUS.md](CURRENT_FOCUS.md)。

## 低 token 启动协议

新窗口或新 agent 启动时，默认只读这三份文档：
1. [AGENTS.md](AGENTS.md)
2. [CURRENT_FOCUS.md](CURRENT_FOCUS.md)
3. [TASKS.md](TASKS.md)

只在“要改具体模块”时再按需补读：
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [PIPELINE.md](PIPELINE.md)
- [MEMORY_V2_DESIGN.md](MEMORY_V2_DESIGN.md)

不要在启动阶段默认全量读取所有 `*.md`。
优先保证任务方向正确，再补实现细节。

---

## 项目定义

Rem 不是通用聊天机器人。

Rem 的终极目标，是成为一个跨终端持续在线、具备人格连续性与长期记忆、能像真人一样自然交流并长期陪伴用户的 AI 存在。

更直白地说：
- 不是做一个 App
- 是做一个一直跟着用户生活流动的数字生命入口

当前总纲分三层：
1. 实时交互层
2. 人格记忆层
3. 跨终端存在层

长期还要具备一条明确的能力扩展方向：
- 插件系统 / capability system
- 第三方平台接入
- 游戏接入
- 直播接入
- 现实机器人/IoT/可穿戴设备接入
- 成人用品等特殊硬件接入

这些能力不是当前主线程，但架构上必须给未来留出边界。
结论是：
- 核心对话与记忆主链路不能和具体外部平台硬耦合
- 未来扩展应通过明确的 plugin / capability boundary 接入
- 不要把一次性的第三方接线写死进核心会话逻辑

---

## 最高优先级

做改动时，按下面顺序优化：

1. 实时交互质量
   - 降低感知延迟
   - 减少尴尬停顿
   - 改善打断处理
   - 提高 turn-taking 准确性
2. 人格与关系连续性
   - 保住 Rem 的人格、语气和情绪连续性
   - 避免回复越来越像通用助手
3. 架构清晰度
   - 职责边界清楚
   - 状态流转清楚
   - 迁移路径清楚
4. 可靠性
   - 不破坏现有文本聊天
   - 不破坏 fallback 路径
5. 可演进性
   - 能支撑跨终端接续
   - 能支撑未来 plugin / capability 扩展

---

## 当前焦点

当前主线程：Memory V2 验证 + 读路径迁移（V2.1）。

它属于“人格记忆层”。
目标不是单独做一个记忆功能，而是让 Rem 更像一个持续存在的人，而不是每轮都重置的聊天框。

当前目标：
- 用真实数据验证 Memory V2 写路径
- 将读路径从 V1 relationship episodes 迁移到 V2 episode store
- 让主动策略逐步依赖 unresolved episode
- 在不伤害实时交互质量的前提下增强关系连续性

不要优先做：
- 纯 VAD 阈值微调
- 单独做 TTS first-audio 微优化
- 只提升展示层、却不增强关系连续性的 avatar 扩展
- 为单一平台做硬编码式接入

成功意味着：
- 真实对话里 episode 数据能被可靠写入
- 读路径能消费 V2 episode memory，且 live UX 不回退
- proactive planning 能消费 unresolved episode state
- 在 V2 行为完全验证前，V1 fallback 仍然可用

如果要改 `server/session/*`、`brains/*`、`memory/*` 或 `brain/*`，先读 [CURRENT_FOCUS.md](CURRENT_FOCUS.md)。
完成当前主线程任务后，在汇报前更新 [TASKS.md](TASKS.md) 和直接受影响的路线图文档。

---

## 核心架构原则

### 1. Fast brain 与 slow brain 必须边界清晰
- Fast brain 负责低延迟对话反应、短承接、即时恢复
- Slow brain 负责记忆提取、关系状态、长周期连续性维护
- 不要把 slow 任务塞进 fast path

### 2. 语音 UX 是一等系统
任何语音改动都必须考虑：
- turn-taking
- interruption
- streaming behavior
- first-audio latency
- playback continuity

### 3. 记忆不能阻塞实时交互
记忆召回和写回不应明显拖慢实时响应。
优先异步更新、有界召回、延迟预算明确的方案。

### 4. 跨终端存在不能靠前端页面偶然拼出来
多终端持续存在应建立在：
- 可恢复的会话状态
- 可迁移的记忆层
- 明确的身份与在线语义
- 不依赖单端页面生命周期的后端边界

### 5. 外部能力接入必须走插件 / 能力边界
未来会接：
- 直播平台
- 游戏
- 机器人
- IoT / 穿戴设备
- 特殊外设

因此：
- 不要把外部平台 SDK 直接耦进核心对话循环
- 不要把设备控制语义散落在 session / pipeline 主链路
- 优先抽象成 capability interface / plugin boundary / adapter layer

---

## 代码改动规则

### 一定要做
- 除非任务明确要求，否则尽量保持现有行为
- 风险行为变化加 feature flag 或回退路径
- 引入新的实时逻辑时保留 fallback
- 给 turn-taking、interrupt、latency-sensitive 决策补日志
- 保持模块小、职责明确
- 记录新增状态字段和事件类型
- 改了路线图敏感区域时同步更新文档

### 绝不要做
- 不要在没有分阶段迁移的情况下合并大型架构重写
- 不要把阻塞性工作放进 fast response path
- 不要把 memory 逻辑和 voice streaming 硬耦合
- 不要把具体平台接入写死进核心会话逻辑
- 不要静默移除 fallback 模式
- 不要写“看起来完成”的虚假汇报

---

## 汇报要求

完成任务后，始终按这个格式汇报：

### 1. What changed
- files modified
- functions/classes added or changed
- new config flags
- new state fields
- new events

### 2. Why it changed
- what problem this solves
- what tradeoff was made

### 3. Risk
- what could break
- what fallback exists
- how to disable the feature

### 4. Evidence
- test cases
- logs
- latency measurements
- before/after comparison

### 5. Remaining gaps
- what is still not solved
- what this task did NOT do

除非所有验收标准都明确验证过，否则不要说“全做完了”。

---

## 高敏感区域

这些目录改动风险高，汇报时必须解释状态流转：
- `server/session/*`
- `server/pipeline/*`
- `voice/*`
- `brains/*`
- `memory/*`
- `web/src/hooks/useRemChat.ts`
- 未来新增的 `plugins/*`、`capabilities/*`、`integrations/*` 类目录

---

## 决策偏好

如果不确定，优先选择：
- 更简单的设计
- 更清楚的状态
- 更安全的 rollout
- 更小的侵入范围
- 更接近“存在感系统”北极星的方案

不要优化聪明感。
要优化 Rem 的活人感、连续性、存在感，以及未来的可扩展性。
