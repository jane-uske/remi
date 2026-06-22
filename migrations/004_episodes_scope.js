// DL-P0-5: episodes 加 scope 列（core | performance）。
// 本体记忆 vs 演出/剧情记忆物理隔离。设计见
// docs/design/DIGITAL_LIFE_NORTH_STAR.md §2c / ROLEPLAY_LAYER_DESIGN.md §5。
// 默认 'core'，现有写入路径暂不改 —— 无运行时行为变更（NORTH_STAR P0 约束）。
exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE episodes ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'core'`);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE episodes DROP COLUMN IF EXISTS scope`);
};
