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
  /**
   * 覆盖新建条目的首次入库时间（epoch ms）。仅用于从别处搬运既有记忆时
   * 保留原始记录日期（如 session overlay 从持久层水合到本地副本），不传时
   * 按正常新建逻辑取当前时间。对已存在的 key 更新时不生效（不改写历史）。
   */
  createdAt?: number;
}

export interface MemoryRepository {
  upsert(key: string, value: string, importance?: number, options?: UpsertOptions): Promise<void>;
  getAll(): Promise<MemoryEntry[]>;
  getByKey(key: string): Promise<MemoryEntry | null>;
  delete(key: string): Promise<void>;
  touch(key: string): Promise<void>;
  getStale(maxAge: number, minImportance: number): Promise<MemoryEntry[]>;
}
