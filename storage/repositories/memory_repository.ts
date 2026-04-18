import { query } from '../database';
import type { DbMemory } from '../types';
import { embeddingToVectorLiteral, parseEmbedding } from './vector_utils';

function mapRow(row: Record<string, unknown>): DbMemory {
  return {
    id: row.id as string,
    user_id: row.user_id as string,
    key: row.key as string,
    value: row.value as string,
    importance: Number(row.importance),
    embedding: parseEmbedding(row.embedding),
    created_at: row.created_at as Date,
    last_accessed_at: row.last_accessed_at as Date,
  };
}

export async function upsertMemory(
  userId: string,
  key: string,
  value: string,
  embedding?: number[]
): Promise<DbMemory> {
  try {
    const hasEmbedding = embedding !== undefined;
    const params: unknown[] = [userId, key, value];
    let sql = `INSERT INTO memories (user_id, key, value, importance`;
    if (hasEmbedding) {
      sql += `, embedding`;
      params.push(embeddingToVectorLiteral(embedding));
    }
    sql += `)
       VALUES ($1, $2, $3, 1.0`;
    if (hasEmbedding) {
      sql += `, $4::vector`;
    }
    sql += `)
       ON CONFLICT (user_id, key)
       DO UPDATE SET
         value = EXCLUDED.value,`;
    if (hasEmbedding) {
      sql += `
         embedding = EXCLUDED.embedding,`;
    } else {
      sql += `
         embedding = CASE
           WHEN memories.value IS DISTINCT FROM EXCLUDED.value THEN NULL
           ELSE memories.embedding
         END,`;
    }
    sql += `
         last_accessed_at = now()
       RETURNING id, user_id, key, value, importance, embedding, created_at, last_accessed_at`;

    const res = await query(sql, params);
    const row = res.rows[0] as Record<string, unknown>;
    return mapRow(row);
  } catch (e) {
    console.log('[Storage] upsertMemory failed:', e);
    throw e;
  }
}

export async function getUserMemories(userId: string): Promise<DbMemory[]> {
  try {
    const res = await query(
      `SELECT id, user_id, key, value, importance, embedding, created_at, last_accessed_at
       FROM memories
       WHERE user_id = $1
       ORDER BY created_at ASC`,
      [userId]
    );
    return res.rows.map((r) => mapRow(r as Record<string, unknown>));
  } catch (e) {
    console.log('[Storage] getUserMemories failed:', e);
    throw e;
  }
}

export async function findSimilarMemories(
  userId: string,
  embedding: number[],
  topK?: number
): Promise<DbMemory[]> {
  const k = topK !== undefined && topK > 0 ? topK : 10;
  try {
    const vectorLiteral = embeddingToVectorLiteral(embedding);
    const res = await query(
      `SELECT id, user_id, key, value, importance, embedding, created_at, last_accessed_at
       FROM memories
       WHERE user_id = $1 AND embedding IS NOT NULL
       ORDER BY embedding <=> $2::vector
       LIMIT $3`,
      [userId, vectorLiteral, k]
    );
    return res.rows.map((r) => mapRow(r as Record<string, unknown>));
  } catch (e) {
    console.log('[Storage] findSimilarMemories failed:', e);
    throw e;
  }
}

export async function getMemoryByKey(userId: string, key: string): Promise<DbMemory | null> {
  try {
    const res = await query(
      `SELECT id, user_id, key, value, importance, embedding, created_at, last_accessed_at
       FROM memories
       WHERE user_id = $1 AND key = $2
       LIMIT 1`,
      [userId, key]
    );
    if (res.rows.length === 0) return null;
    return mapRow(res.rows[0] as Record<string, unknown>);
  } catch (e) {
    console.log('[Storage] getMemoryByKey failed:', e);
    throw e;
  }
}

export async function deleteMemoryByKey(userId: string, key: string): Promise<void> {
  try {
    await query(`DELETE FROM memories WHERE user_id = $1 AND key = $2`, [userId, key]);
  } catch (e) {
    console.log('[Storage] deleteMemoryByKey failed:', e);
    throw e;
  }
}

export async function touchMemory(id: string): Promise<void> {
  try {
    await query(
      `UPDATE memories SET last_accessed_at = now() WHERE id = $1`,
      [id]
    );
  } catch (e) {
    console.log('[Storage] touchMemory failed:', e);
    throw e;
  }
}

export async function updateMemoryEmbedding(id: string, embedding: number[]): Promise<void> {
  try {
    const vectorLiteral = embeddingToVectorLiteral(embedding);
    await query(
      `UPDATE memories SET embedding = $1::vector WHERE id = $2`,
      [vectorLiteral, id]
    );
  } catch (e) {
    console.log('[Storage] updateMemoryEmbedding failed:', e);
    throw e;
  }
}

export async function deleteMemory(id: string): Promise<void> {
  try {
    await query(`DELETE FROM memories WHERE id = $1`, [id]);
  } catch (e) {
    console.log('[Storage] deleteMemory failed:', e);
    throw e;
  }
}

export async function deleteMemoriesByUser(userId: string): Promise<number> {
  try {
    const res = await query(`DELETE FROM memories WHERE user_id = $1`, [userId]);
    return res.rowCount ?? 0;
  } catch (e) {
    console.log('[Storage] deleteMemoriesByUser failed:', e);
    throw e;
  }
}
