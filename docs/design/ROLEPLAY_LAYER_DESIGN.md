# Roleplay Layer 设计 — Performance 层下钻

> 状态：**设计提案，2026-06-22**。未实现。
> 定位：[DIGITAL_LIFE_NORTH_STAR.md](./DIGITAL_LIFE_NORTH_STAR.md) §2c IdentityEnvelope Performance Layer 的下钻设计文档。
> 只回答一个问题：**角色扮演/剧情/cosplay 期间发生的事，怎么不污染 Remi 本体。**

---

## 0. 为什么单独成文

NORTH STAR 定义了 Performance Layer 的**边界**（Core 不得缺席、退出必须干净、不得覆写身份、写入 episode 而非 Core、episode 带 scope）。
但边界只说"不得污染"，没说**怎么判定该不该沉淀**。这是角色扮演层最危险的技术难点，单独成文避免在契约文档里塞实现细节。

现状基线见 [DIGITAL_LIFE_AUDIT.md](./DIGITAL_LIFE_AUDIT.md) §3——Roleplay Layer 几乎空白，这是四个维度里最危险的一个。

---

## 1. 核心问题：沉淀过滤器

### 问题陈述

Performance 期间（角色扮演/剧情/cosplay）发生两类事：

| 类型 | 例子 | 该去哪 |
|------|------|--------|
| **剧情虚构** | "我是骑士，你是公主"、"我们在中世纪村庄" | scope=performance，退出后作为双方共有的剧情记忆保留，**不进 Core** |
| **剧情中泄露的真实事实** | 用户在角色扮演中随口说"我最近换了工作" | 应**沉淀**为 scope=core，因为这是用户的真实生活，Remi 本体应该记得 |

沉淀过滤器要回答的判定：**这条消息是剧情虚构，还是真实事实？**

判错两个方向都不行：

- **剧情误沉淀** → 本体记忆被虚构污染（"混成一坨"，违反用户核心约束）
- **真实事实被丢弃** → Remi 失忆，用户觉得她没在听

### 为什么这是难点

- 纯规则判定（关键词/句式）无法区分"骑士设定"和"换工作事实"——两者都是陈述句
- 纯 LLM 判定贵、慢、可能误判
- 用户不一定记得手动标记"这是真的"

### 提议机制：双层判定（hybrid）

```
Performance 消息进入
        │
        ▼
   [第一层：轻量启发式]（同步，不阻塞 fast path）
   - 用户第一人称 + 陈述现实世界事实（工作/家庭/健康/关系）→ 候选 real
   - 角色扮演人称（"骑士""公主""本王"）或设定陈述 → 候选 fictional
   - 模糊的 → 进第二层
        │
        ▼
   [第二层：LLM 判定]（异步，不阻塞 fast path）
   - prompt: "以下发生在角色扮演中，请判断是用户的真实生活事实，
     还是剧情设定。只输出 real/fictional/unclear。"
   - unclear → 默认按 fictional 处理（不污染 Core），写入
     performance episode 标记 needs_review
        │
        ▼
   [沉淀动作]
   - real → 提升 scope=core，进本体记忆
   - fictional → scope=performance，退出后保留为剧情记忆
   - unclear → scope=performance + needs_review，等用户显式确认
```

**关键约束**：

- 第二层 LLM 判定**异步**走，不在对话 fast path（同 CLAUDE.md 代码规则）
- 第一轮先把消息按 scope=performance 写入，判定完成后若为 real 再提升为 core
- scope 字段可改（单向提升：performance→core；core 不降级），判错可回滚

**安全失败方向**：unclear 默认 fictional。宁可少沉淀也不要污染 Core——污染是"混成一坨"，少沉淀只是剧情记忆，下次可补。

---

## 2. 前车之鉴：NSFW 替换模式是死路

### 现状（2026-06-22 代码）

brain/prompt_builder.ts:222-225 的 leanPersona 逻辑：
NSFW 模式下用 NSFW_PERSONA_BLOCK **整块替换**人格 prompt，Core 被丢弃。

```typescript
const personaPrompt = leanPersona
  ? (useBuiltinNsfwBlock ? NSFW_PERSONA_BLOCK : `你是 Remi...`)
  : buildPersonaPrompt(persona, {...});
```

同时 NSFW 模式下 slow brain 不持久化 interests/personalityNotes 等到 DB（TASKS.md 6.20 P0）。

### 为什么这是"解决了污染但走了死路"

- ✅ 它确实避免了 NSFW 内容污染 Core 画像
- ❌ 但机制是"替换 + 不写"，无法扩展到角色扮演：
  - 角色扮演需要 Core **在场**（用户要觉得还是 Remi 在演，不是别人）
  - 角色扮演需要**部分沉淀**（真实事实要回灌，不像 NSFW 全不写）
  - "替换"模型下没有地方放"Core + 演出叠加"，只能二选一

### 正确模式：包裹（wrap）不替换（replace）

NORTH STAR §2c 已给出正确结构：

```
prompt = [Core, Disposition, '--- 当前演出模式 ---', performanceInstructions]
```

NORTH STAR P1a 任务就是把 NSFW 从替换改成包裹。**这是所有 Performance 层的前置基建**——NSFW 改成包裹后，它就是第一个 Performance Envelope 的参考实现，后续 cosplay/剧情复用同一套包裹机制。

---

## 3. Performance 生命周期

### 状态机

```
[baseline] ──enter(performanceType, instructions)──> [in_performance]
     ▲                                                      │
     │                                                  exit()
     │                                                      │
     └──────────── exit_commit (沉淀过滤器跑完) ────────────┘
```

### enter

- 触发：用户显式请求（"我们来角色扮演""cosplay 成 X"）或 capability 检测
- 动作：
  - 记录当前 Disposition snapshot（用于 exit 时恢复）
  - 设置 performanceContext = { type, instructions, enteredAt }（session 级）
  - prompt 进入包裹模式：Core + Disposition + Performance block
- 不动作：**不改 Core**、**不改 Disposition 旋钮值**（只叠加演出指令）

### maintain（在 Performance 中）

- 每条消息走沉淀过滤器（§1）
- prompt 持续带 Performance block
- episode 写入带 scope=performance（除非过滤器提升为 core）
- 用户可中途调整演出指令（"换个场景"），不触发 exit/enter

### exit

- 触发：用户显式（"退出角色扮演""回到正常"）或会话断开
- 动作：
  - 跑沉淀过滤器剩余 unclear 消息（或标记为长期 needs_review）
  - 清除 performanceContext
  - 恢复 Disposition snapshot
  - 验收（NORTH STAR §2c 边界 2）：**下一条消息不得有任何残留角色特征**

### 与 capabilities/mode_control 的关系

NORTH STAR §2c 提到"Performance 状态机参照 capabilities/mode_control 的现有 enter/exit 模式实现"。
mode_control 已有 enter/exit 模式（NSFW 模式用它）。但当前 mode_control 是**全局开关**，不是 session-scoped 叠加层。需要扩展为：

- 一个 session 同时只有一个 Performance active（避免叠加混乱）
- Performance context 存在 session 级，不是全局
- exit 时严格清理（回归边界 2）

---

## 4. 关系记忆隔离

### 问题

"今天我们是师徒"是 Performance 内的临时关系。如果不隔离：

- 它会写进 relationship state（continuity.ts persistRelationshipContinuityState）
- 退出后 Remi 还认为用户是"徒弟"
- 污染了真实关系史

### 隔离策略

| 关系维度 | Performance 期间 | 退出后 |
|---------|-----------------|--------|
| 真实关系阶段（closeness 等） | **冻结**，不演进 | 恢复演进 |
| 演出内关系（师徒/主仆） | 只存在于 Performance block | 清除 |
| 真实关系的新进展（用户在演出中透露真实情感） | 沉淀过滤器判定 → 若 real，更新真实关系 | 保留 |

实现：Performance 期间 persistRelationshipContinuityState 写入时带 scope=performance 标记，退出时只保留 scope=core 的关系更新。

---

## 5. episode scope 写入规则

### 字段定义（NORTH STAR P0-5）

episodes.scope 列，枚举：

- core（默认）：本体记忆，Remi 永久记得
- performance：剧情记忆，退出 Performance 后保留为双方共有剧情，但**不进 Core prompt 的人格基线**

### 召回时的处理

episode_store.findRelevant() 召回时：

- **baseline 状态**：只召回 scope=core（本体不该被剧情记忆干扰）
- **in_performance 状态**：召回 scope=core + scope=performance（当前剧情内可引用剧情记忆）
- **退出后**：新消息召回 scope=core；scope=performance 的 episode 可被显式回忆（"还记得我们上次演的那个故事吗"）但不主动浮现

### 沉淀后的提升

scope 字段可改（单向）。沉淀过滤器判定为 real 的 performance episode，通过 update 改 scope=core。core 不会降级为 performance。

---

## 6. 与 plugin/registry 的关系

### 现状

plugin/registry.ts 有 PromptInjectionHook、OutputGuardHook 等生命周期钩子。但插件是**全局注册**（plugins: RemiPlugin[]），不是 session-scoped。

### 不能直接用来承载 Performance

- Performance 需要 session-scoped 的 enter/exit 生命周期，全局插件没有
- Performance 需要 scope 隔离的 episode 写入，插件 hook 没有 scope 概念
- 插件适合做"常驻能力"（如 voice_style、image_generation），不适合做"临时演出层"

### 正确关系

Performance Layer 是 **session 级状态**，不是 plugin。它消费 plugin 提供的 capability（如 mode_control 的 enter/exit 原语），但本身是 session 状态机的一部分，归属 server/session/。

---

## 7. 非目标

- **不实现用户自定义角色卡上传**（违反 NORTH STAR 原则三）
- **不做开放世界剧情生成**（归 RemiWorld 主线）
- **不实现多人角色扮演**
- **不在 fast path 同步跑沉淀过滤器**（第二层 LLM 判定必须异步）
- **不承诺过滤器 100% 准确**——unclear 默认 fictional 是安全失败方向，宁可少沉淀也不要污染 Core

---

## 8. 实现前置依赖

| 依赖 | 状态 | 说明 |
|------|------|------|
| NORTH STAR P0-5 episodes scope 字段 | 待做 | 本文档所有 scope 逻辑的前置 |
| NORTH STAR P1a NSFW 包裹化 | 待做 | 第一个 Performance Envelope 的参考实现 |
| NORTH STAR P1b RemiSelf 持久化 | 待做 | Performance context 的 session 级存储可复用其模式 |
| W-PRES-01 默认人格稳定 | in_progress | 任何 Performance 实现不得干扰主线（NORTH STAR 原则一） |

---

## 9. 待决策的开放问题

留给实现会话决策（本文档不拍板）：

1. **沉淀过滤器第二层用哪个模型**：主 LLM 还是轻量 fast brain？成本 vs 准确率权衡。
2. **unclear episode 的 needs_review 何时清理**：用户显式确认？还是下次进入同类型 Performance 时批量提示？
3. **Performance context 跨会话保留吗**：用户中途断线，下次回来还在角色扮演里，还是自动 exit？倾向后者（自动 exit + 提示"上次我们演到一半"）。
4. **多个 Performance 类型之间的切换**：从 cosplay 切到剧情，是 exit+enter 还是 hot-swap？倾向 exit+enter 保持干净。
5. **沉淀过滤器的判定粒度**：按消息还是按 episode？消息级更细但更贵；episode 级更省但可能漏掉单条真实事实。倾向消息级判定 + episode 级沉淀。

---

*最后更新：2026-06-22*
*状态：设计提案，未实现，等待 P0-5/P1a 前置完成后进入实现*
