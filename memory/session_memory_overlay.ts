import { createLogger } from "../infra/logger";
import { getConfig } from "../server/config";
import { isSystemMemoryKey } from "./relationship_state";
import type { MemoryEntry, MemoryRepository } from "./memory_repository";
import { InMemoryRepository } from "./memory_store";

const logger = createLogger("session-memory-overlay");

export function persistentMemoryOverlayEnabled(): boolean {
  return getConfig().REMI_PERSISTENT_MEMORY_OVERLAY_ENABLED;
}

export function persistentMemoryPreloadLimit(): number {
  return getConfig().REMI_PERSISTENT_MEMORY_PRELOAD_LIMIT;
}

export class SessionMemoryOverlayRepository implements MemoryRepository {
  private readonly local = new InMemoryRepository();
  private persistent: MemoryRepository | null = null;
  private hydratePromise: Promise<void> | null = null;

  attachPersistent(repo: MemoryRepository): void {
    this.persistent = repo;
  }

  hasPersistentBackend(): boolean {
    return this.persistent !== null;
  }

  getPersistentBackend(): MemoryRepository | null {
    return this.persistent;
  }

  async hydrateFromPersistent(limit: number): Promise<void> {
    if (!this.persistent || limit <= 0) return;
    if (this.hydratePromise) {
      return this.hydratePromise;
    }

    this.hydratePromise = (async () => {
      const entries = await this.persistent!.getAll();
      const selected = [...entries]
        .filter((entry) => !isSystemMemoryKey(entry.key))
        .sort((a, b) => {
          if (b.lastAccessedAt !== a.lastAccessedAt) {
            return b.lastAccessedAt - a.lastAccessedAt;
          }
          return b.createdAt - a.createdAt;
        })
        .slice(0, limit);

      for (const entry of selected) {
        await this.local.upsert(entry.key, entry.value, entry.importance);
      }
    })()
      .catch((err) => {
        logger.warn("持久记忆预加载失败，降级为本地会话记忆", {
          error: (err as Error).message,
        });
      })
      .finally(() => {
        this.hydratePromise = null;
      });

    return this.hydratePromise;
  }

  private mirrorPersistent(
    opName: string,
    run: (repo: MemoryRepository) => Promise<void>,
  ): void {
    if (!this.persistent) return;
    void run(this.persistent).catch((err) => {
      logger.warn(`持久记忆${opName}失败，本地副本已保留`, {
        error: (err as Error).message,
      });
    });
  }

  async upsert(key: string, value: string, importance?: number): Promise<void> {
    await this.local.upsert(key, value, importance);
    this.mirrorPersistent("写回", (repo) => repo.upsert(key, value, importance));
  }

  async getAll(): Promise<MemoryEntry[]> {
    return this.local.getAll();
  }

  async getByKey(key: string): Promise<MemoryEntry | null> {
    return this.local.getByKey(key);
  }

  async delete(key: string): Promise<void> {
    await this.local.delete(key);
    this.mirrorPersistent("删除", (repo) => repo.delete(key));
  }

  async touch(key: string): Promise<void> {
    await this.local.touch(key);
    this.mirrorPersistent("touch", (repo) => repo.touch(key));
  }

  async getStale(maxAge: number, minImportance: number): Promise<MemoryEntry[]> {
    return this.local.getStale(maxAge, minImportance);
  }

  async clearLocal(): Promise<void> {
    const entries = await this.local.getAll();
    await Promise.all(entries.map((entry) => this.local.delete(entry.key)));
  }

  async clearAll(includePersistent: boolean = false): Promise<void> {
    const localEntries = await this.local.getAll();
    await Promise.all(localEntries.map((entry) => this.local.delete(entry.key)));
    if (!includePersistent || !this.persistent) return;
    const persistentEntries = await this.persistent.getAll();
    await Promise.all(
      persistentEntries
        .filter((entry) => isSystemMemoryKey(entry.key))
        .map((entry) => this.persistent!.delete(entry.key)),
    );
  }
}
