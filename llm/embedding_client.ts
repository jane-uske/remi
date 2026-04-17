export const EMBEDDING_DIMENSIONS = 768;

type EmbeddingConfig = {
  apiKey: string;
  baseURL: string;
  model: string;
};

export type EmbeddingHealthSnapshot = {
  ok: boolean;
  configured: boolean;
  reachable: boolean;
  dimensionsOk: boolean;
  status:
    | "ok"
    | "config_missing"
    | "request_failed"
    | "invalid_payload";
  detail: string;
  baseURL: string | null;
  model: string | null;
};

function getEmbeddingConfig(): EmbeddingConfig {
  const baseURL =
    process.env.REMI_EMBEDDING_BASE_URL?.trim() ||
    process.env.REM_EMBEDDING_BASE_URL?.trim() ||
    process.env.EMBEDDING_BASE_URL?.trim() ||
    process.env.base_url?.trim();
  const apiKey =
    process.env.REMI_EMBEDDING_API_KEY?.trim() ||
    process.env.REM_EMBEDDING_API_KEY?.trim() ||
    process.env.EMBEDDING_API_KEY?.trim() ||
    process.env.key?.trim();
  const model =
    process.env.REMI_EMBEDDING_MODEL?.trim() ||
    process.env.REM_EMBEDDING_MODEL?.trim() ||
    process.env.EMBEDDING_MODEL?.trim() ||
    "nomic-embed-text";

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

export function getEmbeddingHealthSnapshot(): EmbeddingHealthSnapshot {
  const baseURL =
    process.env.REMI_EMBEDDING_BASE_URL?.trim() ||
    process.env.REM_EMBEDDING_BASE_URL?.trim() ||
    process.env.EMBEDDING_BASE_URL?.trim() ||
    process.env.base_url?.trim() ||
    null;
  const apiKey =
    process.env.REMI_EMBEDDING_API_KEY?.trim() ||
    process.env.REM_EMBEDDING_API_KEY?.trim() ||
    process.env.EMBEDDING_API_KEY?.trim() ||
    process.env.key?.trim() ||
    null;
  const model =
    process.env.REMI_EMBEDDING_MODEL?.trim() ||
    process.env.REM_EMBEDDING_MODEL?.trim() ||
    process.env.EMBEDDING_MODEL?.trim() ||
    "nomic-embed-text";

  if (!baseURL) {
    return {
      ok: false,
      configured: false,
      reachable: false,
      dimensionsOk: false,
      status: "config_missing",
      detail: "missing REMI_EMBEDDING_BASE_URL",
      baseURL: null,
      model,
    };
  }

  if (!apiKey) {
    return {
      ok: false,
      configured: false,
      reachable: false,
      dimensionsOk: false,
      status: "config_missing",
      detail: "missing REMI_EMBEDDING_API_KEY",
      baseURL,
      model,
    };
  }

  return {
    ok: true,
    configured: true,
    reachable: false,
    dimensionsOk: false,
    status: "ok",
    detail: "configured",
    baseURL,
    model,
  };
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

export async function checkEmbeddingHealth(): Promise<EmbeddingHealthSnapshot> {
  const snapshot = getEmbeddingHealthSnapshot();
  if (!snapshot.ok || !snapshot.baseURL || !snapshot.model) {
    return snapshot;
  }

  try {
    const embedding = await embed("__remi_embedding_healthcheck__");
    return {
      ok: true,
      configured: true,
      reachable: true,
      dimensionsOk: embedding.length === EMBEDDING_DIMENSIONS,
      status: "ok",
      detail: `reachable (${embedding.length} dims)`,
      baseURL: snapshot.baseURL,
      model: snapshot.model,
    };
  } catch (err) {
    const detail = (err as Error).message || "embedding health check failed";
    const invalidPayload =
      detail.includes("invalid embedding payload") ||
      detail.includes("dimensions");
    return {
      ok: false,
      configured: true,
      reachable: !invalidPayload,
      dimensionsOk: false,
      status: invalidPayload ? "invalid_payload" : "request_failed",
      detail,
      baseURL: snapshot.baseURL,
      model: snapshot.model,
    };
  }
}

export function classifyEmbeddingError(err: unknown): EmbeddingHealthSnapshot["status"] {
  const message = (err as Error)?.message ?? "";
  if (message.includes("missing REMI_EMBEDDING_")) return "config_missing";
  if (message.includes("invalid embedding payload") || message.includes("dimensions")) {
    return "invalid_payload";
  }
  return "request_failed";
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  const embeddings: number[][] = [];
  for (const text of texts) {
    embeddings.push(await embed(text));
  }
  return embeddings;
}
