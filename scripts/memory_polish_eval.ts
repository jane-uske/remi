// ── Memory Polish Eval ──────────────────────────────────────────────────────
// 语料驱动的记忆写入端体检：从 JSONL 多轮对话语料重放慢脑，收集 user_facts /
// moments / conversation_summary / proactive_topics 全部产出，跑规则层质量判定
// （不用 LLM judge），输出各"毒率"指标 + top N 坏例，用于打磨记忆提炼质量。
//
// 复用 scripts/memory_backfill.ts 的核心手法（require.cache 拦截
// memory/episode_store.ingest 观察 moment 产出；RecordingMemoryRepo 包装
// MemoryRepository 观察 fact upsert），但输入换成语料 JSONL 而不是 DB 里的
// 真实会话；也不做 embed/findSimilarEpisodes 的 episode 合并预测——本脚本只关心
// 产出内容质量，不关心合并决策，因此全程不需要数据库、也不需要 embedding 服务，
// 只依赖 LM Studio 的 chat completion（与 memory_backfill 共享同一个本地 LLM，
// 串行请求，低压）。
//
// 每条语料对话 = 一个独立模拟"会话"：一次性分配一个 2026-05~06 的随机
// observationDate（模拟这段对话发生在历史上的某一天），对话内按 user/assistant
// 顺序配对成"轮"，逐轮调用 runSlowBrain（history 为该轮之前的全部轮次，不含本轮
// —— 与 memory_backfill 的 chunk focal 语义一致，避免本轮在 prompt 里重复出现）。
// SlowBrainStore / facts 仓库在同一对话内跨轮累积，但不跨对话共享：不同语料
// 对话是互不相关的陌生人对话，硬拼成同一个"用户"画像只会污染 conversation_summary
// 的增量合并逻辑，不代表真实使用场景。
//
// 用法：
//   node -r ts-node/register/transpile-only scripts/memory_polish_eval.ts \
//     --corpus datasets/polish_corpus.jsonl [--limit 200] [--json] [--top 20]
//
// 约束（与主会话对齐）：不改 brains/、memory/、persona/ 任何逻辑（只读复用）；
// LLM 调用串行，单轮超时 30s，失败跳过继续，不中断整轮。

// pino（infra/logger）默认把 pretty 输出写到真实 stdout，且 level 只在模块
// 求值时读一次 process.env.LOG_LEVEL。--json 模式下 stdout 必须是纯 JSON 才能
// 被下游解析，所以必须在下面任何 import 触发 infra/logger 求值之前就把它静音
// （CommonJS 输出下，import 之前的普通语句先执行——已用最小复现验证过）。
// 同时关掉 dev 文件 sink：level=silent 时第一条 "Dev file sink enabled" 日志
// 也被吞掉，底层 sonic-boom 文件流从未被真正写过，进程退出时 pino 的
// exit-flush 钩子会对着一个从未 open 成功的流报 "sonic boom is not ready
// yet" 并把整个进程崩成非零退出码（stdout 来不及落盘）——实测复现过。
// 用 "error" 而不是 "silent"：LOG_LEVEL 是 server/config 里标了 deprecated
// 的旧名，会被自动镜像进 REMI_LOG_LEVEL 走一遍 zod 校验，而该 enum 不接受
// "silent"（只有 trace|debug|info|warn|error|fatal）——传 "silent" 会在
// import 期间就把 validateEnv() 校验炸掉（同样实测复现过）。
if (process.argv.includes("--json")) {
  if (!process.env.LOG_LEVEL) process.env.LOG_LEVEL = "error";
  if (!process.env.REMI_DISABLE_AUTO_LOG_FILE) process.env.REMI_DISABLE_AUTO_LOG_FILE = "1";
}

import fs from "node:fs";
import path from "node:path";

import { loadEnvFile } from "../server/config/load_env";
import { resetConfig } from "../server/config";
import { hasLlmConfig } from "../llm/qwen_client";
import { InMemoryRepository } from "../memory/memory_store";
import { SlowBrainStore } from "../brains/background_analysis_store";
import type { PromptMessage } from "../brain/prompt_builder";
import type { DbEpisode } from "../storage/repositories/episode_repository";
import type { MomentInput } from "../memory/episode_store";
import type {
  MemoryRepository,
  MemoryEntry,
  UpsertOptions,
} from "../memory/memory_repository";
// fact 后处理层（brains/fact_postprocess.ts）：state 类词表与 isStateLikeFact
// 判定函数共用同一份导出，避免判定器和生产逻辑各写一份词表、口径不一致产生
// 假指标；DATE_STAMP_SUFFIX_RE 用于 hallucination_lite 判幻觉前挖掉后处理层
// 自己拼的日期戳（那不是待核实的 LLM claim）。
import {
  isStateLikeFact,
  STATE_WORDS,
  DATE_STAMP_SUFFIX_RE,
} from "../brains/fact_postprocess";
import type { ExtractedFactInput, NormalizedFact } from "../brains/fact_postprocess";

// ── 常量 ──

const TURN_LLM_TIMEOUT_MS = 30_000; // 单轮超时（任务要求：单批超时 30s）
const DEFAULT_TOP_N = 20;
const DEFAULT_CORPUS_PATH = "datasets/polish_corpus.jsonl";
const DEFAULT_SEED = 20260703;

// observationDate 随机分配范围：2026-05-01 ~ 2026-06-30（模拟历史对话）
const OBS_DATE_START_MS = Date.UTC(2026, 4, 1);
const OBS_DATE_RANGE_DAYS = 61; // 5 月 31 天 + 6 月 30 天

// ── 质量判定用正则（严格按任务给定的词表，不复用 memory_backfill 更宽的
//    STRONG_DEICTIC_RE —— 那份是给"回填真实历史消息"用的，本脚本按任务原文
//    重新定义一份更聚焦的指示性时间词表） ──

const DEICTIC_WORDS_RE = /明天|昨天|上次|最近|现在|今晚|这周|仍在|刚才|正在/;
const ABSOLUTE_DATE_RE =
  /\d{1,2}\s*月\s*\d{1,2}\s*日|20\d{2}\s*-\s*\d{1,2}(\s*-\s*\d{1,2})?|20\d{2}\s*年\s*\d{1,2}\s*月(\s*\d{1,2}\s*日)?/;

// state 类判定词表已搬到 brains/fact_postprocess.ts（与 task1 后处理层共用同一份
// 导出，见上方 import），这里不再本地重复定义 STATE_KEY_RE / STATE_VALUE_RE。
const DATE_ANNOTATION_OK_RE = /（[^）]*\d{1,2}\s*月\s*\d{1,2}\s*日[^）]*记[^）]*）|2026-/;

const QUOTE_PAIR_RE = /「[^」]*」/;

const KEY_PUNCT_RE = /[，。！？；：、,.!?;:"'“”‘’()（）\[\]【】\-\/~～*&%$#@]/;

// ── 语料类型 ──

interface CorpusTurn {
  role: "user" | "assistant";
  content: string;
}

interface CorpusDialog {
  id: string;
  turns: CorpusTurn[];
}

interface TurnPair {
  user: CorpusTurn;
  assistant: CorpusTurn;
}

// ── CLI ──

interface CliArgs {
  corpusPath: string;
  limit: number | null;
  json: boolean;
  top: number;
  seed: number;
  ids: Set<string> | null;
}

function usage(): string {
  return [
    "Usage: node -r ts-node/register/transpile-only scripts/memory_polish_eval.ts",
    `  [--corpus <path>]        JSONL corpus path (default: ${DEFAULT_CORPUS_PATH})`,
    "  [--limit <n>]            only process the first N dialogs",
    "  [--ids <id,id>]          only these dialog ids (debug/rerun)",
    `  [--top <n>]              bad examples to report (default ${DEFAULT_TOP_N})`,
    `  [--seed <n>]             RNG seed for observationDate assignment (default ${DEFAULT_SEED})`,
    "  [--json]                 machine-readable report on stdout",
  ].join("\n");
}

function parseArgs(argv: string[]): CliArgs {
  let corpusPath = DEFAULT_CORPUS_PATH;
  let limit: number | null = null;
  let json = false;
  let top = DEFAULT_TOP_N;
  let seed = DEFAULT_SEED;
  let ids: Set<string> | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--corpus") {
      corpusPath = (argv[i + 1] ?? "").trim();
      i += 1;
    } else if (arg === "--limit") {
      const n = Number(argv[i + 1]);
      if (Number.isFinite(n) && n > 0) limit = Math.floor(n);
      i += 1;
    } else if (arg === "--top") {
      const n = Number(argv[i + 1]);
      if (Number.isFinite(n) && n > 0) top = Math.floor(n);
      i += 1;
    } else if (arg === "--seed") {
      const n = Number(argv[i + 1]);
      if (Number.isFinite(n)) seed = Math.floor(n);
      i += 1;
    } else if (arg === "--ids") {
      const list = (argv[i + 1] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (list.length > 0) ids = new Set(list);
      i += 1;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--help" || arg === "-h") {
      // eslint-disable-next-line no-console
      console.log(usage());
      process.exit(0);
    }
  }

  if (!corpusPath) throw new Error(`--corpus is required\n${usage()}`);
  return { corpusPath, limit, json, top, seed, ids };
}

// ── 语料加载 ──

function loadCorpus(corpusPath: string): CorpusDialog[] {
  const abs = path.isAbsolute(corpusPath)
    ? corpusPath
    : path.resolve(process.cwd(), corpusPath);
  const raw = fs.readFileSync(abs, "utf-8");
  const dialogs: CorpusDialog[] = [];
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      throw new Error(`corpus line ${i + 1} is not valid JSON: ${(err as Error).message}`);
    }
    const rec = parsed as Partial<CorpusDialog>;
    if (!rec.id || !Array.isArray(rec.turns)) {
      throw new Error(`corpus line ${i + 1} missing id/turns`);
    }
    dialogs.push({ id: rec.id, turns: rec.turns as CorpusTurn[] });
  }
  return dialogs;
}

function buildTurnPairs(turns: CorpusTurn[]): TurnPair[] {
  const pairs: TurnPair[] = [];
  let pendingUser: CorpusTurn | null = null;
  for (const t of turns) {
    if (t.role === "user") {
      pendingUser = t;
    } else if (t.role === "assistant" && pendingUser) {
      pairs.push({ user: pendingUser, assistant: t });
      pendingUser = null;
    }
  }
  return pairs;
}

// ── 确定性随机数（可复现的 observationDate 分配） ──

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickObservationDate(rng: () => number): string {
  const dayOffset = Math.floor(rng() * OBS_DATE_RANGE_DAYS);
  return new Date(OBS_DATE_START_MS + dayOffset * 86_400_000).toISOString().slice(0, 10);
}

// ── 质量标记函数（任务给定的 5 类） ──

function temporalPoisonFlag(text: string | undefined | null): boolean {
  if (!text) return false;
  return DEICTIC_WORDS_RE.test(text) && !ABSOLUTE_DATE_RE.test(text);
}

// isStateLikeFact 现在从 brains/fact_postprocess.ts 导入（与 task1 后处理层
// 共用同一份判定，见文件顶部 import）。

function transientStateFlag(key: string, value: string): boolean {
  if (!isStateLikeFact(key, value)) return false;
  return !DATE_ANNOTATION_OK_RE.test(value);
}

// 叙事化判定（v2，替换旧版"「」引语 + 短"标准）：background_analysis.ts 的
// buildSharedMomentSummary 改版后不再产出「」裸引语，旧标准会变成死指标、
// 永远 0%，测不出任何东西。新标准 = 是否读起来像"在转述一件事"：出现
// 叙事/转述动词（聊到/聊起/说起/提到…）才算叙事化；反之——要么还残留「」
// 裸引语（新代码回退成旧样式的信号），要么压根没有任何叙事连接词、只是
// 干巴巴的字段堆砌——都判定为"裸"。
const NARRATIVE_VERB_RE = /提到|说起|聊到|聊起|说过|谈到|讲到|问起|聊了|说了|提起/;

function bareQuoteFlag(summary: string): boolean {
  if (!summary) return false;
  if (QUOTE_PAIR_RE.test(summary)) return true;
  return !NARRATIVE_VERB_RE.test(summary);
}

// 概括性动词/形容词停用词：这些词是"改写同一件事"的产物（用更凝练的词描述
// 同一件事），不是凭空编的新事实，即使原文没有逐字出现也不算幻觉证据。
// 列表刻意偏宽——宁可漏判（假阴性），不可错判改写为幻觉（假阳性是 v1 逐
// 4-gram 判定 51.4% 误报率的主因：短的概括性 value 几乎不可能任何 4 字窗口
// 都命中原文，"情绪低落" 这类改写几乎必然被 v1 错判）。STATE_WORDS 本身是
// "这是什么类别的事实"的框架词（状态/心情/安排…），同样不是待核实的具体
// 实体，一并并入停用词。
const HALLUCINATION_GENERALIZING_WORDS = [
  "低落", "疲惫", "开心", "难过", "焦虑", "紧张", "放松", "忙碌", "糟糕",
  "不错", "还好", "挺好", "正常", "稳定", "舒服", "难受", "沮丧", "烦躁",
  "委屈", "崩溃", "愉快", "郁闷", "烦闷", "轻松", "压抑", "不安", "平静",
  "兴奋", "失落", "孤独",
  "提到", "表示", "觉得", "认为", "希望", "打算", "准备", "决定", "计划",
  "记得", "喜欢", "讨厌", "担心", "期待", "后悔", "满意", "失望", "感到",
  "似乎", "可能", "说过", "聊过", "谈到", "问过", "想过",
  // 程度/强度副词-形容词组合：LLM 概括时常见的"加码措辞"（如"极高""非常"），
  // 本身不是新事实，是对已有信息的强调/量化改写。
  "极高", "极低", "非常", "特别", "极其", "十分", "相当", "严重", "轻微",
  "略微", "稍微", "十足",
  ...STATE_WORDS,
];

const HALLUCINATION_CJK_RUN_RE = /[一-鿿]{2,}/g;
// 模糊匹配的最小实体长度：短于此不做模糊匹配，直接要求逐字命中——2 字实体
// 只有一种"半长度窗口"（就是它自己），模糊匹配对它等价于精确匹配，没有
// 放宽的意义，还会因为窗口太短（1 字）而变得过度宽松（几乎任何字都能在
// 原文里随机命中一个常见字）。
const FUZZY_MIN_ENTITY_LEN = 3;

function extractHallucinationEntities(value: string): string[] {
  // 日期戳（本层 task1 后处理或 ANALYSIS_PROMPT 自己拼的）不是待核实的
  // claim，先挖掉——否则 "…日记）" 里"日"+"记"相邻会被连续汉字段抽取
  // 误认成一个从没出现过的假实体"日记"。
  let text = value.replace(DATE_STAMP_SUFFIX_RE, "");
  for (const w of HALLUCINATION_GENERALIZING_WORDS) {
    if (text.includes(w)) text = text.split(w).join(" ");
  }
  const runs = text.match(HALLUCINATION_CJK_RUN_RE) ?? [];
  return Array.from(new Set(runs));
}

/**
 * 实体是否"有依据"：完整命中原文最强；命中不了时，中文没有显式分词边界，
 * "实体"本质是没做过真正分词的连续汉字段，经常是好几个概念粘在一起的
 * 长块（如"个月大的猫"其实是"9个月"+"大"+"的猫"粘连，源文里数字 9 被 CJK
 * 正则天然排除掉了；"一只名为毛线"里真正的实体"毛线"只占最后 2 字）。这种
 * 块要求整体逐字命中太苛刻——实测（50 段语料）大量这类粘连块 + 近义词改写
 * （"男孩子"→"男性"/"只能戴"→"只戴"）被错判幻觉，是 v2 首版判幻觉（半长度
 * 窗口）误报率不降反升的主因：粘连块里真正对应原文的那部分往往只有 2 字，
 * 半长度门槛（如 6 字实体要求至少 3 字连续命中）依然把它挡在外面。
 *
 * 折中：entity 长度 >= FUZZY_MIN_ENTITY_LEN 时，只要有任意 2 字以上的连续
 * 子串命中原文就算有依据——2 字已经是中文最小的有效词单位，命中即说明
 * 实体不是凭空编的，只是被本地正则拼接进了一个更长的无分词块里。仍然拦得住
 * 整体和原文毫无重叠的纯编造（无重叠时任何长度的子串都不会命中）。短实体
 * （<FUZZY_MIN_ENTITY_LEN）不做模糊匹配，只认逐字命中，避免 2 字本身就是
 * 唯一子串、模糊匹配退化成掉以轻心的"随便命中一个常见字"。
 */
function isEntityGrounded(entity: string, joinedSource: string): boolean {
  if (joinedSource.includes(entity)) return true;
  if (entity.length < FUZZY_MIN_ENTITY_LEN) return false;
  for (let winLen = entity.length - 1; winLen >= 2; winLen -= 1) {
    for (let i = 0; i <= entity.length - winLen; i += 1) {
      if (joinedSource.includes(entity.slice(i, i + winLen))) return true;
    }
  }
  return false;
}

/**
 * 实体级判幻觉（v2，替换旧版逐 4-gram 判定）：只提取产出里的"具体实体"
 * （2+ 字连续汉字段，挖掉日期戳和概括性动词/形容词之后剩下的部分），逐个
 * 核对是否在原对话任意一轮里"有依据"（完整命中，或半长度以上子串命中，
 * 见 isEntityGrounded）；只要有一个实体完全没依据就判幻觉。概括改写
 * （"情绪低落"改写自"很down很丧"）不再因为逐字不匹配被错判——概括词已经
 * 被挖掉，不参与核对。
 *
 * 已知局限：纯字符串出现性/子串重叠检查，不能识别"实体确实出现在原文、
 * 但语义用错"的幻觉（如网络用语"集美"=姐妹被误存成地名，原文字面上确实
 * 有这两个字）——这类语义级幻觉需要 LLM judge，不是规则层能做的，本函数
 * 只保证"实体和原文毫无字面重叠"这一类能被抓到。
 */
function hallucinationLiteFlag(value: string, sourceTurns: string[]): boolean {
  const entities = extractHallucinationEntities(value);
  if (entities.length === 0) return false;
  const joinedSource = sourceTurns.join("");
  return entities.some((entity) => !isEntityGrounded(entity, joinedSource));
}

function keyQualityFlag(key: string): boolean {
  return key.length > 12 || KEY_PUNCT_RE.test(key);
}

function factFlags(key: string, value: string, sourceTurns: string[]): string[] {
  const flags: string[] = [];
  if (temporalPoisonFlag(key) || temporalPoisonFlag(value)) flags.push("temporal_poison");
  if (transientStateFlag(key, value)) flags.push("transient_state");
  if (hallucinationLiteFlag(value, sourceTurns)) flags.push("hallucination_lite");
  if (keyQualityFlag(key)) flags.push("key_quality");
  return flags;
}

function momentFlags(summary: string, topic: string): string[] {
  const flags: string[] = [];
  if (temporalPoisonFlag(summary) || temporalPoisonFlag(topic)) flags.push("temporal_poison");
  if (bareQuoteFlag(summary)) flags.push("bare_quote");
  return flags;
}

function textOnlyTemporalFlags(text: string): string[] {
  return temporalPoisonFlag(text) ? ["temporal_poison"] : [];
}

// ── 记录仓库包装（观察 facts 写入，行为与 memory_backfill 一致） ──

interface FactEvent {
  key: string;
  value: string;
  importance: number;
}

class RecordingMemoryRepo implements MemoryRepository {
  constructor(
    private readonly inner: MemoryRepository,
    private readonly onUpsert: (event: FactEvent) => void,
  ) {}

  async upsert(
    key: string,
    value: string,
    importance?: number,
    options?: UpsertOptions,
  ): Promise<void> {
    this.onUpsert({ key, value, importance: importance ?? 0.5 });
    return this.inner.upsert(key, value, importance, options);
  }

  getAll(): Promise<MemoryEntry[]> {
    return this.inner.getAll();
  }
  getByKey(key: string): Promise<MemoryEntry | null> {
    return this.inner.getByKey(key);
  }
  delete(key: string): Promise<void> {
    return this.inner.delete(key);
  }
  touch(key: string): Promise<void> {
    return this.inner.touch(key);
  }
  getStale(maxAge: number, minImportance: number): Promise<MemoryEntry[]> {
    return this.inner.getStale(maxAge, minImportance);
  }
}

// ── runSlowBrain 加载（拦截 episode_store.ingest，与 memory_backfill 同款手法）
//    本脚本不做 embed / findSimilarEpisodes 合并预测：只关心产出内容质量，不关心
//    合并决策，所以拦截器直接返回一个伪造 DbEpisode，全程零网络零数据库。 ──

type IngestInterceptor = (moment: MomentInput) => Promise<DbEpisode>;

/**
 * fact 后处理层观察回调：每次 background_analysis.ts 调用
 * normalizeExtractedFact() 都会触发一次，用于统计 postprocess_rescued 指标
 * （证明构造层真的在拦截/修正东西，而不只是空跑）。真实归一化逻辑不变——
 * 这里只是"旁路一份观察"，不改变 result 也不改变生产行为。
 */
type NormalizeObserver = (input: ExtractedFactInput, result: NormalizedFact | null) => void;

function loadPatchedRunSlowBrain(
  interceptor: IngestInterceptor,
  onNormalize: NormalizeObserver,
): {
  runSlowBrain: (input: unknown) => Promise<void>;
  restore: () => void;
} {
  const backgroundAnalysisPath = require.resolve("../brains/background_analysis");
  const episodeStorePath = require.resolve("../memory/episode_store");
  const factPostprocessPath = require.resolve("../brains/fact_postprocess");

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const originalEpisodeExports = require(episodeStorePath);
  const originalEpisodeCacheEntry = require.cache[episodeStorePath];

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const originalFactExports = require(factPostprocessPath);
  const originalFactCacheEntry = require.cache[factPostprocessPath];
  const realNormalize: (
    fact: ExtractedFactInput,
    observationDate: string,
  ) => NormalizedFact | null = originalFactExports.normalizeExtractedFact;

  delete require.cache[backgroundAnalysisPath];
  require.cache[episodeStorePath] = {
    id: episodeStorePath,
    filename: episodeStorePath,
    loaded: true,
    exports: { ...originalEpisodeExports, ingest: interceptor },
  } as NodeModule;
  require.cache[factPostprocessPath] = {
    id: factPostprocessPath,
    filename: factPostprocessPath,
    loaded: true,
    exports: {
      ...originalFactExports,
      normalizeExtractedFact: (fact: ExtractedFactInput, observationDate: string) => {
        const result = realNormalize(fact, observationDate);
        onNormalize(fact, result);
        return result;
      },
    },
  } as NodeModule;

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { runSlowBrain } = require(backgroundAnalysisPath);

  return {
    runSlowBrain,
    restore() {
      delete require.cache[backgroundAnalysisPath];
      if (originalEpisodeCacheEntry) {
        require.cache[episodeStorePath] = originalEpisodeCacheEntry;
      } else {
        delete require.cache[episodeStorePath];
      }
      if (originalFactCacheEntry) {
        require.cache[factPostprocessPath] = originalFactCacheEntry;
      } else {
        delete require.cache[factPostprocessPath];
      }
    },
  };
}

function fabricateDbEpisode(moment: MomentInput, observationDate: string): DbEpisode {
  const at = new Date(`${observationDate}T12:00:00.000Z`);
  const titlePreview = (moment.topic || moment.summary).slice(0, 30);
  const summaryPreview = moment.topic ? `${moment.topic}：${moment.summary}` : moment.summary;
  return {
    id: `eval-${Math.random().toString(36).slice(2)}`,
    user_id: moment.userId,
    title: titlePreview,
    summary: summaryPreview,
    topics: moment.topic ? [moment.topic] : [],
    mood: moment.mood,
    kind: moment.kind,
    salience: moment.salience,
    recurrence_count: 1,
    unresolved: moment.unresolved,
    first_seen_at: at,
    last_seen_at: at,
    last_referenced_at: null,
    centroid_embedding: [],
    origin_moment_summaries: [moment.summary],
    relationship_weight: moment.salience,
    status: moment.statusHint ?? (moment.unresolved ? "active" : "cooling"),
    v3_domain: null,
    v3_pressure_source: null,
    v3_relational_impact: null,
    v3_user_stance: null,
    v3_unresolved_level: null,
    v3_event_summary: null,
    v3_evidence_turns: [],
    v3_last_user_position: null,
  };
}

// ── 结果模型 ──

type OutputKind = "fact" | "moment" | "conversation_summary" | "proactive_topic";

interface BaseRecord {
  dialogId: string;
  turnIndex: number;
  observationDate: string;
  flags: string[];
}

interface FactRecord extends BaseRecord {
  kind: "fact";
  key: string;
  value: string;
  importance: number;
}

interface MomentRecord extends BaseRecord {
  kind: "moment";
  summary: string;
  topic: string;
  mood: string;
  momentKind: string;
  salience: number;
  unresolved: boolean;
}

interface SummaryRecord extends BaseRecord {
  kind: "conversation_summary";
  text: string;
}

interface TopicRecord extends BaseRecord {
  kind: "proactive_topic";
  text: string;
}

type AnyRecord = FactRecord | MomentRecord | SummaryRecord | TopicRecord;

interface FailedTurn {
  dialogId: string;
  turnIndex: number;
  error: string;
}

interface MetricBucket {
  flagged: number;
  total: number;
  ratePct: number;
}

function bucket(flagged: number, total: number): MetricBucket {
  return { flagged, total, ratePct: total > 0 ? Math.round((flagged / total) * 10000) / 100 : 0 };
}

/** postprocess_rescued：证明 fact_postprocess.ts 的构造层真的在拦截/修正东西。 */
interface RescueBucket {
  total: number;
  dropped: number;
  modified: number;
  unchanged: number;
  rescuedPct: number;
}

function rescueBucket(total: number, dropped: number, modified: number): RescueBucket {
  const unchanged = total - dropped - modified;
  return {
    total,
    dropped,
    modified,
    unchanged,
    rescuedPct: total > 0 ? Math.round(((dropped + modified) / total) * 10000) / 100 : 0,
  };
}

interface EvalReport {
  kind: "memory_polish_eval";
  corpusPath: string;
  envFile: string;
  llmConfigured: boolean;
  seed: number;
  dialogsRequested: number;
  dialogsProcessed: number;
  dialogsSkippedNoTurns: number;
  turnsProcessed: number;
  failedTurns: FailedTurn[];
  durationMs: number;
  counts: {
    facts: number;
    moments: number;
    conversationSummarySnapshots: number;
    proactiveTopics: number;
  };
  metrics: {
    temporal_poison: MetricBucket & { byKind: Record<OutputKind, MetricBucket> };
    transient_state: MetricBucket & { ofAllFacts: MetricBucket };
    bare_quote: MetricBucket;
    hallucination_lite: MetricBucket;
    key_quality: MetricBucket;
    any_flag_fact: MetricBucket;
    any_flag_moment: MetricBucket;
    postprocess_rescued: RescueBucket;
  };
  topBadExamples: BadExample[];
  facts: FactRecord[];
  moments: MomentRecord[];
  conversationSummaries: SummaryRecord[];
  proactiveTopics: TopicRecord[];
}

interface BadExample {
  dialogId: string;
  turnIndex: number;
  observationDate: string;
  flags: string[];
  outputKind: OutputKind;
  outputPreview: string;
  focalUser: string;
  focalAssistant: string;
}

function clip(text: string, max: number): string {
  const compact = text.trim().replace(/\s+/g, " ");
  return compact.length <= max ? compact : `${compact.slice(0, max - 1)}…`;
}

// ── 单条语料对话的处理 ──

interface DialogOutcome {
  turnsProcessed: number;
  facts: FactRecord[];
  moments: MomentRecord[];
  summaries: SummaryRecord[];
  topics: TopicRecord[];
  failed: FailedTurn[];
  factNormalizeTotal: number;
  factNormalizeDropped: number;
  factNormalizeModified: number;
}

async function processDialog(
  dialog: CorpusDialog,
  rng: () => number,
): Promise<DialogOutcome> {
  const observationDate = pickObservationDate(rng);
  const pairs = buildTurnPairs(dialog.turns);
  const sourceTurns = dialog.turns.map((t) => t.content);

  const outcome: DialogOutcome = {
    turnsProcessed: 0,
    facts: [],
    moments: [],
    summaries: [],
    topics: [],
    failed: [],
    factNormalizeTotal: 0,
    factNormalizeDropped: 0,
    factNormalizeModified: 0,
  };
  if (pairs.length === 0) return outcome;

  const store = new SlowBrainStore();
  const dialogRepo = new InMemoryRepository();
  const history: PromptMessage[] = [];
  let lastSummary = "";
  let lastTopicsKey = "";

  for (let turnIndex = 0; turnIndex < pairs.length; turnIndex += 1) {
    const { user, assistant } = pairs[turnIndex];
    const turnFacts: FactEvent[] = [];
    const turnMoments: MomentInput[] = [];
    let turnNormalizeTotal = 0;
    let turnNormalizeDropped = 0;
    let turnNormalizeModified = 0;

    const interceptor: IngestInterceptor = async (moment) => {
      turnMoments.push(moment);
      return fabricateDbEpisode(moment, observationDate);
    };
    const recordingRepo = new RecordingMemoryRepo(dialogRepo, (event) => {
      turnFacts.push(event);
    });
    const onNormalize: NormalizeObserver = (input, result) => {
      turnNormalizeTotal += 1;
      if (!result) {
        turnNormalizeDropped += 1;
        return;
      }
      const rawKey = (input.key ?? "").trim();
      const rawValue = (input.value ?? "").trim();
      if (result.key !== rawKey || result.value !== rawValue) {
        turnNormalizeModified += 1;
      }
    };

    const { runSlowBrain, restore } = loadPatchedRunSlowBrain(interceptor, onNormalize);
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), TURN_LLM_TIMEOUT_MS);
    try {
      await runSlowBrain({
        userId: `eval:${dialog.id}`,
        inputSource: "voice", // 规避 text-archive 记录路径（与 memory_backfill 一致）
        userMessage: user.content,
        assistantReply: assistant.content,
        history: [...history], // 不含本轮（与 memory_backfill 的 chunk focal 语义一致）
        slowBrain: store,
        memoryRepo: recordingRepo,
        relationshipRepo: null,
        signal: abort.signal,
        observationDateOverride: observationDate,
      });

      outcome.factNormalizeTotal += turnNormalizeTotal;
      outcome.factNormalizeDropped += turnNormalizeDropped;
      outcome.factNormalizeModified += turnNormalizeModified;

      for (const fe of turnFacts) {
        outcome.facts.push({
          kind: "fact",
          dialogId: dialog.id,
          turnIndex,
          observationDate,
          key: fe.key,
          value: fe.value,
          importance: fe.importance,
          flags: factFlags(fe.key, fe.value, sourceTurns),
        });
      }
      for (const m of turnMoments) {
        outcome.moments.push({
          kind: "moment",
          dialogId: dialog.id,
          turnIndex,
          observationDate,
          summary: m.summary,
          topic: m.topic,
          mood: m.mood,
          momentKind: m.kind,
          salience: Number(m.salience.toFixed(2)),
          unresolved: m.unresolved,
          flags: momentFlags(m.summary, m.topic),
        });
      }

      const snap = store.getSnapshot();
      if (snap.conversationSummary && snap.conversationSummary !== lastSummary) {
        lastSummary = snap.conversationSummary;
        outcome.summaries.push({
          kind: "conversation_summary",
          dialogId: dialog.id,
          turnIndex,
          observationDate,
          text: lastSummary,
          flags: textOnlyTemporalFlags(lastSummary),
        });
      }
      const topicsKey = snap.proactiveTopics.join("|");
      if (snap.proactiveTopics.length > 0 && topicsKey !== lastTopicsKey) {
        lastTopicsKey = topicsKey;
        for (const topicText of snap.proactiveTopics) {
          outcome.topics.push({
            kind: "proactive_topic",
            dialogId: dialog.id,
            turnIndex,
            observationDate,
            text: topicText,
            flags: textOnlyTemporalFlags(topicText),
          });
        }
      }

      outcome.turnsProcessed += 1;
    } catch (err) {
      outcome.failed.push({
        dialogId: dialog.id,
        turnIndex,
        error: (err as Error).message,
      });
    } finally {
      clearTimeout(timer);
      restore();
    }

    history.push({ role: "user", content: user.content });
    history.push({ role: "assistant", content: assistant.content });
  }

  return outcome;
}

// ── top-N 坏例挑选（按 flag 类型轮转，保证 5 类都尽量露面，而不是被一类刷屏） ──

const FLAG_PRIORITY = [
  "hallucination_lite",
  "temporal_poison",
  "transient_state",
  "bare_quote",
  "key_quality",
];

function primaryFlag(flags: string[]): string {
  for (const f of FLAG_PRIORITY) {
    if (flags.includes(f)) return f;
  }
  return flags[0] ?? "unknown";
}

function toBadExample(
  rec: AnyRecord,
  dialogsById: Map<string, CorpusDialog>,
): BadExample {
  const dialog = dialogsById.get(rec.dialogId);
  const pairs = dialog ? buildTurnPairs(dialog.turns) : [];
  const pair = pairs[rec.turnIndex];
  const outputPreview =
    rec.kind === "fact"
      ? `${rec.key} = ${clip(rec.value, 60)}`
      : rec.kind === "moment"
      ? `topic=${rec.topic || "(无)"} summary=${clip(rec.summary, 60)}`
      : `${clip(rec.text, 80)}`;
  return {
    dialogId: rec.dialogId,
    turnIndex: rec.turnIndex,
    observationDate: rec.observationDate,
    flags: rec.flags,
    outputKind: rec.kind,
    outputPreview,
    focalUser: pair ? clip(pair.user.content, 70) : "(unknown)",
    focalAssistant: pair ? clip(pair.assistant.content, 70) : "(unknown)",
  };
}

function pickTopBadExamples(
  allFlagged: AnyRecord[],
  n: number,
  dialogsById: Map<string, CorpusDialog>,
): BadExample[] {
  const byPrimary = new Map<string, AnyRecord[]>();
  for (const rec of allFlagged) {
    const p = primaryFlag(rec.flags);
    if (!byPrimary.has(p)) byPrimary.set(p, []);
    byPrimary.get(p)!.push(rec);
  }
  // 组内优先多 flag 命中的（更"典型"的坏例）
  for (const list of byPrimary.values()) {
    list.sort((a, b) => b.flags.length - a.flags.length);
  }
  const groups = FLAG_PRIORITY.filter((f) => byPrimary.has(f)).map((f) => byPrimary.get(f)!);
  const picked: AnyRecord[] = [];
  let round = 0;
  while (picked.length < n && groups.some((g) => round < g.length)) {
    for (const g of groups) {
      if (picked.length >= n) break;
      if (round < g.length) picked.push(g[round]);
    }
    round += 1;
  }
  return picked.slice(0, n).map((rec) => toBadExample(rec, dialogsById));
}

// ── 主流程 ──

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const isJson = args.json;
  const progress = (line: string) => {
    if (isJson) process.stderr.write(`${line}\n`);
    else process.stdout.write(`${line}\n`);
  };

  const envFile = loadEnvFile();
  process.env.REMI_EPISODE_MEMORY_ENABLED = "1"; // moment 记录必须开
  process.env.REMI_RELATIONSHIP_STATE_ENABLED = "0"; // 不做关系持久化（无 DB）
  process.env.REMI_PROJECT_MEMORY_ENABLED = "0"; // 不跑 project memory 分析
  process.env.REMI_TEXT_ARCHIVE_LEDGER_ENABLED = "0"; // 不写冷层 ledger
  resetConfig();

  const llmConfigured = hasLlmConfig();
  progress(`[memory_polish_eval] corpus=${args.corpusPath} env=${envFile}`);
  progress(`[memory_polish_eval] llmConfigured=${llmConfigured} seed=${args.seed}`);
  if (!llmConfigured) {
    progress("[memory_polish_eval] WARN: LLM 未配置，user_facts/summary/topics 将全部为空");
  }

  let dialogs = loadCorpus(args.corpusPath);
  if (args.ids) {
    dialogs = dialogs.filter((d) => args.ids!.has(d.id));
  }
  const dialogsRequested = dialogs.length;
  if (args.limit !== null) {
    dialogs = dialogs.slice(0, args.limit);
  }
  const dialogsById = new Map(dialogs.map((d) => [d.id, d]));
  progress(`[memory_polish_eval] dialogs to process: ${dialogs.length} (of ${dialogsRequested} matched)`);

  const rng = mulberry32(args.seed);
  const t0 = Date.now();

  const report: EvalReport = {
    kind: "memory_polish_eval",
    corpusPath: args.corpusPath,
    envFile,
    llmConfigured,
    seed: args.seed,
    dialogsRequested,
    dialogsProcessed: 0,
    dialogsSkippedNoTurns: 0,
    turnsProcessed: 0,
    failedTurns: [],
    durationMs: 0,
    counts: { facts: 0, moments: 0, conversationSummarySnapshots: 0, proactiveTopics: 0 },
    metrics: {
      temporal_poison: {
        flagged: 0,
        total: 0,
        ratePct: 0,
        byKind: {
          fact: bucket(0, 0),
          moment: bucket(0, 0),
          conversation_summary: bucket(0, 0),
          proactive_topic: bucket(0, 0),
        },
      },
      transient_state: { flagged: 0, total: 0, ratePct: 0, ofAllFacts: bucket(0, 0) },
      bare_quote: bucket(0, 0),
      hallucination_lite: bucket(0, 0),
      key_quality: bucket(0, 0),
      any_flag_fact: bucket(0, 0),
      any_flag_moment: bucket(0, 0),
      postprocess_rescued: rescueBucket(0, 0, 0),
    },
    topBadExamples: [],
    facts: [],
    moments: [],
    conversationSummaries: [],
    proactiveTopics: [],
  };

  let factNormalizeTotal = 0;
  let factNormalizeDropped = 0;
  let factNormalizeModified = 0;

  for (let i = 0; i < dialogs.length; i += 1) {
    const dialog = dialogs[i];
    const dialogT0 = Date.now();
    const pairs = buildTurnPairs(dialog.turns);
    if (pairs.length === 0) {
      report.dialogsSkippedNoTurns += 1;
      continue;
    }

    const outcome = await processDialog(dialog, rng);
    report.facts.push(...outcome.facts);
    report.moments.push(...outcome.moments);
    report.conversationSummaries.push(...outcome.summaries);
    report.proactiveTopics.push(...outcome.topics);
    report.failedTurns.push(...outcome.failed);
    report.turnsProcessed += outcome.turnsProcessed;
    report.dialogsProcessed += 1;
    factNormalizeTotal += outcome.factNormalizeTotal;
    factNormalizeDropped += outcome.factNormalizeDropped;
    factNormalizeModified += outcome.factNormalizeModified;

    const elapsedS = ((Date.now() - dialogT0) / 1000).toFixed(1);
    progress(
      `[${i + 1}/${dialogs.length}] ${dialog.id} pairs=${pairs.length} ` +
        `facts=+${outcome.facts.length} moments=+${outcome.moments.length} ` +
        `failed=${outcome.failed.length} ${elapsedS}s`,
    );
  }

  report.durationMs = Date.now() - t0;
  report.counts.facts = report.facts.length;
  report.counts.moments = report.moments.length;
  report.counts.conversationSummarySnapshots = report.conversationSummaries.length;
  report.counts.proactiveTopics = report.proactiveTopics.length;

  // ── 指标汇总 ──
  const allTextOutputs: { kind: OutputKind; flagged: boolean }[] = [
    ...report.facts.map((f) => ({ kind: "fact" as const, flagged: f.flags.includes("temporal_poison") })),
    ...report.moments.map((m) => ({ kind: "moment" as const, flagged: m.flags.includes("temporal_poison") })),
    ...report.conversationSummaries.map((s) => ({
      kind: "conversation_summary" as const,
      flagged: s.flags.includes("temporal_poison"),
    })),
    ...report.proactiveTopics.map((t) => ({
      kind: "proactive_topic" as const,
      flagged: t.flags.includes("temporal_poison"),
    })),
  ];
  const tpFlagged = allTextOutputs.filter((o) => o.flagged).length;
  report.metrics.temporal_poison = {
    ...bucket(tpFlagged, allTextOutputs.length),
    byKind: {
      fact: bucket(
        report.facts.filter((f) => f.flags.includes("temporal_poison")).length,
        report.facts.length,
      ),
      moment: bucket(
        report.moments.filter((m) => m.flags.includes("temporal_poison")).length,
        report.moments.length,
      ),
      conversation_summary: bucket(
        report.conversationSummaries.filter((s) => s.flags.includes("temporal_poison")).length,
        report.conversationSummaries.length,
      ),
      proactive_topic: bucket(
        report.proactiveTopics.filter((t) => t.flags.includes("temporal_poison")).length,
        report.proactiveTopics.length,
      ),
    },
  };

  const stateLikeFacts = report.facts.filter((f) => isStateLikeFact(f.key, f.value));
  const transientFlagged = stateLikeFacts.filter((f) => f.flags.includes("transient_state")).length;
  report.metrics.transient_state = {
    ...bucket(transientFlagged, stateLikeFacts.length),
    ofAllFacts: bucket(transientFlagged, report.facts.length),
  };

  report.metrics.bare_quote = bucket(
    report.moments.filter((m) => m.flags.includes("bare_quote")).length,
    report.moments.length,
  );
  report.metrics.hallucination_lite = bucket(
    report.facts.filter((f) => f.flags.includes("hallucination_lite")).length,
    report.facts.length,
  );
  report.metrics.key_quality = bucket(
    report.facts.filter((f) => f.flags.includes("key_quality")).length,
    report.facts.length,
  );
  report.metrics.any_flag_fact = bucket(
    report.facts.filter((f) => f.flags.length > 0).length,
    report.facts.length,
  );
  report.metrics.any_flag_moment = bucket(
    report.moments.filter((m) => m.flags.length > 0).length,
    report.moments.length,
  );
  report.metrics.postprocess_rescued = rescueBucket(
    factNormalizeTotal,
    factNormalizeDropped,
    factNormalizeModified,
  );

  const allFlaggedRecords: AnyRecord[] = [
    ...report.facts.filter((f) => f.flags.length > 0),
    ...report.moments.filter((m) => m.flags.length > 0),
    ...report.conversationSummaries.filter((s) => s.flags.length > 0),
    ...report.proactiveTopics.filter((t) => t.flags.length > 0),
  ];
  report.topBadExamples = pickTopBadExamples(allFlaggedRecords, args.top, dialogsById);

  if (isJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  process.stdout.write(renderReport(report));
}

// ── 报告渲染（文本模式） ──

function renderMetricLine(label: string, m: MetricBucket): string {
  return `- ${label}: ${m.flagged}/${m.total} (${m.ratePct}%)`;
}

function renderReport(report: EvalReport): string {
  const lines: string[] = [];
  lines.push("");
  lines.push("# Memory Polish Eval Report");
  lines.push(`- corpus: ${report.corpusPath}`);
  lines.push(`- env: ${report.envFile}  llmConfigured: ${report.llmConfigured}  seed: ${report.seed}`);
  lines.push(
    `- dialogs: processed=${report.dialogsProcessed} (requested=${report.dialogsRequested}, ` +
      `skipped_no_turns=${report.dialogsSkippedNoTurns})`,
  );
  lines.push(
    `- turns processed=${report.turnsProcessed}  failed=${report.failedTurns.length}  ` +
      `duration=${(report.durationMs / 1000).toFixed(1)}s`,
  );
  lines.push(
    `- outputs: facts=${report.counts.facts} moments=${report.counts.moments} ` +
      `summary_snapshots=${report.counts.conversationSummarySnapshots} ` +
      `proactive_topics=${report.counts.proactiveTopics}`,
  );

  lines.push("");
  lines.push("## 总体指标（毒率）");
  lines.push(
    renderMetricLine("temporal_poison（全部产出）", report.metrics.temporal_poison),
  );
  lines.push(`  - fact: ${report.metrics.temporal_poison.byKind.fact.flagged}/${report.metrics.temporal_poison.byKind.fact.total} (${report.metrics.temporal_poison.byKind.fact.ratePct}%)`);
  lines.push(`  - moment: ${report.metrics.temporal_poison.byKind.moment.flagged}/${report.metrics.temporal_poison.byKind.moment.total} (${report.metrics.temporal_poison.byKind.moment.ratePct}%)`);
  lines.push(`  - conversation_summary: ${report.metrics.temporal_poison.byKind.conversation_summary.flagged}/${report.metrics.temporal_poison.byKind.conversation_summary.total} (${report.metrics.temporal_poison.byKind.conversation_summary.ratePct}%)`);
  lines.push(`  - proactive_topic: ${report.metrics.temporal_poison.byKind.proactive_topic.flagged}/${report.metrics.temporal_poison.byKind.proactive_topic.total} (${report.metrics.temporal_poison.byKind.proactive_topic.ratePct}%)`);
  lines.push(
    `- transient_state（状态类 fact 缺日期标注，占状态类 fact）: ${report.metrics.transient_state.flagged}/${report.metrics.transient_state.total} (${report.metrics.transient_state.ratePct}%)` +
      `  [占全部 fact: ${report.metrics.transient_state.ofAllFacts.ratePct}%]`,
  );
  lines.push(renderMetricLine("bare_quote（占 moments）", report.metrics.bare_quote));
  lines.push(renderMetricLine("hallucination_lite（占 facts）", report.metrics.hallucination_lite));
  lines.push(renderMetricLine("key_quality（占 facts）", report.metrics.key_quality));
  lines.push(renderMetricLine("any_flag_fact（至少中一条，占 facts）", report.metrics.any_flag_fact));
  lines.push(renderMetricLine("any_flag_moment（至少中一条，占 moments）", report.metrics.any_flag_moment));
  const pr = report.metrics.postprocess_rescued;
  lines.push(
    `- postprocess_rescued（fact 后处理层拦截/修正，占进入该层的候选 fact）: ` +
      `dropped=${pr.dropped} modified=${pr.modified} unchanged=${pr.unchanged} total=${pr.total} (${pr.rescuedPct}%)`,
  );

  lines.push("");
  lines.push(`## Top ${report.topBadExamples.length} 坏例`);
  if (report.topBadExamples.length === 0) lines.push("(none)");
  for (let i = 0; i < report.topBadExamples.length; i += 1) {
    const e = report.topBadExamples[i];
    lines.push(
      `${i + 1}. [${e.dialogId}#${e.turnIndex}] [${e.flags.join("][")}] kind=${e.outputKind}`,
    );
    lines.push(`   对话: user: ${e.focalUser} | assistant: ${e.focalAssistant}`);
    lines.push(`   产出: ${e.outputPreview}`);
  }

  if (report.failedTurns.length > 0) {
    lines.push("");
    lines.push("## 失败轮次");
    for (const ft of report.failedTurns.slice(0, 20)) {
      lines.push(`- ${ft.dialogId}#${ft.turnIndex}: ${ft.error}`);
    }
    if (report.failedTurns.length > 20) {
      lines.push(`  ... and ${report.failedTurns.length - 20} more`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[memory_polish_eval] failed:", (err as Error).message);
    process.exitCode = 1;
  });
}

export {
  parseArgs,
  buildTurnPairs,
  temporalPoisonFlag,
  transientStateFlag,
  isStateLikeFact,
  bareQuoteFlag,
  hallucinationLiteFlag,
  keyQualityFlag,
  factFlags,
  momentFlags,
};
