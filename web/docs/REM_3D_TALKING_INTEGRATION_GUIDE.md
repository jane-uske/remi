# Remi 3D 说话线程接入指南

## 适用范围

这份指南面向主线程集成，只说明如何把当前“3D 模型同步说话”模块接入现有 Remi 项目。

目标是最小改动接入，不碰主业务逻辑。

## 已落地模块

### 音频说话输入

- [`web/src/hooks/useAudioBase64Queue.ts`](/Users/rare/Desktop/remi-ai/web/src/hooks/useAudioBase64Queue.ts)

对外提供：

- `voiceActive`
- `lipEnvelopeRef`
- `clearQueue()`

作用：

- `voiceActive` 表示角色当前是否在播放 TTS
- `lipEnvelopeRef` 提供 0 到 1 的说话强度
- `clearQueue()` 用于打断时立即停止当前和排队中的说话

### 3D 角色说话驱动

- [`web/src/lib/rem3d/vrmViewer.ts`](/Users/rare/Desktop/remi-ai/web/src/lib/rem3d/vrmViewer.ts)
- [`web/src/lib/rem3d/speechMotion.ts`](/Users/rare/Desktop/remi-ai/web/src/lib/rem3d/speechMotion.ts)
- [`web/src/lib/rem3d/emotionToVrm.ts`](/Users/rare/Desktop/remi-ai/web/src/lib/rem3d/emotionToVrm.ts)

作用：

- 读取说话强度
- 把嘴型、眨眼、眼神、头胸微动作统一输出到 VRM
- 保持情绪表情和说话状态可叠加

### 页面接入层

- [`web/src/components/Remi3DAvatar.tsx`](/Users/rare/Desktop/remi-ai/web/src/components/Remi3DAvatar.tsx)
- [`web/src/components/RemiChatApp.tsx`](/Users/rare/Desktop/remi-ai/web/src/components/RemiChatApp.tsx)
- [`web/src/hooks/useRemiChat.ts`](/Users/rare/Desktop/remi-ai/web/src/hooks/useRemiChat.ts)

作用：

- 将 `voiceActive` 与 `lipEnvelopeRef` 传入 3D Avatar
- 用当前交互状态推导 `remState`

## 主线程接入步骤

1. 保持 `useAudioBase64Queue()` 为唯一 TTS 播放入口  
不要在别处直接维护第二套“是否正在说话”的状态。

2. 在页面层继续把以下信息传给 `Remi3DAvatar`

- `emotion`
- `remState`
- `lipEnvelopeRef`
- `voiceActiveRef`
- 可选 `actionSignal`

3. 继续把打断统一走 `clearQueue()`  
不要仅停 WebSocket 消息，不停本地播放。

4. 保持 `remState` 由主页面统一推导  
不要让 Viewer 自己猜测当前是 `thinking` 还是 `listening`。

## 推荐接入约束

### 必须保持

- `voiceActive` 来自真实播放状态
- `lipEnvelopeRef` 来自同一条 TTS 播放链
- `interrupt` 到来时一定执行 `clearQueue()`

### 不建议做

- 不建议在业务层再造一套嘴型状态
- 不建议直接在多个地方分别写 VRM 表情
- 不建议把说话动作绑死在某个具体 TTS provider 上

## 主线程联调顺序

1. 先验证 `voice_pcm_chunk` 路径  
这是最低延迟、最接近真实说话节奏的路径。

2. 再验证 `voice` 整段回放路径  
确认 fallback 情况下仍然有“开口感”。

3. 再验证打断  
确认用户一开口，本地播放和说话表情能同步收住。

4. 最后验证连续多轮  
确认状态不会累积漂移。

## 通过标准

- TTS 播放时，角色稳定开口
- 停止或打断后，角色能迅速自然回落
- 轻量表情和微动作与说话节奏一致
- 不破坏现有实时对话链路

## 回退方案

如果主线程联调中发现问题，可按下面顺序降级：

1. 先保留嘴型同步，关闭强化微动作
2. 再保留 `voiceActive` 开口 fallback，减弱包络驱动强度
3. 如仍不稳定，仅保留最基础的说话嘴型

原则是：宁可克制，也不要出戏。
