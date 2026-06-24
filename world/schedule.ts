// ── 离线居家人生 P0 —— 服务端 reimplement RemiWorld 行为调度器 ────────────
// 逐字节移植自 web/src/lib/world/behavior.ts（:17 BehaviorId、:44-85 BEHAVIOR_SPOTS
// 的 id+label、:148 hash01、:155 SLOT_BASE_MS、:158 OUTDOOR_BEHAVIORS、:160-180
// scheduledBehaviorAt）。
//
// 与 web 版的差异（刻意）：只保留 `id` + 中文 `label`，丢弃 x/z/faceYaw/motion 等
// 渲染字段——归来叙事只需要"她在做什么"的措辞，不需要她"站在哪"。这些丢弃的字段
// 不参与任何确定性计算（scheduledBehaviorAt 只读 behaviorPool / hash / slot），所
// 以输出与 web 版逐字节一致；由 schedule_parity 测试锁住。
//
// 服务端（根 tsconfig、commonjs）无法 import web，故照 server/session/world_event.ts
// 先例自己实现。

import { worldTimeProfileAt } from "./worldTime";
import type { WeatherProfile } from "./weather";

export type BehaviorId = "reading" | "window" | "flowers" | "bench" | "music";

export interface BehaviorSpot {
  id: BehaviorId;
  /** 给 HUD / 对话上下文用的中文描述 */
  label: string;
}

export const BEHAVIOR_SPOTS: readonly BehaviorSpot[] = [
  { id: "reading", label: "在书架边看书" },
  { id: "window", label: "在窗边看海" },
  { id: "flowers", label: "在花圃打理花" },
  { id: "bench", label: "在长椅边发呆" },
  { id: "music", label: "在电脑前听音乐" },
];

/** 确定性 hash → [0,1) —— 逐字节移植 web/src/lib/world/behavior.ts:148 */
function hash01(n: number): number {
  let h = (n * 374761393 + 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 0xffffffff;
}

/** 行为窗口：每段 75~135 秒，由墙钟决定。进入页面时她"早就在做了"。 */
const SLOT_BASE_MS = 105_000;

/** Outdoor behavior spots that get filtered out during indoorOnly weather */
const OUTDOOR_BEHAVIORS: ReadonlySet<BehaviorId> = new Set(["flowers", "bench"]);

export function scheduledBehaviorAt(
  epochMs: number,
  weather?: Pick<WeatherProfile, "indoorOnly">,
): BehaviorId {
  const slot = Math.floor(epochMs / SLOT_BASE_MS);
  let pool: readonly BehaviorId[] = worldTimeProfileAt(epochMs).behaviorPool;
  // Rain / snow: filter outdoor spots; ensure at least 2 fallback behaviors
  if (weather?.indoorOnly) {
    const filtered = pool.filter((id) => !OUTDOOR_BEHAVIORS.has(id));
    if (filtered.length >= 2) pool = filtered;
    // else keep original pool (safety: never reduce to < 2)
  }
  // 避免连续两段相同：用 slot 序列去重
  const pick = (s: number) =>
    pool[Math.floor(hash01(s) * pool.length)];
  let id = pick(slot);
  if (id === pick(slot - 1)) {
    id = pool[(pool.indexOf(id) + 1) % pool.length];
  }
  return id;
}

/** 查表：behaviorId → 中文 label（叙事措辞唯一来源）。 */
export function spotOf(id: BehaviorId): BehaviorSpot {
  return BEHAVIOR_SPOTS.find((b) => b.id === id)!;
}

export { SLOT_BASE_MS };
