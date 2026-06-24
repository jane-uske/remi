// ── DL-P1b RemiSelf 持久层 —— 内存 fallback ──────────────────────────
// 无 DATABASE_URL 时使用。Map<userId, RemiSelfRecord>。进程重启丢失（与现状
// 内存模式记忆一致）。同一进程内跨重连仍保留 —— 模块级单例（见工厂）。

import type { RemiSelfRepository } from "./remi_self_repository";
import type { RemiSelfRecord } from "../../memory/remi_self";

export class InMemoryRemiSelfRepository implements RemiSelfRepository {
  private readonly store = new Map<string, RemiSelfRecord>();

  async load(userId: string): Promise<RemiSelfRecord | null> {
    const rec = this.store.get(userId);
    // Defensive copy so callers can't mutate the stored record in place.
    return rec ? { ...rec } : null;
  }

  async save(userId: string, rec: RemiSelfRecord): Promise<void> {
    this.store.set(userId, { ...rec });
  }

  /** Test-only: drop all records so each case starts clean. */
  clear(): void {
    this.store.clear();
  }
}
