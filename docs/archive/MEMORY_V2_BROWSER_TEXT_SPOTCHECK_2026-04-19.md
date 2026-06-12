# Remi Memory V2 浏览器文本 workingMemory spot-check 记录

## 基本信息

- 验收日期：2026-04-19
- 验收范围：Web 默认文本链路里的 `workingMemory` prompt 注入与 reconnect 承接
- 验收入口：本地开发 `http://127.0.0.1:3001`
- 前提：服务进程显式带 `REMI_WORKING_MEMORY_ENABLED=1`
- 证据日志：`artifacts/live/dev_server_20260419_025030.log`

## 这轮为什么要重做

`2026-04-17` 那轮浏览器文本 spot-check 本身是正向的，但它没有真正覆盖 `workingMemory`。

这次重做的直接原因是：

- 之前看到的 `currentContextChars = 0`，后来确认是因为当时 `3001` 上跑的是一个旧进程，实际并没有带 `REMI_WORKING_MEMORY_ENABLED=1`
- 所以前一轮对“workingMemory 是否失效”的判断前提不成立，不能拿来下结论

## 验收目标

- 确认 `【当前上下文】` 已经真的进到 Web 默认文本主链路
- 确认“现实约束更新”时 workingMemory 会继续带入 prompt
- 确认 reload / reconnect 后，workingMemory 仍能承接当前这几轮在处理什么

## 验收结果摘要

- 总体结论：通过
- `workingMemory` prompt 注入：通过
- 现实约束更新后的继续承接：通过
- reload / reconnect 后继续追问：通过
- 结论边界：这只是 browser text 单路径验收，不是 full browser 回归，更不是语音 / duplex 验收

## 执行记录

### 1. 决策题进入 `workingMemory`

测试输入：

1. `我到底该不该先把花呗还了，我还欠两万五。`

结果：

- 真实浏览器文本链路里，`LLM prompt stats.currentContextChars = 109`
- 说明 `【当前上下文】` 已经注入 prompt，而不是只存在于代码路径或单测里

产品判断：

- 这证明 `workingMemory` 至少在决策题单路径里已经真的被 Web 默认文本链路消费

### 2. 新约束进入后继续承接

测试输入：

1. `我这周又拿到一个钱少一点但稳定很多的 offer，你会重新怎么判断？`

结果：

- 真实日志里 `currentContextChars = 116`
- 回复内容也围绕“稳定 offer + 还债 + 现金流”重算，而不是把上一轮判断当成静态结论复读

产品判断：

- 这说明 `workingMemory` 不只是“第一次能进 prompt”，而是能在约束更新后继续带入当前上下文

### 3. reload / reconnect 后继续追问

操作：

1. 浏览器 reload
2. 重新建立默认 Web 连接
3. 输入：`那你的核心判断还是先别裸辞、先处理这笔债，对吗？`

结果：

- 新连接下的日志里：
  - `historyChars = 0`
  - `memoryChars = 0`
  - `currentContextChars = 113`
- 这说明这次承接不是靠同一页还挂着的历史 prompt，也不是靠 episode recall 在兜底，而是显式 `workingMemory` 继续在起作用

产品判断：

- 这轮已经能证明 `workingMemory` 的 reconnect-only 恢复路径在 Web 默认文本链路里成立

## 最终判断

这轮可以给出一个明确结论：

- **Web 默认文本链路里的 `workingMemory` prompt 注入和 reconnect 承接已经验收通过。**

但必须同时保留两个边界：

1. 这只是 browser text 单路径验收，不等于 full browser regression
2. 它不能替代 Memory V2 的长期真实样本观察，也不能替代语音 / duplex 验收

## 下一步建议

1. 不要再继续围绕这个 spot-check 扩张前端或 prompt 清理；这条链路已经够过线
2. 现在更值得做的是 `embedding` 运行时健康门槛，而不是继续追一个已经确认成立的 `workingMemory` 注入点
3. 浏览器 duplex / runtime 仍值得继续观察，但那已经不是这轮 `workingMemory` browser text spot-check 的阻塞
