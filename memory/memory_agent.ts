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
import { getConfig } from "../server/config";
import { isSystemMemoryKey } from "./relationship_state";
import type { SlowBrainSnapshot } from "../brains/background_analysis_store";
import {
  episodeStorePromptEnabled,
  isLightAcknowledgementTurn,
  isExplicitMemoryRecallRequest,
  sanitizeMemoryEvidenceText,
  filterSuperseded,
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
  episodeRecallSource: "episode_store" | "none";
  episodeRecallIds: string[];
  episodeReferenceApplied: boolean;
}

const CORE_FACT_KEYS = new Set([
  "名字",
  "城市",
  "工作",
  "学校",
  "宠物",
  "喜好",
]);
const MAX_CORE_FACTS = 2;

type RecalledEpisode = {
  id: string;
  title: string;
  summary: string;
  layer: "active" | "core";
  status: "active" | "cooling" | "resolved";
  structuredTitle?: string;
  structuredSummary?: string;
};

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
  const summary = sanitizeMemoryEvidenceText(entry.structuredSummary || entry.summary, entry.title);
  return `${title}：${summary}`;
}

function isLightTouchTurn(userMessage: string): boolean {
  const trimmed = userMessage.trim();
  if (!trimmed) return false;
  return isLightAcknowledgementTurn(trimmed) && !isExplicitMemoryRecallRequest(trimmed);
}

async function recallEpisodesFromStore(
  userMessage: string,
  userId: string,
  markReferenced: boolean,
): Promise<{ core?: RecalledEpisode; active?: RecalledEpisode; episodeIds: string[] } | null> {
  const ranked = await findRelevantEpisodes(userId, userMessage, 4);
  if (ranked.length === 0) return null;

  const episodes = ranked.map(({ episode, score }) => ({
    entry: mapPersistentEpisodeToRecalledEpisode(episode),
    score,
  }));

  const primary = episodes[0].entry;
  let core: RecalledEpisode | undefined;
  let active: RecalledEpisode | undefined;

  if (primary.layer === "core") {
    core = primary;
    active = episodes.slice(1).find((e) => e.entry.status === "active" && e.entry.id !== primary.id)?.entry;
  } else if (primary.status === "active") {
    active = primary;
  } else {
    core = { ...primary, layer: "core" };
  }

  const episodeIds = [core?.id, active?.id].filter(Boolean) as string[];
  if (markReferenced && episodeIds.length > 0) {
    void Promise.allSettled(episodeIds.map((id) => markReferencedEpisode(id)));
  }

  return { core, active, episodeIds };
}

/**
 * Prompt-facing retrieval: returns a small, relationship-aware fact set.
 * Two layers: episode store (primary) + vector supplement.
 */
export async function retrievePromptMemory(
  repo: MemoryRepository,
  options: RetrievePromptMemoryOptions,
): Promise<Memory[]> {
  const maxEntries =
    options.maxEntries ??
    getConfig().MAX_PROMPT_MEMORY_ENTRIES;
  if (maxEntries <= 0) return [];

  const selected: Memory[] = [];
  const seenKeys = new Set<string>();
  let diagnostics: PromptMemoryDiagnostics = {
    episodeRecallSource: "none",
    episodeRecallIds: [],
    episodeReferenceApplied: false,
  };

  // Layer 0: core KV facts (名字, 城市, etc.)
  const allEntriesRaw = await repo.getAll();
  const allEntries = filterSuperseded(allEntriesRaw);
  const coreFacts = allEntries
    .filter(({ key }) => CORE_FACT_KEYS.has(key) && !isSystemMemoryKey(key))
    .slice(0, Math.min(MAX_CORE_FACTS, maxEntries));
  for (const entry of coreFacts) {
    seenKeys.add(entry.key);
    selected.push({ key: entry.key, value: entry.value, createdAt: entry.createdAt });
  }

  if (isLightTouchTurn(options.userMessage)) {
    options.diagnostics?.(diagnostics);
    return selected;
  }

  // Layer 1: episode store recall
  if (selected.length < maxEntries && episodeStorePromptEnabled() && options.userId) {
    try {
      const result = await recallEpisodesFromStore(
        options.userMessage,
        options.userId,
        options.markEpisodeReferenced !== false,
      );
      if (result) {
        diagnostics = {
          episodeRecallSource: "episode_store",
          episodeRecallIds: result.episodeIds,
          episodeReferenceApplied: result.episodeIds.length > 0 && options.markEpisodeReferenced !== false,
        };
        if (result.core && selected.length < maxEntries) {
          const key = "长期关系主线";
          seenKeys.add(key);
          selected.push({ key, value: formatRecalledEpisodePromptValue(result.core) });
        }
        if (result.active && selected.length < maxEntries) {
          const key = "当前未完主线";
          seenKeys.add(key);
          selected.push({ key, value: formatRecalledEpisodePromptValue(result.active) });
        }
      }
    } catch (err) {
      const health = getEmbeddingHealthSnapshot();
      logger.warn("episode store prompt recall failed", {
        error: (err as Error).message,
        embeddingStatus: classifyEmbeddingError(err),
        embeddingConfigured: health.configured,
      });
    }
  }

  // Layer 2: semantic vector supplement
  if (selected.length < maxEntries) {
    const persistentBackend =
      typeof (repo as any).getPersistentBackend === "function"
        ? (repo as any).getPersistentBackend()
        : null;
    if (persistentBackend && typeof persistentBackend.findSimilar === "function") {
      const timeoutMs = getConfig().REMI_SEMANTIC_RECALL_TIMEOUT_MS;
      try {
        const hits = await Promise.race([
          persistentBackend.findSimilar(options.userMessage, maxEntries * 2) as Promise<Array<{ key: string; value: string; createdAt?: number }>>,
          new Promise<Array<{ key: string; value: string; createdAt?: number }>>((resolve) => setTimeout(() => resolve([]), timeoutMs)),
        ]);
        for (const hit of hits) {
          if (selected.length >= maxEntries) break;
          if (seenKeys.has(hit.key) || isSystemMemoryKey(hit.key)) continue;
          seenKeys.add(hit.key);
          selected.push({ key: hit.key, value: hit.value, createdAt: hit.createdAt });
        }
      } catch (err) {
        logger.debug("semantic vector supplement failed", {
          error: (err as Error).message,
        });
      }
    }
  }

  logger.debug("prompt memory retrieved", {
    selected: selected.map((entry) => entry.key),
    maxEntries,
    episodeRecallSource: diagnostics.episodeRecallSource,
    episodeRecallIds: diagnostics.episodeRecallIds,
  });

  options.diagnostics?.(diagnostics);
  return selected;
}

/**
 * Compatibility helper for non-prompt callers.
 */
export async function retrieveMemory(repo: MemoryRepository): Promise<Memory[]> {
  const entries = await repo.getAll();
  return filterSuperseded(entries)
    .filter(({ key }) => !isSystemMemoryKey(key))
    .map(({ key, value }) => ({ key, value }));
}
