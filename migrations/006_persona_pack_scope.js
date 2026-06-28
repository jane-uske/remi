// M4: Persona Pack 记忆隔离 —— 给记忆 / 情节加 pack 维度，让多角色之间不串台。
//
// pack_id 可空，NULL = 现有「按 user 共享」语义（向后兼容，flag-off / 单 pack 时
// 行为逐字节不变）。memoryScope=per_pack 的角色卡写入时带上 pack id；查询侧按
// (user_id, pack_id) 隔离。
//
// ⚠️ 现状：本迁移只加列，**应用层隔离（repo 查询 + embedding 召回条件）尚未接入**
// ——单 pack 下记忆按 user_id 已完全正确，无需求时不动热点文件 memory_repository。
// 多 pack 真要给用户时，再接 repo 的 WHERE pack_id 条件（含语义检索），那是上多
// pack 的前置。设计见 docs/design/PERSONA_PACK.md。
//
// ⚠️ local-prod 库无 pgmigrations 记账：直接 `migrate:up` 会从 001 重跑、撞已存在
// 的表而失败。上线时**不要**让人跑 migrate:up —— 手动在 local-prod 库执行下方
// 等效的 ADD COLUMN IF NOT EXISTS DDL：
//
//   ALTER TABLE memories  ADD COLUMN IF NOT EXISTS pack_id TEXT;
//   ALTER TABLE episodes  ADD COLUMN IF NOT EXISTS pack_id TEXT;
//   CREATE INDEX IF NOT EXISTS idx_memories_user_pack ON memories (user_id, pack_id);
//   CREATE INDEX IF NOT EXISTS idx_episodes_user_pack ON episodes (user_id, pack_id);

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE memories ADD COLUMN IF NOT EXISTS pack_id TEXT;
    ALTER TABLE episodes ADD COLUMN IF NOT EXISTS pack_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_memories_user_pack ON memories (user_id, pack_id);
    CREATE INDEX IF NOT EXISTS idx_episodes_user_pack ON episodes (user_id, pack_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_memories_user_pack;
    DROP INDEX IF EXISTS idx_episodes_user_pack;
    ALTER TABLE memories DROP COLUMN IF EXISTS pack_id;
    ALTER TABLE episodes DROP COLUMN IF EXISTS pack_id;
  `);
};
