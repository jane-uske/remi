# CLAUDE.md

这个文件给 Claude Code 提供最小工作入口，避免重复阅读大量背景文档。

## 先读什么

1. [AGENTS.md](AGENTS.md)
   - 北极星
   - 当前主线程
   - 代码改动边界
2. [CURRENT_FOCUS.md](CURRENT_FOCUS.md)
   - 当前正在推进的任务
   - 当前什么不该优先做
3. [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md)
   - 完整产品语境
   - 为什么 Rem 不是普通聊天机器人
4. [ARCHITECTURE.md](ARCHITECTURE.md) / [PIPELINE.md](PIPELINE.md)
   - 系统结构与实时链路

## 你需要先知道的事

- Rem 的目标不是做一个更会答题的助手，而是做“存在感系统”
- 当前主线程是 `Memory V2 验证 + 读路径迁移（V2.1）`
- 实时交互质量优先于堆功能
- 人格连续性优先于单轮回答漂亮
- 未来会支持 plugin / capability 扩展，但现在不要把具体平台硬耦进核心链路

## 常用命令

```bash
npm install
npm install --prefix web
./scripts/start-dev-stack.sh
npm run dev:native
npm run web:dev
npm run typecheck
npm test
npm run test --prefix web
node scripts/smoke.mjs
```

## 最重要的代码边界

- `server/session/*`：连接态、turn-taking、interrupt、会话语义
- `server/pipeline/*`：实时执行主链路
- `brains/*`：快脑 / 慢脑 / 关系与策略编排
- `memory/*`：记忆与关系状态
- `voice/*`：STT / TTS / VAD / interrupt

改这些目录时：
- 先看当前主线程
- 保持状态边界清楚
- 不要把慢逻辑塞进快路径
- 不要为单一平台接入污染核心架构
