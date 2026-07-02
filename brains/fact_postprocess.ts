// ── Fact Postprocess ────────────────────────────────────────────────────────
// fact 入库前的构造性校验层（纯函数，无副作用/无 IO，可独立单测）。
//
// 背景（scripts/memory_polish_eval.ts 25 段 LCCC 语料体检基线）：
// - temporal_poison 里有"key 含时间词"的漏网案例（如 fact "今晚安排" =
//   "邀请 Remi 共进晚餐（2026-06-04记）"）：ANALYSIS_PROMPT 的指示性时间词规则
//   只教会 LLM 修 value 侧的表述，没提 key 也不能带时间词；
// - transient_state 46.7%：状态类 fact（心情/身体/安排…）近一半没带日期
//   标注——prompt 里写了"状态类 value 必须带观察日期"的规则，但这是纯靠
//   35B 本地模型自觉遵守，服从率不稳定；
// - 低置信度的"assistant 推断"事实（LLM 自己脑补、不是用户明说的）缺乏过滤，
//   容易把猜测当定论存进长期记忆。
//
// 这一层不依赖 LLM 是否听话："纯代码构造"保证结果，而不是"prompt 里多写一条
// 规则、赌它服从"。ANALYSIS_PROMPT 的对应规则继续保留（第一道防线，省得
// 100% 依赖这层兜底、每条 key/value 都要重写一遍），这里是保证兜底、不可绕过
// 的第二道防线。
//
// 消费方：brains/background_analysis.ts 的 llmAnalysis()——user_facts 循环里
// store.addFact()（会话内存，供本轮起 prompt 使用）和 memoryRepo.upsert()
// （长期持久化）两条路径共用同一次归一化结果，返回 null 时两条路径都跳过
// （不只是不落库，连本轮会话内存都不留——道理与既有的 isVolatileMemoryKey()
// 早退分支一致：不够格的 fact 不值得进 store，不是只挡 DB）。

export interface ExtractedFactInput {
  key: string;
  value: string;
  confidence?: number;
  source?: "user" | "assistant";
}

export interface NormalizedFact {
  key: string;
  value: string;
}

// ── 规则 4：低置信过滤 ──
const LOW_CONFIDENCE_THRESHOLD = 0.6;

// ── 指示性时间词：key 剥离（规则 1）与 value 残留兜底（规则 3）共用同一份。
//    任务给定的最小词表是 今晚/明天/昨天/本周/最近/现在/上次；这里并入现有
//    ANALYSIS_PROMPT 原文和 memory_polish_eval 判定器已经在用的近义词
//    （这周/刚才/刚刚/仍在/正在），避免三处规则各写一份、互相漏字。
//    对 key 剥离而言，词表更宽只会让 key 更干净；对 value 兜底而言，词表更宽
//    只会让"该补日期而没补"的漏网案例更少——两个方向都是"宁宽勿窄"。
const INDICATIVE_TIME_WORDS = [
  "今晚", "明天", "昨天", "本周", "这周", "最近", "现在", "上次",
  "刚才", "刚刚", "仍在", "正在",
];
const INDICATIVE_TIME_WORD_RE = new RegExp(INDICATIVE_TIME_WORDS.join("|"));

// ── 状态类判定词表：任务 1（本文件，决定是否自动补日期）与任务 3
//    （scripts/memory_polish_eval.ts 的 transient_state 判定器）共用同一份
//    导出——判定器和生产逻辑若各写一份词表，两边口径不一致会产生假指标
//    （判定器认为是状态类该扣分，生产层却没触发补日期，或反之）。
//    词表 = 任务给定的最小集合 ∪ 体检基线原有判定器（旧版本地 STATE_KEY_RE /
//    STATE_VALUE_RE）已经在识别的近义词，后者予以保留避免收窄word表，
//    导致体检分母跟着变、25 段基线数字和 50 段新跑不可比。
export const STATE_WORDS = [
  // 任务给定的最小词表
  "状态", "心情", "情绪", "身体", "健康", "疼", "病", "累", "安排", "计划",
  "日程", "工作至", "加班",
  // 体检基线旧判定器已在用的近义词（保留，避免收窄）
  "状况", "作息", "近况", "进度", "睡眠", "病情",
  "失眠", "睡不着", "请假", "感冒", "发烧", "复发", "压力大", "难受",
  "不舒服", "沮丧", "低落", "开心", "难过", "放假", "休息", "准备", "打算",
  "忙碌", "挺累",
];
const STATE_WORD_RE = new RegExp(STATE_WORDS.join("|"));
// 任务额外点名：value 含"正在/仍在/刚"也算状态类信号，即便没命中上面的词表
// （"刚"单字故意宽泛——这里只影响"要不要补日期戳"，宁可多补不可漏补）。
const STATE_VALUE_EXTRA_RE = /正在|仍在|刚/;

/**
 * 判定一条 fact 是否"状态类"（会过期的快照，如身体/心情/日程安排），
 * 而不是"属性类"（长期不变的事实，如职业/城市/车辆）。
 * 导出给 scripts/memory_polish_eval.ts 的 transient_state 判定器复用。
 */
export function isStateLikeFact(key: string, value: string): boolean {
  return STATE_WORD_RE.test(key) || STATE_WORD_RE.test(value) || STATE_VALUE_EXTRA_RE.test(value);
}

// ── 日期标注格式 ──
// 本层构造附加的格式是"（M月D日记）"；同时容忍 ANALYSIS_PROMPT 自己教 LLM
// 产出的"（YYYY-MM-DD记）"格式（prompt 示例：{"value": "胃痛、失眠
// （2026-06-28记）"}）——两种格式都算"已经标注过日期"，不重复附加。
//
// 导出给 scripts/memory_polish_eval.ts 的 hallucination_lite 判定器：日期戳是
// 本层从 observationDate 算出来的客观标注，不是 LLM 声称的"事实"，判幻觉前
// 必须先从 value 里挖掉——否则"…日记）"里"日"+"记"两个字连在一起，会被
// 判幻觉器的连续汉字段抽取误认成一个从没出现过的假实体"日记"。
export const DATE_STAMP_SUFFIX_RE = /（(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\s*月\s*\d{1,2}\s*日)记）\s*$/;

// "记" 是判断"这是不是观察日期标注"的必要条件，两个格式分支都要求它同时
// 出现——否则"（20"这个弱标记单独出现就会被 value 里其他跟观察日期无关的
// 年份括注骗过。真实 50 段语料体检抓到过一个具体坏例：LLM 把"明年去上海"
// 按 temporal_poison 规则换算成了"明年去上海（2027年）"（换算了指代，年份
// 写对了），但那是"这件事将在哪年发生"，不是"这条记忆是哪天记下的"——
// 两者语义完全不同。旧版 `value.includes("（20")` 只看有没有"（20"前缀，
// 会把"（2027年）"错认成"已经有观察日期标注"而跳过补记，实际上这条状态类
// fact 从未被真正打上观察日期戳。
function hasDateAnnotation(value: string): boolean {
  if (!value.includes("记")) return false;
  return value.includes("（20") || (value.includes("月") && value.includes("日"));
}

function monthDayLabel(observationDate: string): string {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(observationDate.trim());
  if (!m) return observationDate.trim(); // 兜底：格式不对也不炸，原样用
  return `${Number(m[2])}月${Number(m[3])}日`;
}

// ── 规则 1：key 归一化 ──
// 与 scripts/memory_polish_eval.ts 的 KEY_PUNCT_RE 字符集保持一致（同一批
// 标点），这样 postprocess 修好的 key 也不会反过来触发 eval 的 key_quality 判定。
const KEY_PUNCT_SPLIT_RE = /[，。！？；：、,.!?;:"'“”‘’()（）\[\]【】\-\/~～*&%$#@]/;
const MAX_KEY_LEN = 12;

function stripIndicativeTimeWords(text: string): string {
  return text.replace(new RegExp(INDICATIVE_TIME_WORDS.join("|"), "g"), "");
}

/**
 * key 归一化：
 * 1a. 含斜杠/标点 → 取第一个"剥离时间词后仍非空"的分段（不是死板取 [0]——
 *     "今晚/安排" 这种时间词独占一段的畸形 key，第一段剥完是空的，
 *     要能落到下一段"安排"，不能直接判空扔掉整条 fact）。
 * 1b. 剥离指示性时间词（"今晚安排" → "安排"）。剥离后即便变得很短/很泛
 *     （"安排"/"状态"）也保留，不做进一步"智能改写"——任务口径就是"直接用
 *     原 key 剥离时间词即可"，不引入新的猜测/编造。
 * 1c. 超过 12 字 → 截断到首个语义段（优先按空白切分；没有空白就硬截断到
 *     12 字——中文短语没有显式分词边界，硬截断是可预测的最后手段）。
 * 所有分段剥离后都是空（key 纯粹就是个时间词本身，如 "今晚"）→ 返回空串，
 * 交给调用方按"救不回来"处理（丢弃整条 fact）。
 */
function normalizeFactKey(rawKey: string): string {
  const rawSegments = rawKey
    .split(KEY_PUNCT_SPLIT_RE)
    .map((s) => s.trim())
    .filter(Boolean);
  const segments = rawSegments.length > 0 ? rawSegments : [rawKey.trim()];

  let key = "";
  for (const seg of segments) {
    const stripped = stripIndicativeTimeWords(seg).trim();
    if (stripped) {
      key = stripped;
      break;
    }
  }
  if (!key) return "";

  if (key.length > MAX_KEY_LEN) {
    const bySpace = key.split(/\s+/)[0];
    key = bySpace && bySpace.length > 0 && bySpace.length <= MAX_KEY_LEN ? bySpace : key.slice(0, MAX_KEY_LEN);
  }
  return key;
}

// ── 规则 2 + 3：状态类自动补日期 / 残留时间词兜底 ──
// 两条规则都是同一个"末尾附日期戳"动作，只是触发条件不同（状态类词表命中 /
// value 里仍有指示性时间词），命中任一个都执行；已经标注过日期的不重复附加。
function needsDateStamp(key: string, value: string): boolean {
  if (hasDateAnnotation(value)) return false;
  return isStateLikeFact(key, value) || INDICATIVE_TIME_WORD_RE.test(value);
}

/**
 * fact 入库前的构造性校验/归一化。null 表示这条 fact 不值得保留
 * （调用方应跳过 store.addFact 和 memoryRepo.upsert 两条消费路径）。
 *
 * @param observationDate 观察日期（YYYY-MM-DD），用于换算状态类 fact 的日期
 *   标注。线上取当天，离线回填传消息原始发生日（与 background_analysis.ts
 *   的 observationDateOverride 语义一致）。
 */
export function normalizeExtractedFact(
  fact: ExtractedFactInput,
  observationDate: string,
): NormalizedFact | null {
  const rawKey = (fact.key ?? "").trim();
  const rawValue = (fact.value ?? "").trim();
  if (!rawKey || !rawValue) return null;

  // 规则 4：低置信过滤（放最前 fail-fast；纯函数不受执行顺序影响结果，
  // 没必要先做 key/value 整形再扔掉）。confidence 缺失时不过滤——只有明确
  // 给出 <0.6 的置信度、且明确标了 source=assistant（LLM 自己推断，不是用户
  // 原话）才算"猜测当定论"，予以丢弃。
  if (
    typeof fact.confidence === "number" &&
    fact.confidence < LOW_CONFIDENCE_THRESHOLD &&
    fact.source === "assistant"
  ) {
    return null;
  }

  // 规则 1
  const key = normalizeFactKey(rawKey);
  if (!key) return null;

  // 规则 2 + 3
  const value = needsDateStamp(key, rawValue)
    ? `${rawValue}（${monthDayLabel(observationDate)}记）`
    : rawValue;

  return { key, value };
}
