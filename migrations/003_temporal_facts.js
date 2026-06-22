exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS temporal_facts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users (id),
      subject TEXT NOT NULL,
      predicate TEXT NOT NULL,
      object TEXT NOT NULL,
      embedding vector(768),
      t_valid TIMESTAMPTZ NOT NULL,
      t_invalid TIMESTAMPTZ,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      source_episode_id UUID,
      salience REAL NOT NULL DEFAULT 0.5
    )
  `);

  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_tf_user_active ON temporal_facts (user_id) WHERE t_invalid IS NULL`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_tf_user_timeline ON temporal_facts (user_id, subject, t_valid DESC)`);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS temporal_facts CASCADE`);
};
