import type { MomentInput } from "./episode_store";
import type { DbEpisode } from "../storage/repositories/episode_repository";

export type EpisodeV3Domain =
  | "money"
  | "work"
  | "pet"
  | "relationship_with_remi"
  | "other";

export type EpisodeV3PressureSource =
  | "financial"
  | "workload"
  | "caretaking"
  | "relational"
  | "mixed"
  | "unknown";

export type EpisodeV3RelationalImpact = "none" | "low" | "medium" | "high";

export type EpisodeV3UserStance =
  | "neutral"
  | "concerned"
  | "committed"
  | "avoidant"
  | "seeking_support"
  | "protective";

export type EpisodeV3Status = "active" | "cooling" | "resolved" | "archived";

export type EpisodeV3Layer = "warm";

export interface EpisodeV3View {
  id: string;
  domain: EpisodeV3Domain;
  pressureSource: EpisodeV3PressureSource;
  relationalImpact: EpisodeV3RelationalImpact;
  userStance: EpisodeV3UserStance;
  unresolvedLevel: 0 | 1 | 2 | 3;
  eventSummary: string;
  evidenceTurns: string[];
  lastUserPosition: string;
  status: EpisodeV3Status;
  layer: EpisodeV3Layer;
}

export interface EpisodeV3StorageFields {
  v3Domain: EpisodeV3Domain;
  v3PressureSource: EpisodeV3PressureSource;
  v3RelationalImpact: EpisodeV3RelationalImpact;
  v3UserStance: EpisodeV3UserStance;
  v3UnresolvedLevel: 0 | 1 | 2 | 3;
  v3EventSummary: string;
  v3EvidenceTurns: string[];
  v3LastUserPosition: string;
}

type EpisodeV3Source = Pick<
  DbEpisode,
  | "id"
  | "title"
  | "summary"
  | "topics"
  | "status"
  | "unresolved"
  | "recurrence_count"
> & Partial<Pick<DbEpisode, "mood" | "kind" | "origin_moment_summaries" | "salience">>;

type PersistedEpisodeV3Source = Partial<
  Pick<
    DbEpisode,
    | "v3_domain"
    | "v3_pressure_source"
    | "v3_relational_impact"
    | "v3_user_stance"
    | "v3_unresolved_level"
    | "v3_event_summary"
    | "v3_evidence_turns"
    | "v3_last_user_position"
  >
>;

const DOMAIN_PRIORITY: EpisodeV3Domain[] = [
  "relationship_with_remi",
  "money",
  "work",
  "pet",
  "other",
];

const DOMAIN_KEYWORDS: Record<Exclude<EpisodeV3Domain, "other">, string[]> = {
  money: [
    "money",
    "budget",
    "bill",
    "rent",
    "salary",
    "paycheck",
    "debt",
    "loan",
    "expense",
    "cash",
    "savings",
    "repayment",
    "compensation",
    "房租",
    "账单",
    "工资",
    "薪水",
    "钱",
    "费用",
    "信用卡",
    "花销",
    "预算",
    "花呗",
    "欠",
    "债",
    "还款",
    "赔偿",
    "积蓄",
    "存款",
    "现金",
  ],
  work: [
    "work",
    "job",
    "project",
    "office",
    "boss",
    "team",
    "meeting",
    "deadline",
    "career",
    "工作",
    "上班",
    "老板",
    "项目",
    "会议",
    "开会",
    "加班",
    "绩效",
    "同事",
    "面试",
  ],
  pet: [
    "pet",
    "cat",
    "dog",
    "kitten",
    "puppy",
    "pet care",
    "cat care",
    "dog care",
    "宠物",
    "猫",
    "狗",
    "小猫",
    "小狗",
    "喂",
    "看医生",
    "照顾",
  ],
  relationship_with_remi: [
    "remi",
    "想和你",
    "只想你",
    "陪我",
    "陪伴",
    "想你",
    "找你",
    "抱抱",
    "别走",
    "在吗",
    "陪我说",
    "你陪我",
    "和你待",
    "和你多待",
    "我想你",
    "安慰",
    "没懂",
    "你懂",
    "接住",
    "理解我",
    "不想回答你",
    "不想再回答",
    "不会安慰",
    "没接住",
  ],
};

const CONCERN_TERMS = [
  "担心",
  "压力",
  "焦虑",
  "害怕",
  "怕",
  "愁",
  "不太",
  "怎么办",
  "要不要",
  "糟",
  "麻烦",
];

const COMMITMENT_TERMS = [
  "得",
  "要",
  "准备",
  "处理",
  "解决",
  "安排",
  "补",
  "先",
  "会去",
  "打算",
];

const AVOIDANCE_TERMS = [
  "先不",
  "算了",
  "不想",
  "懒得",
  "放着",
  "以后再说",
];

const SUPPORT_TERMS = [
  "陪我",
  "想和你",
  "想你",
  "找你",
  "聊聊",
  "陪伴",
  "抱抱",
  "只想你",
  "和你多待",
  "和你说会儿话",
  "站我这边",
  "没接住",
  "不会安慰",
  "别再让我重复讲",
];

const PROTECTIVE_TERMS = [
  "照顾",
  "看医生",
  "带去",
  "喂",
  "保护",
  "安抚",
];

function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function collectText(episode: Pick<EpisodeV3Source, "title" | "summary" | "topics" | "mood" | "kind" | "origin_moment_summaries">): string {
  return [
    episode.title,
    episode.summary,
    episode.mood,
    episode.kind,
    ...(episode.topics ?? []),
    ...(episode.origin_moment_summaries ?? []),
  ]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .map((part) => normalizeText(part))
    .filter(Boolean)
    .join(" ");
}

function countMatches(text: string, terms: string[]): number {
  let score = 0;
  for (const term of terms) {
    const normalizedTerm = normalizeText(term);
    if (!normalizedTerm) continue;
    if (text.includes(normalizedTerm)) {
      score += normalizedTerm.length >= 4 ? 2 : 1;
    }
  }
  return score;
}

function pickBestDomain(text: string): EpisodeV3Domain {
  const scoredDomains = DOMAIN_PRIORITY.map((domain) => {
    if (domain === "other") {
      return { domain, score: 0 };
    }
    return { domain, score: countMatches(text, DOMAIN_KEYWORDS[domain]) };
  });

  let best = scoredDomains[scoredDomains.length - 1];
  for (const candidate of scoredDomains) {
    if (candidate.score > best.score) {
      best = candidate;
    }
  }

  return best.score > 0 ? best.domain : "other";
}

function mapPressureSource(domain: EpisodeV3Domain, text: string): EpisodeV3PressureSource {
  if (domain === "money") return "financial";
  if (domain === "work") return "workload";
  if (domain === "pet") return "caretaking";
  if (domain === "relationship_with_remi") return "relational";

  const financial = countMatches(text, DOMAIN_KEYWORDS.money);
  const workload = countMatches(text, DOMAIN_KEYWORDS.work);
  const caretaking = countMatches(text, DOMAIN_KEYWORDS.pet);
  const relational = countMatches(text, DOMAIN_KEYWORDS.relationship_with_remi);
  const scores: Array<[EpisodeV3PressureSource, number]> = [
    ["financial", financial],
    ["workload", workload],
    ["caretaking", caretaking],
    ["relational", relational],
  ];
  const best = scores.reduce((left, right) => (right[1] > left[1] ? right : left), ["unknown", 0] as const);
  return best[1] > 0 ? best[0] : "unknown";
}

function mapRelationalImpact(domain: EpisodeV3Domain): EpisodeV3RelationalImpact {
  if (domain === "relationship_with_remi") return "high";
  if (domain === "money" || domain === "work") return "medium";
  if (domain === "pet") return "low";
  return "low";
}

function mapUserStance(text: string, domain: EpisodeV3Domain): EpisodeV3UserStance {
  const supportScore = countMatches(text, SUPPORT_TERMS);
  const concernScore = countMatches(text, CONCERN_TERMS);
  const commitmentScore = countMatches(text, COMMITMENT_TERMS);
  const avoidanceScore = countMatches(text, AVOIDANCE_TERMS);
  const protectiveScore = domain === "pet" ? countMatches(text, PROTECTIVE_TERMS) + 1 : countMatches(text, PROTECTIVE_TERMS);

  if (supportScore > 0 && domain === "relationship_with_remi") {
    return "seeking_support";
  }

  if (avoidanceScore > 0 && avoidanceScore >= concernScore && avoidanceScore >= commitmentScore) {
    return "avoidant";
  }

  if (domain === "work" && commitmentScore > 0) {
    return "committed";
  }

  if (domain === "money" || domain === "pet") {
    if (concernScore > 0) return "concerned";
    if (protectiveScore > 0) return "protective";
    if (commitmentScore > 0) return "committed";
  }

  if (supportScore > 0) {
    return "seeking_support";
  }

  if (concernScore >= commitmentScore && concernScore > 0) {
    return "concerned";
  }

  if (protectiveScore > 0) {
    return "protective";
  }

  if (commitmentScore > 0) {
    return "committed";
  }

  return "neutral";
}

function normalizeStatus(status: string | null | undefined): EpisodeV3Status {
  if (status === "active" || status === "cooling" || status === "resolved" || status === "archived") {
    return status;
  }
  return "cooling";
}

function normalizeDomain(domain: string | null | undefined): EpisodeV3Domain | null {
  return domain === "money" ||
    domain === "work" ||
    domain === "pet" ||
    domain === "relationship_with_remi" ||
    domain === "other"
    ? domain
    : null;
}

function normalizePressureSource(
  value: string | null | undefined,
): EpisodeV3PressureSource | null {
  return value === "financial" ||
    value === "workload" ||
    value === "caretaking" ||
    value === "relational" ||
    value === "mixed" ||
    value === "unknown"
    ? value
    : null;
}

function normalizeRelationalImpact(
  value: string | null | undefined,
): EpisodeV3RelationalImpact | null {
  return value === "none" || value === "low" || value === "medium" || value === "high"
    ? value
    : null;
}

function normalizeUserStance(value: string | null | undefined): EpisodeV3UserStance | null {
  return value === "neutral" ||
    value === "concerned" ||
    value === "committed" ||
    value === "avoidant" ||
    value === "seeking_support" ||
    value === "protective"
    ? value
    : null;
}

function computeUnresolvedLevel(episode: EpisodeV3Source, text: string): 0 | 1 | 2 | 3 {
  let level = 0;

  if (episode.unresolved) level += 1;
  if (normalizeStatus(episode.status) !== "resolved" && normalizeStatus(episode.status) !== "archived") {
    level += 1;
  }
  if ((episode.salience ?? 0) >= 0.6) level += 1;
  if ((episode.recurrence_count ?? 0) >= 3) level += 1;
  if (/(还没|不确定|待定|maybe|暂时|纠结|没想好)/i.test(text)) level += 1;

  return Math.min(3, level) as 0 | 1 | 2 | 3;
}

function compactText(value: string, maxLength = 140): string {
  const normalized = normalizeText(value);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function buildEvidenceTurns(episode: EpisodeV3Source): string[] {
  const turns = (episode.origin_moment_summaries ?? [])
    .map((turn) => compactText(turn, 120))
    .filter(Boolean);

  if (turns.length > 0) {
    return turns;
  }

  return [compactText(`${episode.title} ${episode.summary}`)];
}

function buildEventSummary(episode: EpisodeV3Source, evidenceTurns: string[]): string {
  const summary = compactText(episode.summary, 100);
  if (summary) {
    return summary;
  }

  if (evidenceTurns.length > 0) {
    return evidenceTurns.slice(-2).join("；");
  }

  return compactText(`${episode.title} ${(episode.topics ?? []).join(" ")}`.trim(), 120);
}

function deriveEpisodeV3View(episode: EpisodeV3Source): EpisodeV3View {
  const text = collectText(episode);
  const domain = pickBestDomain(text);
  const evidenceTurns = buildEvidenceTurns(episode);

  return {
    id: episode.id,
    domain,
    pressureSource: mapPressureSource(domain, text),
    relationalImpact: mapRelationalImpact(domain),
    userStance: mapUserStance(text, domain),
    unresolvedLevel: computeUnresolvedLevel(episode, text),
    eventSummary: buildEventSummary(episode, evidenceTurns),
    evidenceTurns,
    lastUserPosition: evidenceTurns[evidenceTurns.length - 1] ?? compactText(episode.summary),
    status: normalizeStatus(episode.status),
    layer: "warm",
  };
}

function readPersistedEpisodeV3View(
  episode: EpisodeV3Source & PersistedEpisodeV3Source,
): EpisodeV3View | null {
  const domain = normalizeDomain(episode.v3_domain);
  const pressureSource = normalizePressureSource(episode.v3_pressure_source);
  const relationalImpact = normalizeRelationalImpact(episode.v3_relational_impact);
  const userStance = normalizeUserStance(episode.v3_user_stance);
  const unresolvedLevel = episode.v3_unresolved_level;
  const eventSummary = compactText(episode.v3_event_summary ?? "", 140);
  const evidenceTurns = Array.isArray(episode.v3_evidence_turns)
    ? episode.v3_evidence_turns.map((turn) => compactText(turn, 120)).filter(Boolean)
    : [];
  const lastUserPosition = compactText(episode.v3_last_user_position ?? "", 120);

  if (
    !domain ||
    !pressureSource ||
    !relationalImpact ||
    !userStance ||
    typeof unresolvedLevel !== "number" ||
    unresolvedLevel < 0 ||
    unresolvedLevel > 3 ||
    !eventSummary ||
    evidenceTurns.length === 0 ||
    !lastUserPosition
  ) {
    return null;
  }

  return {
    id: episode.id,
    domain,
    pressureSource,
    relationalImpact,
    userStance,
    unresolvedLevel: unresolvedLevel as 0 | 1 | 2 | 3,
    eventSummary,
    evidenceTurns,
    lastUserPosition,
    status: normalizeStatus(episode.status),
    layer: "warm",
  };
}

export function toEpisodeV3StorageFields(episode: EpisodeV3Source): EpisodeV3StorageFields {
  const view = deriveEpisodeV3View(episode);
  return {
    v3Domain: view.domain,
    v3PressureSource: view.pressureSource,
    v3RelationalImpact: view.relationalImpact,
    v3UserStance: view.userStance,
    v3UnresolvedLevel: view.unresolvedLevel,
    v3EventSummary: view.eventSummary,
    v3EvidenceTurns: [...view.evidenceTurns],
    v3LastUserPosition: view.lastUserPosition,
  };
}

export function toEpisodeV3View(
  episode: EpisodeV3Source & PersistedEpisodeV3Source,
): EpisodeV3View {
  return readPersistedEpisodeV3View(episode) ?? deriveEpisodeV3View(episode);
}

export function summarizeEpisodeV3View(view: EpisodeV3View): string {
  return [
    `[${view.layer}]`,
    `id=${view.id}`,
    `domain=${view.domain}`,
    `pressure=${view.pressureSource}`,
    `impact=${view.relationalImpact}`,
    `stance=${view.userStance}`,
    `unresolved=${view.unresolvedLevel}`,
    `status=${view.status}`,
    `event=${view.eventSummary}`,
    `last=${view.lastUserPosition}`,
  ].join(" | ");
}

export function momentToEpisodeV3View(
  moment: Pick<
    MomentInput,
    "summary" | "topic" | "mood" | "kind" | "salience" | "unresolved" | "statusHint"
  >,
  id = `moment:${Buffer.from(`${moment.topic}:${moment.summary}`).toString("base64url").slice(0, 16)}`,
): EpisodeV3View {
  return toEpisodeV3View({
    id,
    title: (moment.topic || moment.summary).slice(0, 30),
    summary: moment.summary,
    topics: moment.topic ? [moment.topic] : [],
    mood: moment.mood,
    kind: moment.kind,
    salience: moment.salience,
    unresolved: moment.unresolved,
    status: moment.statusHint ?? (moment.unresolved ? "active" : "cooling"),
    recurrence_count: 1,
    origin_moment_summaries: [moment.summary],
  });
}
