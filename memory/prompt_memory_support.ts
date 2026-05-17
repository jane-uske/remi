import type { SlowBrainSnapshot } from "../brains/background_analysis_store";
import { getConfig } from "../server/config";

const STOP_WORDS = new Set([
  "我们",
  "你们",
  "他们",
  "这个",
  "那个",
  "现在",
  "最近",
  "刚才",
  "还是",
  "已经",
  "真的",
  "有点",
  "一下",
  "因为",
  "所以",
  "可以",
  "今天",
  "昨天",
  "晚上",
]);

const LIGHT_ACK_PATTERN =
  /^(?:你好呀?|您好|哈喽|hello|hi|嗨|嘿|在吗|在不在|晚安(?:啦|呀)?|早安|早上好|晚上好|睡了|嗯+|嗯嗯+|哦+|噢+|啊+|好+|好的|好哦|好哒|收到|行吧?|明白了?|知道了?|我知道了|ok(?:ay)?|okk+|ok\s+ok(?:\s+我?知道了)?)[!！?？~～。\s]*$/iu;

const EXPLICIT_RECALL_PATTERN =
  /(?:还?记得|记住|忘了|之前(?:聊|说|提)|我们之前|上次|刚才(?:说|聊)|刚刚(?:说|聊)|聊了什么|说过什么|提过什么|谁在照顾|还记得.*吗)/u;

const VOLATILE_MEMORY_KEY_PATTERN =
  /^(?:当前|此刻|目前|现在|刚才|刚刚|今天|今日|昨日|昨天|明日|明天|本次|此次|此前状态|当前状态|当前诉求|当前需求|当前行为|当前行动|当前事务|当前处理事项|当前正在|正在|用户需求|用户诉求|索要内容)/u;

export type SnapshotThreadCandidate = {
  topic: string;
  summary: string;
  bridgeSummary?: string;
  topMood: string;
  relatedTopics?: string[];
  semanticKeywords?: string[];
  salience: number;
  relationshipWeight?: number;
  unresolvedCount: number;
  recurrenceCount: number;
  episodeCount?: number;
  firstTurn?: number;
  timeSpanTurns?: number;
  memoryLayer?: "active" | "core";
  lastTurn: number;
};

export type SnapshotEpisodeCandidate = {
  id: string;
  title: string;
  summary: string;
  layer: "active" | "core";
  status: "active" | "cooling" | "resolved";
  sourceTopics: string[];
  semanticKeywords: string[];
  topMood: string;
  salience: number;
  relationshipWeight: number;
  recurrenceCount: number;
  lastTurn: number;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function episodeLongHorizonRankingEnabled(): boolean {
  return getConfig().REMI_EPISODE_LONG_HORIZON_RANKING_ENABLED;
}

export function episodeStorePromptEnabled(): boolean {
  return getConfig().REMI_EPISODE_STORE_PROMPT_ENABLED;
}

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\u4e00-\u9fff]+/gu, " ")
    .trim();
}

export function extractKeywords(text: string): string[] {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  const raw = normalized.split(/\s+/);
  const seen = new Set<string>();
  const keywords: string[] = [];

  for (const token of raw) {
    const trimmed = token.trim();
    if (trimmed.length < 2 || STOP_WORDS.has(trimmed)) continue;
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      keywords.push(trimmed);
    }
    if (/^[\u4e00-\u9fff]{4,}$/.test(trimmed)) {
      for (let size = 2; size <= 3; size++) {
        for (let i = 0; i + size <= trimmed.length; i++) {
          const slice = trimmed.slice(i, i + size);
          if (STOP_WORDS.has(slice) || seen.has(slice)) continue;
          seen.add(slice);
          keywords.push(slice);
        }
      }
    }
  }

  return keywords;
}

export function isLightAcknowledgementTurn(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 24) return false;
  return LIGHT_ACK_PATTERN.test(trimmed);
}

export function isExplicitMemoryRecallRequest(text: string): boolean {
  return EXPLICIT_RECALL_PATTERN.test(text.trim());
}

export function isVolatileMemoryKey(key: string): boolean {
  return VOLATILE_MEMORY_KEY_PATTERN.test(key.trim());
}

export function hasDirectTextOverlap(entryText: string, userMessage: string): boolean {
  const userText = normalizeText(userMessage);
  const entry = normalizeText(entryText);
  if (!userText || !entry) return false;
  if (entry.includes(userText) || userText.includes(entry)) return true;
  return keywordOverlapScore(entry, extractKeywords(userMessage), 1, 1) > 0;
}

export function sanitizeMemoryEvidenceText(text: string, title?: string): string {
  let value = text.trim();
  const normalizedTitle = title?.trim();
  if (normalizedTitle) {
    value = value.replace(new RegExp(`^${escapeRegExp(normalizedTitle)}[：:]\\s*`, "u"), "");
  }
  value = value.replace(/^[\p{L}\p{N}]{1,16}[：:]\s*(?=(?:上次|用户|最近|昨晚|前天|一周前|那次|这条|从))/u, "");

  value = value
    .replace(/^上次你提到「([^」]+)」，我们在继续聊([^。]+)。?$/u, "用户围绕$2提到「$1」。")
    .replace(/^上次你提到「([^」]+)」，我们顺着那个话题聊了下去。?$/u, "用户提到「$1」。")
    .replace(/^上次聊到的([^，。]+)，后来怎么样了[？?]?$/u, "$1后续")
    .replace(/^上次聊到的([^，。]+)，后来(.+)$/u, "$1这条线后来$2")
    .replace(/^上次你想推进的([^，。]+)，后来(.+)$/u, "$1这件你想推进的事后来$2")
    .replace(/^上次你说想做的那件事，后来(.+)$/u, "你想做的那件事后来$1")
    .replace(/^上次那个([^，。]+)，后来(.+)$/u, "那个$1后来$2")
    .replace(/上次你提到/u, "用户提到")
    .replace(/上次聊到的/u, "")
    .replace(/上次那个/u, "那个")
    .replace(/你之前/u, "用户曾")
    .replace(/之前你/u, "用户曾")
    .replace(/我们在继续聊/u, "相关主题是");

  return value.trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function getSnapshotThreadCandidates(
  slowBrainSnapshot: SlowBrainSnapshot | null | undefined,
): SnapshotThreadCandidate[] {
  if (!slowBrainSnapshot) return [];
  const threads = slowBrainSnapshot.topicThreads ?? [];
  if (threads.length > 0) return threads;

  const groups = new Map<string, NonNullable<SlowBrainSnapshot["sharedMoments"]>[number][]>();
  for (const moment of slowBrainSnapshot.sharedMoments ?? []) {
    const topic = moment.topic?.trim() || "最近主线";
    const list = groups.get(topic) ?? [];
    list.push(moment);
    groups.set(topic, list);
  }

  return [...groups.entries()]
    .map(([topic, moments]) => {
      const sorted = moments
        .slice()
        .sort((a, b) =>
          Number(b.unresolved) - Number(a.unresolved) ||
          (b.salience ?? 0) - (a.salience ?? 0) ||
          (b.recurrenceCount ?? 1) - (a.recurrenceCount ?? 1) ||
          b.turn - a.turn,
        );
      const top = sorted[0];
      const oldest = sorted
        .slice()
        .sort((a, b) => a.turn - b.turn || a.createdAt - b.createdAt)[0];
      const relatedTopics = [...new Set(sorted.map((entry) => entry.topic).filter(Boolean))];
      const topicEntry = slowBrainSnapshot.topicHistory.find((entry) => entry.topic === topic);
      const firstTurn = Math.min(...sorted.map((entry) => entry.turn), topicEntry?.lastTurn ?? Infinity);
      const lastTurn = Math.max(...sorted.map((entry) => entry.turn), topicEntry?.lastTurn ?? 0);
      const recurrenceCount = sorted.reduce((sum, entry) => sum + (entry.recurrenceCount ?? 1), 0);
      const unresolvedCount = sorted.filter((entry) => entry.unresolved).length;
      const averageSalience =
        sorted.reduce((sum, entry) => sum + (entry.salience ?? 0.35), 0) / Math.max(1, sorted.length);
      const salience = clamp01(Math.max(top.salience ?? 0.35, averageSalience));
      const relationshipWeight = clamp01(
        salience * 0.7 +
        Math.min(0.2, unresolvedCount * 0.08) +
        Math.min(0.1, Math.max(0, recurrenceCount - 1) * 0.03),
      );
      return {
        topic,
        summary:
          topic === "最近主线" && slowBrainSnapshot.conversationSummary
            ? slowBrainSnapshot.conversationSummary
            : top.summary,
        bridgeSummary:
          sorted.length > 1
            ? `${oldest.summary} 最近一次是：${top.summary}`
            : top.summary,
        topMood: top.mood,
        relatedTopics: relatedTopics.length > 0 ? relatedTopics : [topic],
        semanticKeywords: [
          ...new Set(
            sorted.flatMap((entry) =>
              [entry.topic, entry.summary, entry.hook, ...(entry.semanticKeywords ?? [])]
                .flatMap((text) => extractKeywords(text ?? ""))
            ),
          ),
        ].slice(0, 12),
        salience,
        relationshipWeight,
        unresolvedCount,
        recurrenceCount,
        episodeCount: sorted.length,
        firstTurn: Number.isFinite(firstTurn) ? firstTurn : top.turn,
        timeSpanTurns: Math.max(0, lastTurn - (Number.isFinite(firstTurn) ? firstTurn : top.turn)),
        memoryLayer:
          sorted.length >= 2 || recurrenceCount >= 3 || relatedTopics.length >= 2
            ? "core"
            : "active",
        lastTurn,
      } satisfies SnapshotThreadCandidate;
    })
    .sort((a, b) =>
      b.unresolvedCount - a.unresolvedCount ||
      (b.relationshipWeight ?? b.salience) - (a.relationshipWeight ?? a.salience) ||
      b.salience - a.salience ||
      b.recurrenceCount - a.recurrenceCount ||
      b.lastTurn - a.lastTurn,
    );
}

export function getSnapshotEpisodeCandidates(
  slowBrainSnapshot: SlowBrainSnapshot | null | undefined,
): SnapshotEpisodeCandidate[] {
  if (!slowBrainSnapshot) return [];
  const episodes = slowBrainSnapshot.episodes ?? [];
  if (episodes.length > 0) return episodes;

  return getSnapshotThreadCandidates(slowBrainSnapshot).map((thread) => ({
    id: `${thread.topic}-${thread.firstTurn ?? thread.lastTurn}`,
    title: thread.topic,
    summary: thread.bridgeSummary || thread.summary,
    layer:
      thread.memoryLayer === "core" ||
      (thread.episodeCount ?? 1) >= 3 ||
      thread.recurrenceCount >= 3 ||
      (thread.relationshipWeight ?? thread.salience) >= 0.82 ||
      ((thread.relatedTopics ?? []).length >= 2) ||
      (thread.timeSpanTurns ?? 0) >= 5
        ? "core"
        : "active",
    status:
      thread.unresolvedCount > 0
        ? "active"
        : thread.lastTurn >= Math.max(0, slowBrainSnapshot.relationship.turnCount - 2)
          ? "cooling"
          : "resolved",
    sourceTopics: [...(thread.relatedTopics ?? [thread.topic])],
    semanticKeywords: [...(thread.semanticKeywords ?? [])],
    topMood: thread.topMood,
    salience: thread.salience,
    relationshipWeight: thread.relationshipWeight ?? thread.salience,
    recurrenceCount: thread.recurrenceCount,
    lastTurn: thread.lastTurn,
  }));
}

export function getLongHorizonThreadCandidates(
  slowBrainSnapshot: SlowBrainSnapshot | null | undefined,
): SnapshotThreadCandidate[] {
  if (!slowBrainSnapshot) return [];
  const hasExplicitThreads = (slowBrainSnapshot.topicThreads?.length ?? 0) > 0;
  return getSnapshotThreadCandidates(slowBrainSnapshot).filter((entry) =>
    hasExplicitThreads
      ? (
          (entry.memoryLayer ?? "active") === "core" ||
          (entry.episodeCount ?? 1) >= 2 ||
          entry.recurrenceCount >= 3 ||
          (entry.timeSpanTurns ?? 0) >= 4 ||
          ((entry.relatedTopics ?? []).length >= 2)
        )
      : (entry.episodeCount ?? 1) >= 2,
  );
}

export function buildRelationshipTexts(slowBrainSnapshot?: SlowBrainSnapshot | null): {
  summaryText: string;
  combinedText: string;
  keywords: string[];
  recentMoodText: string;
  preferredTopics: string[];
} {
  if (!slowBrainSnapshot) {
    return {
      summaryText: "",
      combinedText: "",
      keywords: [],
      recentMoodText: "",
      preferredTopics: [],
    };
  }

  const threadCandidates = getLongHorizonThreadCandidates(slowBrainSnapshot);
  const episodeCandidates = getSnapshotEpisodeCandidates(slowBrainSnapshot);

  const recentMoodText = slowBrainSnapshot.moodTrajectory
    .slice(-4)
    .map((entry) => entry.mood)
    .join(" ");

  const parts = [
    slowBrainSnapshot.conversationSummary,
    ...slowBrainSnapshot.relationship.preferredTopics,
    ...slowBrainSnapshot.proactiveTopics,
    ...threadCandidates
      .slice(0, 4)
      .map((entry) =>
        `${entry.topic} ${entry.summary} ${entry.bridgeSummary ?? ""} ${(entry.relatedTopics ?? []).join(" ")} ${(entry.semanticKeywords ?? []).join(" ")} ${entry.topMood}`.trim()
      ),
    ...episodeCandidates
      .slice(0, 4)
      .map((entry) =>
        `${entry.title} ${entry.summary} ${entry.sourceTopics.join(" ")} ${entry.semanticKeywords.join(" ")} ${entry.topMood}`.trim()
      ),
    ...slowBrainSnapshot.sharedMoments
      .slice(0, 3)
      .map((entry) =>
        `${entry.topic} ${entry.summary} ${entry.hook} ${(entry.semanticKeywords ?? []).join(" ")}`.trim()
      ),
    ...slowBrainSnapshot.topicHistory
      .slice()
      .sort((a, b) => b.lastTurn - a.lastTurn || b.depth - a.depth)
      .slice(0, 4)
      .map((entry) => entry.topic),
    ...slowBrainSnapshot.moodTrajectory.slice(-4).map((entry) => entry.mood),
  ].filter(Boolean);

  const combinedText = parts.join(" ");
  return {
    summaryText: slowBrainSnapshot.conversationSummary,
    combinedText,
    keywords: extractKeywords(combinedText),
    recentMoodText,
    preferredTopics: [...slowBrainSnapshot.relationship.preferredTopics],
  };
}

export function keywordOverlapScore(
  haystack: string,
  keywords: string[],
  weight: number,
  maxScore: number,
): number {
  let score = 0;
  for (const keyword of keywords) {
    if (!keyword || keyword.length < 2) continue;
    if (haystack.includes(keyword)) {
      score += weight;
      if (score >= maxScore) return maxScore;
    }
  }
  return score;
}
