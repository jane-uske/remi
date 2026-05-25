import type { MemoryEntry, MemoryRepository, UpsertOptions } from "../../memory/memory_repository";
import {
  upsertMemory,
  getUserMemories,
  getMemoryByKey,
  touchMemory,
  deleteMemoryByKey,
  findSimilarMemories,
  updateMemoryEmbedding,
} from "./memory_repository";
import { createLogger } from "../../infra/logger";
import { generateEmbedding } from "../../llm/embeddings";

const logger = createLogger("pg-memory-repo");

export class PgMemoryRepository implements MemoryRepository {
  private readonly _userId: string;

  constructor(userId: string = "dev") {
    this._userId = userId;
  }

  get userId(): string {
    return this._userId;
  }

  async upsert(key: string, value: string, _importance?: number, _options?: UpsertOptions): Promise<void> {
    try {
      const row = await upsertMemory(this._userId, key, value);
      logger.debug("[Memory] upserted", { key, value: value.slice(0, 50) });
      // Fire-and-forget: generate and store embedding without blocking the caller.
      if (row.embedding === null) {
        void this._storeEmbedding(row.id, `${key}: ${value}`);
      }
    } catch (err) {
      logger.warn("[Memory] upsert failed", { key, error: err });
      throw err;
    }
  }

  private async _storeEmbedding(id: string, text: string): Promise<void> {
    try {
      const embedding = await generateEmbedding(text);
      if (embedding) {
        await updateMemoryEmbedding(id, embedding);
        logger.debug("[Memory] embedding stored", { id });
      }
    } catch (err) {
      logger.warn("[Memory] embedding generation skipped", {
        id,
        error: (err as Error).message,
      });
    }
  }

  /**
   * Semantic nearest-neighbour search via pgvector.
   * Returns up to topK entries ordered by cosine distance to queryText.
   * Returns [] when embedding is disabled or on any error.
   */
  async findSimilar(queryText: string, topK: number): Promise<MemoryEntry[]> {
    try {
      const embedding = await generateEmbedding(queryText);
      if (!embedding) return [];
      const rows = await findSimilarMemories(this._userId, embedding, topK);
      return rows.map((m) => ({
        key: m.key,
        value: m.value,
        importance: m.importance,
        accessCount: 0,
        createdAt: m.created_at.getTime(),
        lastAccessedAt: m.last_accessed_at.getTime(),
      }));
    } catch (err) {
      logger.warn("[Memory] findSimilar failed", { error: (err as Error).message });
      return [];
    }
  }

  async getAll(): Promise<MemoryEntry[]> {
    try {
      const rows = await getUserMemories(this._userId);
      return rows.map((m) => ({
        key: m.key,
        value: m.value,
        importance: m.importance,
        accessCount: 0,
        createdAt: m.created_at.getTime(),
        lastAccessedAt: m.last_accessed_at.getTime(),
      }));
    } catch (err) {
      logger.warn("[Memory] getAll failed", { error: err });
      throw err;
    }
  }

  async getByKey(key: string): Promise<MemoryEntry | null> {
    try {
      const row = await getMemoryByKey(this._userId, key);
      if (!row) return null;
      return {
        key: row.key,
        value: row.value,
        importance: row.importance,
        accessCount: 0,
        createdAt: row.created_at.getTime(),
        lastAccessedAt: row.last_accessed_at.getTime(),
      };
    } catch (err) {
      logger.warn("[Memory] getByKey failed", { key, error: err });
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await deleteMemoryByKey(this._userId, key);
      logger.debug("[Memory] deleted", { key });
    } catch (err) {
      logger.warn("[Memory] delete failed", { key, error: err });
      throw err;
    }
  }

  async touch(key: string): Promise<void> {
    try {
      const row = await getMemoryByKey(this._userId, key);
      if (row) {
        await touchMemory(row.id);
        logger.debug("[Memory] touched", { key });
      }
    } catch (err) {
      logger.warn("[Memory] touch failed", { key, error: err });
      throw err;
    }
  }

  async getStale(maxAge: number, minImportance: number): Promise<MemoryEntry[]> {
    try {
      const all = await this.getAll();
      const now = Date.now();
      return all.filter(
        (e) => now - e.lastAccessedAt > maxAge && e.importance < minImportance,
      );
    } catch (err) {
      logger.warn("[Memory] getStale failed", { error: err });
      throw err;
    }
  }
}

let pgRepoInstance: PgMemoryRepository | null = null;

export function getPgMemoryRepository(userId: string = "dev"): PgMemoryRepository {
  if (!pgRepoInstance || pgRepoInstance.userId !== userId) {
    pgRepoInstance = new PgMemoryRepository(userId);
  }
  return pgRepoInstance;
}
