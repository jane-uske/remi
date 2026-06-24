// DL-P1b: RemiSelf 最小持久化表。每用户单份（user_id 主键），跨会话/跨设备
// 读同一份；离线漂移在会话启动时 lazy 计算后写回。字段刻意与现状
// PersonaLiveState 同构（mood/topic_pull = TEXT，energy = TEXT low/medium/high，
// current_focus 从慢脑派生、可空）。设计见
// docs/design/DIGITAL_LIFE_NORTH_STAR.md §1。
//
// ⚠️ local-prod 库无 pgmigrations 记账：直接 `migrate:up` 会从 001 重跑、撞已
// 存在的表而失败。上线时**不要**让人跑 migrate:up —— 手动在 local-prod 库执行
// 下方等效的 CREATE TABLE IF NOT EXISTS DDL（见交付说明）。
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS remi_self (
      user_id UUID PRIMARY KEY REFERENCES users (id),
      mood TEXT NOT NULL DEFAULT '平静',
      energy TEXT NOT NULL DEFAULT 'medium',
      current_focus TEXT,
      topic_pull TEXT NOT NULL DEFAULT '',
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_saved_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS remi_self CASCADE`);
};
