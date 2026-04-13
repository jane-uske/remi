# Web 前端 vibe 计划

面向「边写边爽、快速迭代」的路线图，和 `docs/TASKS.md`（T-035.4 / T-035.5 / T-040）对齐。

## 当前栈（别推翻）


| 项   | 版本/选择                                                   |
| --- | ------------------------------------------------------- |
| 框架  | Next.js 15 App Router                                   |
| UI  | React 19 + Tailwind CSS v4                              |
| 实时  | WebSocket（`useRemiChat`）                                 |
| 脚本  | `npm run dev` / `npm run build`；根目录 `npm run typecheck` |


## 原则

1. **先行为、后架构**：能在一个 hook/组件里搞定就别先抽象全局 store。
2. **动效**：优先 CSS（含 `prefers-reduced-motion`），复杂再上 Motion 类库。
3. **协议**：继续消费现有 `type`（`chat_chunk`、`emotion`、`voice`、`interrupt` 等）；等后端出结构化情绪再扩类型（T-040）。
4. **形象**：聊天 DOM 与「画布形象」分层，避免整页跟着 WebGL 重绘。

---

## Phase A · 连接与情绪可见（≈ TASKS **T-035.4**）

**目标**：用户一眼能看懂「连着吗 / 在不在想 / 当前情绪 / 是否被打断」。


| 优先级 | 事项                                      | 落点提示                            |
| --- | --------------------------------------- | ------------------------------- |
| P0  | 连接态：连接中 / 已连接 / 断线重连提示                  | `useRemiChat` + 顶栏或 `ChatWindow` |
| P0  | 情绪：与 WS `emotion` 同步，UI 有稳定展示（色点/标签/小条） | `ChatWindow` / 新 `EmotionBadge` |


**已做（一次并行迭代）：** `connectionPhase` + `reconnectInSec` + 顶栏色点/文案 + `aria-live`；`Avatar` 情绪中文标签（`lib/emotionLabels.ts`）；`MessageBubble` emoji 字体栈与无障碍；`ChatWindow` `role="log"` + 流式/思考播报策略。
| P1 | 打断：`interrupt` 时 TTS/文案反馈可感知 | 已有队列，补轻提示即可 |
| P1 | 思考态：首 token 前「Remi 在想…」已部分有，统一文案与出现条件 | `ChatWindow`、`globals.css` |

**完成标准**：断网能看懂；一轮对话里情绪变化能看见（不要求 3D）。

---

## Phase B · 消息与气泡（≈ TASKS **T-035.5**）

**目标**：读起来舒服，emoji 与朗读策略一致（展示保留、TTS 由服务端剥）。


| 优先级 | 事项                                 | 落点提示                      |
| --- | ---------------------------------- | ------------------------- |
| P0  | 气泡：用户 / Remi 区分清晰，长消息可读性（行高、宽度）     | `MessageBubble`           |
| P0  | Emoji：原样显示，不破坏布局（字体 fallback）      | 全局 `font-family` / bubble |
| P1  | 代码块 / 列表：若模型常输出，再做轻量 markdown 或等宽块 | 按需                        |
| P2  | 括号舞台说明：是否与 TTS strip 对齐，单独规则（可选）   | 文档 + 组件注释                 |


---

## Phase C · 客户端状态（可选，觉得 prop drilling 烦再上）

**目标**：少一层 `useState` 地狱。


| 选择          | 何时加                            |
| ----------- | ------------------------------ |
| **Zustand** | 会话 UI 状态变多（连接、打断、当前轮次、UI flag） |
| **Jotai**   | 更喜欢原子化、细粒度订阅                   |


建议：**Phase A 收尾后再加**，避免空壳 store。

---

## Phase D · 3D 形象（MVP ✅）

**目标**：对话时可见基础 3D 表情 + 肢体摆动。


| 状态  | 事项                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------ |
| ✅   | `Remi3DAvatar` + `three` + `@pixiv/three-vrm`：默认加载 [VRM1 官方示例](https://github.com/pixiv/three-vrm)（`NEXT_PUBLIC_VRM_URL` 可换自有 `.vrm`） |
| ✅   | 情绪 → VRM Expression 预设（`web/src/lib/rem3d/emotionToVrm.ts`）；脊柱/头/手臂随情绪轻摆（`vrmViewer.ts`）                                             |
| 后续  | 口型 viseme、服务端 `avatar_frame` 细调 blend → **T-032 / T-040**                                                                            |


---

## 目录速查（改代码从这里摸）

```
web/src/
├── app/           # layout、globals.css
├── components/    # ChatWindow、RemiChatApp、InputBar、MessageBubble…
├── hooks/         # useRemiChat、useAudioBase64Queue、pcmCapture
└── lib/           # 工具、可放 ws 类型封装
```

---

## 命令

```bash
cd web && npm run dev
# 类型检查在仓库根目录
cd .. && npm run typecheck
```

---

## 和主线任务对应


| 仓库任务                 | 本计划阶段          |
| -------------------- | -------------- |
| T-035.4 前端情绪控制       | Phase A        |
| T-035.5 emoji 与展示    | Phase B        |
| T-040 多维情绪 + 2.5D/3D | Phase D + 后续协议 |


---

## Vibe 顺序建议（一条线下来的爽法）

1. Phase A 的 **连接态 + 情绪条**（半天～一天能玩起来）
2. Phase B **气泡 + emoji**（视觉立刻变「产品」）
3. 烦了再 **Zustand**（Phase C）
4. **AvatarStage** 占位 + 静态表情映射（Phase D）

改完可在本文件各 Phase 自己打勾 ☑，或拆成 issue / PR 标题对齐。