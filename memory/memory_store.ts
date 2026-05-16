import {
  MemoryEntry,
  MemoryRepository,
} from "./memory_repository";
import { createLogger } from "../infra/logger";

const logger = createLogger("memory_store");

export interface Memory {
  key: string;
  value: string;
}

export class InMemoryRepository implements MemoryRepository {
  private entries: MemoryEntry[] = [];

  snapshotMemories(): Memory[] {
    return this.entries.map(({ key, value }) => ({ key, value }));
  }

  async upsert(key: string, value: string, importance?: number): Promise<void> {
    const now = Date.now();
    const existing = this.entries.find((e) => e.key === key);
    if (existing) {
      existing.value = value;
      existing.lastAccessedAt = now;
      if (importance !== undefined) {
        existing.importance = importance;
      }
    } else {
      this.entries.push({
        key,
        value,
        importance: importance ?? 0.5,
        accessCount: 0,
        createdAt: now,
        lastAccessedAt: now,
      });
    }
  }

  async getAll(): Promise<MemoryEntry[]> {
    return this.entries.map((e) => ({ ...e }));
  }

  async getByKey(key: string): Promise<MemoryEntry | null> {
    const found = this.entries.find((e) => e.key === key);
    return found ? { ...found } : null;
  }

  async delete(key: string): Promise<void> {
    this.entries = this.entries.filter((e) => e.key !== key);
  }

  async touch(key: string): Promise<void> {
    const entry = this.entries.find((e) => e.key === key);
    if (entry) {
      entry.lastAccessedAt = Date.now();
    }
  }

  async getStale(maxAge: number, minImportance: number): Promise<MemoryEntry[]> {
    const now = Date.now();
    return this.entries
      .filter(
        (e) =>
          now - e.lastAccessedAt > maxAge && e.importance < minImportance,
      )
      .map((e) => ({ ...e }));
  }
}

const defaultRepo = new InMemoryRepository();
let repository: MemoryRepository = defaultRepo;
let currentInMemoryRepo: InMemoryRepository | null = defaultRepo;

if (process.env.NODE_ENV !== "test" && !process.env.DATABASE_URL) {
  logger.warn("InMemoryRepository is volatile — user facts will be lost on restart. Set DATABASE_URL for persistence.");
}

export function getMemoryRepository(): MemoryRepository {
  return repository;
}

export function setMemoryRepository(newRepo: MemoryRepository): void {
  repository = newRepo;
  if (newRepo instanceof InMemoryRepository) {
    currentInMemoryRepo = newRepo;
  } else {
    currentInMemoryRepo = null;
  }
}

export function addMemory(key: string, value: string): void {
  void repository.upsert(key, value);
}

export function getAllMemoriesSync(): Memory[] {
  if (currentInMemoryRepo) {
    return currentInMemoryRepo.snapshotMemories();
  }
  return [];
}

export async function getAllMemories(): Promise<Memory[]> {
  if (currentInMemoryRepo) {
    return currentInMemoryRepo.snapshotMemories();
  }
  const entries = await repository.getAll();
  return entries.map(({ key, value }) => ({ key, value }));
}