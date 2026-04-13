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
