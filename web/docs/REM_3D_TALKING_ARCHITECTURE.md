# Remi 3D 说话线程主方案

## 目标

这条线程只解决一件事：让 Remi 在 TTS 播放时具备稳定、低延迟、可打断、具有人感的说话表现。

我们不重做主链路，不改 UI 架构，不重构 LLM / STT / TTS。所有改动都围绕现有前端 3D Avatar 与音频播放链路做最小接入。

## 产品定义

“真人说话感”在这个项目里的定义不是更丰富的动画，而是用户能直觉感受到：

- Remi 在开口表达，而不是嘴巴在机械开合
- 说话节奏、表情、眼神和头部微动作属于同一个角色状态
- 用户插话时，Remi 能像真人一样迅速停住并让出话权
- 说完后 Remi 会自然回到在场待机，而不是突然断电

## 主线程职责

主线程负责四件事：

- 统一体验标准：先定义什么叫达标，再允许子模块实现
- 统一状态语言：`idle` / `thinking` / `speaking` / `listening` 必须驱动同一套表现
- 统一集成顺序：先稳定开口，再叠加自然感，最后验证打断与连续多轮
- 统一最终验收：以连续对话体验为准，而不是单点效果截图

## MVP 范围

MVP 只保证四件事：

- TTS 播放时，嘴型稳定同步
- 停止播放或被打断时，嘴型迅速自然回落
- 说话期间有轻量自然感，不是完全僵住
- 不增加可感知延迟，不破坏现有实时对话链路

## 增强版范围

在 MVP 通过后，再叠加以下增强：

- 说话期轻量表情 overlay
- 轻量眨眼与眼神漂移
- 轻量头部与胸部微动作
- 不同情绪下的说话细微差异

## 模块分工

### 1. 音频驱动层

职责：把 TTS 播放变成稳定的“说话强度”输入。

当前接入点：

- [`web/src/hooks/useAudioBase64Queue.ts`](/Users/rare/Desktop/remi-ai/web/src/hooks/useAudioBase64Queue.ts)

主策略：

- 流式 PCM 路径继续使用 `Web Audio + AnalyserNode`
- `voice` 整段回放路径保留 `voiceActive` 兜底
- 统一向 3D Viewer 暴露 `lipEnvelopeRef` 与 `voiceActive`

### 2. 角色表现层

职责：把“说话强度 + 当前状态 + 当前情绪”翻译成角色表现。

当前接入点：

- [`web/src/lib/rem3d/vrmViewer.ts`](/Users/rare/Desktop/remi-ai/web/src/lib/rem3d/vrmViewer.ts)
- [`web/src/lib/rem3d/speechMotion.ts`](/Users/rare/Desktop/remi-ai/web/src/lib/rem3d/speechMotion.ts)
- [`web/src/lib/rem3d/emotionToVrm.ts`](/Users/rare/Desktop/remi-ai/web/src/lib/rem3d/emotionToVrm.ts)

主策略：

- 情绪表情先定义为基础权重
- 说话期动作作为 overlay 叠加，不覆盖主情绪
- 所有说话相关动作都走同一个控制器，避免嘴型、眼神、眨眼互相打架

### 3. 主页面状态层

职责：决定 Remi 当前处于哪种产品状态。

当前接入点：

- [`web/src/components/RemiChatApp.tsx`](/Users/rare/Desktop/remi-ai/web/src/components/RemiChatApp.tsx)
- [`web/src/hooks/useRemiChat.ts`](/Users/rare/Desktop/remi-ai/web/src/hooks/useRemiChat.ts)

主策略：

- `recording` / `userSpeaking` 优先判定为 `listening`
- `voiceActive` 判定为 `speaking`
- `typing` / `waiting` 判定为 `thinking`
- 角色表现只读取统一状态，不自行猜测业务阶段

## 状态优先级

从高到低：

1. `listening`
2. `speaking`
3. `thinking`
4. `idle`

原因：当用户正在说话时，角色必须立即让出话权；听用户说话优先级高于自身表达。

## 集成原则

- 只做前端最小接入，不改服务端协议
- 保持现有 `voice` / `voice_pcm_chunk` / `interrupt` 行为兼容
- 新增能力优先做成 Viewer 内聚逻辑，不向业务层散出额外复杂性
- 表现层允许降级：即使包络极低，也能用轻量说话 fallback 保持“开口感”

## 风险与控制

### 风险 1：嘴型抖动

控制：

- 对说话强度做平滑，不直接使用原始包络
- 停止说话后使用短暂 hold + release，而不是瞬间归零

### 风险 2：表现过度

控制：

- 表情和微动作只做轻量 overlay
- 优先克制，不追求“动作多”

### 风险 3：打断后还在说

控制：

- `clearQueue()` 与 `voiceActive` 一起作为说话结束信号
- 说话控制器在无播放后快速回落

### 风险 4：多模块互相抢控制权

控制：

- 统一使用 `speechMotion` 输出说话 overlay
- 情绪表情与说话表情通过合并权重输出，不分别直接写 VRM

## 验收顺序

### 第一关：MVP

- 说话时稳定开口
- 停止后自然闭口
- 被打断后迅速停住

### 第二关：真人感

- 表情、眼神、头部动作与说话节奏一致
- 看起来像在表达，不像播报

### 第三关：连续对话

- 多轮播放稳定
- 打断、追问、等待、继续说都不出戏

