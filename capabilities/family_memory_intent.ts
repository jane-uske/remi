import { embed, getEmbeddingHealthSnapshot } from "../llm/embedding_client";
import { createLogger } from "../infra/logger";

const logger = createLogger("family_memory_intent");

// --- Regex fast path (unchanged from original) ---

const FAMILY_MEMORY_RE =
  /宝宝|胎动|孕检|产检|B超|胎心|孕期|预产|怀孕|孕周|胎儿|羊水|脐带|胎盘|分娩|待产|坐月子|母乳|辅食|疫苗|体检|发育|身高|体重|翻身|爬行|走路|说话|出牙|断奶|早教|睡眠训练|家庭|宝贝|小名|乳名|核心记忆|成长|里程碑|第一次/u;

const NON_FAMILY_RE =
  /天气|股票|新闻|比赛|电影|音乐|菜谱|导航|翻译|计算|编程|代码/u;

// --- Embedding-based fallback ---

const FAMILY_EXEMPLARS = [
  "宝宝最近体重多少了",
  "上次产检结果怎么样",
  "孩子什么时候开始翻身的",
  "预产期是几号",
  "疫苗打了哪些了",
  "宝宝第一次叫妈妈是什么时候",
  "孕期要注意什么",
  "辅食什么时候开始加",
];

const NON_FAMILY_EXEMPLARS = [
  "今天天气怎么样",
  "帮我翻译一下这段英文",
  "推荐一部好看的电影",
  "这段代码有什么问题",
  "最近有什么新闻",
  "帮我计算一下",
];

let familyEmbeddings: number[][] | null = null;
let nonFamilyEmbeddings: number[][] | null = null;
let embeddingInitFailed = false;

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

function maxSimilarity(queryVec: number[], exemplarVecs: number[][]): number {
  let max = -1;
  for (const vec of exemplarVecs) {
    const sim = cosineSimilarity(queryVec, vec);
    if (sim > max) max = sim;
  }
  return max;
}

async function ensureExemplarEmbeddings(): Promise<boolean> {
  if (embeddingInitFailed) return false;
  if (familyEmbeddings && nonFamilyEmbeddings) return true;

  const health = getEmbeddingHealthSnapshot();
  if (!health.ok) {
    embeddingInitFailed = true;
    return false;
  }

  try {
    const allTexts = [...FAMILY_EXEMPLARS, ...NON_FAMILY_EXEMPLARS];
    const allVecs: number[][] = [];
    for (const text of allTexts) {
      allVecs.push(await embed(text));
    }
    familyEmbeddings = allVecs.slice(0, FAMILY_EXEMPLARS.length);
    nonFamilyEmbeddings = allVecs.slice(FAMILY_EXEMPLARS.length);
    return true;
  } catch (err) {
    logger.warn("failed to initialize intent exemplar embeddings", {
      error: (err as Error).message,
    });
    embeddingInitFailed = true;
    return false;
  }
}

export type IntentClassification = {
  isFamilyMemory: boolean;
  confidence: "high" | "medium" | "low";
  method: "regex" | "embedding" | "regex+embedding";
};

export async function classifyFamilyMemoryIntent(text: string): Promise<IntentClassification> {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length < 4) {
    return { isFamilyMemory: false, confidence: "high", method: "regex" };
  }

  const matchesFamily = FAMILY_MEMORY_RE.test(trimmed);
  const matchesNonFamily = NON_FAMILY_RE.test(trimmed);

  // Unambiguous: only one regex matches
  if (matchesFamily && !matchesNonFamily) {
    return { isFamilyMemory: true, confidence: "high", method: "regex" };
  }
  if (!matchesFamily && matchesNonFamily) {
    return { isFamilyMemory: false, confidence: "high", method: "regex" };
  }
  if (!matchesFamily && !matchesNonFamily) {
    // Neither regex matches — use embedding if available
    const ready = await ensureExemplarEmbeddings();
    if (!ready || !familyEmbeddings || !nonFamilyEmbeddings) {
      return { isFamilyMemory: false, confidence: "low", method: "regex" };
    }

    try {
      const queryVec = await embed(trimmed);
      const familySim = maxSimilarity(queryVec, familyEmbeddings);
      const nonFamilySim = maxSimilarity(queryVec, nonFamilyEmbeddings);

      // Need meaningful margin to classify as family
      if (familySim > nonFamilySim + 0.08 && familySim >= 0.55) {
        return { isFamilyMemory: true, confidence: "medium", method: "embedding" };
      }
      return { isFamilyMemory: false, confidence: "medium", method: "embedding" };
    } catch {
      return { isFamilyMemory: false, confidence: "low", method: "regex" };
    }
  }

  // Ambiguous: BOTH regexes match — embedding tiebreaker
  const ready = await ensureExemplarEmbeddings();
  if (!ready || !familyEmbeddings || !nonFamilyEmbeddings) {
    // Fallback: NON_FAMILY takes priority (original behavior)
    return { isFamilyMemory: false, confidence: "low", method: "regex" };
  }

  try {
    const queryVec = await embed(trimmed);
    const familySim = maxSimilarity(queryVec, familyEmbeddings);
    const nonFamilySim = maxSimilarity(queryVec, nonFamilyEmbeddings);

    const isFamilyMemory = familySim > nonFamilySim + 0.05;
    return {
      isFamilyMemory,
      confidence: Math.abs(familySim - nonFamilySim) > 0.15 ? "high" : "medium",
      method: "regex+embedding",
    };
  } catch {
    // Embedding failed, fall back to NON_FAMILY priority
    return { isFamilyMemory: false, confidence: "low", method: "regex" };
  }
}

/**
 * Synchronous fast-path check (original behavior, no embedding).
 * Use this when you can't await or embedding is known to be unavailable.
 */
export function isFamilyMemoryQuestionSync(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length < 4) return false;
  if (NON_FAMILY_RE.test(trimmed)) return false;
  return FAMILY_MEMORY_RE.test(trimmed);
}
