# Family Memory Draft 确认体验 — 对话冒烟测试脚本

## 前置条件

1. `remi-family-memory` 服务运行中（`npm run dev` 于 localhost:3456）
2. Remi 主服务运行中，`REMI_FAMILY_MEMORY_ENABLED=1`
3. 至少通过 asset intake 导入了一些文件产生了 pending drafts

---

## 场景 1：有一个 draft

### 准备

确保 `data/drafts/` 下只有一条 pending draft。

### 对话

```
用户：有什么要确认的？
Remi：有 1 条待确认草稿：
        日期：2026-05-10
        文件：ultrasound.jpg

      这些图片当前还不能自动识别内容，请补充摘要后确认。

      回复"确认"通过，"跳过"拒绝，或"补充摘要：<内容>"添加描述后确认。
```

**验收点**：
- 显示日期和文件名
- 如果是图片（ocrStatus=no_extractor），提示"图片当前还不能自动识别内容"
- 如果是 PDF（ocrStatus=extracted），提示"PDF 已提取文本，但仍需确认摘要"

---

## 场景 2：有多个 draft

### 准备

通过 asset intake 导入多批文件，产生 2~3 条 pending drafts。

### 对话

```
用户：有什么要确认的？
Remi：有 3 条待确认草稿：

        1. B超照片
           文件数：2 | OCR：无法自动识别 ⚠需补充摘要
        2. 产检PDF
           文件数：1 | OCR：已提取文本
        3. misc.bin
           文件数：1 | OCR：提取失败 ⚠需补充摘要

      请输入编号选择要操作的草稿（如"1"、"2"）。
```

**验收点**：
- 每条显示编号、inferredTitle、文件数、OCR 状态
- 需要补充摘要时有 ⚠ 标记
- 裸"确认"被拒绝，要求先选编号

```
用户：确认
Remi：有 3 条待确认草稿，请先输入编号选择要操作的草稿（如"1"、"2"）。
```

---

## 场景 3：选择 draft

```
用户：2
Remi：已选择第 2 条：
        日期：2026-05-11
        文件：report.pdf

      PDF 已提取文本，但仍需确认摘要。

      回复"确认"通过，"跳过"拒绝，或"补充摘要：<内容>"添加描述后确认。
```

也支持 `选择2` 语法。

---

## 场景 4：补充摘要

```
用户：补充摘要：第二次产检，一切正常
Remi：已补充摘要到第 2 条草稿。回复"确认"即可生成待同步 note。
```

**验收点**：
- 摘要保存到 session，不丢失
- 回复明确告知下一步操作是"确认"

---

## 场景 5：确认

```
用户：确认
Remi：已生成待同步 note「产检PDF」，运行 npm run sync 后会进入正式时间线和 Remi 可查询记忆。
```

**验收点**：
- 回复包含 `npm run sync` 提示
- 提及"正式时间线"和"Remi 可查询记忆"

---

## 场景 6：跳过/拒绝

```
用户：有什么要确认的？
Remi：有 1 条待确认草稿：...

用户：跳过
Remi：已跳过「B超照片」，不会进入时间线。
```

---

## 场景 7：confirm 后回 family-memory 执行 sync

确认后 Remi 会提示运行 sync。在 family-memory 项目中执行：

```bash
cd /path/to/remi-family-memory
npm run sync
```

sync 会将 confirmed notes 从 `data/drafts/` 移入 `data/notes/` 时间线目录，之后 Remi 的记忆查询能力即可检索到这些内容。

---

## 场景 8：服务不可用

如果 family-memory 服务未启动：

```
用户：有什么要确认的？
Remi：家庭记忆服务暂不可用，无法查询待确认草稿。
```

**验收点**：handled=true，不会 fallback 到主 pipeline。
