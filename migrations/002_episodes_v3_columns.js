exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE episodes ADD COLUMN IF NOT EXISTS v3_domain TEXT`);
  pgm.sql(`ALTER TABLE episodes ADD COLUMN IF NOT EXISTS v3_pressure_source TEXT`);
  pgm.sql(`ALTER TABLE episodes ADD COLUMN IF NOT EXISTS v3_relational_impact TEXT`);
  pgm.sql(`ALTER TABLE episodes ADD COLUMN IF NOT EXISTS v3_user_stance TEXT`);
  pgm.sql(`ALTER TABLE episodes ADD COLUMN IF NOT EXISTS v3_unresolved_level INT`);
  pgm.sql(`ALTER TABLE episodes ADD COLUMN IF NOT EXISTS v3_event_summary TEXT`);
  pgm.sql(`ALTER TABLE episodes ADD COLUMN IF NOT EXISTS v3_evidence_turns TEXT[] NOT NULL DEFAULT '{}'`);
  pgm.sql(`ALTER TABLE episodes ADD COLUMN IF NOT EXISTS v3_last_user_position TEXT`);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE episodes DROP COLUMN IF EXISTS v3_domain`);
  pgm.sql(`ALTER TABLE episodes DROP COLUMN IF EXISTS v3_pressure_source`);
  pgm.sql(`ALTER TABLE episodes DROP COLUMN IF EXISTS v3_relational_impact`);
  pgm.sql(`ALTER TABLE episodes DROP COLUMN IF EXISTS v3_user_stance`);
  pgm.sql(`ALTER TABLE episodes DROP COLUMN IF EXISTS v3_unresolved_level`);
  pgm.sql(`ALTER TABLE episodes DROP COLUMN IF EXISTS v3_event_summary`);
  pgm.sql(`ALTER TABLE episodes DROP COLUMN IF EXISTS v3_evidence_turns`);
  pgm.sql(`ALTER TABLE episodes DROP COLUMN IF EXISTS v3_last_user_position`);
};
