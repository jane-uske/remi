// ── M3-P2 bi-temporal 长期事实层 —— 内存 fallback ─────────────
// 无 DATABASE_URL 时使用。数组存储 + filter 模拟。会话重启丢失。

import type {
  TemporalFact,
  TemporalFactsRepository,
  IngestInput,
  RecallOptions,
} from "./temporal_facts_repository";
import { randomUUID } from "crypto";

export class InMemoryTemporalFactsRepository implements TemporalFactsRepository {
  private facts: TemporalFact[] = [];

  async ingest(userId: string, fact: IngestInput): Promise<void> {
    const now = new Date();
    const tValid = fact.tValid ?? now;

    // 查找同 subject+predicate 的现行事实
    const existing = this.facts.find(
      (f) =>
        f.userId === userId &&
        f.subject === fact.subject &&
        f.predicate === fact.predicate &&
        f.tInvalid === null,
    );

    if (existing) {
      // 同值不重复创建
      if (existing.object === fact.object) return;
      // 旧事实失效
      existing.tInvalid = now;
    }

    this.facts.push({
      id: randomUUID(),
      userId,
      subject: fact.subject,
      predicate: fact.predicate,
      object: fact.object,
      tValid,
      tInvalid: null,
      recordedAt: now,
      salience: fact.salience ?? 0.5,
      sourceEpisodeId: fact.sourceEpisodeId,
    });
  }

  async recall(userId: string, opts?: RecallOptions): Promise<TemporalFact[]> {
    const k = opts?.k ?? 10;
    const asOf = opts?.asOf;

    let results: TemporalFact[];
    if (asOf) {
      // 回溯到某时刻：t_valid <= asOf AND (t_invalid IS NULL OR t_invalid > asOf)
      results = this.facts.filter(
        (f) =>
          f.userId === userId &&
          f.tValid <= asOf &&
          (f.tInvalid === null || f.tInvalid > asOf),
      );
    } else {
      // 默认只取仍成立的
      results = this.facts.filter(
        (f) => f.userId === userId && f.tInvalid === null,
      );
    }

    // 按 salience DESC 排序，取 top k
    return results
      .sort((a, b) => b.salience - a.salience)
      .slice(0, k);
  }

  async history(userId: string, subject: string): Promise<TemporalFact[]> {
    return this.facts
      .filter((f) => f.userId === userId && f.subject === subject)
      .sort((a, b) => b.tValid.getTime() - a.tValid.getTime());
  }
}
