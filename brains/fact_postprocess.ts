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
//
// ── 规则 5（"阿兵案"根治，2026-07-04）──
// 生产实锤：用户说"复述一下阿兵这个小说"（NSFW 小说复述场景），慢脑把**小说
// 主角名**提炼成了用户画像「姓名=阿兵」，此后 Remi 一直误认用户叫阿兵。
// 毒种命名"虚构穿越"：角色扮演/小说复述/讲故事等虚构叙事场景里的人名/职业/
// 关系等，被当成用户真实事实入库。
//
// ANALYSIS_PROMPT 已有一条规则（"只提取用户明确提到的事实…不要猜测"），但这
// 和规则 4 的低置信过滤一样，是"教 LLM 别这样做"、服从率不稳定——虚构叙事里
// 的人名对 LLM 而言看起来就是一句完整的第一人称陈述句（"陈默是一名外科医
// 生"和"我是一名外科医生"在句法上没有区别，LLM 分不出场景），单靠 prompt 无
// 法根治，需要纯代码兜底。
//
// 门槛设计：身份类高危键（姓名/住所/职业/家人等，见 HIGH_RISK_IDENTITY_KEYS）
// 要入库，本轮用户消息必须（a）含第一人称直陈模式（FIRST_PERSON_DIRECT_RE，
// 如"我叫/我是/我住/叫我X"）且（b）不处于虚构叙事请求语境（本轮用户消息命中
// FICTION_CONTEXT_RE，如"复述/写故事/小说/角色扮演"）。任一条件不满足即拒绝
// 整条 fact 入库（两条消费路径都跳过，与规则 1-4 的"救不回来就丢弃"一致）。
// 非身份类键完全不受本规则影响。
//
// 证据来源：ExtractedFactInput 目前没有独立的 evidence/引语字段（LLM 只给
// key/value/confidence/source），新增字段意味着要连 ANALYSIS_PROMPT 的 JSON
// schema 一起改、再赌 LLM 遵守——这正是本文件想避免的"prompt 祈祷"模式。改用
// 现有结构里最接近的等价物：该轮用户消息原文（调用方 background_analysis.ts
// 在 llmAnalysis() 里本来就持有 userMessage，是本轮对话的忠实记录，不依赖
// LLM 如实转述）。

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

/**
 * 身份类高危键清单（用户画像身份信息）。命中即触发规则 5 的第一人称直陈门槛。
 * 可配置：按现有 KV key 命名风格整理（裸中文名词，2-6 字，无下划线/命名空间
 * 前缀），覆盖任务点名的姓名/称呼/住所/籍贯/年龄/性别/职业/家人/伴侣类目，
 * 并入实际提炼中会出现的近义 key（如"居住地"是 normalizeFactKey 已知会从
 * "居住地/活动区域"这类原始 key 归一化出的真实产物）。
 *
 * 匹配方式是"归一化 key 包含清单中任一词"（见 isHighRiskIdentityKey），不是
 * 精确相等——2026-07-04 实测发现 LLM 会产出"配偶姓名"这类复合 key（既不等于
 * "配偶"也不等于"姓名"，但显然还是在问配偶的姓名），若用精确匹配的 Set.has()
 * 会被这类复合词绕过（"阿兵案"同款漏网：只是漏点从"person 长得像句子"换成了
 * "key 长得像新词"）。改用包含匹配后，清单本身仍是这份"裸词根"列表，不需要
 * 穷举所有复合组合——LLM 造多少种复合 key，只要词根还在，都会被捕获。
 */
export const HIGH_RISK_IDENTITY_KEYS = new Set([
  // 姓名/称呼
  "姓名", "名字", "称呼", "昵称", "别名",
  // 住所/籍贯
  "住所", "居住地", "所在地", "常住地", "籍贯", "老家", "户籍",
  // 年龄/性别
  "年龄", "性别",
  // 职业
  "职业", "工作单位", "公司", "职位",
  // 家人/伴侣
  "家人", "父母", "爸爸", "妈妈", "孩子", "子女", "兄弟姐妹",
  "伴侣", "配偶", "老公", "老婆", "丈夫", "妻子", "男朋友", "女朋友",
]);

// 包含匹配只在 key 足够短时生效（见 isHighRiskIdentityKey 的说明）：真实
// 坏例复现时发现，超长 key（如"个人职业发展方向与行业细分领域偏好"，规则 1
// 硬截断到 12 字后是"个人职业发展方向与行业细"）会因为恰好包含"职业"两个
// 字被误判成高危键——但这条 fact 说的是职业发展方向的偏好，不是"用户的
// 职业是什么"，两者语义完全不同。裸身份键本身很短（HIGH_RISK_IDENTITY_KEYS
// 里最长的"工作单位"是 4 字，多数是 2 字），真实的复合身份键（"配偶姓名"）
// 也不会超过 6 字；超过这个长度还包含词根的，几乎都是"词根恰好被更长的
// 描述性短语裹住"的假阳性，而不是真的在问身份信息。
const MAX_HIGH_RISK_KEY_LEN_FOR_SUBSTRING_MATCH = 6;

/**
 * 判定一个（已归一化的）key 是否命中身份类高危清单。
 * - key 长度 ≤ 6 字：用包含匹配（key 含清单中任一词根即算命中，覆盖"配偶
 *   姓名"这类复合 key）。
 * - key 长度 > 6 字：退回精确匹配（key 必须与清单某一项完全相等）——避免
 *   "个人职业发展方向与行业细"这类长描述性短语因为夹带"职业"两个字被误伤
 *   （细节见上方 MAX_HIGH_RISK_KEY_LEN_FOR_SUBSTRING_MATCH 注释）。
 */
function isHighRiskIdentityKey(normalizedKey: string): boolean {
  if (normalizedKey.length <= MAX_HIGH_RISK_KEY_LEN_FOR_SUBSTRING_MATCH) {
    for (const riskWord of HIGH_RISK_IDENTITY_KEYS) {
      if (normalizedKey.includes(riskWord)) return true;
    }
    return false;
  }
  return HIGH_RISK_IDENTITY_KEYS.has(normalizedKey);
}

// 第一人称直陈模式：用户以自己身份直接陈述（"我叫/我是/我住/我今年/我家/叫我
// X"），而不是转述他人（"他叫"）、疑问求证（"我是不是"）或陈述与自己无关的
// 第三方信息。
//
// "我是" 单独出现会有大量假阳性（"我是不是该辞职"这类自我怀疑问句在本仓库
// 语料里高频出现，见 test/brain/turn_interpreter.test.ts 等），因此排除
// "我是不是"/"我是否" 这类疑问变体；"我是"后面还要求跟一段非疑问语气词，
// 用简单的"排除紧跟着的'不是/否'"实现，不做复杂分词。
//
// "我+关系称呼+叫/是+X"（如"我妻子叫小红""我老公是程序员""我儿子今年5岁"）
// 单独列一支：这是家人/伴侣类高危键最自然的第一人称直陈句式——用户在陈述
// 自己家人的事实时，主语仍是"我"，但紧跟的谓语动词前有一个关系称呼名词，
// 不会被"我叫/我是"这两支直接捕获到。词表覆盖 HIGH_RISK_IDENTITY_KEYS 里
// 家人/伴侣类目的口语称呼（不是自己延伸新概念，只是把已经在高危键清单里
// 的名词也接进第一人称直陈的谓语位置）。
const RELATION_TERMS_RE =
  "(?:妻子|老婆|丈夫|老公|伴侣|配偶|父母|爸爸|妈妈|孩子|儿子|女儿|兄弟|姐妹)";
const FIRST_PERSON_DIRECT_RE = new RegExp(
  `我(?:就)?叫(?!$)|我(?:今年)?是(?!不是|否)[^？?]*|我住(?:在)?[^？?]+|我今年[^？?]+|我家[^？?]+|叫我[^？?]+|我${RELATION_TERMS_RE}(?:叫|是)[^？?]+`,
  "u",
);

// 虚构叙事请求语境：用户要求复述/创作/翻译小说、讲故事、角色扮演等。命中即
// 表示本轮对话是虚构叙事场景，其中出现的人名/职业/关系等一律视为剧情内容，
// 不是用户本人事实。
const FICTION_CONTEXT_RE =
  /复述|(?:写|编|讲|说)(?:一)?个?故事|小说|扮演|角色扮演|cosplay|设定(?:一下)?人设|你扮\S{0,4}|我扮\S{0,4}/iu;

/**
 * 规则 5：身份类高危键的第一人称直陈门槛。
 * 返回 true = 通过（允许入库，不受本规则拦截）；false = 拒绝（本轮不得写入）。
 *
 * 非高危键（key 不包含 HIGH_RISK_IDENTITY_KEYS 任一词根）永远返回 true——
 * 本规则完全不影响姓名/住所/职业等以外的普通 fact。
 */
export function passesIdentityEvidenceGate(
  normalizedKey: string,
  userMessage: string,
): boolean {
  if (!isHighRiskIdentityKey(normalizedKey)) return true;
  const trimmed = (userMessage ?? "").trim();
  if (!trimmed) return false;
  if (FICTION_CONTEXT_RE.test(trimmed)) return false;
  return FIRST_PERSON_DIRECT_RE.test(trimmed);
}

/**
 * 规则 5 拒绝时的可观测原因（供调用方记 INFO 日志）。返回 null 表示本条 fact
 * 未被规则 5 拦截（非高危键，或已通过门槛）——调用方应只在非 null 时记日志，
 * 避免为每条正常 fact 都打一条噪声日志。
 */
export function identityGateRejectionReason(
  normalizedKey: string,
  userMessage: string,
): string | null {
  if (!isHighRiskIdentityKey(normalizedKey)) return null;
  const trimmed = (userMessage ?? "").trim();
  if (!trimmed) return null; // 空消息在 passesIdentityEvidenceGate 里已判 false，但没有"原文"可归因，交由上层用别的路径处理
  if (FICTION_CONTEXT_RE.test(trimmed)) {
    return "本轮用户消息处于虚构叙事语境（复述/故事/小说/角色扮演），身份类高危键拒绝入库";
  }
  if (!FIRST_PERSON_DIRECT_RE.test(trimmed)) {
    return "身份类高危键缺少第一人称直陈证据（用户消息原文未见'我叫/我是/我住'等直陈模式）";
  }
  return null;
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
 *
 * 导出给调用方（background_analysis.ts）在规则 5 拒绝时重算同一个归一化
 * key，用于 identityGateRejectionReason() 的日志归因——保证日志里报告的
 * "拒绝原因"和 normalizeExtractedFact() 内部实际做出的拒绝决策用的是同一个
 * key，不会因为两处各自处理 key 而口径不一致。
 */
export function normalizeFactKey(rawKey: string): string {
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
 * @param userMessage 本轮用户消息原文，供规则 5（身份类高危键第一人称直陈
 *   门槛）用作证据来源。缺省为空串——空消息永远无法提供第一人称直陈证据，
 *   高危键会被规则 5 拒绝，非高危键不受影响（与显式传入空串行为一致，调用方
 *   不传时不会意外放行）。
 */
export function normalizeExtractedFact(
  fact: ExtractedFactInput,
  observationDate: string,
  userMessage = "",
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

  // 规则 5：身份类高危键第一人称直陈门槛（对归一化后的 key 判定——原始 key
  // 如"居住地/活动区域"归一化后就是"居住地"，命中清单；判定放在规则 1 之后
  // 保证清单里的裸 key 名和归一化产物口径一致）。非高危键直接放行。
  if (!passesIdentityEvidenceGate(key, userMessage)) {
    return null;
  }

  // 规则 2 + 3
  const value = needsDateStamp(key, rawValue)
    ? `${rawValue}（${monthDayLabel(observationDate)}记）`
    : rawValue;

  return { key, value };
}
