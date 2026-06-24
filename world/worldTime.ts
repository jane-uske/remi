// ── 离线居家人生 P0 —— 服务端 reimplement RemiWorld 世界时间 ─────────────
// 逐字节移植自 web/src/lib/world/worldTime.ts:1-58。确定性纯函数：同一 epochMs
// 必出同一 phase / profile。服务端（根 tsconfig、commonjs）无法 import web，故照
// server/session/world_event.ts 先例自己实现；与 web 版的一致性由黄金 fixture 测
// 试（test/world/schedule_parity.test.ts）逐字节锁住。
//
// 只移植归来叙事所需的纯调度逻辑（phase / behaviorPool / label / contextLine）；
// lowLight 仅渲染用，这里保留以保持 profile 结构与 web 版逐字节一致。

import type { BehaviorId } from "./schedule";

export type WorldTimePhase = "morning" | "day" | "dusk" | "night";

export interface WorldTimeProfile {
  phase: WorldTimePhase;
  /** HUD / prompt 使用的短标签 */
  label: string;
  /** 世界情境里使用的一句话，陈述事实，不写成指令 */
  contextLine: string;
  /** 当前时间段适合 Remi 做的本地日常行为池 */
  behaviorPool: readonly BehaviorId[];
  /** 引擎是否应进入低光照氛围 */
  lowLight: boolean;
}

const PROFILES: Record<WorldTimePhase, WorldTimeProfile> = {
  morning: {
    phase: "morning",
    label: "清晨",
    contextLine: "清晨的光刚照进房间，空气还很安静。",
    behaviorPool: ["window", "flowers", "reading"],
    lowLight: false,
  },
  day: {
    phase: "day",
    label: "午后",
    contextLine: "午后的光线很稳，房间和庭院都显得明亮。",
    behaviorPool: ["reading", "flowers", "music", "window"],
    lowLight: false,
  },
  dusk: {
    phase: "dusk",
    label: "黄昏",
    contextLine: "黄昏正在落下来，海面和房间都被暖光包住。",
    behaviorPool: ["bench", "window", "reading", "music"],
    lowLight: true,
  },
  night: {
    phase: "night",
    label: "深夜",
    contextLine: "深夜的小岛很安静，房间里的灯和屏幕光更明显。",
    behaviorPool: ["reading", "music", "window"],
    lowLight: true,
  },
};

export function worldTimePhaseAt(epochMs: number): WorldTimePhase {
  const hour = new Date(epochMs).getHours();
  if (hour >= 5 && hour < 11) return "morning";
  if (hour >= 11 && hour < 17) return "day";
  if (hour >= 17 && hour < 21) return "dusk";
  return "night";
}

export function worldTimeProfileAt(epochMs: number): WorldTimeProfile {
  return PROFILES[worldTimePhaseAt(epochMs)];
}
