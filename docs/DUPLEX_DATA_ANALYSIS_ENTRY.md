# Duplex Data Analysis Entry

这个入口是给“专门分析数据的 agent”用的，不是产品文案。

## 1. 先从哪里进

优先跑：

```bash
npm run duplex:data-entry
```

它会输出一份 JSON manifest，告诉你：
- 最新 synthetic soak 报告在哪
- 真实浏览器数据当前从哪些日志入口取
- 应该盯哪些日志标签
- 哪些源码文件定义了 trace/report schema

## 2. 当前数据分层

### A. synthetic / 回归报告

目录：

`/Users/rare/Desktop/remi-ai/artifacts/soak`

主要文件：
- `duplex_soak_*.json`
- `duplex_soak_*.md`

重点字段：
- `latencySummary.scenarios`
- `latencySummary.warnings`
- `latencySummary.readiness`
- `latencySummary.incompleteReasons`
- `misclassificationSummary`
- `sampleRows`

适合回答：
- 3 个场景的 `p50/p95` 是多少
- trace 数是否达到最低门槛
- 当前误判主要落在哪类 taxonomy

不适合回答：
- 真实浏览器 duplex 已经稳定了吗
- 真机/真实长会话体验是否通过验收

### B. 真实浏览器 duplex 数据

当前没有独立 exporter，也没有单独落库。

现实入口还是结构化日志，优先看：
- `/Users/rare/Desktop/remi-ai/artifacts/live/dev_server_*.log`
- `/Users/rare/Desktop/remi-ai/rem-ai.log`
- `/Users/rare/Desktop/remi-ai/codex-turn-log.log`

说明：
- `artifacts/live/dev_server_*.log` 现在是开发环境默认自动落盘的 live service log，分析当前 localhost 语音链路时应优先看它
- `rem-ai.log` / `codex-turn-log.log` 更像历史兼容入口，不能默认视为当前实例

重点日志标签：
- `[Latency]`
- `[TurnTaking]`
- `[TurnState]`
- `[TurnTiming]`

## 3. 场景口径

只看这 3 个场景，不要自己扩口径：
- `voice_roundtrip_baseline`
- `speech_resume_before_gap_commit`
- `interrupt_then_new_turn`

## 4. 误判 taxonomy

只按这 6 类归类：
- `false_early_release`
- `false_late_release`
- `noise_promotion`
- `resume_missed`
- `interrupt_missed`
- `state_stuck_or_duplicate`

## 5. 关键 schema 定义

如果要理解字段来源，直接看：
- [scripts/duplex_soak_report.ts](/Users/rare/Desktop/remi-ai/scripts/duplex_soak_report.ts)
- [infra/latency_tracer.ts](/Users/rare/Desktop/remi-ai/infra/latency_tracer.ts)
- [server/session/index.ts](/Users/rare/Desktop/remi-ai/server/session/index.ts)
- [server/session/voice_submit.ts](/Users/rare/Desktop/remi-ai/server/session/voice_submit.ts)
- [server/session/text_chat.ts](/Users/rare/Desktop/remi-ai/server/session/text_chat.ts)

## 6. 建议查询

看最新 synthetic 报告：

```bash
npm run duplex:data-entry
```

从日志拉真实浏览器 trace：

```bash
rg -n "\[Latency\]|\[TurnTaking\]|\[TurnState\]|\[TurnTiming\]" artifacts/live/dev_server_*.log rem-ai.log codex-turn-log.log
```

查误判关键词：

```bash
rg -n "false_early_release|resume_missed|interrupt_missed|state_stuck_or_duplicate" artifacts/soak/*.md artifacts/soak/*.json
```

## 7. 结论约束

分析时必须坚持：
- `synthetic_harness` 只算回归证据，不算真实浏览器验收
- 如果 `latencySummary.readiness=incomplete`，结论必须写“未收完”
- 如果主要问题落在 `stt_final_to_llm_first` 或 `llm_first_to_tts_first`，优先归因模型/runtime，不要默认怪 turn-taking

## 8. 后续待补

当前还缺一个真正可交给数据分析 agent 直接消费的自动化出口：
- 从真实浏览器日志提取 duplex trace
- 聚合成独立 latency report
- 产出可复核的 misclassification sample review 表

现在的现实状态是：
- synthetic 回归报告已经有独立产物
- 真实浏览器证据仍主要停留在日志层
- 后续如果要做“修复后自动验收”，这一块必须补上
