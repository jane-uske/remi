# Japanese Mode — 开发状态记录

> 更新：2026-05-08

---

## 已完成（前端 UI / 逻辑）

### 设计重构
- Apple 设计语言落地：Inter 字体（Google Fonts CDN 加载）、20px 圆角、`box-shadow` 卡片、无 hairline border
- `tokens.css` 新增 CSS 变量：`--jp-card-blue/green/orange`、`--jp-hero-gradient`、`--jp-primary-subtle`、`--jp-primary-border`、`--jp-shadow-card`
- Hero 区域：72px 大标题（`clamp`），毛玻璃 stat tile，双 CTA pill
- FeatureCards：渐变背景、大型 SVG 插图、无边框
- 顶栏：毛玻璃 `backdropFilter: saturate(180%) blur(20px)`

### 数据联动（Mock API → 组件 Props）
- `useJapaneseProgress` hook 接入 `JapaneseDashboard`
- 以下组件已接收动态 props（非硬编码默认值）：
  - `ProgressRings` ← `progress`
  - `MasteryGauge` ← `mastery`, `currentLevel`
  - `AssessmentCard` ← `assessment`
  - `DailyGoals` ← `goals`
  - `LearningCalendar` ← `calendar`
  - `Sidebar` ← `currentLevel`, `targetLevel`

### 组件升级
- `ProgressRings`：120px 圆环，数值叠加在圆心，彩色轨道
- `MasteryGauge`：130px 圆形仪表，动态"距 N3 还需提升 X%"文案
- `AssessmentCard`：4px 彩色进度条，分类颜色映射
- `DailyGoals`：彩色进度条，百分比高亮
- `CapabilityGrid`：7 张能力卡片绑定 `onNavigate`，点击跳转对应视图
- `PersonaCard`：集成到 Overview，与 RemiCharacterSection 并排
- `RemiCharacterSection`：静态 `RemiPortraitAvatar` → `CharacterStage`（Live2D → VRM → 2D 降级链）

### 人设激活
- `MiniChat` mount 时调用 `updatePersonaPreset("japanese_sensei")`，unmount 恢复 `"remi_core"`
- `japanese_sensei` 人设已在 `/home/admin/remi/persona/presets.ts` 完整定义

### 课程模块（静态）
- 新增 `CourseView.tsx`：N5–N1 五级课程，2–9 节/级，LessonCard / UnitSection 组件
- Sidebar 新增"📖 课程"导航项
- Overview Hero CTA "开始今日课程" → 跳转课程视图
- 类型定义：`LessonType`、`LessonStatus`、`Lesson`、`CourseUnit` 已加入 `types/japanese.ts`

### 日志复盘视图
- 原占位符替换为：4 格 stat tile + DailyGoals 明细 + 跳转对话练习的 CTA 卡片

### 基建修复
- `middleware.ts`：排除 `/japanese` 和 `/api/japanese` 路由，避免 Edge Runtime EvalError
- `postcss.config.js`：改为 CJS 格式修复 Tailwind v4 PostCSS 解析问题
- Dev server 启动命令：`NODE_ENV=development HOST=0.0.0.0 npx next dev -p 3003`

---

## 未完成（需要后端 / 真实数据）

### 课程内容
- 课程卡片点击后无实际跳转，没有课程详情页
- 课程进度不持久化（刷新丢失），需要数据库存储 `LessonStatus`
- 课程数据硬编码在 `CourseView.tsx`，需要迁移到 API / CMS

### 学习数据
- `/api/japanese/progress` 返回的是 mock 数据，非真实用户数据
- 连续打卡天数（7天）、词汇量（1234词）、累计学习时长（32小时）均为硬编码
- 需要接入用户学习行为埋点 / 数据库

### AI 能力
- CapabilityGrid 点击"口语对话"进入 MiniChat，但 MiniChat 无课程上下文（不知道当前学到哪里）
- 无自适应课程推荐（根据薄弱项调整下一课）
- 无语音输入（MiniChat 没有麦克风按钮）

### 其他视图
- "学习进度"仅展示当前进度，无历史曲线图
- "日志复盘"无真实对话历史记录（只用当前 session messages，刷新清空）
- 无 JLPT 等级升降判断逻辑

---

## 关键文件索引

| 文件 | 说明 |
|------|------|
| `src/app/japanese/tokens.css` | 设计 token，字体，CSS 变量 |
| `src/components/japanese/JapaneseDashboard.tsx` | 主容器，路由分发，数据注入 |
| `src/components/japanese/Sidebar.tsx` | 侧边栏导航，`NavId` 类型 |
| `src/components/japanese/CourseView.tsx` | 课程视图，静态课程数据 |
| `src/components/japanese/MiniChat.tsx` | 浮动聊天，人设激活逻辑 |
| `src/components/japanese/RemiCharacterSection.tsx` | Live2D 角色区域 |
| `src/hooks/useJapaneseProgress.ts` | 数据 hook，对接 `/api/japanese/progress` |
| `src/app/api/japanese/progress/route.ts` | Mock API，待替换为真实数据源 |
| `src/types/japanese.ts` | 所有 Japanese 模块类型定义 |
| `src/middleware.ts` | 路由排除，避免 Edge Runtime 问题 |
