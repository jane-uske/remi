import type { BehaviorId } from "./behavior";

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

function absenceText(elapsedMs: number): string | null {
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 30) return null;
  if (minutes < 180) return "你离开了一会儿";
  const hours = Math.floor(minutes / 60);
  if (hours < 22) return "你不在的这几个小时";
  const days = Math.max(1, Math.floor(hours / 24));
  return days === 1 ? "你不在的这一天" : `你不在的这 ${days} 天`;
}

export function buildOfflineReturnOpener(args: {
  elapsedMs: number;
  profile: WorldTimeProfile;
  flowerPlanted: boolean;
  lanternLit: boolean;
}): string | null {
  const absence = absenceText(args.elapsedMs);
  if (!absence) return null;

  const traces: string[] = [];
  if (args.flowerPlanted) traces.push("我去看过花，它们还好好开着");
  if (args.lanternLit) traces.push("灯也一直亮着");

  const traceText =
    traces.length > 0 ? `，${traces.join("，")}` : "，我在房间和庭院之间待了一会儿";
  return `你回来啦。${absence}，这里已经到${args.profile.label}了${traceText}。`;
}
