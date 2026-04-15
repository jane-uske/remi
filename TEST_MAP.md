# Test Map

这份文件只回答一件事：改某个目录后，先跑什么测试，不用猜。

## Targeted Commands

- `server/session/*`
  - `./node_modules/.bin/mocha --require ts-node/register/transpile-only "test/server/session/**/*.test.ts"`
- `server/pipeline/*`
  - `./node_modules/.bin/mocha --require ts-node/register/transpile-only "test/server/pipeline/**/*.test.ts"`
- `server/gateway/*`
  - `./node_modules/.bin/mocha --require ts-node/register/transpile-only "test/server/gateway/**/*.test.ts"`
- `brain/*`
  - `./node_modules/.bin/mocha --require ts-node/register/transpile-only "test/brain/**/*.test.ts"`
- `brains/*`
  - `./node_modules/.bin/mocha --require ts-node/register/transpile-only "test/brains/**/*.test.ts" "test/brain/route_message_memory_overlay.test.ts"`
- `memory/*`
  - `./node_modules/.bin/mocha --require ts-node/register/transpile-only "test/memory/**/*.test.ts"`
- `web/src/hooks/*`
  - `cd web && ./node_modules/.bin/mocha --require ts-node/register --require tsconfig-paths/register "test/useRemChat.turnState.test.ts"`
- `web/src/lib/rem3d/*`
  - `cd web && ./node_modules/.bin/mocha --require ts-node/register --require tsconfig-paths/register "test/rem3d/*.test.ts"`

## Always Run Before Closing

- `npm run typecheck`
- `npm test`
- `npm run test --prefix web`

## Hotspot Rule

下面这些文件不是普通文件，改之前先看对应目录 `MODULE.md`：

- `server/session/index.ts`
- `brains/slow_brain_store.ts`
- `web/src/hooks/useRemiChat.ts`
- `memory/memory_agent.ts`
