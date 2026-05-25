import { extractKeywords, keywordOverlapScore, normalizeText } from "./text_utils";
import type { MemoryEntry } from "./memory_repository";

const LIGHT_ACK_PATTERN =
  /^(?:你好呀?|您好|哈喽|hello|hi|嗨|嘿|在吗|在不在|晚安(?:啦|呀)?|早安|早上好|晚上好|睡了|嗯+|嗯嗯+|哦+|噢+|啊+|好+|好的|好哦|好哒|收到|行吧?|明白了?|知道了?|我知道了|ok(?:ay)?|okk+|ok\s+ok(?:\s+我?知道了)?)[!！?？~～。\s]*$/iu;

const EXPLICIT_RECALL_PATTERN =
  /(?:还?记得|记住|忘了|之前(?:聊|说|提)|我们之前|上次|刚才(?:说|聊)|刚刚(?:说|聊)|聊了什么|说过什么|提过什么|谁在照顾|还记得.*吗)/u;

const VOLATILE_MEMORY_KEY_PATTERN =
  /^(?:当前|此刻|目前|现在|刚才|刚刚|今天|今日|昨日|昨天|明日|明天|本次|此次|此前状态|当前状态|当前诉求|当前需求|当前行为|当前行动|当前事务|当前处理事项|当前正在|正在|用户需求|用户诉求|索要内容)/u;

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

// ---------------------------------------------------------------------------
// BM25 sigmoid normalization (mem0 pattern)
// Short queries get sharper curve; long queries get gentler curve.
// ---------------------------------------------------------------------------

function bm25Sigmoid(rawScore: number, queryTermCount: number): number {
  const isShort = queryTermCount <= 3;
  const midpoint = isShort ? 5.0 : queryTermCount > 15 ? 12.0 : 8.0;
  const steepness = isShort ? 0.7 : queryTermCount > 15 ? 0.5 : 0.6;
  return 1 / (1 + Math.exp(-steepness * (rawScore - midpoint)));
}

/**
 * Entity hub attenuation (mem0 pattern).
 * Entities linked to many memories get suppressed to prevent generic terms
 * (e.g. "杭州") from dominating retrieval.
 */
function entityHubWeight(linkedCount: number): number {
  return 1 / (1 + 0.001 * (linkedCount - 1) ** 2);
}

const ENTITY_BOOST_WEIGHT = 0.5;

export interface HybridScoreInput {
  semanticScore: number;
  bm25RawScore?: number;
  queryTermCount: number;
  entitySimilarity?: number;
  entityLinkedCount?: number;
}

/**
 * Three-signal hybrid scoring (mem0 pattern):
 * semantic + BM25(sigmoid-normalized) + entity boost(hub-attenuated).
 * Result is always in [0, 1].
 */
export function hybridScore(input: HybridScoreInput): number {
  const { semanticScore, bm25RawScore, queryTermCount, entitySimilarity, entityLinkedCount } = input;

  const hasBM25 = bm25RawScore != null && bm25RawScore > 0;
  const hasEntity = entitySimilarity != null && entitySimilarity >= 0.5;

  const bm25 = hasBM25 ? bm25Sigmoid(bm25RawScore, queryTermCount) : 0;
  const entityBoost = hasEntity
    ? entitySimilarity * ENTITY_BOOST_WEIGHT * entityHubWeight(entityLinkedCount ?? 1)
    : 0;

  const maxPossible = 1.0 + (hasBM25 ? 1.0 : 0.0) + (hasEntity ? ENTITY_BOOST_WEIGHT : 0.0);
  return Math.min((semanticScore + bm25 + entityBoost) / maxPossible, 1.0);
}

/**
 * Filter out superseded memories from recall results (Graphiti pattern).
 * Superseded entries are only returned when explicitly requesting history.
 */
export function filterSuperseded(entries: MemoryEntry[], includeHistory = false): MemoryEntry[] {
  if (includeHistory) return entries;
  return entries.filter((e) => e.invalidAt == null);
}
