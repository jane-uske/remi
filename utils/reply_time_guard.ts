// ── 回复出口时间守卫（reply time guard）──────────────────────────────────
//
// 背景（2026-07 生产实锤两类翻车）：
//   ① 周六凌晨用户说"有点困了"，Remi 回"周一早起确实折磨人"——记忆里有
//      "周一晚上活跃""工作日早起上班"两条真记忆，模型缝合 + 历史窗口里有旧的
//      "今天是周一?"对话，生成时用错了星期。
//   ② 凌晨 01:42 的主动搭话说"这会儿已经黄昏了"——同类问题，时段判断错误。
// 结论：即使记忆是真的，模型生成时也会用错时间；prompt 里有时间锚但模型
// （指令遵循偏弱）会无视。所以在"说出口前"做构造性校验——纯规则，不祈祷。
//
// 本模块是纯函数：给定一句已经完整的回复句子 + 用户时区 + 当前时刻，判断这句
// 话里的星期/时段断言是否与"当下"矛盾。不做任何 I/O、不 await 任何东西，
// 调用方（server/pipeline/runner.ts 的 pushSentence）在 fast path 上同步调用，
// 微秒级。
//
// 设计原则："宁可漏杀不误杀"——任何拿不准的模式（引号内容、疑问句、谈论
// 过去/将来计划、相对星期如"上周三"）一律放行，不误伤合法句子。

/** 星期字符，下标对齐 `Date.getDay()` / `Intl` weekday-short 的 0=周日..6=周六。 */
const WEEKDAY_CHARS = ["日", "一", "二", "三", "四", "五", "六"];

const WEEKDAY_TOKEN_RE = "(?:周|星期|礼拜)[一二三四五六日天]";

/** 星期词前紧邻这些前缀 → 相对/周期性表达（上周三/下下周一/每周五），不是"今天是 X"断言。 */
const RELATIVE_WEEK_PREFIX_RE = /(?:上上|下下|上|下|每|各)$/;

/** 星期词附近出现这些 → 在谈计划/日程，不是断言"今天就是这天"。 */
const PLAN_CONTEXT_RE =
  /(见|约|打算|计划|安排|定在|预约|开会|提醒|截止|交.{0,4}(作业|报告)|到期|放假|上班|请假|出差)/;

/** 星期词前出现假设/条件词 → 假设语境，放行。 */
const HYPOTHETICAL_BEFORE_RE = /(如果|假设|假如|要是|万一)/;

/** 星期词前出现否定/纠正词 → 是纠正而非断言（"今天不是周一"），放行。 */
const NEGATION_BEFORE_RE = /(不是|不对|才不是|并不是|又不是|哪是|可不是)[，,]?$/;

/** 明天/昨天线索：命中时星期合法集额外放宽 ±1 天。 */
const TOMORROW_CUE_RE = /明天|明早|明晚/;
const YESTERDAY_CUE_RE = /昨天|昨晚|昨早/;

/** 整句含问号 → 疑问句放行（不确定语气，不是断言）。 */
const QUESTION_RE = /[?？]/;

/** 引号字符，用于判断星期词/时段词是否被引用（转述、非断言）而放行。 */
const QUOTE_OPEN_RE = /[「“"'『]/;
const QUOTE_CLOSE_RE = /[」”"'』]/;

// ── 现在时段断言 ──────────────────────────────────────────────────────

/** "现在/此刻/这会儿/已经...了" 等现在时指示词。 */
const NOW_INDICATOR_RE = /(这会儿|现在|此刻|已经|都.{0,4}了)/;

/** 时段词 → 合法小时区间（左闭右开，24 表示次日 0 点）。相邻时段允许 1 小时重叠宽容，在 `legalPeriodWordsForHour` 里处理。 */
const PERIOD_RANGES: Array<{ words: string[]; start: number; end: number }> = [
  { words: ["凌晨", "深夜", "半夜"], start: 0, end: 5 },
  { words: ["早上", "清晨"], start: 5, end: 9 },
  { words: ["上午"], start: 9, end: 11 },
  { words: ["中午"], start: 11, end: 13 },
  { words: ["下午"], start: 13, end: 17 },
  { words: ["傍晚", "黄昏"], start: 17, end: 19 },
  { words: ["晚上", "深夜"], start: 19, end: 24 },
];

const ALL_PERIOD_WORDS = Array.from(new Set(PERIOD_RANGES.flatMap((r) => r.words)));
const PERIOD_TOKEN_RE = `(?:${ALL_PERIOD_WORDS.join("|")})`;

export type ReplyTimeGuardViolationKind = "weekday" | "time_period";

export interface ReplyTimeGuardViolation {
  kind: ReplyTimeGuardViolationKind;
  /** 命中的原词，如"周一"、"黄昏"。 */
  token: string;
  /** 命中位置在句子里的字符下标，便于日志定位。 */
  index: number;
  /** 供日志展示的期望值描述，如"周六"或"凌晨/深夜/半夜"。 */
  expected: string;
}

export interface ReplyTimeGuardResult {
  /** true = 这句话没有可疑的星期/时段断言矛盾，可以正常发出。 */
  ok: boolean;
  violations: ReplyTimeGuardViolation[];
}

export interface ReplyTimeGuardContext {
  /** 判断基准时刻，通常是 `new Date()`；测试可注入固定时间。 */
  now: Date;
  /** 用户时区（IANA），取不到时调用方应传入 REMI_TZ 默认值或 "Asia/Shanghai"。 */
  timeZone: string;
}

// ── 时区安全小工具（不依赖 brain/time_capability.ts，保持本模块零外部依赖） ──

function safeTimeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat("zh-CN", { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return "UTC";
  }
}

function getHourInTz(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(date);
  const raw = parts.find((p) => p.type === "hour")?.value;
  const hour = Number(raw);
  return Number.isFinite(hour) ? hour % 24 : date.getUTCHours();
}

function getWeekdayIndexInTz(date: Date, timeZone: string): number {
  const short = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(date);
  const map: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return map[short] ?? date.getUTCDay();
}

// ── 合法集计算 ────────────────────────────────────────────────────────

/** 今天的星期合法集；命中"明天/昨天"线索时相应 ±1 天也算合法。 */
export function legalWeekdayCharsForSentence(
  sentence: string,
  todayIndex: number,
): Set<string> {
  const legal = new Set<string>([WEEKDAY_CHARS[todayIndex]]);
  if (TOMORROW_CUE_RE.test(sentence)) {
    legal.add(WEEKDAY_CHARS[(todayIndex + 1) % 7]);
  }
  if (YESTERDAY_CUE_RE.test(sentence)) {
    legal.add(WEEKDAY_CHARS[(todayIndex + 6) % 7]);
  }
  return legal;
}

/** 给定当前小时，返回所有"合法"的时段词（含相邻时段 1 小时重叠宽容）。 */
export function legalPeriodWordsForHour(hour: number): Set<string> {
  const legal = new Set<string>();
  const h = ((hour % 24) + 24) % 24;
  for (const range of PERIOD_RANGES) {
    if (h >= range.start && h < range.end) {
      range.words.forEach((w) => legal.add(w));
    }
    const startTolerance = (range.start - 1 + 24) % 24;
    const endTolerance = range.end % 24;
    if (h === startTolerance) range.words.forEach((w) => legal.add(w));
    if (h === endTolerance) range.words.forEach((w) => legal.add(w));
  }
  return legal;
}

// ── 句子切分（与 utils/sentence_chunker.ts 的硬边界一致，独立实现避免循环依赖） ──

const SENTENCE_SPLIT_RE = /(?<=[。！？!?\n])/;

function splitIntoSentences(text: string): string[] {
  return text.split(SENTENCE_SPLIT_RE).filter((s) => s.trim().length > 0);
}

// ── 放行判定小工具 ────────────────────────────────────────────────────

function isQuoted(sentence: string, index: number, tokenLen: number): boolean {
  const before = sentence.slice(Math.max(0, index - 10), index);
  const after = sentence.slice(index + tokenLen, index + tokenLen + 10);
  return QUOTE_OPEN_RE.test(before) && QUOTE_CLOSE_RE.test(after);
}

function isNegated(sentence: string, index: number): boolean {
  const before = sentence.slice(Math.max(0, index - 8), index);
  return NEGATION_BEFORE_RE.test(before);
}

function isHypothetical(windowBefore: string): boolean {
  return HYPOTHETICAL_BEFORE_RE.test(windowBefore);
}

function isPlanContext(window: string): boolean {
  return PLAN_CONTEXT_RE.test(window);
}

/**
 * 句子内部常有逗号/顿号/分号分隔的多个独立分句（sentence_chunker 只保证
 * 硬边界 。！？，一个"句子"单元里可能塞了"断言分句 + 反问分句"，如
 * "这会儿已经黄昏了，你怎么还不睡？"——反问在后半句，前半句仍是平铺断言，
 * 不该被后面的问号连坐放行。这里只取"包含 index 位置"的那个分句来判断
 * 是否为疑问句，而不是整句扫描问号。
 */
const CLAUSE_SPLIT_RE = /[，,、；;]/;

function clauseContaining(sentence: string, index: number): string {
  let start = 0;
  for (let i = index - 1; i >= 0; i--) {
    if (CLAUSE_SPLIT_RE.test(sentence[i])) {
      start = i + 1;
      break;
    }
  }
  let end = sentence.length;
  for (let i = index; i < sentence.length; i++) {
    if (CLAUSE_SPLIT_RE.test(sentence[i])) {
      end = i;
      break;
    }
  }
  return sentence.slice(start, end);
}

function isClauseQuestion(sentence: string, index: number): boolean {
  return QUESTION_RE.test(clauseContaining(sentence, index));
}

// ── 单句检测 ──────────────────────────────────────────────────────────

function checkWeekdayAssertions(
  sentence: string,
  todayIndex: number,
): ReplyTimeGuardViolation[] {
  const violations: ReplyTimeGuardViolation[] = [];
  const legal = legalWeekdayCharsForSentence(sentence, todayIndex);
  const re = new RegExp(WEEKDAY_TOKEN_RE, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(sentence))) {
    const token = m[0];
    const index = m.index;
    const dayChar = token.slice(-1);
    const before = sentence.slice(Math.max(0, index - 6), index);
    const windowBefore = sentence.slice(Math.max(0, index - 12), index);
    const windowAfter = sentence.slice(index + token.length, index + token.length + 12);
    const window = windowBefore + token + windowAfter;

    if (RELATIVE_WEEK_PREFIX_RE.test(before)) continue; // 上周X/下下周X/每周X
    if (isQuoted(sentence, index, token.length)) continue; // 引号内容放行
    if (isPlanContext(window)) continue; // 谈将来/过去计划放行
    if (isHypothetical(windowBefore)) continue; // 假设语境放行
    if (isNegated(sentence, index)) continue; // "今天不是周X" 是纠正，放行
    if (isClauseQuestion(sentence, index)) continue; // 本分句是疑问句，放行

    if (!legal.has(dayChar)) {
      violations.push({
        kind: "weekday",
        token,
        index,
        expected: `周${[...legal].join("/周")}`,
      });
    }
  }
  return violations;
}

function checkTimePeriodAssertions(
  sentence: string,
  hour: number,
): ReplyTimeGuardViolation[] {
  if (!NOW_INDICATOR_RE.test(sentence)) return []; // 无现在时指示词，不判定（避免"早上记得吃早饭"这类泛化建议被误伤）

  const violations: ReplyTimeGuardViolation[] = [];
  const legal = legalPeriodWordsForHour(hour);
  const re = new RegExp(PERIOD_TOKEN_RE, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(sentence))) {
    const token = m[0];
    const index = m.index;
    if (isQuoted(sentence, index, token.length)) continue;
    if (isHypothetical(sentence.slice(Math.max(0, index - 12), index))) continue;
    if (isClauseQuestion(sentence, index)) continue; // 本分句是疑问句，放行

    if (!legal.has(token)) {
      violations.push({
        kind: "time_period",
        token,
        index,
        expected: [...legal].join("/"),
      });
    }
  }
  return violations;
}

/**
 * 检测一句"已经组装完成的回复句子"是否含有与当下矛盾的星期/时段断言。
 * 纯同步函数，不做任何 I/O，可在 fast path 直接调用。
 *
 * @param sentence 单句文本（调用方应在句子边界处调用，如 sentence_chunker 产出的一段）。
 * @param ctx 判断基准（当前时刻 + 用户时区）。
 */
export function checkReplyTimeGuard(
  sentence: string,
  ctx: ReplyTimeGuardContext,
): ReplyTimeGuardResult {
  const trimmed = sentence.trim();
  if (!trimmed) return { ok: true, violations: [] };

  const timeZone = safeTimeZone(ctx.timeZone);
  const hour = getHourInTz(ctx.now, timeZone);
  const todayIndex = getWeekdayIndexInTz(ctx.now, timeZone);

  const violations = [
    ...checkWeekdayAssertions(trimmed, todayIndex),
    ...checkTimePeriodAssertions(trimmed, hour),
  ];

  return { ok: violations.length === 0, violations };
}

/**
 * 对一整段回复文本按句子切分逐句检测（用于持久化前的全文扫描）。
 * 返回每句的检测结果，供调用方决定保留/丢弃哪些句子。
 */
export function checkReplyTimeGuardForFullText(
  text: string,
  ctx: ReplyTimeGuardContext,
): Array<{ sentence: string; result: ReplyTimeGuardResult }> {
  return splitIntoSentences(text).map((sentence) => ({
    sentence,
    result: checkReplyTimeGuard(sentence, ctx),
  }));
}

/**
 * 从全文中剔除一个句子，容忍标点/空白差异。
 *
 * SentenceChunker 输出的句子与 LLM 原文可能有标点差异（软边界标点被移动或丢弃），
 * 生产实案：守卫 drop 了「反正周一还远着呢别急着把自己往床上赶。」（无逗号），
 * 但 full 原文是「反正周一还远着呢，别急着把自己往床上赶。」——精确 split 匹配
 * 失败，坏句原样进了持久化。这里先精确匹配，失败则按"实词序列 + 任意标点空白"
 * 定位删除；向后吞掉句尾残留标点，向前不吞（句首标点属于上一句）。
 */
export function stripSentenceLoose(full: string, sentence: string): string {
  const exact = full.split(sentence).join("");
  if (exact !== full) return exact;
  const core = [...sentence].filter((ch) => /[\p{L}\p{N}]/u.test(ch));
  if (core.length === 0) return full;
  const pattern = core
    .map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[\\s\\p{P}]*");
  try {
    return full.replace(new RegExp(`${pattern}[\\s\\p{P}]*`, "u"), "");
  } catch {
    return full;
  }
}
