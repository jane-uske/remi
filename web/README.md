# Remi Web（Next.js 15）

与仓库根目录 **一体启动** 时，由 `server/gateway` 托管本应用（默认 `http://localhost:3000`）。仅前端开发时在仓库根目录执行：

```bash
npm run web:dev
```

或在 `web/` 目录下执行 `npm run dev`。

根目录 `.env` 中的 `NEXT_PUBLIC_*` 会被 `next.config.ts` 的 `loadEnvConfig` 加载，不必复制到 `web/.env`。

如果页面要从其他设备访问，不要把 `NEXT_PUBLIC_WS_URL` 写成 `ws://localhost:3000/ws` 或 `ws://127.0.0.1:3000/ws`。这会让远端浏览器去连“它自己的本机”，表现为页面能打开，但一直停在“正在连接服务器…”。

## 文档

| 文档 | 说明 |
|------|------|
| [docs/FRONTEND_PITFALLS.md](./docs/FRONTEND_PITFALLS.md) | 网关、WebSocket、VRM、布局等踩坑与处理方式 |
| [VIBE_PLAN.md](./VIBE_PLAN.md) | 前端迭代计划（连接态、情绪 UI 等） |
| [docs/REM_3D_TALKING_ARCHITECTURE.md](./docs/REM_3D_TALKING_ARCHITECTURE.md) | 3D 说话层接线与运行时架构 |
| [docs/REM_3D_TALKING_INTEGRATION_GUIDE.md](./docs/REM_3D_TALKING_INTEGRATION_GUIDE.md) | 3D 说话层接入与联调说明 |
| [docs/REM_3D_TALKING_ACCEPTANCE_2026-04-05.md](./docs/REM_3D_TALKING_ACCEPTANCE_2026-04-05.md) | 3D 说话线程验收记录 |

## 技术栈摘要

Next.js 15、React 19、Tailwind CSS v4、`@pixiv/three-vrm` + Three.js（VRM 形象）。

更多见仓库根目录 [README.md](../README.md)。

## Demo

- 主聊天页：`/`
- 独立 3D demo：`/demo`

主聊天页顶部现在会显示当前身份与连接目标：

- `default-user` / `token-user`：当前是否为默认开发用户
- `uid: ...`：当前前端按哪个 user id 分桶本地缓存与历史记录
- `ws: ...`：当前页面实际连接的 WebSocket 目标，排查远端设备连错 `localhost` 时优先看这里

## 参考（Next.js 官方）

- [Next.js 文档](https://nextjs.org/docs)
- [部署](https://nextjs.org/docs/app/building-your-application/deploying)
