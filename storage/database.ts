import { Pool, type QueryResult } from 'pg';
import { resolveConnectionString } from './connection_resolver';

let pool: Pool | null = null;

export async function initDatabase(config?: {
  connectionString?: string;
}): Promise<void> {
  const rawConnectionString =
    config?.connectionString ?? process.env.DATABASE_URL;
  if (!rawConnectionString) {
    const err = new Error('DATABASE_URL is not set');
    console.log('[Storage] initDatabase failed:', err.message);
    throw err;
  }
  try {
    const connectionString = await resolveConnectionString(rawConnectionString, {
      serviceHost: "postgres",
      fallbackHost: "127.0.0.1",
      fallbackPort: 5432,
      fallbackLabel: "PostgreSQL",
    });
    pool = new Pool({ connectionString });
    await pool.query('SELECT 1');
    console.log('[Storage] PostgreSQL pool initialized');
  } catch (e) {
    pool = null;
    console.log('[Storage] initDatabase failed:', e);
    throw e;
  }
}

export function getPool(): Pool {
  if (!pool) {
    throw new Error('Database pool is not initialized; call initDatabase first');
  }
  return pool;
}

export async function query(
  text: string,
  params?: unknown[]
): Promise<QueryResult> {
  try {
    return await getPool().query(text, params);
  } catch (e) {
    console.log('[Storage] query error:', e);
    throw e;
  }
}

export async function closeDatabase(): Promise<void> {
  if (!pool) {
    return;
  }
  try {
    await pool.end();
    console.log('[Storage] PostgreSQL pool closed');
  } catch (e) {
    console.log('[Storage] closeDatabase error:', e);
    throw e;
  } finally {
    pool = null;
  }
}

export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    await query('SELECT 1');
    return true;
  } catch (e) {
    console.log('[Storage] checkDatabaseHealth failed:', e);
    return false;
  }
}
