export const EMBEDDING_DIMENSIONS = 768;

function getEmbeddingConfig(): {
  apiKey: string;
  baseURL: string;
  model: string;
} {
  const baseURL = process.env.REMI_EMBEDDING_BASE_URL?.trim();
  const apiKey = process.env.REMI_EMBEDDING_API_KEY?.trim();
  const model = process.env.REMI_EMBEDDING_MODEL?.trim() || "nomic-embed-text";

  if (!baseURL) {
    throw new Error(
      "Embedding client is not configured: missing REMI_EMBEDDING_BASE_URL",
    );
  }
  if (!apiKey) {
    throw new Error(
      "Embedding client is not configured: missing REMI_EMBEDDING_API_KEY",
    );
  }

  return { apiKey, baseURL, model };
}

function buildEmbeddingsUrl(baseURL: string): string {
  return `${baseURL.replace(/\/$/, "")}/embeddings`;
}

function extractEmbedding(responseBody: unknown): number[] {
  const data = (responseBody as { data?: Array<{ embedding?: unknown }> })
    ?.data;
  const embedding = data?.[0]?.embedding;
  if (
    !Array.isArray(embedding) ||
    embedding.some((value) => typeof value !== "number")
  ) {
    throw new Error("Embedding client returned an invalid embedding payload");
  }
  if (embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Embedding client returned ${embedding.length} dimensions, expected ${EMBEDDING_DIMENSIONS}`,
    );
  }
  return embedding;
}

export async function embed(text: string): Promise<number[]> {
  const { apiKey, baseURL, model } = getEmbeddingConfig();
  const response = await fetch(buildEmbeddingsUrl(baseURL), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: text,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Embedding client request failed with ${response.status}: ${body.slice(0, 200)}`,
    );
  }

  const payload = await response.json();
  return extractEmbedding(payload);
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  const embeddings: number[][] = [];
  for (const text of texts) {
    embeddings.push(await embed(text));
  }
  return embeddings;
}
