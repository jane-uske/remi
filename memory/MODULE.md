# `memory`

## 职责

- 管记忆提取、prompt memory 召回、episode store 编排、session overlay。
- 负责 memory read/write 的模块边界，不负责会话 transport。

## 不负责什么

- 不直接驱动实时 turn-taking。
- 不把记忆召回逻辑写死进 WebSocket / pipeline 主循环。
- 不替代 `brains/*` 的 relationship orchestration。

## 主入口文件

- `memory_agent.ts` — prompt-facing recall 与兼容提取逻辑
- `episode_store.ts` — V2 episode ingest / retrieve
- `session_memory_overlay.ts` — 会话级本地副本
- `memory_repository.ts` — 记忆仓储接口
- `relationship_state.ts` — 关系状态保留字段

## 关键状态 / 事件

- prompt memory entries
- episode recall：`core` / `active`
- session overlay preload / async writeback
- system memory keys 过滤

## 最常改的文件

- `memory_agent.ts`
- `episode_store.ts`
- `session_memory_overlay.ts`

## 最容易踩的坑

- 让 prompt memory 回忆过量，拖慢 fast path。
- 同时改 V1 fallback 和 V2 recall，却没有明确回退边界。
- 混淆 `memory/memory_repository.ts` 和 `storage/repositories/memory_repository.ts`。

## 必须跑的测试

- `./node_modules/.bin/mocha --require ts-node/register/transpile-only "test/memory/**/*.test.ts"`
- `./node_modules/.bin/mocha --require ts-node/register/transpile-only "test/brain/route_message_memory_overlay.test.ts"`（如果改 prompt 注入行为）
- `npm run typecheck`

## 禁止并行修改的热点文件

- `memory_agent.ts`
