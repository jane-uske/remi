#!/usr/bin/env node
import "dotenv/config";
import crypto from "node:crypto";
import { Client } from "pg";

function stableUuidFromString(input) {
  const hash = crypto.createHash("sha256").update(input).digest("hex");
  const timeLow = hash.slice(0, 8);
  const timeMid = hash.slice(8, 12);
  const timeHighAndVersion = `5${hash.slice(13, 16)}`;
  const clockSeq = ((parseInt(hash.slice(16, 18), 16) & 0x3f) | 0x80)
    .toString(16)
    .padStart(2, "0");
  const clockSeqLow = hash.slice(18, 20);
  const node = hash.slice(20, 32);
  return `${timeLow}-${timeMid}-${timeHighAndVersion}-${clockSeq}${clockSeqLow}-${node}`.toLowerCase();
}

function userId(raw) {
  return stableUuidFromString(`rem-user:${raw}`);
}

async function countByUser(client, id) {
  const [u, s, m, e] = await Promise.all([
    client.query("SELECT COUNT(*)::int AS c FROM users WHERE id=$1", [id]),
    client.query("SELECT COUNT(*)::int AS c FROM sessions WHERE user_id=$1", [id]),
    client.query("SELECT COUNT(*)::int AS c FROM memories WHERE user_id=$1", [id]),
    client.query("SELECT COUNT(*)::int AS c FROM episodes WHERE user_id=$1", [id]),
  ]);
  return {
    users: u.rows[0].c,
    sessions: s.rows[0].c,
    memories: m.rows[0].c,
    episodes: e.rows[0].c,
  };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const devUserId = "00000000-0000-4000-8000-000000000001";
  const u1 = userId("user_001");
  const u2 = userId("user_002");
  const targetUserIds = [u1, u2];

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const beforeDev = await countByUser(client, devUserId);
    const beforeU1 = await countByUser(client, u1);
    const beforeU2 = await countByUser(client, u2);

    await client.query("BEGIN");
    await client.query(
      "DELETE FROM messages WHERE session_id IN (SELECT id FROM sessions WHERE user_id = ANY($1::uuid[]))",
      [targetUserIds],
    );
    await client.query("DELETE FROM sessions WHERE user_id = ANY($1::uuid[])", [targetUserIds]);
    await client.query("DELETE FROM memories WHERE user_id = ANY($1::uuid[])", [targetUserIds]);
    await client.query("DELETE FROM episodes WHERE user_id = ANY($1::uuid[])", [targetUserIds]);
    await client.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [targetUserIds]);
    await client.query("COMMIT");

    const afterDev = await countByUser(client, devUserId);
    const afterU1 = await countByUser(client, u1);
    const afterU2 = await countByUser(client, u2);

    console.log(JSON.stringify({
      userIds: { dev: devUserId, user_001: u1, user_002: u2 },
      before: { dev: beforeDev, user_001: beforeU1, user_002: beforeU2 },
      after: { dev: afterDev, user_001: afterU1, user_002: afterU2 },
    }, null, 2));
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err?.message || String(err));
  process.exit(1);
});
