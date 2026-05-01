# Remi Avatar 运行时说明

## 数据流

1. `useRemiChat.ts` receives WS events and derives:
- `avatarFrame`: server-provided face and lip-sync overlays
- `avatarIntent`: high-level intent derived from emotion and action

2. `Remi3DAvatar.tsx` forwards runtime inputs to the adapter:
- `setEmotion()`
- `setState()`
- `setIntent()`
- `setFrame()`
- `playAction()`

3. `runtimeAdapter.ts` keeps the live lip-signal reference and bridges React props to `RemVrmViewer`.

4. `vrmViewer.ts` 是渲染器 / 运行时：
- 解析骨骼与相机
- 混合 idle、speech、emotion、action 与 intent 信号
- 消费 `face` 和 `lipSync`
- 向 devtools 发布运行时快照

5. `/vrm` 是真实链路 VRM 验证页：
- 继续走 `useRemiChat` / WS / LLM / TTS 主链路
- 强制使用 VRM 渲染，不走默认入口的 Live2D fallback
- 读取 `runtime/selectRemiAvatarRuntimeModel()` 的平台无关 avatar 投影
- 只用于验证 LLM 高层 intent、动作、表情和 TTS 口型输入是否能到达 VRM 表现层

## 模块职责

- `avatarIntent.ts`
  高层 schema 与规则兜底。后续如果要演进 LLM 输出解析，这里是主要入口。

- `faceToVrm.ts`
  把协议里的 face / lip 输入映射到 VRM expression preset。

- `emotionToVrm.ts`
  基础情绪权重与底层表情合并辅助。

- `speechMotion.ts`
  说话状态下的微动作，以及包络驱动的 speaking 行为。

- `devtoolsStore.ts`
  共享环形日志存储，以及最新的运行时快照。

- `runtime/avatar_model.ts`
  位于仓库根 `runtime/`，不是 Web 专属模块。它只输出平台无关的 avatar runtime model，供 Web `/vrm` 和 World 共同消费。

## 后续修改规则

- 不要把直接控制骨骼的字段加进网络 payload。
- 新手势应优先通过高层 intent 或 action label 进入系统。
- 嘴部控制要保持分层：
  1. emotion
  2. face overlay
  3. action / intent accent
  4. speech micro motion
  5. viseme / lip-sync override
- 如果新的 debug 面板需要读取 avatar 内部状态，应订阅 `devtoolsStore`，不要直接读取 viewer 内部实现。
