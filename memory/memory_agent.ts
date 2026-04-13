import type { MemoryRepository } from "./memory_repository";
import type { Memory } from "./memory_store";
import { findRelevant as findRelevantEpisodes } from "./episode_store";
import { createLogger } from "../infra/logger";
import { isSystemMemoryKey } from "./relationship_state";
import type { SlowBrainSnapshot } from "../brains/slow_brain_store";

const logger = createLogger("memory_agent");

export type { Memory };

export interface RetrievePromptMemoryOptions {
  userId?: string;
  userMessage: string;
  slowBrainSnapshot?: SlowBrainSnapshot | null;
  maxEntries?: number;
}

interface MemoryPattern {
  pattern: RegExp;
  key: string;
  isNegative?: boolean;
}

const PATTERNS: MemoryPattern[] = [
  { pattern: /我(?:叫|的名字是)\s*([^\s，。！？,.!?]+)/, key: "名字" },
  { pattern: /我住在\s*([^\s，。！？,.!?]+)/, key: "城市" },
  { pattern: /我在\s*([^\s，。！？,.!?]+)\s*住/, key: "城市" },
  { pattern: /我(?:今年|)\s*(\d+)\s*岁/, key: "年龄" },
  { pattern: /我的工作是\s*([^\s，。！？,.!?]+)/, key: "工作" },
  { pattern: /我是(?:做|干)\s*(.+?)(?:的|[，。！？,.!?]|$)/, key: "工作" },
  { pattern: /我喜欢\s*(.+?)(?:[，。！？,.!?]|$)/, key: "喜好" },
  { pattern: /我不喜欢\s*(.+?)(?:[，。！？,.!?]|$)/, key: "不喜好", isNegative: true },
  { pattern: /我讨厌\s*(.+?)(?:[，。！？,.!?]|$)/, key: "不喜好", isNegative: true },
  { pattern: /我(?:有|养了?)(?:一?只|一?条)?\s*([^\s，。！？,.!?猫狗鸟鱼]+[猫狗鸟鱼]?)/, key: "宠物" },
  { pattern: /我的?(?:猫|狗|宠物)叫?\s*([^\s，。！？,.!?]+)/, key: "宠物名字" },
  { pattern: /我每天\s*([^\s，。！？,.!?]+)/, key: "日常习惯" },
  { pattern: /我(?:家人|家里|爸爸|妈妈|老爸|老妈|哥|姐|弟|妹)/, key: "家庭" },
  { pattern: /我来自\s*([^\s，。！？,.!?]+)/, key: "故乡" },
  { pattern: /我的老家在\s*([^\s，。！？,.!?]+)/, key: "故乡" },
  { pattern: /我(?:的?专业|学的?是)\s*([^\s，。！？,.!?]+)/, key: "专业" },
  { pattern: /我在\s*([^\s，。！？,.!?]+)\s*(?:上学|读书|念书)/, key: "学校" },
];

const NEGATION_WORDS = ["不", "没有", "别", "不是", "没"];
const CORE_FACT_KEYS = new Set([
  "名字",
  "城市",
  "工作",
  "学校",
  "宠物",
  "喜好",
]);
const CORE_FACT_LIMIT = 2;
const MAX_PROMPT_EPISODES = 1;
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

function hasNegationBeforeMatch(msg: string, matchIndex: number): boolean {
  const beforeMatch = msg.slice(0, matchIndex);
  return NEGATION_WORDS.some((neg) => beforeMatch.includes(neg));
}

export function extractMemory(userMessage: string, repo: MemoryRepository): void {
  for (const { pattern, key, isNegative } of PATTERNS) {
    const match = userMessage.match(pattern);
    if (match?.[0] && match?.[1]) {
      if (!isNegative && hasNegationBeforeMatch(userMessage, match.index || 0)) {
        continue;
      }
      const value = match[1].trim();
      if (value) {
        void repo.upsert(key, value);
        logger.info("记住了", { key, value });
      }
    }
  }
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function parseBooleanFlag(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === "") return fallback;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "1" || normalized === "true") return true;
  if (normalized === "0" || normalized === "false") return false;
  return fallback;
}

function episodeLongHorizonRankingEnabled(): boolean {
  return parseBooleanFlag(process.env.REMI_EPISODE_LONG_HORIZON_RANKING_ENABLED, true);
}

function episodeStorePromptEnabled(): boolean {
  return parseBooleanFlag(process.env.REMI_EPISODE_STORE_PROMPT_ENABLED, true);
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\u4e00-\u9fff]+/gu, " ")
    .trim();
}

function extractKeywords(text: string): string[] {
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

function buildRelationshipTexts(slowBrainSnapshot?: SlowBrainSnapshot | null): {
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

  const recentMoodText = slowBrainSnapshot.moodTrajectory
    .slice(-4)
    .map((entry) => entry.mood)
    .join(" ");

  const parts = [
    slowBrainSnapshot.conversationSummary,
    ...slowBrainSnapshot.relationship.preferredTopics,
    ...slowBrainSnapshot.proactiveTopics,
    ...(slowBrainSnapshot.topicThreads ?? [])
      .slice(0, 4)
      .map((entry) =>
        `${entry.topic} ${entry.summary} ${entry.bridgeSummary ?? ""} ${(entry.relatedTopics ?? []).join(" ")} ${(entry.semanticKeywords ?? []).join(" ")} ${entry.topMood}`.trim()
      ),
    ...(slowBrainSnapshot.episodes ?? [])
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

function keywordOverlapScore(
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

function buildTopicThreadPromptMemory(
  slowBrainSnapshot: SlowBrainSnapshot | null | undefined,
  userMessage: string,
  maxEntries: number,
): Memory[] {
  if (!slowBrainSnapshot || maxEntries <= 0) return [];
  const threads = slowBrainSnapshot.topicThreads ?? [];
  if (threads.length === 0) return [];

  const userText = normalizeText(userMessage);
  const userKeywords = extractKeywords(userMessage);
  const ranked = threads
    .map((entry) => {
      const combined = normalizeText(
        `${entry.topic} ${entry.bridgeSummary || entry.summary} ${(entry.relatedTopics ?? []).join(" ")} ${(entry.semanticKeywords ?? []).join(" ")} ${entry.topMood}`,
      );
      const timeSpanTurns = Math.max(0, entry.timeSpanTurns ?? 0);
      const layerBoost = entry.memoryLayer === "core" ? 5 : 1;
      return {
        entry,
        score:
          keywordOverlapScore(combined, userKeywords, 4, 16) +
          (userText && combined.includes(userText) ? 10 : 0) +
          Math.round(entry.salience * 6) +
          Math.round((entry.relationshipWeight ?? entry.salience) * 6) +
          Math.min(4, entry.unresolvedCount * 2) +
          Math.min(4, entry.recurrenceCount) +
          Math.min(3, Math.max(0, (entry.episodeCount ?? 1) - 1)) +
          Math.min(4, Math.floor(timeSpanTurns / 3)) +
          layerBoost,
      };
    })
    .sort((a, b) => b.score - a.score || b.entry.lastTurn - a.entry.lastTurn);

  const selected: Memory[] = [];
  const topCore = ranked.find((item) =>
    (
      item.entry.memoryLayer === "core" ||
      (item.entry.episodeCount ?? 1) >= 3 ||
      item.entry.recurrenceCount >= 3 ||
      (item.entry.relationshipWeight ?? item.entry.salience) >= 0.82
    ) &&
    (item.score >= 5 || userMessage.trim().length <= 12)
  );
  if (topCore) {
    selected.push({
      key: "长期关系主线",
      value: `${topCore.entry.topic}：${topCore.entry.bridgeSummary || topCore.entry.summary}`,
    });
  }

  if (selected.length < maxEntries) {
    const topActive = ranked.find((item) =>
      item.entry.unresolvedCount > 0 &&
      item.entry.topic !== topCore?.entry.topic &&
      item.score >= 8
    );
    if (topActive) {
      selected.push({
        key: "当前未完主线",
        value: `${topActive.entry.topic}：${topActive.entry.bridgeSummary || topActive.entry.summary}`,
      });
    }
  }

  if (selected.length === 0) {
    const fallback = ranked.find((item) => item.score >= 5 || userMessage.trim().length <= 12);
    if (fallback) {
      selected.push({
        key: "长期关系主线",
        value: `${fallback.entry.topic}：${fallback.entry.bridgeSummary || fallback.entry.summary}`,
      });
    }
  }

  return selected.slice(0, maxEntries);
}

type RecalledEpisode = {
  id: string;
  title: string;
  summary: string;
  layer: "active" | "core";
  status: "active" | "cooling" | "resolved";
};

function recallEpisodesFromSnapshot(
  slowBrainSnapshot: SlowBrainSnapshot | null | undefined,
  userMessage: string,
): {
  core?: RecalledEpisode;
  active?: RecalledEpisode;
} {
  const episodes = slowBrainSnapshot?.episodes ?? [];
  if (episodes.length === 0) return {};

  const userText = normalizeText(userMessage);
  const userKeywords = extractKeywords(userMessage);
  const relationship = buildRelationshipTexts(slowBrainSnapshot);
  const relationshipText = normalizeText(relationship.combinedText);

  const ranked = episodes
    .map((entry) => {
      const combined = normalizeText(
        `${entry.title} ${entry.summary} ${entry.sourceTopics.join(" ")} ${entry.semanticKeywords.join(" ")} ${entry.topMood}`,
      );
      const score =
        keywordOverlapScore(combined, userKeywords, 4, 16) +
        (userText && combined.includes(userText) ? 10 : 0) +
        keywordOverlapScore(combined, relationship.keywords, 2, 10) +
        Math.round(entry.salience * 6) +
        Math.round((entry.relationshipWeight ?? entry.salience) * 8) +
        Math.min(4, entry.recurrenceCount) +
        (entry.layer === "core" ? 3 : 0) +
        (entry.status === "active" ? 4 : entry.status === "cooling" ? 2 : 0) +
        (relationshipText.includes(normalizeText(entry.title)) ? 3 : 0);
      return { entry, score };
    })
    .sort((a, b) => b.score - a.score || b.entry.lastTurn - a.entry.lastTurn);

  const core = ranked.find((item) => item.entry.layer === "core" && item.score >= 5)?.entry;
  const active = ranked.find((item) =>
    item.entry.status === "active" &&
    item.entry.id !== core?.id &&
    item.score >= 5
  )?.entry;

  if (!core && !active && ranked[0]?.score >= 4) {
    return {
      core: ranked[0]?.entry.layer === "core" ? ranked[0].entry : undefined,
      active: ranked[0]?.entry.status === "active" ? ranked[0].entry : undefined,
    };
  }

  return { core, active };
}

function mapPersistentEpisodeToRecalledEpisode(
  entry: {
    id: string;
    title: string;
    summary: string;
    unresolved: boolean;
    status: string;
    relationship_weight: number;
    recurrence_count: number;
    topics: string[];
  },
): RecalledEpisode {
  const status: RecalledEpisode["status"] =
    entry.status === "active" || entry.status === "cooling" || entry.status === "resolved"
      ? entry.status
      : entry.unresolved
        ? "active"
        : "cooling";
  const layer: RecalledEpisode["layer"] =
    entry.relationship_weight >= 0.72 ||
    entry.recurrence_count >= 3 ||
    (entry.topics?.length ?? 0) >= 2
      ? "core"
      : "active";
  return {
    id: entry.id,
    title: entry.title,
    summary: entry.summary,
    layer,
    status,
  };
}

export async function recallEpisodes(
  slowBrainSnapshot: SlowBrainSnapshot | null | undefined,
  userMessage: string,
  options?: { userId?: string },
): Promise<{
  core?: RecalledEpisode;
  active?: RecalledEpisode;
}> {
  if (episodeStorePromptEnabled() && options?.userId) {
    try {
      const ranked = await findRelevantEpisodes(options.userId, userMessage, 4);
      if (ranked.length > 0) {
        const persistentEpisodes = ranked.map(({ episode }) =>
          mapPersistentEpisodeToRecalledEpisode(episode),
        );
        const core = persistentEpisodes.find((entry) => entry.layer === "core");
        const active = persistentEpisodes.find((entry) =>
          entry.status === "active" &&
          entry.id !== core?.id,
        );
        if (core || active) {
          return { core, active };
        }
        const first = persistentEpisodes[0];
        if (first) {
          return {
            core: first.layer === "core" ? first : undefined,
            active: first.status === "active" ? first : undefined,
          };
        }
      }
    } catch (err) {
      logger.warn("episode store prompt recall failed, falling back to snapshot episodes", {
        error: (err as Error).message,
      });
    }
  }

  return recallEpisodesFromSnapshot(slowBrainSnapshot, userMessage);
}

function shouldPreferThreadMemory(
  userMessage: string,
  slowBrainSnapshot: SlowBrainSnapshot | null | undefined,
): boolean {
  if (!slowBrainSnapshot) return false;
  const trimmed = userMessage.trim();
  const continuationLike = /继续|刚才|上次那个|还是那个|回到刚才|然后呢|后来呢/u.test(trimmed);
  const lowSignal = trimmed.length <= 12;
  const topThread = (slowBrainSnapshot.topicThreads ?? [])[0];
  if (!topThread) return false;
  return continuationLike || lowSignal || (topThread.episodeCount ?? 1) >= 3;
}

function scoreMemoryEntry(
  entry: Memory,
  userText: string,
  userKeywords: string[],
  relationshipText: string,
  relationshipKeywords: string[],
): number {
  const keyText = normalizeText(entry.key);
  const valueText = normalizeText(entry.value);
  const combined = `${keyText} ${valueText}`.trim();
  let score = 0;

  if (valueText && userText.includes(valueText)) score += 12;
  if (keyText && userText.includes(keyText)) score += 6;
  score += keywordOverlapScore(combined, userKeywords, 4, 12);

  if (relationshipText) {
    if (valueText && relationshipText.includes(valueText)) score += 8;
    if (keyText && relationshipText.includes(keyText)) score += 3;
    score += keywordOverlapScore(combined, relationshipKeywords, 2, 8);
  }

  return score;
}

function scoreSharedMoment(
  entry: NonNullable<SlowBrainSnapshot["sharedMoments"]>[number],
  input: {
    userText: string;
    userKeywords: string[];
    relationshipText: string;
    relationshipKeywords: string[];
    preferredTopics: string[];
    recentMoodText: string;
    turnCount: number;
    lastUsedSummary: string;
  },
): number {
  const combined = normalizeText(
    `${entry.summary} ${entry.topic} ${entry.hook} ${(entry.semanticKeywords ?? []).join(" ")}`,
  );
  let score = 0;
  const emotionalSalience = /委屈|崩溃|难过|焦虑|低落|开心|失眠|睡不着|误解|争吵|冲突/u.test(
    `${entry.summary} ${entry.mood}`,
  );

  if (input.userText && combined.includes(input.userText)) score += 10;
  score += keywordOverlapScore(combined, input.userKeywords, 5, 18);

  const topicText = normalizeText(entry.topic);
  if (topicText) {
    if (input.userText.includes(topicText)) score += 7;
    if (input.preferredTopics.some((topic) => normalizeText(topic) === topicText)) score += 4;
  }

  if (entry.hook) {
    const hookText = normalizeText(entry.hook);
    if (hookText && input.userText.includes(hookText)) score += 5;
  }

  const moodText = normalizeText(entry.mood);
  if (moodText && input.recentMoodText.includes(moodText)) score += 3;
  if (entry.unresolved) score += 4;
  if (entry.kind === "support" || entry.kind === "stress") score += 3;
  if (entry.kind === "goal" || entry.kind === "joy") score += 2;
  score += Math.round((entry.salience ?? 0) * 8);
  score += Math.min(6, Math.max(0, entry.recurrenceCount ?? 1) - 1);

  if (input.relationshipText) {
    score += keywordOverlapScore(combined, input.relationshipKeywords, 2, 10);
  }

  if (emotionalSalience) {
    score += 3;
  }

  const recencyTurns = Math.max(0, input.turnCount - entry.turn);
  score += Math.max(0, 6 - recencyTurns);

  const ageHours = Math.max(0, (Date.now() - entry.createdAt) / (1000 * 60 * 60));
  if (Number.isFinite(ageHours)) {
    score += Math.max(0, 4 - Math.floor(ageHours / 12));
  }

  if (
    episodeLongHorizonRankingEnabled() &&
    ageHours >= 24 &&
    (score >= 12 || keywordOverlapScore(combined, input.relationshipKeywords, 2, 10) >= 4)
  ) {
    // Give older but still clearly relevant episodes a chance to beat fresher noise.
    score += 4;
  }

  if (
    typeof entry.lastReferencedAt === "number" &&
    entry.lastReferencedAt > 0 &&
    Date.now() - entry.lastReferencedAt < 1000 * 60 * 60 * 6
  ) {
    score -= 4;
  }

  if (
    input.lastUsedSummary &&
    entry.summary === input.lastUsedSummary &&
    score < 18
  ) {
    score -= 6;
  }

  return score;
}

function sortEntries(
  a: { entry: Memory; score: number; importance: number; lastAccessedAt: number; createdAt: number },
  b: { entry: Memory; score: number; importance: number; lastAccessedAt: number; createdAt: number },
): number {
  return (
    b.score - a.score ||
    b.importance - a.importance ||
    b.lastAccessedAt - a.lastAccessedAt ||
    b.createdAt - a.createdAt
  );
}

function buildEpisodePromptMemory(
  slowBrainSnapshot: SlowBrainSnapshot | null | undefined,
  userMessage: string,
  maxEntries: number,
): Memory[] {
  if (!slowBrainSnapshot || maxEntries <= 0) return [];
  if (!slowBrainSnapshot.sharedMoments?.length) return [];

  const enabled = parseBooleanFlag(process.env.REMI_EPISODE_RETRIEVAL_V1_ENABLED, true);
  const userText = normalizeText(userMessage);
  const userKeywords = extractKeywords(userMessage);
  const relationship = buildRelationshipTexts(slowBrainSnapshot);
  const turnCount = slowBrainSnapshot.relationship.turnCount ?? 0;
  const lastUsedSummary =
    slowBrainSnapshot.continuityCueState?.lastSharedMomentSummary ?? "";
  const episodeLimit = enabled
    ? Math.min(MAX_PROMPT_EPISODES, maxEntries)
    : Math.min(2, maxEntries);

  const ranked = slowBrainSnapshot.sharedMoments
    .map((entry) => ({
      entry,
      score: enabled
        ? scoreSharedMoment(entry, {
            userText,
            userKeywords,
            relationshipText: normalizeText(relationship.combinedText),
            relationshipKeywords: relationship.keywords,
            preferredTopics: relationship.preferredTopics,
            recentMoodText: normalizeText(relationship.recentMoodText),
            turnCount,
            lastUsedSummary,
          })
        : scoreSharedMoment(entry, {
            userText,
            userKeywords,
            relationshipText: normalizeText(relationship.combinedText),
            relationshipKeywords: relationship.keywords,
            preferredTopics: relationship.preferredTopics,
            recentMoodText: normalizeText(relationship.recentMoodText),
            turnCount,
            lastUsedSummary: "",
          }),
    }))
    .sort((a, b) => b.score - a.score || b.entry.turn - a.entry.turn || b.entry.createdAt - a.entry.createdAt);

  if (
    enabled &&
    lastUsedSummary &&
    ranked.length > 1 &&
    ranked[0].entry.summary === lastUsedSummary &&
    ranked[1].score >= ranked[0].score - 6
  ) {
    const [first, second, ...rest] = ranked;
    ranked.splice(0, ranked.length, second, first, ...rest);
  }

  return ranked
    .filter((item, index) => {
      if (enabled) {
        if (index === 0) return item.score >= 4 || userMessage.trim().length <= 12;
        return item.score >= 14;
      }
      return item.score > 0 || userMessage.trim().length <= 12;
    })
    .slice(0, episodeLimit)
    .map((item, index) => ({
      key: index === 0 ? "最近共同经历" : `共同经历${index + 1}`,
      value: item.entry.summary,
    }));
}

/**
 * Prompt-facing retrieval: returns a small, relationship-aware fact set.
 * This is the main prompt retrieval path and intentionally avoids getAll-style flooding.
 */
export async function retrievePromptMemory(
  repo: MemoryRepository,
  options: RetrievePromptMemoryOptions,
): Promise<Memory[]> {
  const maxEntries =
    options.maxEntries ??
    parsePositiveInt(process.env.MAX_PROMPT_MEMORY_ENTRIES, 6);
  if (maxEntries <= 0) return [];

  const allEntries = await repo.getAll();
  const entries = (allEntries || [])
    .filter(({ key }) => !isSystemMemoryKey(key))
    .map((entry) => ({
      entry: { key: entry.key, value: entry.value },
      importance: entry.importance,
      lastAccessedAt: entry.lastAccessedAt,
      createdAt: entry.createdAt,
    }));

  const seenKeys = new Set<string>();
  const selected: Memory[] = [];
  const userText = normalizeText(options.userMessage);
  const userKeywords = extractKeywords(options.userMessage);
  const relationship = buildRelationshipTexts(options.slowBrainSnapshot);
  const relevantCandidates = entries.map((item) => ({
    ...item,
    score: scoreMemoryEntry(
      item.entry,
      userText,
      userKeywords,
      normalizeText(relationship.combinedText),
      relationship.keywords,
    ),
  }));

  const coreFacts = relevantCandidates
    .filter(({ entry }) => CORE_FACT_KEYS.has(entry.key))
    .sort(sortEntries)
    .slice(0, Math.min(CORE_FACT_LIMIT, maxEntries));

  for (const item of coreFacts) {
    seenKeys.add(item.entry.key);
    selected.push(item.entry);
  }

  if (selected.length < maxEntries) {
    const recalledEpisodes = await recallEpisodes(
      options.slowBrainSnapshot,
      options.userMessage,
      { userId: options.userId },
    );
    let structuredNarrativeAdded = false;
    if (recalledEpisodes.core) {
      selected.push({
        key: "长期关系主线",
        value: `${recalledEpisodes.core.title}：${recalledEpisodes.core.summary}`,
      });
      seenKeys.add("长期关系主线");
      structuredNarrativeAdded = true;
    }
    if (selected.length < maxEntries && recalledEpisodes.active) {
      selected.push({
        key: "当前未完主线",
        value: `${recalledEpisodes.active.title}：${recalledEpisodes.active.summary}`,
      });
      seenKeys.add("当前未完主线");
      structuredNarrativeAdded = true;
    }
    if (!structuredNarrativeAdded) {
      const threadMemories = buildTopicThreadPromptMemory(
        options.slowBrainSnapshot,
        options.userMessage,
        maxEntries - selected.length,
      );
      for (const memory of threadMemories) {
        if (selected.length >= maxEntries) break;
        if (seenKeys.has(memory.key)) continue;
        seenKeys.add(memory.key);
        selected.push(memory);
      }
    }
  }

  if (selected.length < maxEntries) {
    const promptEpisodes = buildEpisodePromptMemory(
      options.slowBrainSnapshot,
      options.userMessage,
      maxEntries - selected.length,
    );
    for (const episode of promptEpisodes) {
      if (selected.length >= maxEntries) break;
      if (seenKeys.has(episode.key)) continue;
      seenKeys.add(episode.key);
      selected.push(episode);
    }
  }

  if (selected.length < maxEntries) {
    const relevant = relevantCandidates
      .filter((item) => item.score > 0 && !seenKeys.has(item.entry.key))
      .sort(sortEntries);

    for (const item of relevant) {
      if (selected.length >= maxEntries) break;
      seenKeys.add(item.entry.key);
      selected.push(item.entry);
    }
  }

  if (selected.length < maxEntries) {
    const fallback = relevantCandidates
      .filter((item) => !seenKeys.has(item.entry.key))
      .map((item) => ({ ...item, score: 0 }))
      .sort(sortEntries);

    for (const item of fallback) {
      if (selected.length >= maxEntries) break;
      seenKeys.add(item.entry.key);
      selected.push(item.entry);
    }
  }

  // Semantic supplement: if there are still open slots and the repo has a pg
  // backend with vector search, ask pgvector for nearest neighbours to fill gaps.
  // Only activates when EMBEDDING_MODEL is set; degrades gracefully on any error.
  if (selected.length < maxEntries) {
    const persistentBackend =
      typeof (repo as any).getPersistentBackend === "function"
        ? (repo as any).getPersistentBackend()
        : null;
    if (persistentBackend && typeof persistentBackend.findSimilar === "function") {
      const timeoutMs = parsePositiveInt(
        process.env.REMI_SEMANTIC_RECALL_TIMEOUT_MS,
        300,
      );
      try {
        const semanticHits = await Promise.race([
          persistentBackend.findSimilar(
            options.userMessage,
            maxEntries * 2,
          ) as Promise<Array<{ key: string; value: string }>>,
          new Promise<Array<{ key: string; value: string }>>((resolve) =>
            setTimeout(() => resolve([]), timeoutMs),
          ),
        ]);
        let semanticAdded = 0;
        for (const hit of semanticHits) {
          if (selected.length >= maxEntries) break;
          if (seenKeys.has(hit.key) || isSystemMemoryKey(hit.key)) continue;
          seenKeys.add(hit.key);
          selected.push({ key: hit.key, value: hit.value });
          semanticAdded++;
        }
        if (semanticAdded > 0) {
          logger.debug("semantic recall supplemented", {
            added: semanticAdded,
            total: selected.length,
          });
        }
      } catch {
        // Semantic search is best-effort; keyword recall already covered the slots.
      }
    }
  }

  logger.debug("prompt memory retrieved", {
    selected: selected.map((entry) => entry.key),
    totalEntries: entries.length,
    maxEntries,
    relationshipSummary: relationship.summaryText.slice(0, 80),
  });

  return selected;
}

/**
 * Compatibility helper for non-prompt callers.
 * This keeps the old behavior for tests and auxiliary tooling.
 */
export async function retrieveMemory(repo: MemoryRepository): Promise<Memory[]> {
  const entries = await repo.getAll();
  return entries
    .filter(({ key }) => !isSystemMemoryKey(key))
    .map(({ key, value }) => ({ key, value }));
}
