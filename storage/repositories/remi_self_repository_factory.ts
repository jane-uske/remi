// ── DL-P1b RemiSelf 持久层 —— 工厂选择 ───────────────────────────────
// DB 可用走 PG 实现，否则走进程级单例内存实现（跨重连仍在本进程内保留，与
// project_memory 的 module-level cache 同思路）。
//
// 注意：与 temporal_facts 略有不同 —— temporal_facts 在 bootstrap 里只在
// REMI_TEMPORAL_FACTS_ENABLED && DB 时实例化 PG（无 DB 即留 null）。RemiSelf
// 的卖点是「关掉隔天回来还在」，所以 DB 不可用时也要走内存实现（同进程内有效），
// 由本工厂按 isDbReady() 选择。

import type { RemiSelfRepository } from "./remi_self_repository";
import { InMemoryRemiSelfRepository } from "./in_memory_remi_self";
import { PgRemiSelfRepository } from "./pg_remi_self_repository";
import { isDbReady } from "../../infra/app_state";

let pgRepo: PgRemiSelfRepository | null = null;
let memoryRepo: InMemoryRemiSelfRepository | null = null;

/**
 * Return the active RemiSelf repository. DB ready → PG (one shared instance);
 * otherwise an in-process singleton in-memory repo so a record survives
 * reconnects within the same process even without a database.
 */
export function getRemiSelfRepository(): RemiSelfRepository {
  if (isDbReady()) {
    pgRepo ??= new PgRemiSelfRepository();
    return pgRepo;
  }
  memoryRepo ??= new InMemoryRemiSelfRepository();
  return memoryRepo;
}

/** Test-only: drop the in-process in-memory store so each case starts clean. */
export function __resetRemiSelfRepositoryForTest(): void {
  memoryRepo?.clear();
  memoryRepo = null;
  pgRepo = null;
}
