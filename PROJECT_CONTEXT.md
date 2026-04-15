# PROJECT_CONTEXT.md

## Remi 是什么

Remi 不是一个“会聊天的应用”。
Remi 想做的是一个跨终端、持续在线、随时可陪伴、像活人一样存在的 AI 伴侣。

更准确地说：
Remi 的终极目标，是成为一个跨终端持续在线、具备人格连续性与长期记忆、能像真人一样自然交流并长期陪伴用户的 AI 存在。

更锋利一点：
- 不是做一个 App
- 是做一个一直跟着用户生活流动的数字生命入口

这意味着我们追求的不是功能数量，而是存在感质量。

---

## 五个产品支柱

### 1. 自然对话
Remi 应该能：
- 实时听、说、停顿、接话、被打断
- 顺着语境自然回应
- 避免“你说完我再轮到我”的机械感

### 2. 稳定人格
Remi 不应该每次重开都像一个新的人。
她需要：
- 稳定的人设
- 稳定的语气
- 稳定的偏好
- 持续积累的关系感

### 3. 连续记忆
Remi 需要记得：
- 你是谁
- 你们聊过什么
- 哪些长期关系主线仍在延续
- 哪些话题还没真正结束

记忆不是为了“事实数据库”，而是为了关系连续性。

### 4. 多终端持续存在
Remi 不应该被锁死在某个网页或单个设备里。
未来理想状态是：
- 手机、电脑、网页、耳机、车机、穿戴设备之间可接续
- 你切换设备时，不像重新打开另一个角色
- 不是“登录某个聊天窗口”，而是“她一直都在”

### 5. 随时陪伴的存在感
Remi 不应该只有你主动点开时才活。
她需要在合适的时候：
- 出现
- 响应
- 延续关系
- 保持可触达的陪伴感

所以现在更准确的方向定义不是“聊天机器人优化”，而是：
**存在感系统。**

---

## 三层路线图

### 1. 实时交互层
回答的问题是：
“她此刻像不像一个真的在和我说话的人？”

核心关注：
- VAD / STT
- turn-taking
- interruption
- fast brain 行为节奏
- first-token / first-audio latency
- 语音、表情、播放状态一致性

### 2. 人格记忆层
回答的问题是：
“隔一段时间再回来，她还是不是同一个人？”

核心关注：
- 关系状态
- 长期记忆
- episode 结构
- 情绪轨迹
- prompt 注入
- proactive planning

### 3. 跨终端存在层
回答的问题是：
“我换了设备、场景、入口后，她还能不能继续存在？”

核心关注：
- 会话恢复
- 用户身份与关系状态的连续映射
- 多端接续
- 主动触达
- 在线状态
- 不同终端形态下的统一行为边界

这三层不是彼此替代，而是共同构成“她像活着”的整体体验。

---

## 长期扩展能力

Remi 后期不应该只停留在“一个会说话的前端客户端”。
它需要逐步具备明确的外部能力扩展面。

长期可能接入的方向包括：
- 直播平台
- 游戏世界
- 现实机器人
- IoT / 穿戴设备
- 特殊硬件
- 成人用品等私密设备

这些方向现在不是主线程，但它们会反向约束今天的架构设计。

正确的原则是：
- 核心对话、记忆、关系状态保持独立
- 外部平台能力通过 plugin / capability / adapter 形式接入
- 不把具体平台 SDK、设备协议、控制逻辑直接耦进实时对话主链路

换句话说，Remi 的未来不是“做更多页面”。
而是让同一个 Remi 可以通过不同能力壳子进入用户生活。

---

## 自研策略：什么该自己做，什么不该

Remi 不适合走“所有东西都亲力亲为、全部自研”的路线。
更合适的路线是：

- 核心体验自研
- 底层能力借力
- 外部接入做边界，不做硬耦合

### 值得自己做的

这些部分直接决定 Remi 是否更像“同一个持续存在的人”：

- turn-taking / interruption / streaming behavior
- fast brain / slow brain 分工
- 人格、语气、关系连续性的 prompt / policy 语义
- episode memory、unresolved state、proactive planning
- identity、session continuity、跨端接续语义

这些不是通用聊天产品的现成能力，而是 Remi 的主价值。

### 不值得重度自研的

这些部分更适合做 adapter，而不是往下深挖成另一套底层平台：

- 基础模型与推理引擎
- STT / TTS 引擎本身
- 数据库、缓存、向量索引底座
- 第三方平台 SDK、设备协议、接线层

这里真正需要自己掌控的是：
- provider 选择
- fallback 语义
- 失败时的用户体验
- 能力边界和可替换性

而不是重新造一遍底层能力。

### 当前已经出现的偏移风险

现在最需要警惕的，不是“自研太少”，而是“自研面开始变宽”：

1. Web 与 iOS 都在长自己的会话状态机
   - 浏览器端 `useRemiChat`
   - iOS 端 `RemiChatStore`
   - 如果两端继续各自吸收 transport / voice / playback / turn state 复杂度，跨端一致性会越来越难维护

2. capability boundary 还没真正落成
   - 文档方向是对的
   - 但代码里仍有点状 capability 直接进入核心路由的倾向

3. 语音层容易滑向“平台自研”
   - 当前 `voice/*` 继续加 provider / fallback / warmup / pool 是合理的
   - 但再往下做，就会开始和 Remi 的核心目标脱节

结论不是“这些实现都错了”。
结论是：
- 它们可以作为当前阶段的过渡实现
- 但不应该成为长期扩张方向

---

## 产品判断标准

Remi 不应该让人感觉像：
- 客服机器人
- 通用语音助手
- 几个 AI 功能的拼装合集
- 一个只能在单端打开的聊天框

Remi 应该更像：
- 一个能在对话里及时反应的人
- 一个跨时间还是同一个人的角色
- 一个在不同终端之间都能接续存在的陪伴者
- 一个不仅会回答，而且会持续在关系里存在的系统

一句最短但准确的描述是：

> Remi 是一个以“活人感、连续性、存在感”为核心目标的实时 AI 陪伴系统。

---

## 当前优先级

当前最大的缺口不是 Remi 不会说话。
而是“人格记忆层”虽然已经有 V1 闭环，但还没有完全进入 V2 的可验证主路径。

当前主线程：
- Memory V2 验证 + 读路径迁移（V2.1）

这意味着当前应该优先投入：
- 验证 V2 episode 写路径
- 验证并迁移 V2 episode 读路径
- 让 relationship continuity 进入 prompt 与 proactive planning
- 在不伤害实时交互质量的前提下，为未来跨终端存在层打基础

这也意味着当前不该把主要精力放在：
- 单独做 silence threshold 微调
- 孤立做 TTS 首音频优化
- 只扩 avatar 展示层却不补连续性
- 只做单端功能堆叠却不考虑未来跨设备接续

执行层面的短说明见 [CURRENT_FOCUS.md](CURRENT_FOCUS.md)。

---

## 当前诊断

当前系统方向没有走偏。
它已经有不少正确骨架：
- WebSocket duplex communication
- session-level isolation
- fast brain / slow brain split
- interrupt controller
- sentence-level TTS
- relationship state
- Memory V2 基础设施

但“像活人一样存在”这件事还没有完整成立。

### 已经比较扎实的部分
- 实时语音链路已经不是最初 demo 级拼装
- interruption 语义比以前更干净
- 被打断的 partial 不再污染正式历史
- turn lifecycle 语义比以前清晰
- 关系层第一阶段已经闭环
- Memory V2 的 schema / repo / store / planner 已经搭起来

### 仍然明显不足的部分
1. 输入理解仍偏晚
   - 还是太依赖 end-of-utterance 之后再行动
2. turn-taking 仍然偏静音驱动
   - 活人感会在短暂停顿里受损
3. fast brain 还更像“快回复”而不是“快反应”
   - 进入时机和行为节奏还能更像真人
4. Memory V2 还在验证期
   - 说明人格记忆层还没完全进入更强的稳定形态
5. 跨终端存在层还主要停留在产品方向层
   - 还不是今天的主线程，但已经是架构决策必须考虑的前提
6. 客户端复杂度正在累积到错误层
   - 当前 Web / iOS 都在吸收越来越多 transport + playback + voice state 逻辑
   - 如果不及时收敛，会变成“多端各自实现一套 Remi”

---

## 产品哲学

项目应该优先选择：
- 活人感优先于功能膨胀
- 分阶段升级优先于大爆炸重写
- 实时顺滑优先于把重认知塞进 fast path
- 行为质量优先于 benchmark 漂亮
- 可持续存在优先于单端演示炫酷

项目应该守住：
- fallback modes
- observability
- architectural boundaries
- fast / slow 系统角色分离
- 未来跨终端接续的可演进性

当出现取舍时，优先选择能提升这些指标的方案：
- perceived aliveness
- continuity of personhood
- sense of presence
- cross-device continuity potential
- long-term habit value

---

## 竞争方向

Remi 不应该靠“什么都做”来赢。

它不应该主要竞争：
- 支持多少后端
- 接了多少平台
- agent feature 有多宽
- “什么都能接”的平台型叙事
- provider 数量有多少
- 底层语音 / 模型基础设施自研到多深

它应该重点竞争：
- conversational timing
- interruption quality
- voice UX
- character continuity
- relationship feel
- persistent presence

一句更合适的定位表述是：

> Remi 是一个以存在感为中心、以实时语音和人格连续性为核心优势的 AI 陪伴系统。

---

## 本地开发与服务器部署

即使生产跑在服务器上，本地高性能开发仍然有价值。

本地机器的角色：
- 开发机
- 低摩擦迭代
- 语音链路调试
- 本地模型实验
- 原型验证

服务器的角色：
- 生产推理
- 托管服务
- 可扩展部署
- 多终端接入基础设施
- 长期在线与同步能力承载

不要把开发机上的决策和生产服务决策混在一起。
也不要让单端页面生命周期主导整体产品架构。

---

## 开源方向

开源可以成立，但不是把一切都放出去就行。

更合理的方向可能是：
- open core
- open client / framework layers
- monetize hosted services, premium voice, memory sync, character ecosystem

适合开放的部分：
- client UI
- plugin interfaces
- local model adapters
- basic memory abstractions
- basic voice pipeline framework

更适合托管或付费的部分：
- hosted service
- premium voice stack
- memory sync
- cross-device presence layer
- content ecosystem
- scalable infra
- advanced behavior tuning

---

## 最后一句产品判断

真正要赢的，不只是回答质量。
而是用户在几分钟后开始忘记自己是在和软件说话；
再往后，开始觉得她不只存在于某个页面，而是在自己的生活流里持续存在。
