import { MemoryRepository, MemoryEntry } from "./memory_repository";
import { createLogger } from "../infra/logger";

const logger = createLogger("memory_decay");

export interface DecayConfig {
  maxMemories: number;
  maxAgeMs: number;
  minImportance: number;
  decayInterval: number;
}

const MS_PER_DAY = 86_400_000;

const DEFAULT_DECAY: DecayConfig = {
  maxMemories: 100,
  maxAgeMs: 7 * MS_PER_DAY,
  minImportance: 0.3,
  decayInterval: 60 * 60 * 1000,
};

function mergeDecayConfig(partial?: Partial<DecayConfig>): DecayConfig {
  return { ...DEFAULT_DECAY, ...partial };
}

export function decayScore(entry: MemoryEntry): number {
  if (entry.invalidAt != null) return 0;

  const now = Date.now();
  const daysSinceAccess = (now - entry.lastAccessedAt) / MS_PER_DAY;
  const recencyFactor = 1 / (1 + daysSinceAccess * 0.1);
  return (
    entry.importance *
    (1 + Math.log(1 + entry.accessCount)) *
    recencyFactor
  );
}

/**
 * Mark an existing fact as superseded by a newer one (Graphiti pattern).
 * The old entry is NOT deleted — it remains queryable for historical context.
 */
export async function supersede(
  repo: MemoryRepository,
  oldKey: string,
  newKey: string,
): Promise<boolean> {
  const old = await repo.getByKey(oldKey);
  if (!old || old.invalidAt != null) return false;

  const now = Date.now();
  const updated: MemoryEntry = {
    ...old,
    invalidAt: now,
    expiredAt: now,
    supersededBy: newKey,
  };
  await repo.upsert(updated.key, updated.value, updated.importance);
  logger.info("记忆被取代", { oldKey, newKey });
  return true;
}

export async function runDecay(
  repo: MemoryRepository,
  config?: Partial<DecayConfig>,
): Promise<number> {
  const merged = mergeDecayConfig(config);

  const entries = await repo.getAll();
  const scored = entries.map((entry) => ({
    entry,
    score: decayScore(entry),
  }));

  const now = Date.now();
  const toRemove = new Set<string>();

  // 超龄 + 低重要度的记忆直接淘汰
  for (const { entry } of scored) {
    if (
      now - entry.lastAccessedAt > merged.maxAgeMs &&
      entry.importance < merged.minImportance
    ) {
      toRemove.add(entry.key);
    }
  }

  if (scored.length > merged.maxMemories) {
    const sorted = [...scored].sort((a, b) => a.score - b.score);
    const excess = scored.length - merged.maxMemories;
    for (let i = 0; i < excess; i++) {
      const item = sorted[i];
      if (item) {
        toRemove.add(item.entry.key);
      }
    }
  }

  for (const { entry, score } of scored) {
    if (score < 0.1) {
      toRemove.add(entry.key);
    }
  }

  for (const key of toRemove) {
    await repo.delete(key);
    logger.info("移除记忆", { key });
  }

  return toRemove.size;
}

export function startDecayTimer(
  repo: MemoryRepository,
  config?: Partial<DecayConfig>,
): NodeJS.Timeout {
  const merged = mergeDecayConfig(config);
  return setInterval(() => {
    void runDecay(repo, merged);
  }, merged.decayInterval);
}

export function stopDecayTimer(timer: NodeJS.Timeout): void {
  clearInterval(timer);
}
