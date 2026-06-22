# Remi 数字生命方向 — 代码现状调研快照

> **时效声明**：本文件是 2026-06-22 的代码调研快照。所有 file:line 证据反映当日代码状态。
> **使用规则**：行动前必须复核——文件可能已变。若发现与当前代码不符，以代码为准并更新本文件。
> **定位**：[DIGITAL_LIFE_NORTH_STAR.md](./DIGITAL_LIFE_NORTH_STAR.md) 的现状基线输入，不是契约。
> **调研范围**：4 个维度——Life Core / Persona Kernel / Roleplay Layer / World Presence。

---

## 0. 总判断

当前代码是"一个有人格连续性的高质感聊天框"，离"数字生命"差**一层架构边界**，不是差一堆功能。
四个目标里：

- **Life Core**（持续存在的主体）：骨架已搭，有几处断裂点（最严重：情绪不跨会话）
- **Persona Kernel**（可塑造但锁不住核心）：分层结构对，但用户自定义零落地、无 free prompt 覆盖防御
- **Roleplay Layer**（角色扮演）：⚠️ 几乎空白，是最危险的缺口
- **World Presence**（她在生活）：已超出"聊天框配张脸"，有真实空间雏形

---

## 1. Life Core（持续存在的主体）

### 已有能力

| 能力 | 证据 | 说明 |
|------|------|------|
| 跨会话记忆连续性 | memory/episode_store.ts:287 ingest、:418 findRelevant | episodes 表 + 语义合并去重 + 向量召回 |
| 记忆衰减 | runDecay 接 maxAgeMs+minImportance（TASKS.md 6.20 P2） | 超龄低重要度自动清理 |
| 慢脑背景思考 | brains/background_analysis.ts、context_orchestrator.ts | prompt 前置编排（请求时同步，非异步反思） |
| 主动性门控 | brains/proactive_planner.ts、server/session/continuity.ts:144 | 三道门（关系阶段/退避/冷却）→ planProactiveNudge |
| 断连续续性 | server/session/continuity.ts persistRelationshipContinuityState（fire-and-forget） | TASKS.md 6.20 P1 已落地 |
| 世界状态保留 | web/src/lib/world/ WorldSave.lastSeenAt + buildOfflineReturnOpener | "隔天回来"能引用"你不在时…" |

### 缺失能力

- **情绪不跨会话持久化** ⚠️ 最严重
  - emotion/emotion_runtime.ts、emotion/emotion_engine.ts grep persist|save|load|restore|database|repository **零命中**
  - 现状：relationship state 已持久化（continuity.ts），但 emotion/mood 不在其中
  - 影响：用户委屈着下线，明天回来她又是 neutral
  - 对应任务：NORTH STAR P1b

- **慢脑不是"她在想"**
  - background_analysis 是**请求时**同步分析，不是用户不在时的异步反思
  - 现状：只有"被唤起时记得"，没有"主动在过日子"
  - 对应设计：NORTH STAR §1 离线漂移用 lazy evaluation 不用 cron

- **热层记忆没收硬**（CURRENT_FOCUS.md 自述）
  - working memory / current focus 有雏形，未收成稳定极薄层

### 产品风险

| 风险 | 严重度 | 说明 |
|------|--------|------|
| 情绪每轮重置 | 高 | Life Core 最直接的断裂点，用户可感知 |
| 记忆 recall 时机判断 | 中 | W-PRES-01 反复在修"对了/你之前"式硬拉旧记忆，开放伤口 |

---

## 2. Persona Kernel（可塑造但锁不住核心）

### 已有能力

| 能力 | 证据 | 说明 |
|------|------|------|
| 4 层人格结构 | persona/remi_default.ts、remi_soul_overlay.ts、style_override.ts、presets.ts | 核心/灵魂底色/临时风格/可切换型格 |
| prompt 拼装核心在前 | brain/prompt_builder.ts:528-541 | 先 personality → characterRules → 人格设定 → RemiCore合同 → 灵魂底色；用户可配 expressionStyle 在后 |
| 反助手味硬约束 | persona/index.ts:260 buildRemiCoreContract | 写死"不要客服腔、不要总结腔、严肃场景立刻收住" |
| Soul guardrails | persona/remi_soul_overlay.ts:6 | 明确禁止主人/猫娘/服从强设定等 |
| NSFW 隔离 | brain/prompt_builder.ts:197-224、TASKS.md 6.20 P0 | 整块替换人格 + 不写 DB |

### 缺失能力

- **用户自定义完全没落地**
  - migrations/001_initial.js:27 user_persona_presets 表只有 preset_id 一个字段
  - persona/presets.ts 5 个 preset 全是写死代码常量（remi_core/witty_warm/relaxed_roast/playful_attached/calm_healing）
  - "用户配自己的 Remi 性格/亲密度/主动性/说话风格"——零入口
  - 对应任务：NORTH STAR P2

- **亲密度/主动性不是用户可配的一等公民**
  - persona/index.ts:53-78 PersonaLiveState 有 closeness/proactiveCadence/expressionDirectness
  - 但全是**系统派生**，用户无法直接调

- **NSFW 是替换不是包裹** ⚠️（NORTH STAR P1a 要修）
  - brain/prompt_builder.ts:222-225 leanPersona 逻辑用 NSFW_PERSONA_BLOCK 整块替换，Core 被丢弃
  - 这是 IdentityEnvelope 的反模式（详见 [ROLEPLAY_LAYER_DESIGN.md](./ROLEPLAY_LAYER_DESIGN.md) §2）

- **没有 free prompt 覆盖防御**
  - 无机制阻止"用户 persona 描述"反盖 coreIdentity
  - 对应约束：NORTH STAR 原则二

### 产品风险

| 风险 | 严重度 | 说明 |
|------|--------|------|
| 第二阶段直接阻塞 | 高 | 自定义是路线图第二阶段，数据模型都没有 |
| free prompt 覆盖核心身份 | 高 | 开放自定义即污染入口 |

---

## 3. Roleplay Layer（角色扮演）⚠️ 几乎空白

### 已有能力

- **几乎没有作为一等公民的抽象**
  - 全仓库搜 roleplay/scene_context/scenario/cosplay/角色扮演 无结构性命中，全是无关字面量（latency tracer、test fixtures、prompt_builder 普通文本）
  - persona/presets.ts 是"可塑造型格"不是"角色扮演"
- **plugin 机制可承载但不是为它设计的**
  - plugin/registry.ts 有 PromptInjectionHook/OutputGuardHook，但插件全局注册（plugins: RemiPlugin[]），非 session-scoped
  - 详见 [ROLEPLAY_LAYER_DESIGN.md](./ROLEPLAY_LAYER_DESIGN.md) §6
- **capabilities/mode_control 有 enter/exit 模式**
  - NSFW 模式用它，但当前是全局开关，不是 session-scoped 叠加层

### 缺失能力（四个全缺）

1. **叠加层抽象**：无"场景/剧情模式"session-scoped 临时层概念，所有输入直接进主对话
2. **退出机制**：无"结束角色扮演回到本体"显式动作
3. **沉淀过滤器** ⚠️ **完全不存在**：无机制判断"哪些回灌本体、哪些随剧情丢弃"
4. **关系记忆隔离**：临时关系会直接污染真实关系史（无 scope 区分）

### 记忆 scope 现状（关键缺口）

- memory/episode_store.ts:29 MomentInput 接口字段：
  ```
  userId / summary / topic / mood / kind / salience / unresolved / statusHint
  ```
  **没有 scope/origin/context_type 字段**
- migrations/001_initial.js:71 episodes 表无 scope 列
- 所有 episode 进同一张表，本体记忆和剧情记忆物理不分
- 对应任务：NORTH STAR P0-5（加 scope 列）

### 产品风险 ⚠️ 最高

| 风险 | 严重度 | 说明 |
|------|--------|------|
| NSFW 是前车之鉴 | 高 | 已用"替换+不写"暴力解决污染，但是特例不是通用模式，无法扩展 |
| 沉淀过滤器不存在 | 高 | 角色扮演层核心技术难点，零基础（设计见 [ROLEPLAY_LAYER_DESIGN.md](./ROLEPLAY_LAYER_DESIGN.md)） |
| 直接加 cosplay 会污染本体 | 高 | 关系状态和 episode 同 user_id 命名空间，无隔离 |

---

## 4. World Presence（她在生活）

### 已有能力（最超出"聊天框"的一块）

| 能力 | 证据 | 说明 |
|------|------|------|
| 真实空间存在 | web/src/lib/world/、/world 路由 | RemiWorld v0.1：小岛/房间/庭院/记忆墙 |
| 自主行为调度器 | web/src/lib/world/behavior.ts（RW-P1-1 已完成） | 墙钟驱动 + 路点 BFS，5 日常行为，进入页面她已在做事 |
| 注意力系统 | RW-P1-2 已完成 | 进入 4.2m 抬头，5.5m 外回到做事 |
| 时间/作息 | worldTime.ts（RW-P2-1 已完成） | 清晨/午后/黄昏/深夜驱动行为池+灯光+prompt |
| 离线推演 | buildOfflineReturnOpener（RW-P2-2 已完成） | 按离开时长生成"你不在的时候…" |
| 世界事件进记忆 | server/session/world_event.ts（RW-P1-4b 已完成） | 种花/点灯/回访 → episodeStore.ingest |
| 声音形象 | voice/ 5 TTS provider + viseme + emotionToVrm | 已贯通世界 |

### 缺失能力

- **世界状态未服务端持久化**
  - 当前 WorldSave 在 localStorage
  - NORTH_STAR §4 硬约束要求"服务端持久化 + 进入时按流逝时间推演"，现在没做
  - 对应任务：NORTH STAR P2（迁移到 RemiSelf.worldPresence）
- **主动性只到沉默搭话**
  - proactive_planner 只在用户在场沉默时触发
  - 没有"她不在你面前时也在过日子"的可见层（NORTH_STAR §4 硬约束"不做常驻服务端模拟"，走低档）
- **十分钟观察基准未真机验收**
  - 单测过，真机长时样本没验（NORTH_STAR 活人感基准之一）

### 产品风险

| 风险 | 严重度 | 说明 |
|------|--------|------|
| localStorage 存档 = 单机玩具 | 中 | 换设备/清缓存世界就没了，与"持续存在"冲突 |
| 世界和聊天的 Remi 是否同一个 | 低 | /world 已接 useRemiChat（同连接同记忆），当前对；未来加 companion_id 要重验 |

---

## 5. 产品风险总览（按严重度）

| 风险 | 影响 | 现状 | 对应任务 |
|------|------|------|---------|
| 情绪不跨会话持久化 | Life Core 断裂 | 零持久化代码 | P1b |
| 记忆无 scope 区分 | Roleplay 必然污染本体 | MomentInput 无字段 | P0-5 |
| 沉淀过滤器不存在 | 角色扮演层核心难点 | 完全空白 | ROLEPLAY_LAYER_DESIGN |
| NSFW 替换模式是死路 | Performance 层无法扩展 | prompt_builder.ts:222 | P1a |
| 用户自定义无数据模型 | 第二阶段阻塞 | user_persona_presets 只有 preset_id | P2 |
| free prompt 无覆盖防御 | 开放自定义污染核心身份 | 无机制 | 原则二 |
| 世界状态在 localStorage | 单机玩具 | 待最小服务端持久化 | P2 |

---

## 6. DL 任务 / P 阶段映射

| 调研发现 | NORTH STAR 任务 | 阶段 | 状态 |
|---------|----------------|------|------|
| 情绪持久化 | P1b RemiSelf 最小持久化 | P1 | 待做（前提 W-PRES-01） |
| 记忆 scope 字段 | P0-5 episodes scope 列 | P0 | 待做（无运行时变更） |
| NSFW 包裹化 | P1a 替换→包裹 | P1 | 待做（前提 W-PRES-01） |
| 用户可配维度 | P2 Disposition 旋钮 | P2 | 待做（前提 P1a+b） |
| free prompt 防御 | 原则二（契约层约束） | 持续 | 已固化在 NORTH STAR |
| 沉淀过滤器设计 | ROLEPLAY_LAYER_DESIGN.md | 设计 | 已成文，待实现 |
| 世界状态服务端化 | P2 worldPresence 迁移 | P2 | 待做（前提 P1b） |

---

## 7. 关键文件索引（供实现会话快速定位）

| 关注点 | 文件 | 关键行 |
|--------|------|--------|
| 人格拼装顺序 | brain/prompt_builder.ts | 528-541（核心在前）、222-225（NSFW 替换反模式） |
| Persona 状态 | persona/index.ts | 53-78（PersonaLiveState）、260（buildRemiCoreContract） |
| Soul guardrails | persona/remi_soul_overlay.ts | 6 |
| 记忆写入 | memory/episode_store.ts | 29（MomentInput 无 scope）、287（ingest）、418（findRelevant） |
| episodes 表 | migrations/001_initial.js | 71 |
| 慢脑写路径 | brains/slow_brain.ts、background_analysis.ts | — |
| 主动性 | brains/proactive_planner.ts、server/session/continuity.ts | 144 |
| 断连持久化 | server/session/continuity.ts | persistRelationshipContinuityState |
| 情绪运行时（无持久化） | emotion/emotion_runtime.ts、emotion_engine.ts | — |
| 插件注册 | plugin/registry.ts | 全局非 session-scoped |
| 世界状态 | web/src/lib/world/ | behavior.ts、worldTime.ts、WorldSave |
| 用户 preset 表 | migrations/001_initial.js | 27（只有 preset_id） |

---

*最后更新：2026-06-22*
*状态：调研快照，行动前需复核代码*
