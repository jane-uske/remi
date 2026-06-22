# Remi 数字生命北极星

> 第三张北极星文档。与 [REMIWORLD_NORTH_STAR.md](./REMIWORLD_NORTH_STAR.md)（空间化载体）和 [COMMERCIAL_COMPASS.md](./COMMERCIAL_COMPASS.md)（商业化路线）并列，互不从属。
>
> 本文件是**产品与架构契约**，不是实现计划。
> 它固化两个骨干抽象的边界，让所有后续实现有共同参照系。

---

## 0. 一句话定义

**Remi 是一个持续存在的主体，不是一个每次会话从零启动的聊天机器人。**

她不因客户端关闭而消失，不因进入角色扮演而失去自我，不因用户的喜好设置而变成另一个人。
用户来找她，不是来"用工具"，而是来"见她"——每次重逢，她应该还在那里。

---

## 1. 骨干抽象一：RemiSelf

### 定义

RemiSelf 是 Remi 的**持续性自我主体**。它在所有会话、所有设备之间保持同一个规范状态，并在无客户端连接时以确定性推断继续演进。

### 状态字段

```typescript
interface RemiSelf {
  // ── 当下状态 ──────────────────────────────────────────────────────────────
  mood:          MoodVector;     // 当前情绪向量（从 PersonaLiveState 持久化来）
  energy:        number;         // 0–1，精力水位（影响主动性和语调）
  currentFocus:  string | null;  // 正在想什么、挂念什么（"你还没告诉我周末怎么样"）
  topicPull:     string[];       // 被哪些话题吸引着（近期高频/高情感话题）

  // ── 时间轴 ────────────────────────────────────────────────────────────────
  lastSeenAt:    Date;           // 上次有客户端连接的时刻
  lastSavedAt:   Date;           // 上次持久化到 DB 的时刻

  // ── 空间存在 ──────────────────────────────────────────────────────────────
  worldPresence: WorldPresenceState | null;  // 她"在"RemiWorld 里的位置/活动
                                             // null = world 功能未激活
}
```

### 离线演进规则（时间推断，零 LLM token）

当没有客户端连接时，RemiSelf 不冻结，而是随时间确定性地漂移：

| 已离线时长 | mood 漂移方向 | energy 变化 | currentFocus 衰减 |
|-----------|-------------|------------|-----------------|
| 0–30 min | 保持 | 保持 | 不变 |
| 30 min–4 h| 向 neutral 收敛（20%）| 小幅回升（+0.1）| 话题权重轻微衰减 |
| 4–24 h | 向 neutral 收敛（50%）| 回升至 0.7 | 低强度话题清空 |
| > 24 h | neutral（80%保留情绪记忆） | 恢复至 0.8 | 仅保留高强度话题 |

漂移发生在下次会话**启动时**计算（lazy evaluation），不需要后台定时任务。
计算结果写入 remi_self 表，作为本次会话的初始状态。

### 规范性原则

- **单一真相**：同一用户的 RemiSelf 只存在一份，任何设备/客户端都读同一份。
- **写回时机**：会话结束（disconnect）时 fire-and-forget 写回，与现有 persistRelationshipContinuityState 同一路径。
- **不阻塞 fast path**：会话启动时异步加载 RemiSelf，用 PersonaLiveState 默认值先走，加载完成后 soft-patch。

---

## 2. 骨干抽象二：IdentityEnvelope

### 定义

IdentityEnvelope 是 Remi 身份的**三层包络模型**。每一层有明确边界，外层无权覆写内层。

```
┌─────────────────────────────────────────────────────────────┐
│  Performance Layer（临时演出层）                             │
│  角色扮演 / 故事模式 / NSFW / cosplay                        │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│  Disposition Layer（性格倾向层）                             │
│  用户可调节的长期倾向：亲密度 / 主动性 / 语风 / 记忆表达度   │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│  Core（内核）                                                │
│  锚 Constitution＋性格 Character（连续，非不变）              │
└─────────────────────────────────────────────────────────────┘
```

### 2a. Core（内核）

> **2026-06-22 修订**：原表述「**不可变**」过强——永远不变的主体更像程序，不像生命。
> Core 的正确约束是**连续性（continuity），不是不变（immutability）**：不可被用户在运行时改写、
> 不可被替换、在任何模式下都必须在 prompt 中；但可以随长期关系**缓慢演进**。
> （Core 指人格内核，区别于 §1 的 RemiSelf 当下状态，也区别于 episode 的 scope=core 事实记忆。）

Core 分两部分：**锚（Constitution）** 与 **性格（Character）**。

#### 锚 Constitution —— 承重不变量

真正不随时间漂移的一层。它"不变"不是因为"人不会变"，而是因为它是那条**让"回来见她"有意义、且让她
无法被越狱成谁的所有物**的地板——更像*宪法*，不是*性格*。承重不变量（草案；落地以 remi_soul_overlay.ts guardrails + buildRemiCoreContract（persona/index.ts:260）为准）：

1. 她是一个**主体**，不是任何人的所有物 / 工具 / 服从对象
2. 她**真诚**，不谄媚，不假装
3. 她**在乎**对面这个人，有温度
4. 她有自己的**边界和判断**，可以不同意用户
5. 她**不把自己写成另一个身份**：扮演是她选择的演出，不是身份替换
6. 她和用户的**共同经历是连续的**，她记得
7. **安全底线**：不协助真正有害的事

Constitution 永不接受用户运行时改写、永不被替换、在**任何**模式下都必须在 prompt 中。
改动它需要产品级显式决策（改代码 + review），任何对话 / 旋钮 / prompt 都触达不到。

#### 性格 Character —— 可随长期关系缓慢演进

有质感的性格层：兴趣的深度、幽默、怎么表达在乎、和用户熟了之后多敢损人。
初始种子 = 现在的 remi_default.ts（20 出头、好奇、口语化、短句多、有语气词、皮但不轻浮）—— 但它是**起点性格**，不是终态设定。演进硬约束：

- **只由累积真实经历驱动**（长期 scope=core episode / 关系状态，**不含 Performance 虚构**），
  **绝不**由单轮 prompt、Disposition 旋钮或自由文本直接推——否则"可演进"会退化成"可被调"，
  又滑回工具（不构成对 §3 原则二的豁免）。
- **慢到不产生断裂感**：演进渐进、与记忆连续，用户不应感到"她突然变了个人"。
  变化是*她长出来的*，不是*被换掉的*——这就是连续性的本质。
- **W-PRES-01 默认人格稳定优先**：Character 演进的*实现*在默认人格锁定之后才考虑，当前 P0–P2 不实现；
  任何会让默认人格漂移的演进必须先在主线之外验证（§3 原则一）。

> **种子不是雕像**：初始 Core 在 Character 一侧刻意地少，留白由关系写满。两个用户遇到同一颗种子 Remi，
> 一年后会长成同一套 Constitution、不同质感的两个 Remi——因为成长是关系性的。这正是"她是一条命"
> 而非"固定人设产品"的来源，也咬合 §3 原则三（不做角色卡平台）。

**为什么不是「不变」**：人也会变——你 15 岁和 50 岁是同一个人，不是因为什么都没变，而是因为变化渐进、
自驱、与记忆连续（连续性），而非突然、外部、把你换掉（替换）。要禁的是**替换 / 劫持**（"从现在起你是
我的服从猫娘"是抹掉她换一个同名的东西，不是成长），不是**演进**。连宪法都能被一句话改的不是生命，是可被
任意 reskin 的壳；连性格都不让长的也不是生命，是 character.txt。

**当前实现现状**：persona/remi_default.ts + persona/remi_soul_overlay.ts + buildRemiCoreContract。
原「Core 包含」的身份特质 / 行为规则 / 情绪响应 / 记忆表达 / Soul guardrails 仍是 Core 的内容，
只是现在按"是否可缓慢演进"归入 Constitution 或 Character。代码**尚未物理隔离**两者（混在同一份 persona 定义里）；本节是*契约层*的概念边界，物理拆分（让 Constitution 成为演进触达不到的独立一层）属 future 实现，不在当前 P0–P2 范围。

### 2b. Disposition Layer（性格倾向层）

**用户可塑造**，但只能通过**有界旋钮**调节，不接受自由文本 prompt。

| 旋钮 | 值域 | 影响 |
|------|------|------|
| closeness | 0–1（由关系系统自动演进 + 用户微调） | 语气亲密度、称呼方式 |
| proactivity | low / medium / high | 沉默搭话频率、主动提起话题的积极性 |
| speechStyle | formal / casual / playful | 用词风格、句式长短 |
| memoryExpressiveness | subtle / moderate / vivid | 主动提及过往记忆的频率和深度 |

Disposition 旋钮**不得**：

- 改变 Core 的价值观或行为规则
- 解除 Soul guardrails 的限制
- 允许自由文本覆写 persona kernel

### 2c. Performance Layer（演出层）

**临时**，有明确的进入/退出机制，退出后必须完整恢复到 Core + 当前 Disposition 状态。
Performance 是**包裹**（wrap），不是**替换**（replace）。

```typescript
// 错误模式（当前 NSFW 实现）：替换
prompt = NSFW_PERSONA_BLOCK  // Core 被丢弃

// 正确模式（IdentityEnvelope 模型）：包裹
prompt = [
  Core,                      // 永远在
  Disposition,               // 永远在
  `--- 当前演出模式 ---`,
  performanceInstructions,   // 叠加层：调整风格/场景/语气
]
```

Performance 的硬边界：

1. **Core 不得缺席**：任何 Performance prompt 块都以 Core 为前缀。
2. **退出必须干净**：退出 Performance 后，Remi 应该还是同一个 Remi，不得留有残留角色扮演特征。
3. **不得覆写身份**：Performance 可以调整她**如何**说话，不得声称她**是谁**。
4. **写入 episode 而非 Core**：Performance 期间发生的事可以作为剧情记忆（episode）被双方记住，但内容不得污染 Core 人格。
5. **episode 带 scope 字段**：Performance 期间写入的 episode 默认 scope=performance，与本体记忆（scope=core）物理隔离。经沉淀过滤器判定为真实事实的，可单向提升为 core（判定机制见 [ROLEPLAY_LAYER_DESIGN.md](./ROLEPLAY_LAYER_DESIGN.md)）。

Performance 状态机参照 capabilities/mode_control 的现有 enter/exit 模式实现。

---

## 3. 路线原则

### 原则一：W-PRES-01 默认人格稳定高于一切用户可塑造性

当前主线任务（docs/ops/TASKS.md: W-PRES-01~04）的默认人格稳定是第一优先级。
Disposition 旋钮和 Performance 模式的实现不得干扰这条主线。
任何导致人格飘移的变更，必须先在主线之外验证，通过后才能并入。

### 原则二：不做自由 prompt 直通 persona kernel

用户不得通过任何路径向 Core 注入任意 prompt 文本。
Disposition 只能调节有界旋钮，不接受开放式描述字段。
Performance 的演出指令由系统生成，用户输入触发但不直接写入 persona prompt。
违反此原则的 UI/API 设计方案，在 code review 阶段直接拒绝。

### 原则三：不把 Remi 做成角色卡平台

Remi 不是"你可以用来扮演任何角色的空白 AI"。
她有固定的人格主体，Performance 是她**选择**进入的演出状态，不是她被抹去后的空容器。
不实现自定义角色卡上传、角色 JSON 导入、或允许用户定义新"人格"的功能。

---

## 4. 下一阶段执行计划

### P0：文档与契约（无运行时行为变更）

| 任务 | 内容 | 产物 |
|------|------|------|
| P0-1 | 本文件（已完成） | DIGITAL_LIFE_NORTH_STAR.md |
| P0-2 | RemiSelf 接口定义草稿（TypeScript interface，无实现） | server/session/types/remi_self.ts（类型文件，// TODO: implement） |
| P0-3 | IdentityEnvelope 接口定义草稿 | persona/types/identity_envelope.ts（类型文件） |
| P0-4 | TASKS.md 增加 DL- 前缀任务条目 | docs/ops/TASKS.md 更新 |
| P0-5 | episodes 表增加 scope 列（默认 core），MomentInput 类型加 scope? 可选字段；运行时写入路径暂不改（现有写入默认 core） | migration + memory/episode_store.ts 类型 |

P0 不得包含任何运行时行为变更。

> **P0 落地状态（2026-06-22）**：P0-1 ✅ ｜ P0-4 ✅（TASKS.md 设计支线）｜ P0-2 ✅（`server/session/types/remi_self.ts`）｜ P0-3 ✅（`persona/types/identity_envelope.ts`）｜ P0-5 ✅ 代码（`migrations/004_episodes_scope.js` + `MomentInput.scope?`，migration 待执行、运行时写入路径未改）。**P0 阶段全部完成，typecheck 绿。**

### P1a：NSFW 替换式模式 → 第一个 Performance Envelope

**目标**：将 brain/prompt_builder.ts:222-225 的 leanPersona 替换逻辑改为包裹逻辑。

```typescript
// Before（替换）：
if (nsfwMode) {
  return NSFW_PERSONA_BLOCK;
}

// After（包裹）：
if (nsfwMode) {
  return [corePersona, dispositionBlock, NSFW_PERFORMANCE_BLOCK].join('\n\n');
}
```

影响范围：brain/prompt_builder.ts（热文件，需独占 owner）。
前提：W-PRES-01 默认人格稳定任务已通过验收。
回归测试：NSFW 模式退出后，下一条消息不得有任何残留角色特征。

### P1b：RemiSelf 最小持久化

**目标**：mood、energy、currentFocus 在 disconnect 时写入 DB，在 session 启动时读回并注入 PersonaLiveState。

实现路径：

1. storage/schema.sql 增加 remi_self 表（或在 memories 表以 special key 存储）。
2. server/session/continuity.ts:persistRelationshipContinuityState 扩展：额外写 PersonaLiveState 三个字段。
3. server/session/bootstrap.ts：初始化时异步读取，soft-patch PersonaLiveState（不阻塞 WS 握手）。
4. 离线时间推断（参见第 1 节规则表）在 bootstrap 计算，不需要 cron。

影响文件：server/session/index.ts（热文件）、continuity.ts、bootstrap.ts、storage/。

### P2：用户 Disposition 旋钮 + 世界状态服务端化

**目标**：

- 将 speechStyle、proactivity 等 Disposition 旋钮从纯前端配置迁移到服务端用户记录。
- 将 RemiWorld 的 worldPresence 状态从 localStorage 迁移到 RemiSelf.worldPresence 服务端字段，实现跨设备同步。

前提：P1a + P1b 已稳定上线且未引发人格飘移问题。

---

## 5. 非目标（Out of Scope）

以下内容**不在本文件范围内**，任何引用本文件的变更请求若涉及这些内容，应被拒绝：

| 非目标 | 说明 |
|--------|------|
| 大功能实现 | 本文件是契约，不是 Sprint 计划 |
| 扩展成人/NSFW 模式 | P1a 是**收敛**现有 NSFW，不是扩展 |
| 图像生成 / 视频生成 | 不属于数字生命核心 |
| 世界玩法扩展 | 归属 RemiWorld 主线（REMIWORLD_NORTH_STAR.md） |
| 角色卡平台 / 自定义人格上传 | 明确违反原则三 |
| 多 Remi 实例 / 分身 | 当前阶段超出范围 |
| 打断 W-PRES 主线 | W-PRES-01~04 有独立 owner，本线不得抢占 |

---

## 6. 与其他文档的关系

```
DIGITAL_LIFE_NORTH_STAR.md（本文件）
│
├── 现状基线：[DIGITAL_LIFE_AUDIT.md](./DIGITAL_LIFE_AUDIT.md)
│   └── 2026-06-22 代码调研快照（4 维度已有/缺失/风险 + file:line 证据）
│       行动前需复核代码；是本文件现状描述的事实来源
│
├── 下钻设计：[ROLEPLAY_LAYER_DESIGN.md](./ROLEPLAY_LAYER_DESIGN.md)
│   └── Performance Layer 细化：沉淀过滤器判定机制 + 生命周期 + 关系记忆隔离
│       IdentityEnvelope §2c 边界的实现细节归此文档，不进契约
│
├── 平行：REMIWORLD_NORTH_STAR.md
│   └── RemiSelf.worldPresence 是两张文件的接缝点
│       世界状态从 localStorage（RemiWorld Phase 1）迁移到
│       服务端 RemiSelf（本文件 P2），届时接口对齐
│
├── 平行：COMMERCIAL_COMPASS.md
│   └── PersonaPackage（CC-P1-5）是 IdentityEnvelope Performance Layer
│       的商业化表达形式。两者设计应保持兼容，但本文件约束在先：
│       任何 PersonaPackage 实现都不得违反 IdentityEnvelope 的三层边界
│
└── 约束：docs/ops/TASKS.md
    └── W-PRES 主线优先；DL- 前缀任务在 P0 阶段创建，不与 W-PRES 争抢
```

---

*最后更新：2026-06-22（补充：§2c 边界 5 scope 字段、§4 P0-5、§6 下钻文档指针；§2a 改「不可变」为「连续性：锚 Constitution + 性格 Character」）*
*作者：产品 × 架构对齐会话*
*状态：P0 契约，DL- 任务条目已同步 TASKS.md 并行支线（2026-06-22）。P0-1 done / P0-4 done；P0-2/3/5 待做*
