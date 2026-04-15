# `web/src/hooks`

## 职责

- 管浏览器端聊天状态、WebSocket 连接、历史回放、本地持久化、音频播放协调。
- 为 UI 层提供稳定 hook，不在组件里散落连接和播放逻辑。

## 不负责什么

- 不承载服务端协议设计。
- 不把 3D 展示层状态和聊天 transport 继续深度耦合。
- 不在 hook 里偷塞业务策略判断。

## 主入口文件

- `useRemiChat.ts` — 主聊天 hook
- `useRemiChatTurnState.ts` — turn lifecycle 辅助判断
- `useAudioBase64Queue.ts` — buffered 音频队列

## 关键状态 / 事件

- 连接态：`connecting` / `open` / `closed`
- 历史列表：hydrate / prepend / append
- turn lifecycle：`interrupt`、`chat_end`、播放 drain
- duplex 麦克风发送与本地播放协调

## 最常改的文件

- `useRemiChat.ts`
- `useAudioBase64Queue.ts`

## 最容易踩的坑

- 同时改消息持久化、WS 连接和播放 drain，结果很难定位回归。
- 本地缓存 key 和 token 用户隔离没对齐。
- 为展示层顺手改 hook 主状态，打坏文本/语音共用链路。

## 必须跑的测试

- `cd web && ./node_modules/.bin/mocha --require ts-node/register --require tsconfig-paths/register "test/useRemChat.turnState.test.ts"`
- `cd web && ./node_modules/.bin/mocha --require ts-node/register --require tsconfig-paths/register "test/rem3d/*.test.ts"`（如果动 avatar runtime 同步）
- `npm run typecheck`

## 禁止并行修改的热点文件

- `useRemiChat.ts`
