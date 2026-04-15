import { createLogger } from "../infra/logger";
import { embed } from "./embedding_client";

const logger = createLogger("embeddings");
const EXPECTED_EMBEDDING_DIMENSIONS = 768;

function embeddingConfig(): {
  apiKey: string;
  baseURL: string;
  model: string;
} | null {
  const apiKey =
    process.env.REMI_EMBEDDING_API_KEY?.trim() ||
    process.env.REM_EMBEDDING_API_KEY?.trim() ||
    process.env.EMBEDDING_API_KEY?.trim() ||
    process.env.key?.trim() ||
    "";
  const baseURL =
    process.env.REMI_EMBEDDING_BASE_URL?.trim() ||
    process.env.REM_EMBEDDING_BASE_URL?.trim() ||
    process.env.EMBEDDING_BASE_URL?.trim() ||
    process.env.base_url?.trim() ||
    "";
  const model =
    process.env.REMI_EMBEDDING_MODEL?.trim() ||
    process.env.REM_EMBEDDING_MODEL?.trim() ||
    process.env.EMBEDDING_MODEL?.trim() ||
    "";

  if (!apiKey || !baseURL || !model) return null;
  return { apiKey, baseURL, model };
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

  try {
    return await embed(text.slice(0, 8192));
  } catch (err) {
    logger.warn("[Embedding] 生成失败，降级为关键词召回", {
      error: (err as Error).message,
      expected: EXPECTED_EMBEDDING_DIMENSIONS,
      model: embeddingConfig()?.model,
    });
    return null;
  }
}
