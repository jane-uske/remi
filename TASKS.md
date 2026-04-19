# Remi AI — TASKS

## 这份文档的用途

这份文档只回答三个问题：
- 现在最重要的任务是什么
- 哪些事情已经做完了
- 哪些事情还没做，且现在不该和主线程混在一起

当前主线程与交付边界，始终以 [CURRENT_FOCUS.md](CURRENT_FOCUS.md) 为准。
如果 `TASKS.md` 和其他文档冲突，以 `CURRENT_FOCUS.md`、`AGENTS.md`、实际代码状态为准。

---

## 当前主线程

**Web 端 10 分钟在场感体验（默认人格 + 严肃场景承接 + Web 在场感统一）**

当前目标不是继续堆功能。
当前目标是把已经接通的记忆、语气、承接、语音和表现层压成一个单端高光体验，让用户第一次明显觉得 Remi 不只是聊天框。

### Current Execution Board

| ID | Task | Status | Exit Criteria | Next |
|---|---|---|---|---|
| `W-PRES-01` | 默认人格稳定 | `in_progress` | 轻松聊 / 睡前聊 / 日常碎聊时，口气、边界、追问强度明显更稳定 | `W-PRES-02` |
| `W-PRES-02` | 严肃场景承接修正 | `todo` | 现实压力 / 财务压力 / 自责 / 委屈类 bad case 明显减少轻浮、失焦和错位 | `W-PRES-03` |
| `W-PRES-03` | Web 在场感统一 | `todo` | 说话态 / 停顿态 / 被打断态 / 口型与音频播放时间线不再互相打架 | `W-PRES-04` |
| `W-PRES-04` | 10 分钟体验压测 | `todo` | 睡前陪聊 / 日常碎聊 / 压力倾诉三个场景中，10 分钟体验明显不再像普通聊天框 | `observe` |

状态枚举只允许：`todo` / `in_progress` / `blocked` / `done`。
每次任务状态变化，先改这个表，再改下方详细说明。

### 当前正在做

- [ ] **W-PRES-01** 默认人格稳定
  - 目标：先把“同一个默认人格”做稳，而不是继续扩 persona preset 数量
  - 当前重点：收口口气、亲近方式、边界感、追问方式、安慰方式
  - 当前不做：大而全 persona presets 扩展、free-form persona authoring、额外风格玩法
  - 验收标准：轻松闲聊 / 睡前陪聊 / 普通碎聊时，不再频繁出现“像客服 / 像老师 / 像另一个系统”的漂移

- [ ] **W-PRES-02** 严肃场景承接修正
  - 目标：优先修“最伤关系可靠感”的 bad cases，而不是继续扩 memory 功能面
  - 当前重点：
    - 事实承接错
    - 情绪误判
    - 场景切换失败
    - 严肃时刻轻浮
  - 当前边界：优先通过 `TurnInterpretation -> ResponsePolicy`、`tone contract`、默认人格提示和坏样本回归收口
  - 验收标准：用户从轻松聊切到现实压力、财务压力、自责、委屈时，Remi 明显更稳，不再轻飘飘错位

- [ ] **W-PRES-03** Web 在场感统一
  - 目标：让角色从“会说话的系统”更接近“在场的她”
  - 当前重点：
    - 说话态、停顿态、听你说态更清楚
    - 口型、音频、表情、turn state 不互相打架
    - 打断时不出现明显错位
  - 已有基础：4.19 已接通 `tts_lip_sync`、lip timeline、`MicTxGate`
  - 验收标准：从视觉和听感上，角色状态已经明显比当前更像“有人在”

- [ ] **W-PRES-04** 10 分钟体验压测
  - 目标：先证明一个单端、单场景、单默认人格的高光体验
  - 场景固定为：
    - 睡前陪聊
    - 日常碎聊
    - 压力倾诉
  - 验收标准：至少在一个默认入口里，用户和她待 10 分钟后，不再自然把她归类成普通聊天框

### 当前明确不优先做

- [ ] iOS 新功能扩张
- [ ] 多端持续在线产品化闭环
- [ ] 大而全 persona preset 扩展
- [ ] adult-mode / 边缘玩法扩展
- [ ] 与当前主线无关的大量 docs / ops / infra 美化
- [ ] 继续按“memory / web / iOS / auth / avatar / voice 全线一起推”的模式工作

### 并行支线（不抢主线程）

- [ ] **Memory V2 真实质量观察（observe / blocked）**
  - 当前状态：主链路已接通，但真实样本不足；继续围绕 `audit / hygiene` 扩工具，只会得到低信号 proxy 结论
  - 当前边界：保留现有 readiness，不再为“验证而验证”扩脚本或规则
  - 解锁条件：出现新的真实 `episodes` 样本，或出现足够多样的真实用户对话可供抽样人工复核

- [ ] **I-001** iOS v0（文本）5 人内测闭环
  - 当前状态：文本基线、鉴权、缓存隔离骨架已具备
  - 边界：只保底，不抢当前 Web 主线
  - 验收标准：5 人试用通过、无 P0 崩溃、无串号反馈

- [ ] **I-002** iOS 按住说话语音链路收口
  - 当前状态：代码级主怀疑点已继续收口，但真机可用性仍未成立
  - 边界：不计入本轮主线 done 判定
  - 验收标准：真机按住说话能稳定出现 transcript 或最终用户气泡，并触发 assistant 回复

- [ ] **T-042** Prompt / latency budget 收口
  - 当前判断：这仍重要，但不能继续稀释“像她”的主线
  - 当前边界：只做对 Web 默认体验直接有帮助的压缩和稳定性修复

### 当前禁止并行修改的热点文件

- `server/session/index.ts`
- `brains/slow_brain_store.ts`
- `web/src/hooks/useRemiChat.ts`
- `memory/memory_agent.ts`

规则：
- 同一迭代周期内，一个热点文件只能有一个 owner。
- 任何 agent 在改热点文件前，先看对应目录的 `MODULE.md` 和根目录 `TEST_MAP.md`。
- 如果任务必须同时涉及两个以上热点文件，优先拆成“单 owner 主改 + 其他人只补测试 / fixture / 文档”。

---

## 已完成里程碑

下面不是“所有历史小任务”的逐项流水账，而是按主线整理后的已完成事实。
这些结论基于当前代码状态与最近主线提交。

### M0 · 基础系统已完成

- [x] Node.js + TypeScript 全栈项目建立完成
- [x] HTTP + WebSocket 网关完成
- [x] PostgreSQL + Redis 接入完成
- [x] 基础日志、认证、限流、Docker 化完成
- [x] Next.js 前端、旧版前端、基础音频链路完成

### M1 · 实时交互主链路已成型

- [x] Fast Brain / Slow Brain 双脑架构已落地
- [x] VAD / STT / TTS 主链路已接通
- [x] turn-taking 状态机已引入 `hold / likely_end / confirmed_end`
- [x] 打断语义已收口：被打断 partial 不污染正式历史 / 慢脑 / 正常持久化
- [x] `chat_end` 与本地 playback drain 已分离
- [x] 延迟指标与 duplex harness 已稳定，可用于回归比较

### M2 · 在场感 / Avatar 表现层已达到可用 MVP

- [x] Avatar 协议、动作触发、控制器已接通
- [x] 3D 互动 MVP 已完成，可做离线演示与人工验收
- [x] 语音、情绪、状态与形象之间已有基本联动
- [x] 4.19 已补 client lip sync transport、Web lip timeline、`MicTxGate`

### M3 · 人格与关系连续性 V1 已完成验收

- [x] per-user relationship state
- [x] reconnect continuity
- [x] relationship-aware prompt consumption
- [x] interrupted partial pollution guard
- [x] relationship-aware retrieval
- [x] proactive ledger / style slots / continuity policy 已接入

### M4 · Persona 骨架已进入可用状态

- [x] 基础 persona / character rules 已稳定存在
- [x] 最小产品骨架 Layer 2 + Layer 4 已接入
- [x] 已修复 4-layer skeleton 的关键持久化缺口

### M5 · Memory V2 主链路已完成单路径验收

- [x] `llm/embedding_client.ts`
- [x] `episodes` 表与 repository
- [x] `episode_store` 编排层
- [x] slow brain 写路径双写 V1 + V2
- [x] `proactive_planner` 已实现
- [x] prompt 读路径已优先接到 `episodeStore.findRelevant()`
- [x] silence nudge 主路径已接到 `planProactiveNudge()`
- [x] 真实 WS 文本会话写路径已验收，`episodes` 可稳定写入并合并

### M6 · 多端与运行底座已有骨架

- [x] Web Clerk / legacy 双桥接入
- [x] iOS lite 文本聊天骨架已接通
- [x] per-user cache / auth identity / session continuity 基础已接通
- [x] 本地 dev / local-prod 运行口径已拆分，避免互相污染

---

## 当前未完成项

### A. 当前主线程未完成

- [ ] 默认人格稳定
- [ ] 严肃场景承接修正
- [ ] Web 在场感统一
- [ ] 10 分钟体验压测

### B. 并行但非主线程

- [ ] Memory V2 真实质量观察
- [ ] iOS 内测验收
- [ ] iOS 按住说话语音链路收口
- [ ] Prompt / latency budget 收口（只保留对当前主线直接有价值的部分）

### C. 长期方向，暂不进入当前执行板

- [ ] 多端持续在线存在层的具体实现
- [ ] 插件 / capability 系统
- [ ] 直播 / 游戏 / 机器人 / 设备接入
- [ ] 更大范围 persona / character ecosystem

---

## 与代码现状不一致、已归档的旧表述

下面这些说法已经过时，不应再作为当前任务判断依据：

- “当前主线程仍然是 Memory V2 验证 + 读路径迁移”
- “继续所有方向一起推进也能自然长出高光体验”
- “当前最缺的是更多能力点，而不是把已有能力压成体验”

这些旧内容不再保留为主文。
它们已经被当前代码状态、当前提交历史和 [CURRENT_FOCUS.md](CURRENT_FOCUS.md) 取代。

---

## 任务更新规则

今后更新这份文档时，遵守下面规则：

1. 先更新“当前主线程”
2. 再更新 `Current Execution Board` 的状态与 `Next`
3. 再更新“已完成里程碑”
4. 不再把早期基础建设任务逐条往下累加
5. 当前优先级变化时，必须同步 `CURRENT_FOCUS.md`
6. 如果只改了历史说明、没改当前主线程，不要改顶部执行板
