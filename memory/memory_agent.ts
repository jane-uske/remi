import type { MemoryRepository } from "./memory_repository";
import type { Memory } from "./memory_store";
import {
  findRelevant as findRelevantEpisodes,
  markReferenced as markReferencedEpisode,
} from "./episode_store";
import {
  classifyEmbeddingError,
  getEmbeddingHealthSnapshot,
} from "../llm/embedding_client";
import { toEpisodeV3View } from "./episode_v3";
import { createLogger } from "../infra/logger";
import { isSystemMemoryKey } from "./relationship_state";
import type { SlowBrainSnapshot } from "../brains/slow_brain_store";
import {
  buildRelationshipTexts,
  episodeLongHorizonRankingEnabled,
  episodeStorePromptEnabled,
  extractKeywords,
  getLongHorizonThreadCandidates,
  getSnapshotEpisodeCandidates,
  keywordOverlapScore,
  normalizeText,
  parseBooleanFlag,
  parsePositiveInt,
} from "./prompt_memory_support";

const logger = createLogger("memory_agent");

export type { Memory };

export interface RetrievePromptMemoryOptions {
  userId?: string;
  userMessage: string;
  slowBrainSnapshot?: SlowBrainSnapshot | null;
  maxEntries?: number;
  markEpisodeReferenced?: boolean;
  touchSelected?: boolean;
  diagnostics?: (meta: PromptMemoryDiagnostics) => void;
}

export interface PromptMemoryDiagnostics {
  episodeRecallSource: "episode_store" | "snapshot" | "none";
  episodeRecallIds: string[];
  episodeReferenceApplied: boolean;
  episodeRecallFallback: boolean;
}

export interface ExtractedMemoryWrite {
  key: string;
  value: string;
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
const SYNTHETIC_MEMORY_KEYS = new Set([
  "当前上下文",
  "长期关系主线",
  "当前未完主线",
  "最近共同经历",
]);

const LIGHT_TOUCH_TURN_PATTERN =
  /^(?:你好呀?|您好|哈喽|hello|hi|嗨|嘿|在吗|在不在|晚安(?:啦|呀)?|早安|早上好|晚上好|睡了|嗯+|嗯嗯+|哦+|噢+|啊+|好+|好的|好哦|好哒|收到|行吧?|ok(?:ay)?|okk+)[!！?？~～。\s]*$/iu;

function isLightTouchTurn(userMessage: string): boolean {
  const trimmed = userMessage.trim();
  if (!trimmed || trimmed.length > 12) return false;
  return LIGHT_TOUCH_TURN_PATTERN.test(trimmed);
}

function hasNegationBeforeMatch(msg: string, matchIndex: number): boolean {
  const beforeMatch = msg.slice(0, matchIndex);
  return NEGATION_WORDS.some((neg) => beforeMatch.includes(neg));
}

function shouldTouchMemoryKey(key: string): boolean {
  if (!key || isSystemMemoryKey(key)) return false;
  if (SYNTHETIC_MEMORY_KEYS.has(key)) return false;
  if (/^共同经历\d+$/u.test(key)) return false;
  return true;
}

function touchPromptMemories(
  repo: MemoryRepository,
  memories: Memory[],
): void {
  const keys = [...new Set(memories.map((entry) => entry.key).filter(shouldTouchMemoryKey))];
  if (keys.length === 0) return;
  void Promise.allSettled(keys.map((key) => repo.touch(key)));
}

export function extractMemory(
  userMessage: string,
  repo: MemoryRepository,
): ExtractedMemoryWrite[] {
  const writes: ExtractedMemoryWrite[] = [];
  for (const { pattern, key, isNegative } of PATTERNS) {
    const match = userMessage.match(pattern);
    if (match?.[0] && match?.[1]) {
      if (!isNegative && hasNegationBeforeMatch(userMessage, match.index || 0)) {
        continue;
      }
      const value = match[1].trim();
      if (value) {
        void repo.upsert(key, value);
        writes.push({ key, value });
        logger.info("记住了", { key, value });
      }
    }
  }
  return writes;
}

function buildTopicThreadPromptMemory(
  slowBrainSnapshot: SlowBrainSnapshot | null | undefined,
  userMessage: string,
  maxEntries: number,
): Memory[] {
  if (!slowBrainSnapshot || maxEntries <= 0) return [];
  const threads = getLongHorizonThreadCandidates(slowBrainSnapshot);
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
  structuredTitle?: string;
  structuredSummary?: string;
};

type RecalledEpisodeSelection = {
  core?: RecalledEpisode;
  active?: RecalledEpisode;
  source: "episode_store" | "snapshot" | "none";
  episodeIds: string[];
  fallbackUsed: boolean;
};

type RankedRecalledEpisode = {
  entry: RecalledEpisode;
  score: number;
};

function recallEpisodesFromSnapshot(
  slowBrainSnapshot: SlowBrainSnapshot | null | undefined,
  userMessage: string,
): RecalledEpisodeSelection {
  const episodes = getSnapshotEpisodeCandidates(slowBrainSnapshot);
  if (episodes.length === 0) {
    return {
      source: "none",
      episodeIds: [],
      fallbackUsed: false,
    };
  }

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
      source: "snapshot",
      episodeIds: [ranked[0].entry.id],
      fallbackUsed: false,
    };
  }

  return {
    core,
    active,
    source: "snapshot",
    episodeIds: [core?.id, active?.id].filter(Boolean) as string[],
    fallbackUsed: false,
  };
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
    v3_event_summary?: string | null;
  },
): RecalledEpisode {
  const view = toEpisodeV3View(entry);
  const status: RecalledEpisode["status"] =
    entry.status === "active" || entry.status === "cooling" || entry.status === "resolved"
      ? entry.status
      : entry.unresolved
        ? "active"
        : "cooling";
  const layer: RecalledEpisode["layer"] =
    status === "active" &&
    (view.domain === "relationship_with_remi" || view.unresolvedLevel >= 2)
      ? "active"
      : (
          entry.relationship_weight >= 0.72 ||
          entry.recurrence_count >= 3 ||
          (
            (entry.topics?.length ?? 0) >= 2 &&
            (entry.recurrence_count >= 3 || entry.relationship_weight >= 0.68)
          )
        )
        ? "core"
        : "active";
  return {
    id: entry.id,
    title: entry.title,
    summary: entry.summary,
    layer,
    status,
    structuredTitle: mapEpisodeV3PromptTitle(view.domain, entry.title),
    structuredSummary: entry.v3_event_summary?.trim() || undefined,
  };
}

function mapEpisodeV3PromptTitle(
  domain: ReturnType<typeof toEpisodeV3View>["domain"],
  fallbackTitle: string,
): string {
  switch (domain) {
    case "money":
      return "钱和现实压力";
    case "work":
      return "工作压力";
    case "pet":
      return "宠物与照料";
    case "relationship_with_remi":
      return "你和 Remi 之间";
    default:
      return fallbackTitle;
  }
}

function formatRecalledEpisodePromptValue(entry: RecalledEpisode): string {
  const title = entry.structuredTitle || entry.title;
  const summary = entry.structuredSummary || entry.summary;
  return `${title}：${summary}`;
}

function selectEpisodeStoreEpisodes(
  ranked: RankedRecalledEpisode[],
): Pick<RecalledEpisodeSelection, "core" | "active" | "episodeIds"> | null {
  const primary = ranked[0]?.entry;
  if (!primary) return null;

  if (primary.layer === "core") {
    const active = ranked
      .slice(1)
      .find((item) => item.entry.status === "active" && item.entry.id !== primary.id)
      ?.entry;
    return {
      core: primary,
      active,
      episodeIds: [primary.id, active?.id].filter(Boolean) as string[],
    };
  }

  if (primary.status === "active") {
    return {
      active: primary,
      episodeIds: [primary.id],
    };
  }

  return {
    core: { ...primary, layer: "core" },
    episodeIds: [primary.id],
  };
}

export async function recallEpisodes(
  slowBrainSnapshot: SlowBrainSnapshot | null | undefined,
  userMessage: string,
  options?: { userId?: string; markReferenced?: boolean },
): Promise<RecalledEpisodeSelection> {
  let attemptedEpisodeStore = false;
  if (episodeStorePromptEnabled() && options?.userId) {
    attemptedEpisodeStore = true;
    try {
      const ranked = await findRelevantEpisodes(options.userId, userMessage, 4);
      if (ranked.length > 0) {
        const persistentEpisodes = ranked.map(({ episode, score }) => ({
          entry: mapPersistentEpisodeToRecalledEpisode(episode),
          score,
        }));
        const selection = selectEpisodeStoreEpisodes(persistentEpisodes);
        if (selection && options.markReferenced !== false && selection.episodeIds.length > 0) {
          void Promise.allSettled(selection.episodeIds.map((id) => markReferencedEpisode(id)));
        }
        if (selection) {
          return {
            core: selection.core,
            active: selection.active,
            source: "episode_store",
            episodeIds: selection.episodeIds,
            fallbackUsed: false,
          };
        }
      }
    } catch (err) {
      const health = getEmbeddingHealthSnapshot();
      logger.warn("episode store prompt recall failed, falling back to snapshot episodes", {
        error: (err as Error).message,
        embeddingStatus: classifyEmbeddingError(err),
        embeddingConfigured: health.configured,
        embeddingBaseURL: health.baseURL ?? undefined,
        embeddingModel: health.model ?? undefined,
      });
    }
  }

  const fallback = recallEpisodesFromSnapshot(slowBrainSnapshot, userMessage);
  if (attemptedEpisodeStore) {
    return {
      ...fallback,
      fallbackUsed: true,
      source: fallback.source,
    };
  }
  return fallback;
}

function shouldPreferThreadMemory(
  userMessage: string,
  slowBrainSnapshot: SlowBrainSnapshot | null | undefined,
): boolean {
  if (!slowBrainSnapshot) return false;
  const trimmed = userMessage.trim();
  const continuationLike = /继续|刚才|上次那个|还是那个|回到刚才|然后呢|后来呢/u.test(trimmed);
  const lowSignal = trimmed.length <= 12;
  const topThread = getLongHorizonThreadCandidates(slowBrainSnapshot)[0];
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
    parsePositiveInt(process.env.MAX_PROMPT_MEMORY_ENTRIES, 5);
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
  let diagnostics: PromptMemoryDiagnostics = {
    episodeRecallSource: "none",
    episodeRecallIds: [],
    episodeReferenceApplied: false,
    episodeRecallFallback: false,
  };
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

  const suppressNarrativeMemory =
    Boolean(options.slowBrainSnapshot) && isLightTouchTurn(options.userMessage);
  if (suppressNarrativeMemory) {
    logger.debug("prompt memory kept compact for light-touch turn", {
      userMessage: options.userMessage,
      selected: selected.map((entry) => entry.key),
      totalEntries: entries.length,
    });
    if (options.touchSelected !== false) {
      touchPromptMemories(repo, selected);
    }
    options.diagnostics?.(diagnostics);
    return selected;
  }

  if (selected.length < maxEntries) {
    const hasStructuredSnapshotNarrative = Boolean(
      (options.slowBrainSnapshot?.episodes?.length ?? 0) > 0 ||
      (options.slowBrainSnapshot?.topicThreads?.length ?? 0) > 0,
    );
    const recalledEpisodes = await recallEpisodes(
      options.slowBrainSnapshot,
      options.userMessage,
      {
        userId: options.userId,
        markReferenced: options.markEpisodeReferenced !== false,
      },
    );
    diagnostics = {
      episodeRecallSource: recalledEpisodes.source,
      episodeRecallIds: recalledEpisodes.episodeIds,
      episodeReferenceApplied:
        recalledEpisodes.source === "episode_store" &&
        (options.markEpisodeReferenced !== false) &&
        (recalledEpisodes.core !== undefined || recalledEpisodes.active !== undefined),
      episodeRecallFallback: recalledEpisodes.fallbackUsed,
    };
    let structuredNarrativeAdded = false;
    if ((options.userId || hasStructuredSnapshotNarrative) && recalledEpisodes.core) {
      selected.push({
        key: "长期关系主线",
        value: formatRecalledEpisodePromptValue(recalledEpisodes.core),
      });
      seenKeys.add("长期关系主线");
      structuredNarrativeAdded = true;
    }
    if (
      (options.userId || hasStructuredSnapshotNarrative) &&
      selected.length < maxEntries &&
      recalledEpisodes.active
    ) {
      selected.push({
        key: "当前未完主线",
        value: formatRecalledEpisodePromptValue(recalledEpisodes.active),
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
    episodeRecallSource: diagnostics.episodeRecallSource,
    episodeRecallIds: diagnostics.episodeRecallIds,
    episodeReferenceApplied: diagnostics.episodeReferenceApplied,
    episodeRecallFallback: diagnostics.episodeRecallFallback,
  });

  if (options.touchSelected !== false) {
    touchPromptMemories(repo, selected);
  }
  options.diagnostics?.(diagnostics);

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
