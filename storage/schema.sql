-- ============================================================
-- THIS FILE IS NOW REFERENCE ONLY.
-- Schema is managed by migrations/ directory.
-- Use `npm run migrate:up` to apply changes.
-- Use `npm run migrate:create` to create new migrations.
-- ============================================================

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

CREATE TABLE IF NOT EXISTS user_persona_presets (
  user_id UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  preset_id TEXT NOT NULL
);

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

ALTER TABLE episodes ADD COLUMN IF NOT EXISTS v3_domain TEXT;
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS v3_pressure_source TEXT;
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS v3_relational_impact TEXT;
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS v3_user_stance TEXT;
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS v3_unresolved_level INT;
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS v3_event_summary TEXT;
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS v3_evidence_turns TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS v3_last_user_position TEXT;

CREATE INDEX IF NOT EXISTS idx_episodes_user_id ON episodes (user_id);
CREATE INDEX IF NOT EXISTS idx_episodes_user_status_updated
  ON episodes (user_id, status, last_seen_at DESC);

-- ── Invite codes ──────────────────────────────────────────────────────────
-- Each code may be used for:
--   (a) guest trial (/try/<code>) — repeatable, rate-limited per IP
--   (b) registration — one-time: a single Clerk user can redeem it to join
-- Each newly-registered user is automatically issued CODES_PER_USER (2) codes.
-- Seed codes (issued_by_user_id IS NULL) are created from REMI_SEED_INVITE_CODES.
CREATE TABLE IF NOT EXISTS invite_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  -- who generated this code (NULL = seed / admin-generated)
  issued_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  -- registration: one Clerk user can redeem the code to create their account
  register_redeemed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  register_redeemed_at TIMESTAMPTZ,
  -- trial usage counter (incremented each time a guest token is issued with this code)
  trial_use_count INT NOT NULL DEFAULT 0,
  -- lifecycle
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_invite_codes_issued_by
  ON invite_codes (issued_by_user_id);
CREATE INDEX IF NOT EXISTS idx_invite_codes_redeemed_by
  ON invite_codes (register_redeemed_by_user_id);
