CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_auth_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id),
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_auth_identities_provider_user_unique UNIQUE (provider, provider_user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_auth_identities_user_id ON user_auth_identities (user_id);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions (id),
  role VARCHAR(16) NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages (session_id);

CREATE TABLE IF NOT EXISTS memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id),
  key VARCHAR(128) NOT NULL,
  value TEXT NOT NULL,
  importance REAL NOT NULL DEFAULT 1.0,
  embedding vector(768),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT memories_user_id_key_unique UNIQUE (user_id, key)
);

CREATE INDEX IF NOT EXISTS idx_memories_user_id ON memories (user_id);

CREATE TABLE IF NOT EXISTS episodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  topics TEXT[] NOT NULL DEFAULT '{}',
  mood TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL,
  salience REAL NOT NULL DEFAULT 0,
  recurrence_count INT NOT NULL DEFAULT 1,
  unresolved BOOLEAN NOT NULL DEFAULT FALSE,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_referenced_at TIMESTAMPTZ,
  centroid_embedding vector(768) NOT NULL,
  origin_moment_summaries TEXT[] NOT NULL DEFAULT '{}',
  relationship_weight REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE INDEX IF NOT EXISTS idx_episodes_user_id ON episodes (user_id);
CREATE INDEX IF NOT EXISTS idx_episodes_user_status_updated
  ON episodes (user_id, status, last_seen_at DESC);
