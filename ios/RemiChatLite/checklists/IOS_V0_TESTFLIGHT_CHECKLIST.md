# RemiChatLite v0 TestFlight Checklist

当前范围：本清单只覆盖 iOS v0 文本基础闭环，不把实验性 duplex 语音能力算进本轮 done。

已知阻塞：
- iOS 前端已切到实验性 duplex voice toggle，但还没有真机验收通过
- 因此当前 TestFlight 目标仍是先验证文本、连接、鉴权、缓存隔离和重连
- 语音问题应单独跟踪，不要在本清单里误判为“顺手一起验掉”

## A. 环境准备（发布前）

- [ ] 后端可从公网访问：`wss://<domain>/ws`
- [ ] `JWT_SECRET` 已配置（推荐）
- [ ] 若走 dev key 兜底：
  - [ ] `REMI_MOBILE_DEV_ENABLED=1`
  - [ ] `REMI_MOBILE_DEV_KEY` 已配置
- [ ] iOS Scheme 环境变量已设置：
  - [ ] `REMI_IOS_WS_URL`
  - [ ] `REMI_IOS_JWT`（JWT 模式）
  - [ ] `REMI_IOS_MOBILE_DEV_KEY`（dev key 模式）

## B. 真机基础链路验收

- [ ] App 启动后 5 秒内状态进入 `Connected`
- [ ] 连续发送 10 条文本消息，无崩溃
- [ ] 流式回复可持续更新，`chat_end` 后文本收束
- [ ] 发送文本后，在首个回复 chunk 前有可见 assistant loading 占位
- [ ] 错误态可见（网络断开/401）
- [ ] 网络恢复后自动重连成功
- [ ] 滑到历史顶部时会自动加载更早消息，且不会被强制拉回底部
- [ ] prepend 老历史后，当前阅读位置不出现明显跳动或丢锚
- [ ] 长按消息文本可弹出 iOS 原生菜单（复制/翻译等）

## C. 多用户隔离（同设备切换）

- [ ] 用 `user_001` token 聊天 5 轮并退出
- [ ] 切换 `user_002` token 再聊天 5 轮
- [ ] 回切 `user_001` 时只看到 `user_001` 历史，不出现 `user_002` 文本
- [ ] 回切 `user_002` 时同理

## D. TestFlight 内测发布

- [ ] Archive 成功
- [ ] 上传 TestFlight 成功
- [ ] 添加 5 位内测用户
- [ ] 收集 48 小时反馈（连接成功率、错序、串号）

## E. 退出标准（本轮 Done）

- [ ] 5 位内测用户都能完成“发送-接收-重连”闭环
- [ ] 未出现跨用户历史串号
- [ ] 无 P0 崩溃

## F. 暂不纳入本轮 Done

- [ ] duplex voice toggle 下出现实时/最终转写
- [ ] duplex voice toggle 下触发 assistant 回复或 TTS
- [ ] iOS 语音链路稳定性验收
