# `server/session`

## 职责

- 管每条 WebSocket 连接的会话生命周期。
- 负责 turn-taking、interrupt、partial/final transcript、实时状态推进。
- 承接连接 bootstrap、history hydrate、duplex 音频控制、session 级回退逻辑。

## 不负责什么

- 不直接承载 slow brain 策略实现。
- 不为单一平台写死协议分支。
- 不把阻塞性 memory/LLM 工作塞进 fast path。

## 主入口文件

- `index.ts` — 连接主状态机与 orchestration
- `bootstrap.ts` — async session bootstrap / identity-normalized history hydrate
- `message_router.ts` — WS raw message dispatch / audio binary parsing
- `continuity.ts` — silence nudge / continuity persistence / VAD silence threshold sync
- `voice_submit.ts` — voice STT final -> pipeline submit wiring
- `turn_state_protocol.ts` — turn_state publish + timing snapshot logging
- `turn_taking.ts` — 句末判断与阶段推进
- `turn_timing.ts` — turn 时间预算
- `interruption.ts` — interruption 分类
- `developer.ts` — dev preset/reset command helpers
- `duplex_audio.ts` — duplex raw-buffer / capped chunk helpers / no-vad fallback utilities

## 关键状态 / 事件

- turn 状态：`hold` / `likely_end` / `confirmed_end`
- interruption：文本抢占、语音打断、预测预判
- duplex：`duplex_start` / `duplex_stop`
- 生命周期：`interrupt`、`chat_end`、播放 drain 对齐

## 最常改的文件

- `index.ts`
- `continuity.ts`
- `voice_submit.ts`
- `turn_taking.ts`
- `interruption.ts`

## 最容易踩的坑

- 把 slow path 逻辑塞回 `index.ts` 主循环，直接拖慢 fast path。
- 在 helper runtime 里缓存一次性状态快照，后续定时器继续复用，导致 `pipelineChain` / timer / recent activity 读到旧值。
- 改 turn 状态推进时只看文本 happy path，漏掉语音和 interrupt。
- 改 bootstrap/auth/history restore 时只修线上入口，打坏本地调试或 harness。

## 必须跑的测试

- `./node_modules/.bin/mocha --require ts-node/register/transpile-only "test/server/session/**/*.test.ts"`
- `./node_modules/.bin/mocha --require ts-node/register/transpile-only "test/server/pipeline/**/*.test.ts"`（如果会话改动触达 pipeline 触发边界）
- `npm run typecheck`

## 禁止并行修改的热点文件

- `index.ts`
