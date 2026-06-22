# COMMERCIAL_COMPASS.md — Remi 商业化与开源指南针

这份文档的用途：

固化商业化与开源的双轨方向，供任何接手商业化、架构拆分、对外发布工作的 agent / 人启动时阅读。

当前优先级永远以 CURRENT_FOCUS.md 为准；本文档只回答四件事：走什么路线、按什么顺序逼近、哪些约束不许破、哪些事终局也不做。

与世界线 REMIWORLD_NORTH_STAR.md 不冲突：世界是"在场感"主线的空间化载体，本文档是"产品形态"主线——回答"Remi 以什么形态交付给谁、靠什么活下去"。

事实基线核对日期：2026-06-22。代码行数与文件路径以本次扫描为准；后续若 persona/、server/session/、brains/ 发生结构迁移，先更新本文档「资产清单」一节再动代码。

---

## 一、战略选择（已对齐 2026-06-22）

两条已拍板的选择，构成所有后续决策的前提：

| 维度 | 选择 | 含义 |
|------|------|------|
| 商业形态 | 开源 + 内容订阅 | 引擎免费开源换生态与可信度；Premium 人格 / 高质语音 / 专属角色 / 托管便利作为订阅内容卖 |
| 人格 IP 策略 | 开源基础人格，高级人格收费 | 基础人格（能跑、可改、可玩）开源 MIT；soul overlay / NSFW / 专属 presets / Premium 角色作为付费内容 |

一句话：开源"通用陪伴引擎 + 一个能跑的基础人格"，卖"Remi 完整人格 + 好声音 + 多端同步 + 托管省心"。

这条路线组合的核心推论：人格层从"引擎里的一个模块"升级为"整个商业化的产品轴"。架构拆分必须围绕"人格作为可分发的、有授权的、可组合的包"来设计，而不是围绕"把服务端拆成微服务"。

---

## 二、资产清单（什么能开源、什么是护城河、什么是品牌）

### Tier 1 — 工程护城河（开源也不怕被抄）

| 资产 | 位置 | 规模 | 为何难复制 |
|------|------|------|-----------|
| 实时语音 turn-taking 状态机 | server/session/（index + turn_taking + turn_taking_predictor + interruption + duplex_audio + voice_submit + turn_state_protocol） | ~7k 行 | 多阶段状态机 + 预测 + VAD + partial STT 增长跟踪 + 犹豫 hold + 峰值/强帧比降噪 |
| 陪伴记忆系统 | memory/（含 relationship_state.ts 690 行） | ~3.6k 行 | episode store + active/core 分层 + cooling/resolution + salience + repairState（none/minor_miss/trust_drop/rupture）+ V2 分片读 |
| 慢脑 / 关系编排 | brains/（background_analysis_store 1826 + conversation_guidance 926 + context_orchestrator 970） | ~4.4k 行 | 关系阶段标签 + 语气契约 + 回复形状契约 + proactive nudge 冷却账本 |

### Tier 2 — 品牌资产（容易被抄，但是品牌核心，开源需分级）

| 资产 | 位置 | 性质 |
|------|------|------|
| Remi 默认人格 bible | persona/remi_default.ts（72 行：identity / traits / 12 behavioral_rules / emotional_responses） | 品牌 IP |
| Soul overlay | persona/remi_soul_overlay.ts（27 行：soul/bond/guardrails） | 品牌 IP，付费内容 |
| 命名预设 | persona/presets.ts（156 行：remi_core / witty_warm / relaxed_roast / playful_attached / calm_healing） | 部分免费、部分付费 |
| 风格覆盖规则 | persona/style_override.ts（257 行：中文 regex 意图识别） | 引擎能力，开源 |
| 角色规则 | brain/character_rules.ts（30 行：9 条 BASE_CHARACTER_RULES） | 引擎能力，开源 |
| NSFW prompt block | brain/prompt_builder.ts:17-59（~40 行明文成人 roleplay） | 付费内容，开源前必须移出 |
| 品牌视觉形象（立绘） | web/public/brand/（待接入，2026-06-22 决策：基础人格开源可见） | 品牌资产，许可与代码分离（见硬约束 8） |

### Tier 3 — 现成的架构接缝（拆分的基础，不是阻碍）

- ✅ **MessageSink 接口** — server/gateway/types.ts:15-18，`{ readyState, send() }`。pipeline / continuity 已通过它被 WS 和 SSE 共用。这是天然的库边界。
- ✅ **Plugin registry** — plugin/types.ts（5 个 typed hooks：characterRules / turnInterpreter / promptInjection / outputGuard / ttsModifier）+ plugin/registry.ts，经 `REMI_PLUGIN_PATH` 动态加载。真扩展层，in-tree 未用但为外部消费者设计。
- ✅ **DirectCapability 接口** — brain/direct_capabilities.ts，capabilities/ 下 7 个实现（date_recap / family_memory / image_generation / video_generation / mode_control / voice_style）在用。
- ✅ **多端独立可拆** — web/（Next.js workspace）/ desktop/（Tauri workspace）/ ios/（Swift project）已是独立代码库。
- ❌ **服务端 core 纠缠** — persona + memory + brain + pipeline + session + gateway 单进程 monolith，共享 avatar/types.ts。core engine 无法被整体 lift 出来而不动 gateway/session。

### 外部服务耦合（抽象层基本完整）

| 能力 | 抽象 | 默认 provider | 是否可免费跑 |
|------|------|--------------|-------------|
| LLM | OpenAI SDK + `REMI_LLM_BASE_URL` | 自动检测 | ✅ Ollama / LM Studio 本地 |
| TTS | voice/tts.ts 5 provider 路由 + fallback | edge（免费） | ✅ 无需 key |
| STT | voice/stt_stream.ts 3 provider | openai | ⚠️ whisper-cpp / sherpa-onnx 可本地 |
| Auth | infra/auth.ts 三模式 | disabled | ✅ 无需 Clerk |
| DB / Redis | 可选 | 内存模式 | ✅ 不配即跳过 |
| Embedding | 可选 | 禁用 | ✅ 不配即跳过 |

泄露点：web/src/components/RemiAuthProvider.tsx 硬 import @clerk/nextjs，auth disabled 时也强拉 Clerk SDK。P1 要 lazy load。

### 品牌视觉资产（2026-06-22 决策）

背景：用户提供一张自有版权的立绘（粉色长发、紫粉眼睛、白衣粉饰带星星元素，温暖治愈调性），希望绑定为 Remi 品牌形象。视觉调性与"陪伴 / 活人感"产品定位契合。

已对齐决策：

| 维度 | 选择 | 含义 |
|------|------|------|
| 版权归属 | 用户自有 | 可自由用于商业品牌，无法律障碍 |
| 形象分层 | 基础人格开源可见 | 立绘作为开源基础人格的视觉形象，社区能见到、能用 |
| 隐含约束 | 立绘原图进公开开源仓库 | 需资产许可保护，不能裸 MIT 发布（见硬约束 8） |

#### 核心原则：双许可分离

代码 MIT 不延伸到品牌形象（立绘 / logo / "Remi" 名字）。品牌视觉资产用单独许可，允许开源基础人格"可见可用"但不允许随意衍生 / 商用。参考 GitLab / Mozilla / Sentry 的标准做法：代码开源，品牌资产单独许可。

许可方案选择（待定 W-6）：

| 协议 | 含义 | 适合度 |
|------|------|--------|
| CC-BY 4.0 | 署名即可用（含商用） | 传播力最强，但衍生不受控 |
| CC-BY-NC 4.0 | 署名 + 非商用 | 推荐：社区二创传播品牌，商业使用需授权，与"开源 + 内容订阅"模式对齐 |
| CC-BY-SA 4.0 | 署名 + 相同许可共享 | 折中，衍生必须同许可 |
| CC-BY-NC-ND | 非商用 + 禁止衍生 | 保护最严，社区二创空间小 |

绑定执行清单：

**工程接入**（可由开发完成，对应 CC-P0-6）：

- 立绘进 `web/public/brand/remi-portrait.png`，替换现有 `web/public/avatar/assets/remi-selected-portrait.png`
- 新增 `BRAND_LICENSE.md`（资产许可声明，与代码 MIT 明确分离）
- 更新 `README.md` / `CLAUDE.md` 顶部品牌呈现
- 四端头像引用统一（web / desktop / iOS / watchOS 的头像、启动屏、watch 表盘表情脸）

**资产生产**（需原画师 / 用户提供源文件）：

- 情绪态：对应现有 `web/public/avatar/assets/{happy,sad,shy,curious,neutral}.svg`，立绘最好产出对应情绪态（至少 happy / neutral 两态用于品牌位）
- 多尺寸：头像（64 / 128 / 256）、分享卡（1200×630）、icon（各 dp）
- 3D 化决策：Remi 在场感依赖动起来。静态立绘只能做头像 / 品牌位；要契合 /world 和多端在场感主线，需 model 成 VRM / Live2D（成本显著，另立项目）

**法律**（需用户定）：

- CC 协议最终选择（W-6）
- "Remi" 商标注册（中国 / 美国，分类 9 软件 + 42 SaaS）

责任划分：

| 能做 | 需要用户 |
|------|---------|
| 立绘接入替换头像 | 提供立绘源文件（分层 PSD / 多尺寸 PNG） |
| 写 BRAND_LICENSE.md | 定 CC 协议选哪个 |
| 四端头像引用更新 | 3D 化预算 / 意愿 |
| 文档品牌呈现更新 | 商标注册决策 |

与人格分层的关系：视觉形象分基础版和 Premium 版，与"基础人格开源 / 高级人格收费"同一切面。基础人格配此立绘（开源可见），Premium 人格的完整 3D / 全套情绪表情 / 专属视觉作为付费内容（后续 CC-P2-3 阶段定义）。

---

## 三、核心矛盾与解法

**矛盾**：开源代码 = 把人格 bible 也开源了。一股脑 MIT 全开，护城河里的"人格内容"归零，只剩工程护城河（刚好是最难抄的，也是用户最难感知价值的）。

**解法**：Open Core（GitLab / Cal.com / Sentry 模式）

| 层 | 归属 | 换什么 |
|------|------|--------|
| 引擎（turn-taking + memory + 双脑 + pipeline + 协议 + plugin/capability 接口） | 🟢 开源 MIT | 生态、贡献者、可信度 |
| 基础人格包（能跑的默认 Remi，去 soul overlay / NSFW / 高级 presets） | 🟢 开源 MIT | 让社区真的能跑、能改 |
| Premium 人格包（soul overlay / NSFW / 专属 presets / 高质语音配置） | 🔴 闭源 | 现金流 |
| 托管服务（开箱即用、多端同步） | 🔴 SaaS | 卖给"不想折腾"的大多数 |
| 多端原生客户端高级特性 | 🔴 商业版 | 卖给付费用户 |
| 创作者 / 企业面板（多人格、多用户、用量、SLA） | 🔴 商业版 | B 端 |

---

## 四、硬约束（破坏任何一条都算走偏）

1. **同一个 Remi。** 开源引擎和商业版共用同一套大脑 / 记忆 / turn-taking。禁止长出"商业版 Remi"和"开源版 Remi"两套割裂的人格或记忆。
2. **fast path 规则继续适用。** 人格加载、entitlement 校验、premium 注入都不许进 fast path 做阻塞工作（同 CLAUDE.md 代码规则）。entitlement 在 session bootstrap 阶段一次性解析，后续只读本地副本。
3. **Premium 内容不下发到客户端。** soul overlay / NSFW 块永远在服务端 prompt 组装阶段注入；客户端只持有 personaId 引用 + 基础人格。这是防盗与合规的底线（见权衡 W-1）。
4. **开源仓库零红牌。** 开源前必须完成 P0 全部清理：私有依赖、NSFW 明文、第三方版权资产（Live2D Hiyori Pro）、协议未版本化。任何一项未清就禁止公开发布。
5. **不破坏自部署路径。** 引擎 + 基础人格 + 免费 TTS + 本地 LLM 必须在不开账户、不付费、不联网授权的情况下能完整跑通文本 + 语音聊天。这是开源信誉的基础，也是商业版的免费试用漏斗。
6. **人格数据驱动。** 引擎只认 persona 包接口，不内置任何具体人格的硬编码内容。开源引擎仓库里不含 Remi 完整 bible，只有基础人格包作为可选依赖。
7. **自主决策边界。** 架构拆分、persona 包格式、entitlement 实现不必请示；以下四类必须停下来问用户：资产采购、付费服务接入（支付/CDN）、对外公开发布、删除用户数据。同世界线硬约束第 7 条。
8. **品牌资产许可与代码许可分离。** 代码 MIT 不延伸到品牌形象（立绘 / logo / "Remi" 名字）。品牌视觉资产用单独许可（CC-BY 4.0 署名 或更严格的 CC-BY-NC-ND），允许开源基础人格"可见可用"但不允许随意衍生 / 商用。开源仓库里放一个 `BRAND_LICENSE.md` 明确这一边界。具体许可形式在 P0 期间确定。

---

## 五、架构拆分的三个核心动作

不是"把 server 拆成微服务"，而是三件围绕"人格作为产品轴"的动作：

### 动作 A — Persona Package 格式（人格包规范）

把 persona/*.ts 硬编码 bible 变成标准化、可加载的人格包：

```
remi-persona-package/
├── manifest.json        # id, name, version, tier(free|premium), author, dependencies
├── persona.ts           # identity, traits, behavioral_rules
├── soul_overlay.ts      # 可选 — premium
├── style_override.ts    # 可选
├── presets.ts           # 可选
├── nsfw_block.ts        # 可选 — premium，永不下发客户端
├── assets/              # 头像、表情 SVG、语音配置
└── LICENSE              # free 包 MIT，premium 包商业授权
```

基础人格包 `@remi/persona-remi-basic`（MIT）—— 给社区一个能跑的默认角色，去掉 soul overlay / NSFW / 高级 presets。
Premium 人格包 `@remi/persona-remi-premium`（闭源）—— 完整 soul、NSFW、专属 presets、高质语音配置。
引擎侧只认 persona 包接口（PersonaPackage 类型 + loader），不内置任何具体人格。

### 动作 B — Entitlement 授权层（新增）

订阅模式必须有授权层：

- 用户登录 → 查订阅状态 → 决定能加载哪些 premium persona
- `server/session/bootstrap.ts` 在连接建立时按用户 entitlement 解析人格包
- 新增 `infra/entitlement.ts`：`resolveEntitlement(userId) → { personas, tier, expiresAt }`
- 扩展 user_persona_presets 表为 user_entitlements（用户 × 人格包 × 订阅状态 × 有效期）
- 多端（iOS/watchOS/desktop）共享同一 entitlement，校验在服务端

### 动作 C — Premium 人格服务端注入（防盗）

soul overlay / NSFW 块永远不作为文件下发客户端，只在服务端 prompt 组装阶段注入：

- 客户端只持 personaId 引用 + 基础人格
- `brain/prompt_builder.ts` 在组装 system prompt 时，按当前用户 entitlement 从 premium 包读取 soul/NSFW 片段注入
- 客户端永远拿不到 premium 源文件 —— 订阅 = 用服务端组装好的完整人格

---

## 六、分阶段路线

### P0 — 开源前清理（2 周，硬前置）

任何一项未完成，禁止公开仓库。全部为"清理 / 隔离 / 版本化"，不动核心逻辑。

| ID | 任务 | 位置 | 验收 |
|----|------|------|------|
| CC-P0-1 | 移除私有依赖 @jane-uske/yepanywhere（in-tree 零 import） | package.json:56 | npm install 不再拉该包；npm run dev 不回归 |
| CC-P0-2 | NSFW 内置 fallback 明文移出引擎（promptInjection 插件接口已就位，无需新加） | brain/prompt_builder.ts:17-59（NSFW_PERSONA_BLOCK，仅 nsfwActive && pluginSections.length===0 时作为 fallback 生效） | 引擎源码无 NSFW 明文；useBuiltinNsfwBlock fallback 分支移除或改为"无插件时降级为基础人格"；NSFW 内容由 Premium 插件经 promptInjection hook 提供 |
| CC-P0-3 | 清理 Live2D Hiyori Pro（第三方版权） | web/public/live2d/hiyori-pro/ | 换开源模型，或加非商业声明并从默认构建移除 |
| CC-P0-4 | 协议版本化 + dev 消息隔离 | avatar/types.ts:159-286 | client_context 握手含 protocol_version；dev_* / nsfw_mode_state 拆独立命名空间 |
| CC-P0-5 | 定义 Persona Package 格式 schema | 新增 docs/design/PERSONA_PACKAGE_SPEC.md | manifest.json 字段确定；引擎侧 loader 接口签名确定 |
| CC-P0-6 | 品牌视觉资产接入 + 许可声明 | 立绘进 web/public/brand/；新增 BRAND_LICENSE.md | 立绘替换现有 remi-selected-portrait.png；资产许可与代码 MIT 明确分离 |

### P1 — 架构拆分（4–6 周，核心工程）

这条路线的真正工程量。沿 MessageSink 接缝 + persona 数据驱动化推进。

| ID | 任务 | 验收 |
|----|------|------|
| CC-P1-1 | persona 数据驱动化：引擎只认 PersonaPackage 接口，persona/*.ts 硬编码全部外移成包 | 引擎仓库不含 Remi 完整 bible；加载基础包即可跑 |
| CC-P1-2 | 拆基础人格包 @remi/persona-remi-basic（MIT），引擎仓库引用为可选默认 | 不配 premium 时，开源用户开箱即跑基础人格 |
| CC-P1-3 | 抽 @remi/engine 库（沿 MessageSink 接缝：pipeline + continuity + persona 接口 + memory + brains） | 第三方可 npm i @remi/engine 不拉 gateway/session |
| CC-P1-4 | 新增 infra/entitlement.ts：session bootstrap 按用户订阅解析人格 | 连接时 entitlement 一次性解析，后续 fast path 只读本地副本 |
| CC-P1-5 | Premium 人格服务端注入：soul/NSFW 永远在 prompt 组装阶段注入，客户端只持引用 | 客户端源码 / 网络流量均无 premium 内容 |
| CC-P1-6 | Clerk 硬依赖 lazy load | web/src/components/RemiAuthProvider.tsx 在 auth disabled 时不拉 Clerk SDK |

### P2 — 商业化上线（4 周）

| ID | 任务 | 验收 |
|----|------|------|
| CC-P2-1 | 开源引擎 + 基础人格包上 GitHub（MIT） | Quick Start 跑通；文档齐 |
| CC-P2-2 | 接支付（Stripe / Lemon Squeezy 二选一） + user_entitlements 表 | 订阅、续费、到期回退 free 生效 |
| CC-P2-3 | Premium 人格包部署到服务端（不开源、不下载、只注入） | 订阅用户使用完整 Remi 人格 |
| CC-P2-4 | 托管版：订阅用户开箱即用 + 多端同步 | iOS/watchOS/desktop 订阅状态一致 |

### P3 — 生态（长线）

| ID | 任务 | 验收 |
|----|------|------|
| CC-P3-1 | Persona SDK：第三方作者做的人格包能跑在引擎上 | 至少 1 个第三方人格包 demo |
| CC-P3-2 | 协议 SDK + 第三方客户端接入文档 | 协议有版本化承诺 + 稳定性窗口 |
| CC-P3-3 | 插件市场（已有 plugin/ registry 设计） | 第三方插件可注册 5 类 hook |

---

## 七、关键权衡与待决策项

| ID | 权衡 | 现状倾向 | 何时必须定 |
|----|------|---------|-----------|
| W-1 | Premium 人格分发方式：客户端下载 vs 服务端注入 vs 加密包 DRM | 服务端注入（硬约束第 3 条已锁定） | 已定 |
| W-2 | 支付 provider：Stripe vs Lemon Squeezy | 倾向 Lemon Squeezy（个人开发者友好、全球） | P2 启动前 |
| W-3 | 基础人格包放引擎仓库还是独立仓库 | 倾向独立仓库 remi-persona-basic（解耦发布节奏） | P1 启动前 |
| W-4 | 多端高级特性如何切分免费/付费 | 未定，需产品判断 | P2 设计期 |
| W-5 | NSFW 内容的合规与地区策略 | 未定，可能需地区门控 | 商业版上线前必答 |
| W-6 | 品牌视觉资产许可：CC-BY-NC（推荐）vs CC-BY vs CC-BY-SA vs CC-BY-NC-ND vs 保留 | 倾向 CC-BY-NC 4.0 | CC-P0-6 启动前 |

---

## 八、成功指标

**开源侧**

- GitHub star / fork / 第三方 issue（衡量生态吸引力）
- 至少 1 个第三方人格包或插件（衡量扩展层是否真的可用）
- "从 clone 到第一条语音回复" < 10 分钟（衡量自部署门槛）

**商业侧**

- 订阅转化率（free → paid）
- 订阅用户 7 日 / 30 日留存（衡量人格是否真的"想回来见她"）
- Premium 人格使用占比（衡量付费内容价值）
- 多端活跃分布（衡量跨终端存在感是否成立）

**不作为指标**

- 功能数量（防止滑向"通用助手"）
- 单次对话 token 成本（防止为压成本牺牲人格质量）

---

## 九、终局也不做（非目标）

1. **不做通用 AI 助手。** 工具只服务陪伴，不重写产品分类（同 CLAUDE.md）。
2. **不做企业级 RBAC / 私有化交付**（除非未来 B 端方向调整）。当前路线是 C 端订阅，不是私有化卖 license。
3. **不做人格的客户端明文分发**（硬约束第 3 条）。即使影响离线体验，也不为便利性牺牲 IP 防盗。
4. **不把开源引擎做成"残废版"逼用户付费。** 开源版必须能完整跑通文本 + 语音聊天；商业版卖的是"更好的 Remi"和"更省心"，不是"解锁基础功能"。
5. **不做世界玩法堆砌替代关系质量。** 世界服务于"想回来见她"，商业化同样服务于这个北极星，不反过来。
6. **不在 fast path 做 entitlement 实时校验。** 订阅状态在 bootstrap 解析一次，后续只读，绝不每条消息查 DB。

---

## 十、与其他文档的关系

- **执行优先级**：永远以 CURRENT_FOCUS.md 为准。本文档是方向，不是当下任务清单。
- **世界线**：REMIWORLD_NORTH_STAR.md 是"在场感"主线的空间化载体；本文档是"产品形态"主线。两者正交，不互相阻塞。
- **架构现状**：ARCHITECTURE.md 是当前模块分层事实；本文档的「资产清单」若与 ARCHITECTURE.md 冲突，以 ARCHITECTURE.md 为准并回头修订本文档。
- **代码规则**：本文档不覆盖 CLAUDE.md 的代码规则与热点文件约束；P1 拆分触及热点文件（server/session/index.ts、memory/memory_agent.ts）时，遵守单 owner 规则。

---

*事实基线核对日期：2026-06-22*
*状态：商业化与开源方向指南针，执行优先级以 CURRENT_FOCUS.md 为准*
