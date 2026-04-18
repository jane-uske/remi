export interface DbUser {
  id: string;
  created_at: Date;
}

export interface DbUserAuthIdentity {
  id: string;
  user_id: string;
  provider: string;
  provider_user_id: string;
  email: string | null;
  created_at: Date;
  last_seen_at: Date;
}

export interface DbSession {
  id: string;
  user_id: string;
  started_at: Date;
  ended_at: Date | null;
}

export interface DbMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: Date;
}

export interface DbMemory {
  id: string;
  user_id: string;
  key: string;
  value: string;
  importance: number;
  embedding: number[] | null;
  created_at: Date;
  last_accessed_at: Date;
}

export interface StorageConfig {
  pg_url: string;
  redis_url: string;
}
