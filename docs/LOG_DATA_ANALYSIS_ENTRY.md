# Log Data Analysis Entry

这个入口给“读日常日志 / 查运行问题 / 做初步 triage 的 agent”用。

## 1. 先从哪里进

优先跑：

```bash
npm run logs:data-entry
```

它会输出一份 JSON manifest，告诉你：
- 当前应该先看哪些日志文件
- 哪些标签是高信号
- 哪些源码文件定义了日志来源
- 推荐的查询命令和 triage 顺序

## 2. 适用场景

以下请求默认先走这个入口：
- “看看最近日志”
- “分析当前运行问题”
- “读一下日常日志”
- “查为什么今天服务不稳定”
- “先做日志 triage”

如果问题明确是语音延迟 / duplex / turn-taking，再在第一轮日志扫描后切到：

```bash
npm run duplex:data-entry
```

## 3. 主日志入口

优先看：
- `/Users/rare/Desktop/remi-ai/artifacts/live/dev_server_*.log`
- `/Users/rare/Desktop/remi-ai/rem-ai.log`
- `/Users/rare/Desktop/remi-ai/codex-turn-log.log`

说明：
- `artifacts/live/dev_server_*.log` 现在是开发环境默认自动落盘的 live service log，优先级高于老的 `rem-ai.log`
- `rem-ai.log` / `codex-turn-log.log` 仍然可能存在，但很多情况下已经不是当前正在跑的那条 localhost 实例

次级历史日志：
- `codex-stage1.log`
- `codex-stage2.log`
- `codex-stage2b.log`
- `rem-ai-restart.log`
- `rem-ai-service-fix.log`
- `rem-ai-tts-fix.log`
- `rem-ai-whitescreen-fix.log`

## 4. 高信号标签

先盯这些：
- `[Latency]`
- `[TurnTaking]`
- `[TurnState]`
- `[TurnTiming]`
- `[Duplex]`
- `[DuplexRx]`
- `[VAD]`
- `[STT]`
- `[pipeline]`
- `[session]`

## 5. 推荐 triage 顺序

1. 先看当前主线程和任务文档，确认是不是 Memory V2 / voice / session 敏感区。
2. 先扫主日志和高信号标签，不要一上来翻 archive。
3. 如果问题是语音延迟、duplex、turn-taking，再切到 `npm run duplex:data-entry`。
4. synthetic 报告只能当回归证据，不能当真实浏览器验收。

## 6. 建议查询

入口：

```bash
npm run logs:data-entry
```

高信号日志扫描：

```bash
rg -n "\[Latency\]|\[TurnTaking\]|\[TurnState\]|\[TurnTiming\]|\[Duplex\]|\[VAD\]|\[STT\]" artifacts/live/dev_server_*.log rem-ai.log codex-turn-log.log
```

看最近日志尾部：

```bash
tail -n 200 artifacts/live/dev_server_*.log
tail -n 200 rem-ai.log
```

语音延迟专项：

```bash
npm run duplex:data-entry
```

## 7. 对分析 agent 的约束

- 不要只看一条报错就下结论，要结合 session / pipeline / latency trace。
- 不要把历史修复日志当成当前状态。
- 如果证据只来自 synthetic soak 或旧日志，必须明确写“不是当前真实浏览器验收证据”。
