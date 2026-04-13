import OpenAI from "openai";
import { createLogger } from "../infra/logger";

const logger = createLogger("embeddings");
const EXPECTED_EMBEDDING_DIMENSIONS = 768;

let client: OpenAI | null = null;

function embeddingConfig(): {
  apiKey: string;
  baseURL: string;
  model: string;
} | null {
  const apiKey =
    process.env.REM_EMBEDDING_API_KEY?.trim() ||
    process.env.EMBEDDING_API_KEY?.trim() ||
    process.env.key?.trim() ||
    "";
  const baseURL =
    process.env.REM_EMBEDDING_BASE_URL?.trim() ||
    process.env.EMBEDDING_BASE_URL?.trim() ||
    process.env.base_url?.trim() ||
    "";
  const model =
    process.env.REM_EMBEDDING_MODEL?.trim() ||
    process.env.EMBEDDING_MODEL?.trim() ||
    "";

  if (!apiKey || !baseURL || !model) return null;
  return { apiKey, baseURL, model };
}

function getClient(): OpenAI | null {
  if (client) return client;
  const config = embeddingConfig();
  if (!config) return null;
  const { apiKey, baseURL } = config;
  client = new OpenAI({ apiKey, baseURL });
  return client;
}

export function embeddingEnabled(): boolean {
  return Boolean(embeddingConfig());
}

/**
 * Generate a dense embedding vector for the given text.
 * Returns null when embedding is not configured or the API call fails.
 * Callers should treat null as "fall back to keyword recall".
 */
export async function generateEmbedding(text: string): Promise<number[] | null> {
  if (!embeddingEnabled()) return null;
  const model = embeddingConfig()!.model;
  const openai = getClient();
  if (!openai) return null;

  try {
    const res = await openai.embeddings.create({
      model,
      input: text.slice(0, 8192),
      dimensions: EXPECTED_EMBEDDING_DIMENSIONS,
    });
    const embedding = res.data[0]?.embedding ?? null;
    if (!embedding) return null;
    if (embedding.length !== EXPECTED_EMBEDDING_DIMENSIONS) {
      logger.warn("[Embedding] 维度不匹配，降级为关键词召回", {
        expected: EXPECTED_EMBEDDING_DIMENSIONS,
        actual: embedding.length,
        model,
      });
      return null;
    }
    return embedding;
  } catch (err) {
    logger.warn("[Embedding] 生成失败，降级为关键词召回", {
      error: (err as Error).message,
    });
    return null;
  }
}
