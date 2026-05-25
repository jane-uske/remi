import { createLogger } from "../infra/logger";
import {
  readTextArchiveEntries,
  resolveTextArchiveLedgerPath,
  type TextArchiveLedgerEntry,
  type TextArchiveSlowBrainEntry,
  type TextArchivePromptEntry,
} from "./text_archive_ledger";

const logger = createLogger("text_archive_retrieval");

export interface ArchiveSearchResult {
  entry: TextArchiveLedgerEntry;
  score: number;
  matchedTerms: string[];
}

export interface ArchiveRetrievalOptions {
  maxResults?: number;
  minScore?: number;
  stageFilter?: "prompt" | "slow_brain";
  dateFrom?: Date;
  dateTo?: Date;
}

interface InvertedIndexEntry {
  idx: number;
  tf: number;
}

interface ArchiveIndex {
  entries: TextArchiveLedgerEntry[];
  invertedIndex: Map<string, InvertedIndexEntry[]>;
  builtAt: number;
}

let cachedIndex: ArchiveIndex | null = null;
const INDEX_TTL_MS = 5 * 60 * 1000;

function tokenize(text: string): string[] {
  const normalized = text.toLowerCase();
  const cjkTokens: string[] = [];
  const cjkRegex = /[一-鿿㐀-䶿]/g;
  let match: RegExpExecArray | null;
  while ((match = cjkRegex.exec(normalized)) !== null) {
    cjkTokens.push(match[0]);
    if (match.index + 1 < normalized.length) {
      const next = normalized[match.index + 1];
      if (/[一-鿿㐀-䶿]/.test(next)) {
        cjkTokens.push(match[0] + next);
      }
    }
  }

  const latinTokens = normalized
    .replace(/[一-鿿㐀-䶿]/g, " ")
    .split(/[\s\p{P}]+/u)
    .filter((t) => t.length >= 2);

  return [...new Set([...cjkTokens, ...latinTokens])];
}

function extractSearchableText(entry: TextArchiveLedgerEntry): string {
  const parts: string[] = [];

  if (entry.stage === "prompt") {
    const prompt = entry as TextArchivePromptEntry;
    parts.push(prompt.userMessage);
    for (const write of prompt.memoryWrites) {
      parts.push(write.key, write.value);
    }
  } else {
    const slow = entry as TextArchiveSlowBrainEntry;
    parts.push(slow.userMessage, slow.assistantReply);
    for (const write of slow.memoryWrites) {
      parts.push(write.key, write.value);
    }
    for (const moment of slow.extractedMoments) {
      parts.push(moment.summary);
      if (moment.topic) parts.push(moment.topic);
    }
    for (const ep of slow.episodeViews) {
      if (ep.title) parts.push(ep.title);
      if (ep.summary) parts.push(ep.summary);
    }
  }

  return parts.filter(Boolean).join(" ");
}

function buildIndex(entries: TextArchiveLedgerEntry[]): ArchiveIndex {
  const invertedIndex = new Map<string, InvertedIndexEntry[]>();

  for (let idx = 0; idx < entries.length; idx++) {
    const text = extractSearchableText(entries[idx]);
    const tokens = tokenize(text);
    const termFreq = new Map<string, number>();
    for (const token of tokens) {
      termFreq.set(token, (termFreq.get(token) ?? 0) + 1);
    }
    for (const [term, tf] of termFreq) {
      let posting = invertedIndex.get(term);
      if (!posting) {
        posting = [];
        invertedIndex.set(term, posting);
      }
      posting.push({ idx, tf });
    }
  }

  return { entries, invertedIndex, builtAt: Date.now() };
}

async function getOrBuildIndex(filePath?: string): Promise<ArchiveIndex> {
  if (cachedIndex && Date.now() - cachedIndex.builtAt < INDEX_TTL_MS) {
    return cachedIndex;
  }

  const entries = await readTextArchiveEntries(filePath);
  cachedIndex = buildIndex(entries);
  return cachedIndex;
}

export function invalidateArchiveIndex(): void {
  cachedIndex = null;
}

export async function searchArchive(
  query: string,
  options: ArchiveRetrievalOptions = {},
): Promise<ArchiveSearchResult[]> {
  const {
    maxResults = 10,
    minScore = 0.01,
    stageFilter,
    dateFrom,
    dateTo,
  } = options;

  const filePath = resolveTextArchiveLedgerPath();
  let index: ArchiveIndex;
  try {
    index = await getOrBuildIndex(filePath);
  } catch (err) {
    logger.warn("failed to build archive index", { error: (err as Error).message });
    return [];
  }

  if (index.entries.length === 0) return [];

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  const docCount = index.entries.length;
  const scores = new Map<number, { score: number; matchedTerms: string[] }>();

  for (const token of queryTokens) {
    const posting = index.invertedIndex.get(token);
    if (!posting) continue;

    const idf = Math.log(1 + docCount / posting.length);

    for (const { idx, tf } of posting) {
      const existing = scores.get(idx);
      const termScore = (1 + Math.log(tf)) * idf;
      if (existing) {
        existing.score += termScore;
        existing.matchedTerms.push(token);
      } else {
        scores.set(idx, { score: termScore, matchedTerms: [token] });
      }
    }
  }

  let results: ArchiveSearchResult[] = [];
  for (const [idx, { score, matchedTerms }] of scores) {
    if (score < minScore) continue;
    const entry = index.entries[idx];

    if (stageFilter && entry.stage !== stageFilter) continue;

    if (dateFrom || dateTo) {
      const entryDate = new Date((entry as TextArchivePromptEntry).recordedAt);
      if (dateFrom && entryDate < dateFrom) continue;
      if (dateTo && entryDate > dateTo) continue;
    }

    results.push({ entry, score, matchedTerms: [...new Set(matchedTerms)] });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, maxResults);
}

export async function retrieveRecentContext(
  query: string,
  maxEntries = 5,
): Promise<string[]> {
  const results = await searchArchive(query, {
    maxResults: maxEntries,
    stageFilter: "slow_brain",
  });

  return results.map((r) => {
    const slow = r.entry as TextArchiveSlowBrainEntry;
    return `[${slow.recordedAt}] ${slow.userMessage} → ${slow.assistantReply.slice(0, 120)}`;
  });
}
