import { query } from '../database';
import type { DbMessage } from '../types';

export type UserMessageHistoryCursor = {
  created_at: Date;
  id: string;
};

export type UserMessageHistoryPage = {
  messages: DbMessage[];
  hasMore: boolean;
  nextCursor: UserMessageHistoryCursor | null;
};

function mapRow(row: Record<string, unknown>): DbMessage {
  const role = row.role as string;
  if (role !== 'user' && role !== 'assistant') {
    throw new Error(`Invalid message role: ${role}`);
  }
  return {
    id: row.id as string,
    session_id: row.session_id as string,
    role,
    content: row.content as string,
    created_at: row.created_at as Date,
  };
}

export async function saveMessage(
  sessionId: string,
  role: string,
  content: string
): Promise<DbMessage> {
  try {
    const res = await query(
      `INSERT INTO messages (session_id, role, content)
       VALUES ($1, $2, $3)
       RETURNING id, session_id, role, content, created_at`,
      [sessionId, role, content]
    );
    const row = res.rows[0] as Record<string, unknown>;
    return mapRow(row);
  } catch (e) {
    console.log('[Storage] saveMessage failed:', e);
    throw e;
  }
}

export async function getRecentUserMessages(
  userId: string,
  limit: number = 10
): Promise<DbMessage[]> {
  const res = await query(
    `SELECT m.id, m.session_id, m.role, m.content, m.created_at
     FROM messages m
     JOIN sessions s ON s.id = m.session_id
     WHERE s.user_id = $1
     ORDER BY m.created_at DESC
     LIMIT $2`,
    [userId, limit]
  );
  // DESC → reverse to chronological order for ctx.history
  return res.rows
    .map((r) => mapRow(r as Record<string, unknown>))
    .reverse();
}

export async function getUserMessagesPage(
  userId: string,
  limit: number = 15,
  cursor?: UserMessageHistoryCursor | null
): Promise<UserMessageHistoryPage> {
  const pageSize = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 15;
  const queryLimit = pageSize + 1;
  const res = await query(
    `SELECT m.id, m.session_id, m.role, m.content, m.created_at
     FROM messages m
     JOIN sessions s ON s.id = m.session_id
     WHERE s.user_id = $1
       AND (
         $2::timestamptz IS NULL
         OR (m.created_at, m.id) < ($2::timestamptz, $3::uuid)
       )
     ORDER BY m.created_at DESC, m.id DESC
     LIMIT $4`,
    [userId, cursor?.created_at ?? null, cursor?.id ?? null, queryLimit]
  );

  const rows = res.rows.map((r) => mapRow(r as Record<string, unknown>));
  const hasMore = rows.length > pageSize;
  const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
  const nextCursorRow = hasMore ? pageRows[pageRows.length - 1] ?? null : null;

  return {
    messages: [...pageRows].reverse(),
    hasMore,
    nextCursor: nextCursorRow
      ? {
          created_at: nextCursorRow.created_at,
          id: nextCursorRow.id,
        }
      : null,
  };
}

export async function getSessionMessages(
  sessionId: string,
  limit?: number
): Promise<DbMessage[]> {
  try {
    const hasLimit = limit !== undefined && limit > 0;
    const sql = hasLimit
      ? `SELECT id, session_id, role, content, created_at
         FROM messages
         WHERE session_id = $1
         ORDER BY created_at ASC
         LIMIT $2`
      : `SELECT id, session_id, role, content, created_at
         FROM messages
         WHERE session_id = $1
         ORDER BY created_at ASC`;
    const res = hasLimit
      ? await query(sql, [sessionId, limit])
      : await query(sql, [sessionId]);
    return res.rows.map((r) => mapRow(r as Record<string, unknown>));
  } catch (e) {
    console.log('[Storage] getSessionMessages failed:', e);
    throw e;
  }
}

export async function getUserMessagesInRange(
  userId: string,
  startAt: Date,
  endAt: Date,
  limit?: number,
): Promise<DbMessage[]> {
  try {
    const hasLimit = limit !== undefined && limit > 0;
    const sql = hasLimit
      ? `SELECT m.id, m.session_id, m.role, m.content, m.created_at
         FROM messages m
         JOIN sessions s ON s.id = m.session_id
         WHERE s.user_id = $1
           AND m.created_at >= $2
           AND m.created_at < $3
         ORDER BY m.created_at ASC, m.id ASC
         LIMIT $4`
      : `SELECT m.id, m.session_id, m.role, m.content, m.created_at
         FROM messages m
         JOIN sessions s ON s.id = m.session_id
         WHERE s.user_id = $1
           AND m.created_at >= $2
           AND m.created_at < $3
         ORDER BY m.created_at ASC, m.id ASC`;

    const res = hasLimit
      ? await query(sql, [userId, startAt, endAt, limit])
      : await query(sql, [userId, startAt, endAt]);
    return res.rows.map((row) => mapRow(row as Record<string, unknown>));
  } catch (e) {
    console.log('[Storage] getUserMessagesInRange failed:', e);
    throw e;
  }
}

export async function deleteMessagesByUser(userId: string): Promise<number> {
  try {
    const res = await query(
      `DELETE FROM messages m
       USING sessions s
       WHERE m.session_id = s.id
         AND s.user_id = $1`,
      [userId]
    );
    return res.rowCount ?? 0;
  } catch (e) {
    console.log('[Storage] deleteMessagesByUser failed:', e);
    throw e;
  }
}
