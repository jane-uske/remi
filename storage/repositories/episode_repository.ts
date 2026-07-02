import { query } from '../database';
import {
  embeddingToVectorLiteral,
  parseEmbedding,
} from './vector_utils';

export interface DbEpisode {
  id: string;
  user_id: string;
  title: string;
  summary: string;
  topics: string[];
  mood: string;
  kind: string;
  salience: number;
  recurrence_count: number;
  unresolved: boolean;
  first_seen_at: Date;
  last_seen_at: Date;
  last_referenced_at: Date | null;
  centroid_embedding: number[];
  origin_moment_summaries: string[];
  relationship_weight: number;
  status: string;
  v3_domain: string | null;
  v3_pressure_source: string | null;
  v3_relational_impact: string | null;
  v3_user_stance: string | null;
  v3_unresolved_level: number | null;
  v3_event_summary: string | null;
  v3_evidence_turns: string[];
  v3_last_user_position: string | null;
}

function mapRow(row: Record<string, unknown>): DbEpisode {
  return {
    id: row.id as string,
    user_id: row.user_id as string,
    title: row.title as string,
    summary: row.summary as string,
    topics: (row.topics as string[]) ?? [],
    mood: row.mood as string,
    kind: row.kind as string,
    salience: Number(row.salience),
    recurrence_count: Number(row.recurrence_count),
    unresolved: Boolean(row.unresolved),
    first_seen_at: row.first_seen_at as Date,
    last_seen_at: row.last_seen_at as Date,
    last_referenced_at: (row.last_referenced_at as Date | null) ?? null,
    centroid_embedding: parseEmbedding(row.centroid_embedding) ?? [],
    origin_moment_summaries: (row.origin_moment_summaries as string[]) ?? [],
    relationship_weight: Number(row.relationship_weight),
    status: row.status as string,
    v3_domain: (row.v3_domain as string | null) ?? null,
    v3_pressure_source: (row.v3_pressure_source as string | null) ?? null,
    v3_relational_impact: (row.v3_relational_impact as string | null) ?? null,
    v3_user_stance: (row.v3_user_stance as string | null) ?? null,
    v3_unresolved_level:
      row.v3_unresolved_level === null || row.v3_unresolved_level === undefined
        ? null
        : Number(row.v3_unresolved_level),
    v3_event_summary: (row.v3_event_summary as string | null) ?? null,
    v3_evidence_turns: (row.v3_evidence_turns as string[]) ?? [],
    v3_last_user_position: (row.v3_last_user_position as string | null) ?? null,
  };
}

const EPISODE_COLUMNS = `id, user_id, title, summary, topics, mood, kind, salience, recurrence_count,
  unresolved, first_seen_at, last_seen_at, last_referenced_at, centroid_embedding,
  origin_moment_summaries, relationship_weight, status,
  v3_domain, v3_pressure_source, v3_relational_impact, v3_user_stance,
  v3_unresolved_level, v3_event_summary, v3_evidence_turns, v3_last_user_position`;

export async function insertEpisode(params: {
  userId: string;
  title: string;
  summary: string;
  topics: string[];
  mood: string;
  kind: string;
  salience: number;
  unresolved: boolean;
  status?: string;
  centroidEmbedding: number[];
  originMomentSummaries: string[];
  relationshipWeight: number;
  v3Domain?: string;
  v3PressureSource?: string;
  v3RelationalImpact?: string;
  v3UserStance?: string;
  v3UnresolvedLevel?: number;
  v3EventSummary?: string;
  v3EvidenceTurns?: string[];
  v3LastUserPosition?: string;
  /**
   * 离线回填用：覆盖 episode 的首见/末见时间为历史消息的真实时间。
   * 不传时保持原行为（数据库 now()）。运行时写路径不应传这两个字段。
   */
  firstSeenAt?: Date;
  lastSeenAt?: Date;
}): Promise<DbEpisode> {
  try {
    const res = await query(
      `INSERT INTO episodes (
         user_id,
         title,
         summary,
         topics,
         mood,
         kind,
         salience,
         unresolved,
         status,
         centroid_embedding,
         origin_moment_summaries,
         relationship_weight,
         v3_domain,
         v3_pressure_source,
         v3_relational_impact,
         v3_user_stance,
         v3_unresolved_level,
         v3_event_summary,
         v3_evidence_turns,
         v3_last_user_position,
         first_seen_at,
         last_seen_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::vector, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
               COALESCE($21::timestamptz, now()), COALESCE($22::timestamptz, now()))
       RETURNING ${EPISODE_COLUMNS}`,
      [
        params.userId,
        params.title,
        params.summary,
        params.topics,
        params.mood,
        params.kind,
        params.salience,
        params.unresolved,
        params.status ?? (params.unresolved ? "active" : "cooling"),
        embeddingToVectorLiteral(params.centroidEmbedding),
        params.originMomentSummaries,
        params.relationshipWeight,
        params.v3Domain ?? null,
        params.v3PressureSource ?? null,
        params.v3RelationalImpact ?? null,
        params.v3UserStance ?? null,
        params.v3UnresolvedLevel ?? null,
        params.v3EventSummary ?? null,
        params.v3EvidenceTurns ?? [],
        params.v3LastUserPosition ?? null,
        params.firstSeenAt ?? null,
        params.lastSeenAt ?? null,
      ]
    );
    return mapRow(res.rows[0] as Record<string, unknown>);
  } catch (e) {
    console.log('[Storage] insertEpisode failed:', e);
    throw e;
  }
}

export async function updateEpisode(
  id: string,
  params: {
    summary?: string;
    topics?: string[];
    mood?: string;
    salience?: number;
    recurrenceCount?: number;
    unresolved?: boolean;
    /** 离线回填用：合并时把首见时间向更早的历史时间回拨。运行时路径不应传。 */
    firstSeenAt?: Date;
    lastSeenAt?: Date;
    lastReferencedAt?: Date;
    centroidEmbedding?: number[];
    originMomentSummaries?: string[];
    relationshipWeight?: number;
    status?: string;
    v3Domain?: string | null;
    v3PressureSource?: string | null;
    v3RelationalImpact?: string | null;
    v3UserStance?: string | null;
    v3UnresolvedLevel?: number | null;
    v3EventSummary?: string | null;
    v3EvidenceTurns?: string[];
    v3LastUserPosition?: string | null;
  }
): Promise<DbEpisode | null> {
  try {
    const updates: string[] = [];
    const values: unknown[] = [];

    if (params.summary !== undefined) {
      values.push(params.summary);
      updates.push(`summary = $${values.length}`);
    }
    if (params.topics !== undefined) {
      values.push(params.topics);
      updates.push(`topics = $${values.length}`);
    }
    if (params.mood !== undefined) {
      values.push(params.mood);
      updates.push(`mood = $${values.length}`);
    }
    if (params.salience !== undefined) {
      values.push(params.salience);
      updates.push(`salience = $${values.length}`);
    }
    if (params.recurrenceCount !== undefined) {
      values.push(params.recurrenceCount);
      updates.push(`recurrence_count = $${values.length}`);
    }
    if (params.unresolved !== undefined) {
      values.push(params.unresolved);
      updates.push(`unresolved = $${values.length}`);
    }
    if (params.firstSeenAt !== undefined) {
      values.push(params.firstSeenAt);
      updates.push(`first_seen_at = $${values.length}`);
    }
    if (params.lastSeenAt !== undefined) {
      values.push(params.lastSeenAt);
      updates.push(`last_seen_at = $${values.length}`);
    }
    if (params.lastReferencedAt !== undefined) {
      values.push(params.lastReferencedAt);
      updates.push(`last_referenced_at = $${values.length}`);
    }
    if (params.centroidEmbedding !== undefined) {
      values.push(embeddingToVectorLiteral(params.centroidEmbedding));
      updates.push(`centroid_embedding = $${values.length}::vector`);
    }
    if (params.originMomentSummaries !== undefined) {
      values.push(params.originMomentSummaries);
      updates.push(`origin_moment_summaries = $${values.length}`);
    }
    if (params.relationshipWeight !== undefined) {
      values.push(params.relationshipWeight);
      updates.push(`relationship_weight = $${values.length}`);
    }
    if (params.status !== undefined) {
      values.push(params.status);
      updates.push(`status = $${values.length}`);
    }
    if (params.v3Domain !== undefined) {
      values.push(params.v3Domain);
      updates.push(`v3_domain = $${values.length}`);
    }
    if (params.v3PressureSource !== undefined) {
      values.push(params.v3PressureSource);
      updates.push(`v3_pressure_source = $${values.length}`);
    }
    if (params.v3RelationalImpact !== undefined) {
      values.push(params.v3RelationalImpact);
      updates.push(`v3_relational_impact = $${values.length}`);
    }
    if (params.v3UserStance !== undefined) {
      values.push(params.v3UserStance);
      updates.push(`v3_user_stance = $${values.length}`);
    }
    if (params.v3UnresolvedLevel !== undefined) {
      values.push(params.v3UnresolvedLevel);
      updates.push(`v3_unresolved_level = $${values.length}`);
    }
    if (params.v3EventSummary !== undefined) {
      values.push(params.v3EventSummary);
      updates.push(`v3_event_summary = $${values.length}`);
    }
    if (params.v3EvidenceTurns !== undefined) {
      values.push(params.v3EvidenceTurns);
      updates.push(`v3_evidence_turns = $${values.length}`);
    }
    if (params.v3LastUserPosition !== undefined) {
      values.push(params.v3LastUserPosition);
      updates.push(`v3_last_user_position = $${values.length}`);
    }

    if (updates.length === 0) {
      const res = await query(
        `SELECT ${EPISODE_COLUMNS}
         FROM episodes
         WHERE id = $1
         LIMIT 1`,
        [id]
      );
      if (res.rows.length === 0) {
        return null;
      }
      return mapRow(res.rows[0] as Record<string, unknown>);
    }

    values.push(id);
    const res = await query(
      `UPDATE episodes
       SET ${updates.join(', ')}
       WHERE id = $${values.length}
       RETURNING ${EPISODE_COLUMNS}`,
      values
    );
    if (res.rows.length === 0) {
      return null;
    }
    return mapRow(res.rows[0] as Record<string, unknown>);
  } catch (e) {
    console.log('[Storage] updateEpisode failed:', e);
    throw e;
  }
}

export async function findSimilarEpisodes(
  userId: string,
  embedding: number[],
  topK?: number
): Promise<DbEpisode[]> {
  const k = topK !== undefined && topK > 0 ? topK : 5;
  try {
    const res = await query(
      `SELECT ${EPISODE_COLUMNS}
       FROM episodes
       WHERE user_id = $1
         AND status <> 'archived'
       ORDER BY centroid_embedding <=> $2::vector
       LIMIT $3`,
      [userId, embeddingToVectorLiteral(embedding), k]
    );
    return res.rows.map((row) => mapRow(row as Record<string, unknown>));
  } catch (e) {
    console.log('[Storage] findSimilarEpisodes failed:', e);
    throw e;
  }
}

export async function getEpisodesByUser(
  userId: string,
  status?: string,
  options?: { includeArchived?: boolean },
): Promise<DbEpisode[]> {
  try {
    const params: unknown[] = [userId];
    let sql = `SELECT ${EPISODE_COLUMNS}
       FROM episodes
       WHERE user_id = $1`;

    if (status !== undefined) {
      params.push(status);
      sql += ` AND status = $${params.length}`;
    } else if (!options?.includeArchived) {
      sql += ` AND status <> 'archived'`;
    }

    sql += ` ORDER BY last_seen_at DESC`;

    const res = await query(sql, params);
    return res.rows.map((row) => mapRow(row as Record<string, unknown>));
  } catch (e) {
    console.log('[Storage] getEpisodesByUser failed:', e);
    throw e;
  }
}

export async function getUnresolvedEpisodes(userId: string): Promise<DbEpisode[]> {
  try {
    const res = await query(
      `SELECT ${EPISODE_COLUMNS}
       FROM episodes
       WHERE user_id = $1 AND unresolved = true AND status = 'active'
       ORDER BY last_seen_at DESC`,
      [userId]
    );
    return res.rows.map((row) => mapRow(row as Record<string, unknown>));
  } catch (e) {
    console.log('[Storage] getUnresolvedEpisodes failed:', e);
    throw e;
  }
}

export async function deleteEpisodesByUser(userId: string): Promise<number> {
  try {
    const res = await query(
      `DELETE FROM episodes
       WHERE user_id = $1`,
      [userId]
    );
    return res.rowCount ?? 0;
  } catch (e) {
    console.log('[Storage] deleteEpisodesByUser failed:', e);
    throw e;
  }
}

export async function deleteEpisode(id: string): Promise<void> {
  try {
    await query(`DELETE FROM episodes WHERE id = $1`, [id]);
  } catch (e) {
    console.log('[Storage] deleteEpisode failed:', e);
    throw e;
  }
}
