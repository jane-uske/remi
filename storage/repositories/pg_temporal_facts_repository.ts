// ── M3-P2 bi-temporal 长期事实层 —— PostgreSQL 实现 ────────────
// 复用 storage/database.ts 的 query()。embedding 异步生成（fire-and-forget）。

import type {
  TemporalFact,
  TemporalFactsRepository,
  IngestInput,
  RecallOptions,
} from "./temporal_facts_repository";
import { query } from "../database";
import { generateEmbedding } from "../../llm/embeddings";
import { embeddingToVectorLiteral } from "./vector_utils";
import { createLogger } from "../../infra/logger";

const logger = createLogger("pg-temporal-facts");

function mapRow(row: Record<string, unknown>): TemporalFact {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    subject: row.subject as string,
    predicate: row.predicate as string,
    object: row.object as string,
    tValid: row.t_valid as Date,
    tInvalid: (row.t_invalid as Date) ?? null,
    recordedAt: row.recorded_at as Date,
    salience: Number(row.salience),
    sourceEpisodeId: (row.source_episode_id as string) ?? undefined,
  };
}

export class PgTemporalFactsRepository implements TemporalFactsRepository {
  private readonly userId: string;

  constructor(userId: string) {
    this.userId = userId;
  }

  async ingest(userId: string, fact: IngestInput): Promise<void> {
    const uid = userId || this.userId;
    const now = new Date();
    const tValid = fact.tValid ?? now;

    try {
      // 查找同 subject+predicate 的现行事实
      const existing = await query(
        `SELECT id, object FROM temporal_facts
         WHERE user_id = $1 AND subject = $2 AND predicate = $3 AND t_invalid IS NULL
         LIMIT 1`,
        [uid, fact.subject, fact.predicate],
      );

      if (existing.rows.length > 0) {
        const row = existing.rows[0] as Record<string, unknown>;
        // 同值不重复创建
        if (row.object === fact.object) return;
        // 旧事实失效
        await query(
          `UPDATE temporal_facts SET t_invalid = $1 WHERE id = $2`,
          [now, row.id],
        );
      }

      // 插入新事实
      const res = await query(
        `INSERT INTO temporal_facts (user_id, subject, predicate, object, t_valid, salience, source_episode_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [uid, fact.subject, fact.predicate, fact.object, tValid, fact.salience ?? 0.5, fact.sourceEpisodeId ?? null],
      );

      // Fire-and-forget: 异步生成 embedding
      const id = (res.rows[0] as Record<string, unknown>).id as string;
      void this.storeEmbedding(id, `${fact.subject} ${fact.predicate} ${fact.object}`);
    } catch (err) {
      logger.warn("temporal_facts ingest failed", { error: (err as Error).message });
    }
  }

  private async storeEmbedding(id: string, text: string): Promise<void> {
    try {
      const embedding = await generateEmbedding(text);
      if (embedding) {
        await query(
          `UPDATE temporal_facts SET embedding = $1::vector WHERE id = $2`,
          [embeddingToVectorLiteral(embedding), id],
        );
      }
    } catch (err) {
      logger.debug("temporal_facts embedding skipped", { id, error: (err as Error).message });
    }
  }

  async recall(userId: string, opts?: RecallOptions): Promise<TemporalFact[]> {
    const uid = userId || this.userId;
    const k = opts?.k ?? 10;
    const asOf = opts?.asOf;

    try {
      let sql: string;
      let params: unknown[];

      if (asOf) {
        sql = `SELECT * FROM temporal_facts
               WHERE user_id = $1 AND t_valid <= $2 AND (t_invalid IS NULL OR t_invalid > $2)
               ORDER BY salience DESC LIMIT $3`;
        params = [uid, asOf, k];
      } else {
        sql = `SELECT * FROM temporal_facts
               WHERE user_id = $1 AND t_invalid IS NULL
               ORDER BY salience DESC LIMIT $2`;
        params = [uid, k];
      }

      const res = await query(sql, params);
      return res.rows.map((r) => mapRow(r as Record<string, unknown>));
    } catch (err) {
      logger.warn("temporal_facts recall failed", { error: (err as Error).message });
      return [];
    }
  }

  async history(userId: string, subject: string): Promise<TemporalFact[]> {
    const uid = userId || this.userId;
    try {
      const res = await query(
        `SELECT * FROM temporal_facts
         WHERE user_id = $1 AND subject = $2
         ORDER BY t_valid DESC`,
        [uid, subject],
      );
      return res.rows.map((r) => mapRow(r as Record<string, unknown>));
    } catch (err) {
      logger.warn("temporal_facts history failed", { error: (err as Error).message });
      return [];
    }
  }
}
