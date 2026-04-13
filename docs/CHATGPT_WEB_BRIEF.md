# Remi AI — 网页版 ChatGPT 用项目简报

> **怎么用**：在 **ChatGPT 网页版** 开一个新对话，把**从下一行「---」到文末**整段复制粘贴进去，作为本仓库的固定上下文。更新本文件后重新粘贴即可同步进展。
>
> 仓库内路径：本文件位于 `**docs/CHATGPT_WEB_BRIEF.md`**；其余说明文档均在 `**docs/`** 目录（根目录仅保留各 `README.md`）。

---

## 1. 产品一句话

**Remi AI** 是一套自托管的**实时 AI 陪伴**系统：多轮对话、会话内记忆与情绪、语音输入输出、WebSocket 全双工；前端为 **Next.js**，形象为 **VRM 三维角色**（Three.js），后端为 **Node + Express**，管线内含快慢脑 LLM、STT/TTS、VAD、打断控制等。

---

## 2. 当前架构（分层）


| 层级          | 路径 / 技术                                 | 职责摘要                                                                                                                      |
| ----------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **客户端**     | `web/`（Next.js 15、React 19、Tailwind v4） | `RemiChatApp`、聊天窗、输入栏、`useRemiChat`（WebSocket）、`useAudioBase64Queue`（TTS PCM）、`Remi3DAvatar` + `lib/rem3d/vrmViewer.ts`（VRM） |
| **网关**      | `server/gateway/`                       | HTTP 服务 + 集成 Next；`ws` **noServer** 模式，`/ws` 升级；请求 URL 规范化；`PORT`、`REMI_NEXT_HOSTNAME` 与 Next 一致；HTTP 限流；可选 JWT            |
| **会话**      | `server/session/`                       | 每连接 `ConnectionSession`：消息路由、STT/VAD、与 `server/pipeline` 编排                                                               |
| **管线**      | `server/pipeline/`                      | `runPipeline()`：情绪、记忆、快慢脑、流式回复、断句、TTS、下行消息                                                                                |
| **大脑**      | `brains/`、`brain/`、`llm/`               | 双脑路由、Prompt 组装、OpenAI 兼容流式客户端                                                                                             |
| **语音**      | `voice/`                                | STT 流、TTS 多后端、VAD、打断、情绪语调映射                                                                                               |
| **记忆**      | `memory/`、`storage/`                    | 提取与衰减；可选 PostgreSQL + pgvector、Redis                                                                                      |
| **形象（协议层）** | `avatar/`                               | Avatar 驱动类型、情绪映射、控制器（与 3D 口型细调可并行）                                                                                        |


数据流概要：**浏览器 ↔ WebSocket (`/ws`) ↔ Session ↔ Pipeline ↔ LLM/TTS/STT**；情绪经 WS 推送前端，驱动 UI 与 VRM Expression。

更细的框图与模块说明见同目录 `**docs/ARCHITECTURE.md`**（仓库内）。

---

## 3. 技术栈（简表）

- **运行时**：Node.js、TypeScript  
- **HTTP / WS**：Express、`ws`  
- **前端**：Next.js 15、React 19、Tailwind CSS v4、`@pixiv/three-vrm`、three.js  
- **LLM**：OpenAI 兼容 HTTP（本地 LM Studio、云端等）  
- **存储（可选）**：PostgreSQL + pgvector、Redis  
- **日志**：pino；**部署**：Docker / Compose

---

## 4. 项目进展（相对 README 阶段表）


| 领域                          | 状态    | 说明                                       |
| --------------------------- | ----- | ---------------------------------------- |
| 流式对话、双脑、WebSocket、打断        | ✅ 已完成 | 主管线在 `gateway` / `session` / `pipeline`  |
| 情绪识别与下行 `emotion`           | ✅ 已完成 | 前端展示 + VRM 表情预设映射                        |
| STT / VAD / 全双工 PCM、TTS 多后端 | ✅ 已完成 | 见 `voice/`                               |
| 记忆提取与衰减、可选 PG 持久化与向量检索      | ✅ 已完成 | 依赖 `DATABASE_URL` 等                      |
| Next.js 聊天 UI               | ✅ 已完成 | 含连接态、气泡、响应式输入区                           |
| VRM 3D 形象 MVP               | ✅ 已完成 | 加载、情绪表情、待机骨骼、取景、Orbit；口型细调与 viseme 仍为规划项 |
| 口型与音素级同步（P3）                | ❌ 未做  | 需音素或更强驱动协议                               |
| JWT、限流、日志、Docker            | ✅ 已完成 | 可增强 HTTP 限流                              |


前端迭代细项与 Phase A–D 见 `**docs/VIBE_PLAN.md`**；工程向优化清单见 `**docs/OPTIMIZATION.md`**。

---

## 5. 前端与一体部署要点

- **一体启动**：仓库根目录 `npm run dev` → 网关同时托管 API 与 Next（默认端口见 `PORT`，常为 3000）。  
- **仅前端**：`npm run web:dev`，WebSocket 常需 `NEXT_PUBLIC_WS_URL=ws://127.0.0.1:3000/ws` 或依赖 `wsUrl.ts` 对 3001/3002 的默认指向。  
- **环境变量**：根目录 `.env` 中 `NEXT_PUBLIC_`* 由 `web/next.config.ts` 的 `loadEnvConfig` 注入前端构建。  
- **踩坑合集**：`**docs/FRONTEND_PITFALLS.md`**（畸形 URL、VRM 手臂与 node constraint、顶栏与画布等）。

---

## 6. 文档与代码「指路」索引（在仓库里查）


| 需求          | 优先读                                                               |
| ----------- | ----------------------------------------------------------------- |
| 整体数据流与模块边界  | `docs/ARCHITECTURE.md`                                            |
| 管线与时序       | `docs/PIPELINE.md`                                                |
| 前端协议与组件     | `web/src/hooks/useRemiChat.ts`、`web/src/components/RemiChatApp.tsx` |
| VRM 与 Three | `web/src/lib/rem3d/vrmViewer.ts`、`emotionToVrm.ts`                |
| 网关与 WS      | `server/gateway/index.ts`                                         |
| 环境变量全表      | 根目录 `README.md` 表格、`.env.example`                                 |
| 已知前端坑       | `docs/FRONTEND_PITFALLS.md`                                       |


---

## 7. 修订记录


| 日期         | 说明                                     |
| ---------- | -------------------------------------- |
| 2026-04-04 | 首版：进展表 + 架构摘要 + 文档索引                   |
| 2026-04-04 | 文档统一迁入 `docs/`；本文件改名为网页版 ChatGPT 粘贴用简报 |


---

*一句话：Remi AI 是带记忆与情绪的实时陪伴后端 + Next/VRM 前端，WebSocket 全双工，快慢脑与语音管线已落地，3D 口型级同步仍为后续工作。*
