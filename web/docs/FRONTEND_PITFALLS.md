# Remi 前端踩坑记录

本文记录 Next.js 一体网关、WebSocket、VRM 三维形象与布局相关的问题与结论，便于后续维护与排障。

## 1. 路由与地址栏

### `/localhost:3000/...` 无限嵌套

**现象：** 地址栏出现 `http://localhost:3000/localhost:3000/...`。

**原因：** 把 `localhost:3000/ws` 这类字符串当成**相对路径**使用（缺少 `ws://`、`http://` 或前导 `/`）。浏览器会解析成当前站点下的路径并层层叠加。

**处理：**

- `NEXT_PUBLIC_WS_URL` 必须写成 **`ws://主机:端口/ws`**（或 `wss://`）。
- `NEXT_PUBLIC_VRM_URL` 若以 `host:port/...` 形式且无前缀，需在代码里补 `http://`（见 `wsUrl.ts`、`vrmViewer.ts` 的 normalize）。
- `middleware.ts`：路径中含 `/localhost:端口` 等畸形段时 **302 回首页**，修坏书签。

## 2. 一体网关（`server/gateway`）与 Next

### `req.url` 带完整 HTTP URL

少数代理会把 `http://host/path` 整段放进 `req.url`，Next 会拼出畸形重定向。网关内用 **`normalizeIncomingUrl`** 只保留 `pathname + search`。

### `REMI_NEXT_HOSTNAME`

Next 的 `hostname` **只能是主机名**，不能写 `localhost:3000` 或整段 URL，否则内部绝对链接会错乱。代码里会解析成纯 `hostname`。

### `PORT`

监听端口与传给 Next 的 `port` 必须一致；从环境变量 `PORT` 读取，避免文档与实现不一致。

### `listen` 失败

端口占用时原先会触发未捕获异常；改为 **`server.once('error', …)`** 打日志后 **`process.exit(1)`**。

## 3. WebSocket（`useRemiChat` / `wsUrl.ts`）

- 仅跑 `npm run web:dev` 时，Next 常在 **3001**，后端在 **3000**；代码对 3001/3002 默认连 `ws://hostname:3000/ws`，或显式设置 `NEXT_PUBLIC_WS_URL`。
- 环境变量里的 WS 地址需 **`normalizeEnvWsUrl`**，避免 `host:port/ws` 被当成相对路径。

## 4. RemiChatApp 布局与顶栏

### 顶栏挡住 3D 拖拽或「裁切」脸部

**原因：** 顶栏在文档流里占高度，画布实际高度 = `100vh - 顶栏`；若再叠 `z-index`，容易挡指针或视觉上裁切角色。

**处理：**

- 顶栏改为 **`absolute`** 浮在内容上方，**不占 flex 高度**；主内容区 **`h-svh`** 铺满。
- 顶栏容器 **`pointer-events-none`**，Logo / 连接状态再设 **`pointer-events-auto`**，避免挡画布 Orbit 拖拽与滚轮缩放。
- 大屏下聊天侧栏加 **`lg:pt-14`**，避免首条消息被浮层盖住。

### 情绪与底部条占画布高度

「当前情绪」若放在 3D 列底部会挤占画布高度，腿易被「挤没」。**改为顶栏副标题**（`RemiChatApp` 内 `AI 陪伴 · 情绪`），stage 模式 **`Remi3DAvatar`** 不再渲染底部情绪条。

### 舞台容器 padding

`section` 内层曾带较大 `px/pb`，会吃掉可视区域；stage 与画布区域改为 **`p-0`** 或最小 padding。

## 5. VRM / three-vrm（`src/lib/rem3d/vrmViewer.ts`）

### `autoUpdateHumanBones: false`

必须关闭，否则每帧 normalized humanoid 会覆盖我们对 **raw 骨骼**的写入，手臂姿势无法保持。

### `VRMC_node_constraint`

**现象：** 单手长期保持模型作者绑定的「展示姿势」（如单手高举），改代码无效。

**原因：** `vrm.update()` 内 **`nodeConstraintManager.update()`** 在每帧约束目标骨骼，覆盖我们在 `applyIdlePose` 之后写入的姿势（下一帧约束先执行，再被我们覆盖——但若约束与我们的目标冲突，表现会因顺序与模型而异；**禁用约束后**手臂逻辑才稳定）。

**处理：** 加载后默认 **`nodeConstraintManager = undefined`**（不再执行约束）。若头发/饰品异常，在根目录 `.env` 设 **`NEXT_PUBLIC_VRM_DISABLE_NODE_CONSTRAINT=0`** 恢复。

### 上臂下垂算法

1. **角度上限过小：** 曾用 `π×0.48`（约 86°），从上举到下垂需要接近 180°，需提高上限（如 `π×0.96`）。
2. **叉积退化：** `vDir` 与 `vDown` 共线（竖直上举）时 **`vDir × vDown = 0`**，原逻辑直接 `return`，手臂永不旋转。需用辅助轴（如与 `world X`、`world Z` 叉乘）求旋转轴。
3. **局部 +X 不对称：** 左右上臂镜像时，用局部 **`+X` 当大臂方向** 可能一侧错误。**改为肩→肘世界向量**（UpperArm 世界位置到 LowerArm 世界位置）作为 `vDir`。
4. **`captureArmRestPose` 时机：** 须在 **`vrm.update(0)`** 之后再采样 rest，避免未初始化骨骼被当成绑定姿势。

### 取景（`frameCameraToModelUpperBody`）

- **`NEXT_PUBLIC_VRM_FRAMING=upper`：** 按约半高算距离，胸口注视，腿部多在画外。
- **全身：** 通过注视点与机位整体 **+Y**（世界坐标上移），让人物在画面里更靠下，贴近窗口底部。
- 需同步调整 **`camera.near` / `far`**。

### OrbitControls

- 开启 **平移**（右键/中键），**`contextmenu` `preventDefault`**，避免 Mac 右键菜单挡拖拽。

### 模型本身

手套手指穿模、极端抬手时肩窝拉扯等，属 **网格/权重**，需在 VRoid / DCC 修，代码只能改善姿势与取景。

## 6. 构建与依赖

- `next.config.ts` 用 **`loadEnvConfig`** 读取**仓库根** `.env`，便于 monorepo 下 `NEXT_PUBLIC_*` 只维护一份。
- `web/` 使用 **Tailwind v4**、`@import "tailwindcss"`，与根目录 workspace 并存时注意 **lockfile**（`web/package-lock.json` 或 npm workspaces 策略以仓库为准）。

## 7. 参考文件

| 主题 | 路径 |
|------|------|
| VRM 加载与待机姿势 | `web/src/lib/rem3d/vrmViewer.ts` |
| WS URL | `web/src/lib/wsUrl.ts` |
| 网关 HTTP/WS | `server/gateway/index.ts` |
| 聊天壳与顶栏 | `web/src/components/RemiChatApp.tsx` |
| 畸形路径中间件 | `web/src/middleware.ts` |

---

*随功能迭代可继续追加条目；修改行为时请同步更新根目录 `README.md` 与 `.env.example` 中的变量说明。*
