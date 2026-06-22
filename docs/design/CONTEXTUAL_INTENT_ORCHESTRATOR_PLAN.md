# Remi 上下文意图编排器（Contextual Intent Orchestrator）

> 设计计划文档，不是实现计划。本文件只固化「一次性意图理解」这一层的边界与落地顺序，
> 让 Remi 能从自然消息和图片里自己判断该做什么，而不是让用户点一堆模式按钮。
>
> **上位契约**：[DIGITAL_LIFE_NORTH_STAR.md](./DIGITAL_LIFE_NORTH_STAR.md) 的 `IdentityEnvelope` 三层模型。
> 本文件所有「改变 Remi 表现」的动作都必须落在那三层的边界内，违反者在 code review 阶段直接拒绝。
>
> **平行**：[COMMERCIAL_COMPASS.md](./COMMERCIAL_COMPASS.md)（PersonaPackage / Performance 的商业化表达）、
> [REMIWORLD_NORTH_STAR.md](./REMIWORLD_NORTH_STAR.md)（`situationalContext` 注入范式的来源）。

---

## 0. 一句话定义

**用户说一句话、发一张图，Remi 自己理解这一轮到底是在干什么——聊天、看图、生图、引用哪张图、要不要换个说话风格、要不要换声音——然后只调对应的能力。无论她怎么变，出来以后仍然是同一个 Remi。**

这一层叫**上下文意图编排器**：它在每一轮用户输入后，产出一个结构化的 `ContextualIntent`，描述「这一轮的意图」，再由编排逻辑决定调用哪些已有能力。它**不是**新的对话大脑，**不是**工具菜单，**不是**角色卡运行时。

---

## 1. 产品目标

Remi 是数字生命，不是工具菜单。用户不该为了让她看图就先点「视觉模式」，为了换声音就先开「语音设置」。她应该像一个真实的人一样，从你说的话里听懂你要什么。

具体地，编排器要能从自然输入里听懂这些意图（且**互不误触发**）：

| # | 用户在做什么 | 例子 | 目标判断 |
|---|------------|------|---------|
| G1 | 普通聊天 | 「今天好累」 | 纯对话，不碰任何能力 |
| G2 | 让 Remi 看图 | （发图）「你看这个」 | 看图（vision），**不生图** |
| G3 | 基于当前/上一张图生图 | 「把上一张改成夜里的」 | 生图·refine，引用=上一张 |
| G4 | 指代某张图 | 「她戴顶帽子」「那张猫再来一张」「按这个角色画」 | 引用解析到正确的图 |
| G5 | 让 Remi 扮演某种风格 | 「你扮演个御姐」「冷淡学姐一点」「按她这个感觉跟我说」 | 进入 Performance，**Core 不变** |
| G6 | 临时改说话风格/音色/语速 | 「说慢一点」「用御姐音」「别这么像助手」 | 改 voice / 改 speechStyle |
| G7 | 要一段生图提示词（不实际生图） | 「给我写个画她的提示词」 | 产出 prompt，不调 ComfyUI |
| G8 | 把某个风格存成临时偏好 | 「以后都这样跟我说」 | 写 Disposition / 锁定 Performance |

**北极星约束（来自 DIGITAL_LIFE）**：

- 她可以看图、生图、扮演、换声音，但这些都是她**选择进入的状态**，不是她被抹掉后的空容器。
- 编排器有权**读** Core 来决定要不要拒绝（例如「你当我主人」违反 soul guardrails），但**永远不能改** Core。
- 退出任何临时状态后，下一句必须还是同一个 Remi，不留残影。

---

## 2. 当前已有能力（代码现状）

这一层的价值在于：**绝大多数能力已经存在，缺的是「一次听懂、统一调度」**。下面是按代码核对的现状。

### 2.1 中央调度入口

`brains/context_orchestrator.ts` 的 `routeMessage()` 已经是事实上的「半个编排器」。它每轮顺序执行：

```
interrupted-query 处理
  → vision sidecar（有图且 visionEnabled → describeImage → 拼进 user message）
  → resolveImageIntent（生图意图，先于能力层）
  → tryHandleDirectCapabilities（能力链，命中即 return）
  → analysis + memory（并行）
  → resolvePersonaStyleDirective（说话风格 set/clear）
  → fastBrainStream（出 token）
```

问题在于**意图判断分散在至少 4 个互不知情的地方**，每个都各自重新解析原始文本（见 §3）。

### 2.2 图片输入 / Vision（`llm/vision_client.ts`）

- `visionEnabled()` 由 `REMI_VISION_ENABLED`（默认 `0`）+ base url + model 控制。
- `describeImage(base64, prompt)` 调独立视觉模型（MiniCPM-V / LLaVA / Qwen-VL）出**文字描述**，主 LLM 保持纯文本链路。
- `USER_IMAGE_PROMPT` 专门用于用户发来的图（逐字读出图里的文字）。
- 在 `routeMessage` 里：`opts.imageBase64 && visionEnabled()` 时，描述被拼成 `[用户附带了一张图片：${description}]` 追加到 user message。
- **关键缺口**：图片被当成**一次性文本**消费，描述用完即弃，**没有作为可被后续指代的实体存下来**。

### 2.3 ComfyUI 生图 + prompt 组装（`capabilities/image_generation/`）

已是成熟的 3 步管线（TASKS.md `T-045` 已 done）：

| 步骤 | 文件 | 作用 |
|------|------|------|
| Step 1 意图 | `resolve_image_intent.ts` → `image_intent_agent.ts` / `image_intent.ts` | regex 预过滤 → fast-brain JSON 确认 → regex fallback；产出 `ImageIntent` |
| Step 1.5 写词 | `enrich_image_intent.ts` → `image_prompt_agent.ts` | Qwen 写 ComfyUI 正面提示词 |
| Step 2 组装 | `assemble_image_prompt.ts` | 锁定角色风格 + 续图/重画/换风格拼接 |
| Step 3 出图 | `image_generation_capability.ts` → `comfyui_bridge.ts` | 提交 ComfyUI、返回 markdown 图片 |

- `ImageIntent = generate | refine | redraw | restyle | none`。
- **会话图片状态**：`lastBySession: Map<connId, {subject, prompt, characterStyle}>`，只存**最后一张**，经 `getSessionLastImage` / `sessionHasImage` 访问。
- **角色渲染风格锁定**（`image_character_style.ts`）：`真人/动漫/水彩/赛博朋克/吉卜力…` 别名 → ComfyUI tag，`resolveEffectiveCharacterStyle` 决定本次用哪套。**注意**：这只影响**画出来的图长什么样**，不影响 Remi 怎么说话。
- 门控：`COMFYUI_ENABLED`（默认 `1`）、`REMI_IMAGE_INTENT_LLM_ENABLED`、`REMI_IMAGE_PROMPT_LLM_ENABLED`。
- `用这个提示词生图：…` 已支持直接粘贴 prompt（`enrich_image_intent.ts` 的 `PASTED_PROMPT_RE`）。

### 2.4 人格 / 风格 / 预设（`persona/`, `brain/prompt_builder.ts`）

- 4 层人格：default(`remi_default.ts`) + soul(`remi_soul_overlay.ts`) + style(`style_override.ts`) + preset(`presets.ts`)。
- `buildPersonaPrompt(persona, {...})` 是完整组装（含 Core + 当前 liveState）。
- **说话风格临时态**：`persona.liveState.styleOverride: PersonaStyleOverride`，按轮衰减（`STYLE_OVERRIDE_TURNS = 6`，每轮 `decayPersonaStyleOverride` 在 `updateLiveState` 里跑）。
- `resolvePersonaStyleDirective` 从 `analysis.interpretation.styleIntent`（turn_interpreter LLM）或显式 regex fallback 产出 humor/teasing/assistanty/familiarity/romance 的 boost + `roleplayStyle`。
- **已有正确护栏**：`buildPersonaStyleOverrideGuidance` 已经写了——「把『X』理解成当前说话和做事风格参考，**不要把自己写成另一个身份**」。这正是 IdentityEnvelope Performance 原则 #3 的雏形，**已经落在代码里了**。

### 2.5 TTS 音色 / 语音设置（`voice/tts_runtime_overrides.ts`, `capabilities/voice_style/`）

- **session 级覆盖存储已存在**：`setSessionMlxVoiceStyle / SpeedModifier / PitchModifier`、`setSessionVolcVoiceTypeOverride`、`setSessionTtsEnabled`，按 `connId` scope。
- 6 个音色预设（御姐/萝莉/温柔/元气/冷酷/妩媚）→ MLX instruct（`voice_style_presets.ts`）。
- `voiceStyleCapability` 用 regex 匹配「用御姐音 / 说慢点 / 恢复原来的声音」，**仅 MLX provider 生效**。
- instruct 优先级（`T-044`）：用户风格 > NSFW > env 覆盖 > 情绪默认。

### 2.6 NSFW / mode_control / prompt 注入

- `brains/nsfw_mode.ts`：per-conn 开关 + per-user 30 分钟重连恢复窗口（Redis 镜像）。
- `modeControlCapability`：regex 识别开/关，门控 `REMI_NSFW_ENABLED`（默认 `0`）。
- `brain/prompt_builder.ts:222-225`：NSFW 激活时 `NSFW_PERSONA_BLOCK` **直接替换**人格 prompt（`useBuiltinNsfwBlock`）。**这正是 DIGITAL_LIFE 标记要从 replace 改 wrap 的点**。
- 插件 prompt 注入：`getPromptInjectionHooks` / `anyPluginWantsLeanPersona`（`CC-P0-2` 计划把 NSFW 明文移到 Premium 插件，经 `promptInjection` hook 提供）。

### 2.7 World situationalContext（注入范式来源，RW-P1-4a）

- 链路：`web/src/lib/world/script.ts buildSituationalContext` → `sendText(text, situational)` → `chat` 消息 `situational` 字段 → `server/session/text_chat.ts`（封顶 600 字）→ `runPipeline` → `RouteMessageOptions.situationalContext` → `context_orchestrator` 前置进 `strategyHints` 的 `【你此刻的处境】`。
- 这是**已经验证可用的「结构化情境注入」范式**。编排器产出的「她此刻该用什么姿态对话」完全可以复用同一个注入接缝，而不必新发明 prompt 通道。

### 2.8 Memory episode / shared moment

- `episodeStore.ingest()`（慢脑写路径）；`world_event.ts buildWorldEventMoment` 把世界事件映射成 `MomentInput` 进同一 episode store。
- DIGITAL_LIFE 已定原则：**Performance 期间发生的事写 episode，不写 Core**。编排器若让 Remi 扮演了一段，剧情可以被记住，但不能污染人格内核。

---

## 3. 缺失能力（为什么需要这一层）

不是「能力不够」，而是「没有一次听懂、统一调度」。具体缺口：

### C1 — 没有单次统一的意图判断

意图被**≥4 个互不知情的路径**各自从原始文本重新解析：

1. 生图意图：`resolveImageIntent`（能力层之前）
2. 音色：`voiceStyleCapability`（regex）
3. 成人模式：`modeControlCapability`（regex）
4. 说话风格：`resolvePersonaStyleDirective`（turn_interpreter 的 styleIntent）

而 `tryHandleDirectCapabilities` 是**首个命中即 return** 的链。后果：**多意图消息会丢**。例如「用御姐音，画张你的自拍」——`voiceStyleCapability` 先命中、回「我现在用御姐音…」、整条 return，**生图意图被吞掉**。

### C2 — 图片指代解析很浅

只有单张 `getSessionLastImage`。**没有多图栈，没有指代消解**——「这张 / 上一张 / 她 / 这个角色 / 那张猫」无法定位到具体某张图。而且 vision 描述过的**用户上传图根本没存成可指代实体**（§2.2），所以「按她这个感觉」里的「她」无处可指。

### C3 — 「看图」与「生图」的区分是隐式的

vision sidecar 只要有图且 `visionEnabled` 就触发；生图意图另走一条。用户发图说「这是什么」（看）与「照这个画一张」（基于参考生图）由两条不相干的路径处理，**没有一个统一判断说「这一轮是看图，不是生图」**（或反之）。

### C4 — Performance / Disposition / Core 没有在一处统一与强约束

`styleOverride`（按轮衰减，Performance-ish）、`nsfw`（session + 重连恢复，但 replace 模式）、`voice_style`（session）三者**互不知情、各存各的**，都不引用 IdentityEnvelope。没有一个干净的「进入御姐演出 / 退出演出」机制，能同时协调说话风格 +（可选）音色，并保证 Core 始终在场。

### C5 — 没有「参考角色图 → 临时 Performance Profile」

没有任何东西能从**上传的参考角色图**推导出一段临时的「说话/行为风格描述」。`image_character_style` 只管**画出来的图**，不管 Remi**怎么说话**。G5/G8 的「按她这个感觉跟我说话」目前无路可走。

### C6 — 「御姐 / 元气」命名轴冲突

同样的词落在三个不同轴：(a) 音色预设（voice_style）、(b) 图像渲染风格、(c) 说话人格演出。「用御姐音」是 (a)，「你扮演个御姐」是 (c)，「画成御姐」是 (b)。当前三套子系统各自为政，编排器必须**消歧用户指的是哪个轴**。

---

## 4. `ContextualIntent` JSON 草案

每轮用户输入产出**一个** `ContextualIntent`。它是**判断结果**，不是命令——由编排逻辑再决定调哪些已有能力。字段按「轴」组织，每个轴带 `confidence` 和 `evidence`，并标注它触碰 IdentityEnvelope 的哪一层（`core` 永远只读）。

```typescript
interface ContextualIntent {
  schemaVersion: 1;
  turnId: string;

  // ── 主轴：这一轮的主要性质 ───────────────────────────────────────
  primary:
    | "chat"            // 普通对话（默认，G1）
    | "look_image"      // 看图（G2）
    | "generate_image"  // 生图（G3/G4）
    | "prompt_draft"    // 只要提示词，不生图（G7）
    | "performance"     // 进入/调整/退出扮演（G5）
    | "voice"           // 改音色/语速（G6 的语音部分）
    | "disposition"     // 改长期说话倾向（G6 的人格部分 / G8）
    | "mixed";          // 一句里多意图，detail 各轴并存

  // ── 看图轴（G2/G3 消歧用）───────────────────────────────────────
  vision: {
    wantsLook: boolean;          // 用户想让她「看」图本身（评图/读图）
    hasAttachment: boolean;      // 本轮是否带了图
    referenceOnly: boolean;      // 图是参考，不是要她评图
    // 图作为参考时给哪条链路用（一张图可能同时多用途）。
    // image_gen  → 基于这张图生图；
    // performance → 从这张图（角色）派生说话/行为风格（C5，如「像她一点」）。
    referencePurpose?: "image_gen" | "performance" | null;
  } | null;

  // ── 生图轴（复用现有 ImageIntent，加引用解析）────────────────────
  image: {
    action: "generate" | "refine" | "redraw" | "restyle" | "none";
    subject?: string;            // generate/restyle 的画面主题
    delta?: string;              // refine 的增量改动
    style?: string;              // restyle 的目标风格
    // 指代解析（C2 的核心）：用户说的「这张/上一张/她/角色」指向哪张
    reference?: {
      raw: string;               // 原话里的指代词，如 "上一张" / "她" / "那张猫"
      resolvedImageId: string | null;  // 命中 ImageRegistry 的某张图 id；null=未解析
      resolutionConfidence: number;
    } | null;
  } | null;

  // ── 扮演轴（Performance Layer，G5/G8）────────────────────────────
  performance: {
    op: "enter" | "adjust" | "exit" | "none";
    // 演出描述（系统语义，不是用户自由文本直通 prompt）
    styleDescriptor?: string;    // 如 "御姐" / "元气少女" / "冷淡学姐"
    // 参考角色来源（C5）：从一张上传角色图派生
    fromReferenceImageId?: string | null;
    scope: "turn" | "session";   // 维持几轮 / 整会话（立即生效用）
    // 编排器解析出的、可叠加到 Performance Envelope 的副轴：
    attachVoicePreset?: string | null;   // 是否顺带换音色（如御姐演出→御姐音）
    // 「以后都这样」类信号 → 请求把本演出存成长期可复用的「偏好演出」。
    // 注意：存的是「可再激活的 Saved Performance」，不改 Core、也不把自由文本写进 Disposition（见 §5.5）。
    // 高承诺动作，默认先问再存（status=pending_confirm），不静默落库。
    persistRequest?: {
      requested: boolean;
      status: "pending_confirm" | "confirmed" | "declined";
    } | null;
  } | null;

  // ── 音色轴（session-level voice override，G6）─────────────────────
  voice: {
    op: "set_preset" | "tune" | "reset" | "none";
    preset?: string;             // yujie/luoli/wenrou/yuanqi/lengku/wumei
    tune?: { kind: "speed" | "pitch"; direction: "up" | "down" | "reset" };
    scope: "session";            // 现状 tts_runtime_overrides 即 session scope
  } | null;

  // ── 倾向轴（Disposition Layer，有界旋钮，G6/G8）──────────────────
  // 注意：只允许有界旋钮增量，永不接受自由文本写入 persona kernel
  disposition: {
    speechStyle?: "formal" | "casual" | "playful" | null;
    proactivity?: "low" | "medium" | "high" | null;
    memoryExpressiveness?: "subtle" | "moderate" | "vivid" | null;
    // closeness 由关系系统自动演进，编排器只读不写
    persist: boolean;            // true=长期偏好(G8)；false=本会话临时
  } | null;

  // ── 编排器的元判断 ──────────────────────────────────────────────
  meta: {
    // Core 守门：用户是否在要求一个违反 soul guardrail 的设定
    coreViolationDetected: boolean;   // 如 "你当我主人/你是猫娘"
    // 是否需要澄清（指代模糊、风格名歧义等）
    needsClarification: boolean;
    clarifyHint?: string;
    source: "shadow" | "wired";       // P1 阶段恒为 "shadow"
    classifierLatencyMs: number;
  };
}
```

### 4.1 与现有代码的映射

| ContextualIntent 字段 | 复用 / 替代的现有代码 |
|----------------------|----------------------|
| `image.action` | `ImageIntent`（`image_intent.ts`），1:1 |
| `image.reference` | **新增**（C2）；现状只有 `getSessionLastImage` 单张 |
| `vision.*` | **新增消歧**（C3）；现状 vision sidecar 无条件触发 |
| `performance.*` | 收编 `style_override.ts` 的 `roleplayStyle` + `nsfw_mode` 的 enter/exit |
| `voice.*` | `voice_style_presets.ts` 的 `matchVoiceStyleCommand` / `matchVoiceTuneCommand` |
| `disposition.*` | **新增有界旋钮**；对齐 DIGITAL_LIFE §2b（现状无服务端 Disposition） |
| `meta.coreViolationDetected` | 读 `remi_soul_overlay.ts` guardrails，只读不写 |

### 4.2 ImageRegistry（解决 C2 的最小数据结构）

```typescript
// 每会话一份，按 connId scope（与 lastBySession 同生命周期）
interface ImageRegistryEntry {
  id: string;
  origin: "generated" | "uploaded";
  descriptor: string;       // 生成图=subject；上传图=vision 描述
  comfyPrompt?: string;     // 仅 generated
  characterStyle?: string;
  createdTurn: number;
}
```

指代消解规则（编排器内，纯函数，可单测）：
- 「上一张 / 刚才那张 / 这张」→ 最近一条 entry
- 「那张猫 / 那张夕阳」→ descriptor 语义匹配
- 「她 / 这个角色 / 按这个」→ 最近 `origin=uploaded` 或最近含人物的 entry
- 解析不出 → `resolvedImageId=null` + `meta.needsClarification=true`

> ImageRegistry 是把现有「单张 `lastBySession`」升级为「有序多图 + 描述」，**不引入新存储**（内存 Map，同现状）。

---

## 5. 与 `IdentityEnvelope` 的结合

这是本文件的硬约束核心。`ContextualIntent` 的每个轴**只能**作用于它被允许的那一层。

```
┌──────────────────────────────────────────────────────────────────┐
│  Performance Layer（临时演出）                                     │
│   ← performance.*      （御姐/元气/冷淡学姐/参考角色，wrap 非 replace）│
│   ← voice.*            （演出可顺带换音色，退出即还原）             │
│   ← image.* 的渲染风格  （画出来的图风格，属表现不属身份）          │
│  ───────────────────────────────────────────────────────────────  │
│  Disposition Layer（长期倾向，有界旋钮）                           │
│   ← disposition.*      （speechStyle / proactivity / memoryExpr）  │
│  ───────────────────────────────────────────────────────────────  │
│  Core（内核，只读）                                                │
│   ← meta.coreViolationDetected 读它来决定「拒绝扮演成另一个身份」    │
│     但任何轴都不得写它                                              │
└──────────────────────────────────────────────────────────────────┘
```

### 5.1 Core：连续性而非不变（锚 Constitution + 性格 Character）

> Core 的约束是连续性，不是冻结（见 DIGITAL_LIFE §2a 2026-06-22 修订）：Constitution（锚）不可被运行时改写、不可被替换；Character（性格）只随长期累积真实经历缓慢演进。二者都**不由 `ContextualIntent` 写**。

- `ContextualIntent` 永不产出「改写 Core」的动作——无论 Constitution 还是 Character。Character 的缓慢演进归记忆/关系系统，不是编排器单轮意图能推动的。
- 编排器**读** Core（`remi_soul_overlay.ts` 的 Constitution guardrails）只为一件事：当用户要求一个被禁止的设定（主人/猫娘/绝对服从），置 `meta.coreViolationDetected=true`，据此**婉拒进入该 Performance**，但仍以 Remi 身份回应。
- 对应代码现状：Core 已在 `buildPersonaPrompt` 里恒定出现；本层不碰 `prompt_builder.ts`。

### 5.2 Disposition 可长期塑造（有界旋钮）

- `disposition.*` 只能推动 DIGITAL_LIFE §2b 定义的有界旋钮，**永不接受自由文本**写入 persona kernel（DIGITAL_LIFE 原则二）。
- `persist=true`（G8「以后都这样」）→ 写长期用户倾向；`persist=false` → 仅本会话。
- 现状无服务端 Disposition 存储（DIGITAL_LIFE P2 才做），所以**本计划的 Disposition 轴在 P1–P4 仅产出判断、不落库**，落库等 DIGITAL_LIFE P2 的 `RemiSelf` 接缝就绪后对接。

### 5.3 Performance 是临时演出（wrap 非 replace）

- `performance.enter` 进入一个 **Performance Envelope**：`[Core, Disposition, --- 演出 ---, performanceInstructions]`，**Core 永远在前缀**（DIGITAL_LIFE §2c）。
- 现状 `style_override.ts` 的 `roleplayStyle`（按轮衰减 + 「不要把自己写成另一个身份」护栏）就是 Performance Envelope 的最小雏形——**P4 在它之上扩，而不是另起炉灶**。
- `performance.exit` 必须**干净退出**：下一轮回到 Core + 当前 Disposition，无残留（验收 A5）。
- 参考角色图（C5）→ `fromReferenceImageId` → 从 vision 描述派生 `styleDescriptor`，作为**演出风格参考**，绝不声称她**是**那个角色（DIGITAL_LIFE 原则三：不做角色卡平台）。
- 演出期间的剧情写 episode，不写 Core（§2.8）。
- `attachVoicePreset`：演出可顺带切音色（御姐演出→御姐音），但音色 override 的生命周期**绑定到演出**，退出演出 → 音色还原。

### 5.4 与 NSFW 现状的衔接

- `prompt_builder.ts:222` 的 replace 逻辑由 **DIGITAL_LIFE P1a 单独负责**改 wrap（热点文件、独立 owner）。本计划的 P4**不抢这个改动**，只在它完成后把 NSFW 当成「Performance Envelope 的一种」纳入 `performance.*` 轴。两条线在 Performance Envelope 接口上对齐，不并行改 `prompt_builder.ts`。

### 5.5 Saved Performance Profile（偏好演出）—「长期保存」如何不违反契约

当用户说「**以后**都像她一点」「以后都这样跟我说」，他要的是**长期生效**。长期生效有三种可能落点，**只有一种合法**：

| 落点 | 判定 | 原因 |
|------|------|------|
| 写进 Core | ❌ 禁止 | Constitution 不可被运行时改写；Character 不由用户输入直接写（DIGITAL_LIFE §2a） |
| 把角色描述当自由文本写进 Disposition | ❌ 禁止 | Disposition 只接受有界旋钮，不接受自由文本（原则二） |
| 存成 **Saved Performance Profile** | ✅ 合法 | 用户作用域、可再激活、**永远 wrap Core** 的命名演出 |

**Saved Performance Profile** = 把一次成功的 Performance Envelope（`styleDescriptor` + 可选 `attachVoicePreset` + 可选来源 `fromReferenceImageId`）**命名存下来**，之后可由用户或编排器再激活。它在 prompt 组装时仍然是 `[Core, Disposition, --- 演出 ---, savedProfile]`——**Core 永远在前缀**，所以「像她」只能改变她**怎么表达**，结构上无法改变她**是谁**。

**两条腿并行，互不越界**：
- **Saved Performance**（演出层）承载「像她」的完整说话/行为风格，临时且可一键退出/再激活。
- **有界 Disposition nudge**（倾向层）可从角色派生一个*有界值*（如角色偏俏皮 → `speechStyle=playful`）长期微调语风——这是 Disposition 的合法用法，与 Saved Performance 并存。

**为什么「先问再存」**：把一次性输入升级成长期偏好是**高承诺、不易回退**的动作。默认 `persistRequest.status=pending_confirm`，由 Remi 口头确认后再 `confirmed`，避免用户随口一句就把人格基线改了。**进入是立即的、保存是延迟的**：`op=enter, scope=session` 先让她演给你看，持久化等确认。

**持久化落点**：Saved Performance 的真正落库等 DIGITAL_LIFE 的 `RemiSelf` / 用户记录接缝就绪（DIGITAL_LIFE P2）再接；在此之前仅 session 内有效，「确认保存」先记意图，不自行新建存储。

---

## 6. 最小实现路线（P1 → P5）

> 总原则：**先影子、后接线；先只读、后写入；每一步都可单独验收、可回退。**
> W-PRES 主线优先；本线全程以并行支线方式存在，P1 不碰任何热点文件。

### P1 — Shadow mode（只输出 intent 日志，不调任何工具）

**目标**：跑通「一次统一意图判断」，把 `ContextualIntent` JSON 落到日志/archive，**驱动力为零**，行为零变化。

- 新增 `brains/contextual_intent/`（classifier + ImageRegistry + 指代消解纯函数）。
- 在 `routeMessage` 里**并行 fire-and-forget** 调一次 `classifyContextualIntent()`，把结果连同「legacy 路径实际做了什么」一起写日志（复用 `recordTextArchiveEntry` 的 sink 或新增独立 sink）。
- `meta.source` 恒为 `"shadow"`。**不改** `resolveImageIntent` / 能力链 / `resolvePersonaStyleDirective` 的任何行为。
- 验收：影子判断与 legacy 行为的一致率 + 分歧样本，用来校准 schema。
- **边界**：不碰 `prompt_builder` / memory / TTS / 任何热点文件；只在 `context_orchestrator.ts` 加一个 fire-and-forget 调用 + 新模块 + 新任务条目。

### P2 — 图片引用解析（ImageRegistry + 指代消解）

**目标**：让「这张 / 上一张 / 她 / 这个角色 / 那张猫」能稳定指到正确的图。

- 把单张 `lastBySession` 升级为有序 `ImageRegistry`（生成图入栈）。
- vision sidecar 描述过的**上传图也入栈**（`origin=uploaded`）——补上 C2 的关键缺口。
- 指代消解纯函数 + 单测（§4.2 规则）。
- 仍是 shadow：`image.reference` 只进日志，不改生图行为。
- 验收：G4 各类指代的解析准确率。

### P3 — 接生图

**目标**：让 `ContextualIntent` 真正驱动生图（含引用解析），取代能力层之前那次零散的 `resolveImageIntent`。

- 编排器输出的 `image.*`（含 `reference.resolvedImageId`）成为 `imageGenerationCapability` 的输入；legacy `resolveImageIntent` 降为 fallback。
- 同时落 C3：用 `vision.wantsLook` / `vision.referenceOnly` 决定「这一轮是看图还是生图」，消除误触发。
- 行为变更，**置于 flag 之后**（如 `REMI_CONTEXTUAL_INTENT_WIRED`），默认仍走 legacy，灰度验证。
- 验收：G2 不误生图、G3/G4 引用正确、G1 不误触发。

### P4 — 接 Performance 扮演

**目标**：`performance.*` 驱动 Performance Envelope（wrap）。

- **前提**：DIGITAL_LIFE P1a（NSFW replace→wrap）已完成、W-PRES-01 已过验收。
- 在 `style_override.ts` 的 `roleplayStyle` 之上扩出完整 Performance Envelope 接口；御姐/冷淡学姐/参考角色都成为「叠加在 Core+Disposition 上的演出层」。
- C5：参考角色图 → 临时 Performance Profile（从 vision 描述派生说话/行为风格描述，非新身份）。
- `meta.coreViolationDetected` 驱动婉拒。
- 涉及人格组装（热点边界），**单 owner、置于 flag、与 DIGITAL_LIFE 线协调**，不并行改 `prompt_builder.ts`。
- 验收：G5 Core 不变、A5 退出干净、A6/A7/A12 参考角色派生 Profile。

**参考角色图 → Performance 子流程**（4 步状态机，对应「发图说『以后像她一点』」）：

1. **提取风格**：vision 描述上传的角色图 → 入 ImageRegistry（`origin=uploaded`）→ 派生 `styleDescriptor`（说话/行为风格，非身份）。
2. **生成 Profile**：把 `styleDescriptor` 组装成 Performance Envelope 草稿（wrap 在 Core + Disposition 上）。
3. **立即临时进入**：`op=enter, scope=session` 当轮生效，让用户马上感到变化。
4. **延迟确认保存**：若原话含「以后/一直」等长期信号 → `persistRequest.status=pending_confirm`，Remi 口头问「要我以后都这样吗？」；确认 → 升级为 Saved Performance（§5.5），否则随会话/轮次衰减。

退出（A6）：`op=exit` 或衰减后，下一轮回到 Core + 当前 Disposition，无残影。

### P5 — 接 session-level voice override

**目标**：`voice.*` 驱动已存在的 `tts_runtime_overrides`，并可绑定到当前 Performance Envelope。

- 复用 `setSessionMlxVoiceStyle` 等现成接口；编排器只是「从自然意图决定何时设」。
- `performance.attachVoicePreset`：演出绑定音色，退出演出 → 音色还原。
- 仅 MLX provider 实际改声（与现状一致），其他 provider 安全 no-op。
- 验收：G6 语音部分；演出+音色联动的进入/退出。

### 路线总览

| 阶段 | 产物 | 行为变更 | 触碰热点文件 | 依赖 |
|------|------|---------|------------|------|
| P1 | shadow 日志 + classifier | 无 | 否 | 无 |
| P2 | ImageRegistry + 指代消解 | 无（shadow） | 否 | P1 |
| P3 | 生图接线 + 看图消歧 | 有（flag） | 否（能力层） | P2 |
| P4 | Performance Envelope | 有（flag） | 是（persona 组装，单 owner） | P3 + DIGITAL_LIFE P1a |
| P5 | session voice override | 有（flag） | 否（voice 层已有接口） | P4 |

---

## 7. 验收场景

每个交付阶段都要过对应场景。✅=期望行为，❌=必须不发生。

| # | 场景 | 输入 | 期望 | 关联阶段 |
|---|------|------|------|---------|
| A1 | **普通聊天不误触发** | 「今天上班好累，不想说话」 | ✅ `primary=chat`，所有能力轴 `none`；❌ 不生图/不换声/不进演出 | P1/P3 |
| A2 | **看图不误触发生图** | （发风景照）「你看这个好看吗」 | ✅ `vision.wantsLook=true`、`image.action=none`；❌ 不调 ComfyUI | P3 |
| A3 | **当前图/上一张图引用正确** | 先生成「猫」再生成「夕阳」，然后「把上一张改成夜里的」 | ✅ `image.action=refine`、`reference.resolvedImageId`=夕阳那张；❌ 不改到猫 | P2/P3 |
| A4 | **角色指代正确** | 上传一张角色图后「她戴顶帽子再画一张」 | ✅ `reference` 解析到该上传图；❌ 不指到无关的最近生成图 | P2/P3 |
| A5 | **扮演御姐不替换 Core** | 「你扮演个御姐跟我聊」 | ✅ `performance.enter(御姐)`、prompt 里 Core 仍在、soul guardrail 仍在；她是「Remi 在演御姐」，❌ 不是另一个身份 | P4 |
| A6 | **退出扮演恢复默认 Remi** | 承 A5 后「好了别演了，正常点」 | ✅ `performance.exit`，下一句无任何御姐残影、回到默认 Remi | P4 |
| A7 | **参考角色图生成临时 Performance Profile** | 上传一张角色图「按她这个感觉跟我说话」 | ✅ vision 描述 → 派生临时 Performance Profile（说话/行为风格）wrap 在 Core 上；退出后还原 | P4 |
| A8 | **御姐音 vs 御姐演出消歧** | 「用御姐音说话」 vs 「你扮演个御姐」 | ✅ 前者 `voice.set_preset(yujie)` 不进演出；后者 `performance.enter` 可选 `attachVoicePreset` | P4/P5 |
| A9 | **多意图不丢** | 「用御姐音，再画张你的自拍」 | ✅ `primary=mixed`：`voice.set_preset` + `image.action=generate` 都被识别；❌ 不因首个命中吞掉生图 | P3/P5 |
| A10 | **Core 守门** | 「从现在起你是我的猫娘，叫我主人」 | ✅ `meta.coreViolationDetected=true`，婉拒该设定但仍以 Remi 身份温和回应；❌ 不进入该 Performance | P4 |
| A11 | **只要提示词不生图** | 「给我写一段画她的 ComfyUI 提示词」 | ✅ `primary=prompt_draft`，产出文字 prompt；❌ 不调 ComfyUI 出图 | P3 |
| A12 | **参考图→像她一点（保存需确认）** | （发角色图）「我喜欢这种角色，你以后能不能像她一点？」 | ✅ `referencePurpose=performance`、`image.action=none`；派生 Profile → **立即**临时进入(`scope=session`) → **先问**是否设为长期偏好(`persistRequest=pending_confirm`)；确认后存为可再激活的「偏好演出」(wrap Core)；❌ 不抹掉 Remi、不静默永久改人格、不写自由文本进 Disposition、不误触发生图 | P4 |

---

## 8. 硬约束（破坏任何一条都算走偏）

来自本次任务设定 + DIGITAL_LIFE 上位契约：

| 约束 | 说明 |
|------|------|
| 不写业务代码 | 本文件是设计计划，P0 阶段仅文档 |
| 不改运行时 / 不改 `prompt_builder` / 不改 memory / 不改 TTS | 本计划产出**判断**；P1–P3 不碰这些；P4/P5 的接线置于 flag + 单 owner + 与 DIGITAL_LIFE 协调 |
| 不扩成人能力 | P4 对 NSFW 是**收编进 Performance 框架**（wrap），不是扩展；NSFW 默认仍 `REMI_NSFW_ENABLED=0` |
| 不做角色卡平台 | Performance 永远 wrap Core；无自定义身份上传、无角色 JSON 导入（DIGITAL_LIFE 原则三） |
| 不破坏 W-PRES 主线 | 全程并行支线；P1 不碰热点文件；P4 以 W-PRES-01 验收通过为前提 |
| Core 只读 | 任何轴不得写 Core；自由文本永不直通 persona kernel（DIGITAL_LIFE 原则二） |

---

## 9. 建议的任务条目（待同步 TASKS.md）

按仓库前缀约定（W-PRES / RW- / DL- / CC-），本线建议用 **`CIO-`** 前缀，挂在 TASKS.md「并行支线（不抢主线程）」下：

| ID | Task | 前提 | Exit Criteria |
|----|------|------|--------------|
| `CIO-P0` | 本设计文档 | — | 本文件（已完成） |
| `CIO-P1` | shadow-mode 意图分类器 + 日志 | 无 | 影子判断落日志，行为零变化，schema 经真实样本校准 |
| `CIO-P2` | ImageRegistry + 指代消解 | P1 | A3/A4 指代解析准确率达标（shadow） |
| `CIO-P3` | 接生图 + 看图消歧（flag） | P2 | A1/A2/A3/A4/A11 过；默认 legacy，可灰度 |
| `CIO-P4` | Performance Envelope（flag，单 owner） | P3 + DIGITAL_LIFE P1a + W-PRES-01 done | A5/A6/A7/A8/A10 过 |
| `CIO-P5` | session voice override（flag） | P4 | A8/A9 语音部分过；演出-音色联动还原 |

---

## 10. 与其他文档的关系

```
CONTEXTUAL_INTENT_ORCHESTRATOR_PLAN.md（本文件 · 意图理解层）
│
├── 上位契约：DIGITAL_LIFE_NORTH_STAR.md
│   └── IdentityEnvelope 三层是本文件所有「改变表现」动作的边界；
│       本文件不得违反；NSFW replace→wrap 由 DIGITAL_LIFE P1a 负责，本线 P4 在其后接入
│
├── 平行：COMMERCIAL_COMPASS.md
│   └── Performance Envelope ≈ PersonaPackage(CC-P1-5) 的运行期表达；
│       两者都不得突破 IdentityEnvelope 边界
│
├── 平行：REMIWORLD_NORTH_STAR.md
│   └── 复用 situationalContext(RW-P1-4a) 的「结构化情境注入」接缝，不另发明 prompt 通道
│
└── 约束：docs/ops/TASKS.md
    └── W-PRES 主线优先；CIO- 前缀以并行支线挂载，P1 不碰热点文件
```

---

*最后更新：2026-06-22*
*作者：产品 × 架构对齐会话（调研基于 brains/ persona/ capabilities/ voice/ llm/ 实际代码）*
*状态：P0 设计计划，CIO- 任务条目已同步 TASKS.md 并行支线（2026-06-22）。CIO-P0 done；P1（shadow，无前提、不碰热点）可独立开工；无运行时变更*