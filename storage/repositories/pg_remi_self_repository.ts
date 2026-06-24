// ── DL-P1b RemiSelf 持久层 —— PostgreSQL 实现 ────────────────────────
// 复用 storage/database.ts 的 query()。每用户单行（user_id 主键），save = upsert。
// 失败只 warn 并返回 null / 静默 —— DB 不可用时调用方走默认，不报错。

import type { RemiSelfRepository } from "./remi_self_repository";
import type { RemiSelfRecord } from "../../memory/remi_self";
import type { EnergyLevel } from "../../persona";
import { query } from "../database";
import { createLogger } from "../../infra/logger";

const logger = createLogger("pg-remi-self");

function normalizeEnergy(value: unknown): EnergyLevel {
  return value === "low" || value === "high" ? value : "medium";
}

function mapRow(row: Record<string, unknown>): RemiSelfRecord {
  return {
    mood: typeof row.mood === "string" && row.mood ? (row.mood as string) : "平静",
    energy: normalizeEnergy(row.energy),
    currentFocus: (row.current_focus as string) ?? null,
    topicPull: typeof row.topic_pull === "string" ? (row.topic_pull as string) : "",
    lastSeenAt: row.last_seen_at as Date,
    lastSavedAt: row.last_saved_at as Date,
  };
}

export class PgRemiSelfRepository implements RemiSelfRepository {
  async load(userId: string): Promise<RemiSelfRecord | null> {
    try {
      const res = await query(
        `SELECT mood, energy, current_focus, topic_pull, last_seen_at, last_saved_at
         FROM remi_self WHERE user_id = $1 LIMIT 1`,
        [userId],
      );
      if (res.rows.length === 0) return null;
      return mapRow(res.rows[0] as Record<string, unknown>);
    } catch (err) {
      logger.warn("remi_self load failed", { error: (err as Error).message });
      return null;
    }
  }

  async save(userId: string, rec: RemiSelfRecord): Promise<void> {
    try {
      await query(
        `INSERT INTO remi_self
           (user_id, mood, energy, current_focus, topic_pull, last_seen_at, last_saved_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (user_id) DO UPDATE SET
           mood = EXCLUDED.mood,
           energy = EXCLUDED.energy,
           current_focus = EXCLUDED.current_focus,
           topic_pull = EXCLUDED.topic_pull,
           last_seen_at = EXCLUDED.last_seen_at,
           last_saved_at = EXCLUDED.last_saved_at`,
        [
          userId,
          rec.mood,
          rec.energy,
          rec.currentFocus,
          rec.topicPull,
          rec.lastSeenAt,
          rec.lastSavedAt,
        ],
      );
    } catch (err) {
      logger.warn("remi_self save failed", { error: (err as Error).message });
    }
  }
}
