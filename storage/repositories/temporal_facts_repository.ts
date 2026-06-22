// ── M3-P2 bi-temporal 长期事实层 —— 接口定义 ──────────────────
// 事实有双时间轴：t_valid（现实何时成立）+ t_invalid（何时失效）。
// 过期事实置为失效不删除，支持"上个月你还在…"这类回溯。
// 设计见 docs/design/MEMORY_V3_DESIGN.md §5。

export interface TemporalFact {
  id: string;
  userId: string;
  subject: string;     // 实体，如 "用户的工作"
  predicate: string;   // 关系，如 "状态"
  object: string;      // 值，如 "在还债" / "已还清"
  tValid: Date;        // 现实中何时开始成立
  tInvalid: Date | null; // 何时失效（null = 仍成立）
  recordedAt: Date;    // 何时被记下
  salience: number;
  sourceEpisodeId?: string;
}

export interface IngestInput {
  subject: string;
  predicate: string;
  object: string;
  tValid?: Date;       // 默认 now()
  salience?: number;
  sourceEpisodeId?: string;
}

export interface RecallOptions {
  /** 语义查询文本（可选，用于向量召回） */
  query?: string;
  /** 最多返回几条 */
  k?: number;
  /** 回溯到某个时间点（默认 = 只取仍成立的） */
  asOf?: Date;
}

export interface TemporalFactsRepository {
  /**
   * 写入事实。语义撞到同 subject+predicate 的现行事实 → 旧行 t_invalid=now，插新行。
   * 同值不重复创建。
   */
  ingest(userId: string, fact: IngestInput): Promise<void>;

  /**
   * 召回现行事实。默认 asOf=now → WHERE t_invalid IS NULL。
   * 传历史时刻可回溯。
   */
  recall(userId: string, opts?: RecallOptions): Promise<TemporalFact[]>;

  /**
   * 回溯某 subject 的历史值（按 t_valid DESC）。
   */
  history(userId: string, subject: string): Promise<TemporalFact[]>;
}
