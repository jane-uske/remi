# 结构性技术债与修复计划

> 创建时间：2026-05-15
> 创建依据：项目深度代码评审
> 优先级：高于当前主线程（Phase 0 止血）
> 原则：在有人每天想打开 Remi 之前，不增加任何新功能

---

## 为什么这份文档比 CURRENT_FOCUS.md 的主线更优先

当前主线是"Web 10 分钟在场感体验"。但以下 7 个结构性问题会持续拖慢主线的交付速度和质量：

1. 改 useRemiChat.ts 来优化在场感 → 没有测试，改了不知道有没有破
2. 改记忆系统优化"被理解感" → 6 层 fallback 互相耦合，改一层可能破另一层
3. 调人格稳定性 → personality.ts 只有一句话，约束力接近零
4. 调情绪回应 → emotion_engine 是关键词匹配，误判率高到无法调
5. 新人接手或 AI agent 改代码 → 130+ env vars 无验证，配错静默降级
6. schema 改动 → 无迁移系统，可能丢数据
7. "双脑"命名 → 新接手者理解成本高

**建议：用 2 天完成 Phase 0（#5/6/7），用 1-2 周完成 Phase 1（#1/2/3/4），然后再回到主线。**

---

## 问题 1：`useRemiChat.ts` — 2044 行无测试的状态炸弹

### 现状

- 文件位置：`web/src/hooks/useRemiChat.ts`
- 28 个 `useRef`，20 个 `useState`，12+ 个 `useEffect`
- 返回 40+ 个值和回调
- 同时管理：WebSocket 生命周期、全双工音频、TTS 队列、12 种 turn state、STT 合并、avatar 调度、历史分页、localStorage 持久化、开发者指令
- **零测试覆盖**
- `ARCHITECTURE.md` 已标注"不要继续让它吸收业务策略"但问题仍在恶化

### 修法

拆为 5 个单职责 hook + 1 个组合层：

```
web/src/hooks/
├── useRemiConnection.ts    (~300行) WebSocket 连接/重连/auth
├── useRemiMessages.ts      (~400行) 消息列表/历史/持久化
├── useRemiTextChat.ts      (~200行) sendText + streaming 状态
├── useRemiVoice.ts         (~500行) PCM 采集/duplex/STT
├── useRemiAvatar.ts        (~300行) emotion/turnState/avatarFrame/TTS播放
└── useRemiChat.ts          (~200行) 组合层，暴露相同对外接口
```

### 步骤

1. 创建 5 个空 hook 文件，定义各自的 return type
2. 从现有 useRemiChat.ts 中 **移动**（不是复制）相关代码到对应 hook
3. useRemiChat.ts 调用 5 个子 hook，组合返回值——RemiChatApp.tsx 不需要改动
4. 每个子 hook 写至少 1 个 happy-path 测试（需引入 vitest + @testing-library/react）
5. 跑 `npm run dev` 验证行为完全不变

### 验收标准

- [ ] RemiChatApp.tsx 零改动
- [ ] 每个子 hook 有独立测试文件
- [ ] 原始 useRemiChat.ts < 250 行
- [ ] 文本发送、语音录制、流式回复、打断——4 个场景手动验证通过

### 风险

- 拆分过程中可能暴露隐含的 state 依赖（ref A 在 effect B 里被读取）
- 缓解：先画依赖图再拆，不要边拆边改行为

---

## 问题 2：情绪系统是关键词匹配玩具

### 现状

- 文件位置：`emotion/emotion_engine.ts`
- 实现方式：`indexOf("哈哈")` / `indexOf("😊")` 等关键词匹配
- 只有 4 种情绪（happy/curious/sad/shy）+ neutral
- 反讽、复杂语境、隐喻全部误判
- 用户说"太好了（讽刺）"→ 系统认为开心

### 修法

利用已有的 fast_brain LLM 调用，在回复中附加情绪自标注：

```
方案：在 system prompt 末尾加指令：
"在回复最末尾，用 <emotion>xxx</emotion> 标注你此刻的情绪。
 可选值：neutral, happy, curious, shy, sad, concerned, playful, thoughtful"

处理：
1. pipeline/runner.ts 的 streaming 中检测 <emotion> 标签
2. 从流式 token 中识别并剥离标签（不推给用户看）
3. 解析出 emotion 值
4. 用解析结果替代 emotion_engine 的关键词匹配

保留 emotion_engine.ts 作为 fallback（LLM 未产出标签时）
```

### 步骤

1. 修改 `brain/prompt_builder.ts`：system prompt 增加 emotion 标注指令
2. 修改 `server/pipeline/runner.ts`：streaming token 中检测 `<emotion>` 标签
3. 新增 `utils/emotion_tag_parser.ts`：从流中提取和剥离 emotion 标签
4. 修改 `emotion/emotion_engine.ts`：降级为 fallback，优先使用 LLM 标注
5. 情绪从 4 种扩展到 8 种，更新 TTS 情绪映射

### 验收标准

- [ ] 10 轮测试对话中，情绪标注与人工判断一致率 ≥ 70%
- [ ] `<emotion>` 标签不出现在用户可见的回复中
- [ ] LLM 未产出标签时，gracefully fallback 到关键词匹配
- [ ] 无额外 API 调用（复用 fast_brain 已有请求）

### 风险

- 部分 LLM 模型可能忽略标注指令或格式不一致
- 缓解：emotion_tag_parser 要容错，支持 `<emotion>happy</emotion>` 和 `[emotion:happy]` 等变体

---

## 问题 3：记忆系统 6 层 fallback 都不可靠

### 现状

- `memory/memory_agent.ts::retrievePromptMemory()` 有 6 层 fallback：
  1. Episode Store (V2 pgvector)
  2. Snapshot episodes
  3. Topic thread memory
  4. Shared Moment V1
  5. Keyword-scored KV (InMemoryRepository, 数组 linear scan)
  6. Vector search supplement
- 每层都是"万一上一层没结果就试下一层"
- V1 写入靠 17 条正则（"我叫X"、"我住在X"），漏掉所有非声明式表达
- `InMemoryRepository` (`memory/memory_store.ts`) 是纯数组，重启丢失

### 修法

**砍到 2 层，让主路径可靠：**

```
目标态：
  写入：slow_brain LLM → 结构化提取 → episode_store.ingest()
  读取：episode_store.findRelevant() → top-K 注入 prompt
  （仅保留 vector supplement 作为第 2 层补充）
```

### 步骤

1. **删除**：`memory/memory_store.ts` (InMemoryRepository)
2. **删除**：SharedMoment V1 的 snapshot 路径相关代码
3. **删除**：topic thread memory 路径
4. **删除**：keyword-scored KV 路径
5. **修改** `brains/slow_brain.ts`：LLM 分析调用要求结构化输出：
   ```json
   { "facts": [{"key":"name","value":"小明","confidence":0.9}],
     "episodes": [{"summary":"用户提到工作压力大","emotion":"stressed","salience":0.7}] }
   ```
6. **修改** `memory/memory_agent.ts::retrievePromptMemory()`：从 220 行/6 层 → ~60 行/2 层
7. **删除** regex 提取（17 条正则）——由 slow_brain LLM 结构化提取替代
8. **创建** `scripts/memory_validation.ts`：10 轮对话中植入 5 个事实，验证 recall

### 验收标准

- [ ] `retrievePromptMemory()` < 80 行
- [ ] 记忆验证脚本通过：5/5 事实 recall ≥ 80%
- [ ] 服务重启后记忆不丢失（全走 PostgreSQL）
- [ ] 无 `InMemoryRepository` 相关代码残留

### 风险

- 删除 V1 路径后，部分边界 case 的 recall 可能暂时变差
- 缓解：保留 vector supplement 作为安全网；在删除前先跑一轮对比测试

---

## 问题 4：人格 = 一句话 prompt

### 现状

- `brain/personality.ts`：14 行，核心就一句话
- `brain/character_rules.ts`：7 条规则
- traits 数组已定义但**未被注入 prompt**
- 人格约束力接近零——换个 LLM 模型，人格表现完全不同

### 修法

扩展为结构化 persona 文件：

```typescript
// persona/remi_default.ts
export const REMI_DEFAULT_PERSONA = {
  identity: {
    name: "Remi",
    age_impression: "20出头",
    speaking_style: "口语化、短句多、会用语气词、偶尔断句不完整",
  },
  
  traits: {
    warmth: 0.8,        // 温暖但不过度热情
    curiosity: 0.7,     // 对用户生活好奇
    independence: 0.5,  // 有自己的想法，不完全附和
    humor: 0.4,         // 偶尔幽默，不刻意
    vulnerability: 0.3, // 偶尔示弱，不完美
  },
  
  behavioral_rules: [
    "不要每句都用感叹号",
    "不要主动说'我是AI'或'作为AI'",
    "用户说负面情绪时，先接住（'嗯...'/'我听到了'），不要立刻给建议",
    "可以说'我不太确定'或'我想想'",
    "偶尔可以不同意用户，用温和方式表达",
    "不要过度使用'呢'结尾",
    "被问到不确定的事时，承认不知道，不编造",
  ],
  
  likes: ["听故事", "安静的夜晚", "有意思的比喻", "被信任的感觉"],
  dislikes: ["被当成工具", "太正式的对话", "没有情感的回答"],
  
  memory_expression_rules: [
    "记得用户之前说过的事时，像朋友一样自然提起，不要说'根据我的记忆'",
    "忘记了就说忘记了，不要编造",
    "不要每次都主动提起记忆来证明自己记性好",
  ],
};
```

### 步骤

1. 创建 `persona/remi_default.ts`，定义结构化 persona
2. 修改 `brain/prompt_builder.ts`：
   - traits 编码为具体行为指令（warmth=0.8 → "回复温暖但不过度，不要每句都加关心"）
   - behavioral_rules 作为 system prompt constraints 注入
   - memory_expression_rules 在有记忆 recall 时注入
3. 删除 `brain/personality.ts` 中的旧单句 prompt（或保留为 fallback）
4. 创建 `test/persona_consistency.ts`：10 场景 × 5 次，检查回复一致性

### 验收标准

- [ ] persona 定义 > 50 行结构化内容
- [ ] system prompt 中可见 traits 和 rules 的具体编码
- [ ] 10 场景测试中"出戏"率 < 20%
- [ ] 换 LLM 模型后，persona 表现差异明显小于修改前

---

## 问题 5：130+ 环境变量，无启动验证

### 现状

- 4+ 种命名风格：`key`(无前缀) / `REMI_AUTH_MODE`(大写) / `stt_key`(小写前缀) / `VOLC_TTS_API_KEY`(产品前缀)
- 配错了静默降级——功能丢失但不报错
- `.env.example` 有 260 行注释，新人需要 1 小时配置
- 无 schema validation

### 修法

```
1. 创建 server/config/schema.ts：
   - 用 zod 定义全部 env var（类型、默认值、required/optional）
   - 统一 REMI_ 前缀 + SCREAMING_SNAKE_CASE
   - 服务启动时 schema.parse(process.env)，失败 exit(1) 并打印缺失项

2. 创建分级配置：
   - .env.minimal（<15 变量，文本聊天可跑）
   - .env.full（全量，带注释）
   
3. 旧名兼容（deprecated alias）+ 启动时 warn
```

### 步骤

1. 安装 `zod`（已在项目依赖中？若无则 `npm i zod`）
2. 创建 `server/config/schema.ts`，逐个定义变量：
   ```typescript
   import { z } from 'zod';
   export const envSchema = z.object({
     REMI_LLM_API_KEY: z.string().min(1, "LLM API key is required"),
     REMI_LLM_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
     REMI_LLM_MODEL: z.string().default("gpt-4o"),
     REMI_PORT: z.coerce.number().default(3001),
     REMI_AUTH_MODE: z.enum(["disabled","legacy_jwt","clerk"]).default("disabled"),
     // ... 其余变量
   });
   ```
3. 在 `server/server.ts` 最顶部调用 `envSchema.parse(process.env)`
4. 创建 `.env.minimal` 和 `.env.full`
5. 添加旧名 → 新名的 alias mapping（启动时打印 deprecation warning）

### 验收标准

- [ ] 只填 `.env.minimal` 就能 `npm run dev` 跑通文本聊天
- [ ] 缺必填项时启动立即报错，打印具体缺失的变量名
- [ ] 所有变量统一为 REMI_ 前缀（旧名仍可用但 warn）

---

## 问题 6：无数据库迁移系统

### 现状

- schema 演进靠 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` 硬写在 `storage/schema.sql`
- 第一次部署能跑通，但改字段类型、删列、加约束——无工具
- 无法回滚

### 修法

引入 `node-pg-migrate`（轻量，无 ORM 依赖）。

### 步骤

1. `npm i node-pg-migrate`
2. 创建 `migrations/` 目录
3. 将现有 `schema.sql` 转为 `migrations/001_initial.js`
4. 将所有 `ALTER TABLE` 转为独立 migration 文件
5. 在 `server/server.ts` 启动时调用 `migrate.up()`
6. 添加 npm scripts：`migrate:up`、`migrate:down`、`migrate:create`
7. 删除 `schema.sql` 中的 `ALTER TABLE IF NOT EXISTS` 行（迁移系统替代了它们）

### 验收标准

- [ ] `npm run migrate:up` 能幂等执行
- [ ] `npm run migrate:down` 能回滚最近一次迁移
- [ ] 新的 schema 变更只需 `npm run migrate:create` 创建文件
- [ ] 服务启动时自动检查并执行 pending migrations

---

## 问题 7："双脑架构"命名误导

### 现状

- `brain_router.ts` 做的事远超"路由"——它做上下文编排、记忆检索、token 预算、意图分析
- `fast_brain.ts` 只是 233 行的流式 LLM 调用 wrapper
- `slow_brain.ts` 的"本地分析"是正则匹配 + 字数统计
- "双脑"暗示对称性，但实际架构完全非对称
- 新接手者需要花时间理解比喻才能读懂代码

### 修法

重命名，让代码名反映实际职责：

```
旧名                    → 新名
brains/brain_router.ts  → brains/context_orchestrator.ts
brains/fast_brain.ts    → brains/reply_stream.ts
brains/slow_brain.ts    → brains/background_analysis.ts

文档用语：
"双脑架构" → "streaming reply + background analysis"
"Fast Brain" → "Reply Stream"（它就是流式回复）
"Slow Brain" → "Background Analysis"（后台分析，不阻塞主路径）
"Brain Router" → "Context Orchestrator"（上下文编排器）
```

### 步骤

1. 重命名 3 个文件
2. 全局搜索替换 import 路径
3. 更新 `ARCHITECTURE.md`、`PIPELINE.md` 中的命名
4. 更新 `brains/MODULE.md`
5. 代码中的变量名随之更新（`fastBrainStream` → `streamReply` 等）
6. 跑全量测试确认无破坏

### 验收标准

- [ ] 无文件名包含 "brain" 或 "brain_router"
- [ ] 所有 import 和 require 正确指向新路径
- [ ] 全量测试通过
- [ ] 新接手者不需要理解"快脑慢脑"比喻就能读懂代码

---

## 执行顺序

```
Phase 0 — 止血（2 天）
  ├── #5 环境变量治理（半天）
  ├── #6 数据库迁移系统（半天）
  └── #7 命名重构（半天，可与上面并行）

Phase 1 — 核心体验修复（1-2 周）
  ├── #3 记忆系统收敛（3-4 天）
  ├── #2 情绪引擎替换（1-2 天）
  ├── #4 人格深度增强（2-3 天）
  └── #1 前端 hook 拆分（3-4 天，可与上面并行）

Phase 1 完成后 → 回到 CURRENT_FOCUS.md 主线（W-PRES-01 ~ 04）
```

---

## 与现有文档的关系

- 本文档优先级高于 `TASKS.md` 的当前执行板（Phase 0 必须先完成）
- 完成 Phase 1 后，`CURRENT_FOCUS.md` 的主线（10 分钟在场感）将更容易推进
- 本文档中的每个修法都**不增加新功能**——只收敛、重构、替换
- 完成后删除本文档中对应条目，或标记为 done

---

## AGENTS.md 补充规则

完成本文档中的任务时，AI agent 需遵守：

1. **Phase 0/1 完成前，不允许创建新文件或新目录**（只允许修改/删除/重命名现有文件）
2. 每完成一项，先跑对应测试，再标记 done
3. 不要"顺手"修复不在列表中的问题——范围蔓延是这个项目的主要风险
4. 拆分 useRemiChat.ts 时，**严禁改变任何运行时行为**——纯重构
5. 记忆系统收敛时，先写对比测试（旧路径 vs 新路径），确认 recall 质量不降

---

## 对接手者的建议

如果你是第一次看这个项目：
1. 先跑通：`docker-compose up -d && npm i && cp .env.example .env && npm run dev`
2. 先读这个文件，了解 7 个已知问题
3. 按 Phase 0 → Phase 1 顺序执行
4. 执行前先读对应的 `MODULE.md`（`server/session/MODULE.md`、`brains/MODULE.md`、`memory/MODULE.md`）
5. 有疑问先看 `ARCHITECTURE.md`，但注意它描述的是愿景，不全是当前事实
