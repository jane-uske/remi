# Persona Pack — 角色卡架构

> 自定义人格 = 一张可插拔的「角色卡」。人格用 markdown 写（IDENTITY/SOUL/EXAMPLES），
> 由平台 L0 系统护栏夹住后编译进一次 LLM 调用。对应需求：支持 OpenClaw 式
> `SOUL.md / IDENTITY.md` 自定义人格，产品定位为「纯角色卡平台」。

## 定位

- 人格 **100% 由 pack 决定**，平台不约束人格 / 内容。
- 平台只保 **L0 技术护栏**（防伪造系统层、防冒充平台身份骗取凭据）。
- 减法路线：语义层正则 / 多套 guidance 逐步交给 LLM；这套 pack 是新人格骨架的载体。

## 文件结构

```
personas/<id>/
  persona.json   结构化元数据（程序读）
  IDENTITY.md    她是谁、怎么说话        → 对应旧 persona/remi_default.ts
  SOUL.md        内核怎么待你            → 对应旧 persona/remi_soul_overlay.ts
  EXAMPLES.md    few-shot 对话范例（可选）→ 新增，承接「减法靠示范不靠规则」
```

`persona.json` 字段：`id` `name` `displayName?` `version?` `author?`
`voice{provider,voiceId}` `avatar{kind,modelId,url}` `allowNsfw?` `memoryScope?`。

> OpenClaw 三件套的第三件 `USER.md`（关于用户的事实）**不进 pack**——那是记忆
> 系统的职责，且是动态、跨会话增长的，做成静态文件会退化。

## 分层 compose

`composePersonaPrompt(pack, options)` 产出 system prompt 的人格段：

```
L0   平台系统护栏（常量，pack 改不动）
──   本轮动态上下文（慢脑/关系/语气合同，可选；减法阶段会变薄）
L1   IDENTITY.md   ← pack
L2   SOUL.md       ← pack
L3   EXAMPLES.md   ← pack（few-shot）
──   记忆背景 / 情绪语调（可选）
L0'  平台系统护栏 · 重申（在自定义文本之后再钉一遍，对抗带偏/注入）
```

L0 / L0' 是 `persona/pack/system_layer.ts` 的常量。2026-04 的 A/B 实验证明
raw md 注入能把人格整个带偏（强控制力既是卖点也是风险），L0' 后置重申就是那对
当时缺失的夹层。

## Feature flag（默认关，零回归）

`REMI_PERSONA_PACK_ENABLED`（默认 `0`）。`REMI_PERSONA_PACK_DIR` 可覆盖根目录。

- **on 且加载成功** → `composePersonaPrompt`
- **off 或加载失败** → 逐字节回退旧 `buildPersonaPrompt`（fallback，不抛错打断对话）

接入点：`brain/prompt_builder.ts` 的 persona 分支。NSFW / 插件 lean-persona 路径
优先级不变（仍走各自分支）。

### 如何接通生效

1. **dev**：`.env.localhost` 设 `REMI_PERSONA_PACK_ENABLED=1`（模板已默认开）→ `npm run dev`。
2. **prod**：`.env.local-prod` 设 `=1` → `npm run prod:local:rebuild`（让 `personas/` 进镜像）。
3. **验证**：`node -r ts-node/register/transpile-only scripts/persona_pack_verify.ts`
   对 NDADVM7Q 失败 case 跑 flag-off vs flag-on 真实 LLM 对比。

加载失败（缺目录 / manifest 非法）自动回退旧 `buildPersonaPrompt`，不打断对话。

## 已落地

### M1 — 文字层 + compose（✅）

- `persona/pack/{types,system_layer,loader,compose}.ts`
- `personas/remi/`：把现有 Remi 人格搬成默认 pack + 针对历史 bad case 的 few-shot
- flag + `prompt_builder` 接入；Dockerfile COPY `personas/`；`.env.example` 文档
- 测试 `test/persona/pack/`：加载 / 校验 / budget / L0 夹层 / **flag-off 零回归**

### M2 — 多 pack 运行时切换（后端骨架 ✅）

- `brains/persona_pack_mode.ts`：per-connection registry（仿 `nsfw_mode`），
  `getActivePersonaPackId` / `setActivePersonaPack` / `clearActivePersonaPack`
- `loader.listPersonaPacks()`：扫目录发现可用 pack
- `prompt_builder` 按连接选 pack（默认仍 remi，故 M1 行为不变）

### M3 — per-pack voice（✅）/ avatar（follow-up）

- **voice ✅**：`tts.ts` 的 `resolvePackVoiceOverride(connId)`——edge/openai buffered
  + 流式 + cache variant 都按 active pack 的 voiceId 解析。默认 remi pack voice 与
  全局一致故零行为变化，flag-gated 零回归（测试 `test/voice/persona_pack_voice.test.ts`）。
  跨 provider 切换 + volc/mlx 各自机制（voiceType/speaker）是扩展项。
- **avatar**：manifest 已解析；前端 CharacterStage 渲染消费留多角色 UI 上线。

### M4 — 记忆隔离（schema 骨架 ✅ / repo 隔离 follow-up）

- `migrations/006_persona_pack_scope.js`：memories/episodes 加 `pack_id` 可空列
  （向后兼容、含 local-prod 等效 DDL、**未执行**）。
- repo 查询隔离（含 embedding 召回）+ migrate 执行留多角色上线。

### M5 — 减法（实质 ✅ / 物理删码 follow-up）

- 测试证明 flag-on 路径绕过 `build*Guidance` / 语义正则规则引擎
  （`test/persona/pack/flag_integration.test.ts`：flag-off 含【RemiCore合同】、flag-on 不含）。
- 物理删除旧 fallback 代码留 flag 长期默认后——保留 fallback 安全网。

## 剩余 follow-up（多角色 UI 上线 / flag 长期默认时触发）

| 项 | 前置 / 为什么 defer |
|----|------|
| M3 avatar 前端渲染 | 碰热点文件 `useRemiChat` + CharacterStage 降级链；单 pack 零效果 |
| M4 repo 隔离查询 + migrate 执行 | 碰热点 `memory_repository` + 不可逆迁移；单 pack 下按 user_id 已正确 |
| M5 物理删除规则引擎 | 撞「不静默移除 fallback」红线；需 flag 长期默认验证后 |
| M2 持久化 + 前端切换 UI | DB 扩列 + 前端；多角色 UI |

这些都为**零当前需求**（单 pack）改热点文件 / 做不可逆操作 / 撞红线，刻意 defer
到真实触发点（多角色上线、flag 长期默认），不混进当前 diff。
