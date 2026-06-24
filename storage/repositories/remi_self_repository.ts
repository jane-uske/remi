// ── DL-P1b RemiSelf 持久层 —— 接口定义 ───────────────────────────────
// 每用户单份 RemiSelfRecord（user_id 唯一）。load 返回 null = 无记录（首次见
// 这个用户）。save = upsert。DB 可用走 PG 实现，否则走内存实现（工厂选择见
// getRemiSelfRepository）。设计见 docs/design/DIGITAL_LIFE_NORTH_STAR.md §1。

import type { RemiSelfRecord } from "../../memory/remi_self";

export interface RemiSelfRepository {
  /** 读这个用户的 RemiSelf 记录；无记录返回 null。 */
  load(userId: string): Promise<RemiSelfRecord | null>;
  /** upsert 这个用户的 RemiSelf 记录（user_id 唯一）。 */
  save(userId: string, rec: RemiSelfRecord): Promise<void>;
}
