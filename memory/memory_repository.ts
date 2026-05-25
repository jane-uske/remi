export interface MemoryEntry {
  key: string;
  value: string;
  importance: number;
  accessCount: number;
  createdAt: number;
  lastAccessedAt: number;
  /** Event time: when the fact became true in the real world. */
  validAt?: number;
  /** Event time: when the fact was superseded by a newer fact. */
  invalidAt?: number;
  /** System time: when we detected the supersedure. */
  expiredAt?: number;
  /** Key of the newer memory that superseded this one. */
  supersededBy?: string;
  /** Attribution: who stated this fact. */
  attributedTo?: "user" | "assistant";
}

export interface UpsertOptions {
  attributedTo?: "user" | "assistant";
  validAt?: number;
}

export interface MemoryRepository {
  upsert(key: string, value: string, importance?: number, options?: UpsertOptions): Promise<void>;
  getAll(): Promise<MemoryEntry[]>;
  getByKey(key: string): Promise<MemoryEntry | null>;
  delete(key: string): Promise<void>;
  touch(key: string): Promise<void>;
  getStale(maxAge: number, minImportance: number): Promise<MemoryEntry[]>;
}
