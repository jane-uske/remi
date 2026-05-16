# `brains`

## 职责

- 承担 fast brain / slow brain orchestration。
- 管会话级关系状态、priority context、proactive planner、slow brain snapshot 派生。
- 连接 `brain/*` 的规则层与 `server/session/*` 的实时会话层。

## 不负责什么

- 不直接处理 WebSocket 细节或前端事件协议。
- 不把 prompt 规则和 tone/interpreter 细节继续堆进 runtime store。
- 不替代 `memory/*` 的独立记忆编排职责。

## 主入口文件

- `context_orchestrator.ts` — 主路由与快慢脑调度
- `reply_stream.ts` — 低延迟回复路径
- `background_analysis.ts` — 后台分析与写回
- `background_analysis_store.ts` — relationship / proactive / snapshot 派生
- `remi_session_context.ts` — 连接级上下文
- `proactive_planner.ts` — 主动策略

## 关键状态 / 事件

- `priorityContext`
- `SlowBrainSnapshot`
- relationship stage / preferred topics / shared moments
- proactive mode / silence nudge 计划

## 最常改的文件

- `context_orchestrator.ts`
- `background_analysis_store.ts`
- `reply_stream.ts`

## 最容易踩的坑

- 在 `background_analysis_store.ts` 里继续累加策略，导致它变成万能文件。
- 动 `priorityContext` 时只看 prompt 字符数，不看关系连续性回退。
- 把 `brain/*` 和 `brains/*` 的职责混在一起。

## 必须跑的测试

- `./node_modules/.bin/mocha --require ts-node/register/transpile-only "test/brains/**/*.test.ts" "test/brain/route_message_memory_overlay.test.ts"`
- `./node_modules/.bin/mocha --require ts-node/register/transpile-only "test/brain/**/*.test.ts"`（如果改了 prompt / policy 边界）
- `npm run typecheck`

## 禁止并行修改的热点文件

- `background_analysis_store.ts`
- `context_orchestrator.ts`
