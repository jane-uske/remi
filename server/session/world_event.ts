// ── RemiWorld 世界事件 → 长期记忆（RW-P1-4b）────────────────────────────
// 用户在世界里做的有情感重量的事（种花、点灯、隔天回来）写进 episode 写路径，
// 让 Remi 几天后仍记得"你给院子种过花"。
//
// 边界：
// - 不是对话轮，不走 fast path，不触发回复；纯异步 fire-and-forget 落库
// - 复用慢脑同一个 episode store（同一个 Remi 的同一份记忆），语义合并自带去重
// - 无 DB 时 ingest 会抛错，这里吞掉并告警，不影响世界其余功能

import { getConfig } from "../config";
import { ingest, type MomentInput } from "../../memory/episode_store";
import { createLogger } from "../../infra/logger";

const logger = createLogger("world_event");

export type WorldEventKind = "flower_planted" | "lantern_lit" | "revisit";

/** 事件 → 记忆内容。集中在服务端，作为"什么值得被记住"的事实源。 */
const WORLD_EVENT_MOMENTS: Record<
  WorldEventKind,
  Omit<MomentInput, "userId">
> = {
  flower_planted: {
    summary:
      "用户在你们的小世界里，亲手种下了一朵花，说要让这片土地记得他来过。",
    topic: "RemiWorld·一起种的花",
    mood: "温暖",
    kind: "shared_world_moment",
    salience: 0.66,
    unresolved: false,
  },
  lantern_lit: {
    summary:
      "用户点亮了小世界门前的灯笼，说要让它照着回家的路，以后再晚都找得到家。",
    topic: "RemiWorld·点亮的灯笼",
    mood: "温暖",
    kind: "shared_world_moment",
    salience: 0.64,
    unresolved: false,
  },
  revisit: {
    summary: "用户隔了一阵，又回到你们的小世界来看你。",
    topic: "RemiWorld·又回来了",
    mood: "想念",
    kind: "shared_world_moment",
    salience: 0.55,
    unresolved: false,
  },
};

function isWorldEventKind(value: unknown): value is WorldEventKind {
  return (
    value === "flower_planted" || value === "lantern_lit" || value === "revisit"
  );
}

/** 纯函数：事件 + userId → MomentInput（未知事件返回 null）。便于单测。 */
export function buildWorldEventMoment(
  event: unknown,
  userId: string,
): MomentInput | null {
  if (!isWorldEventKind(event)) return null;
  return { userId, ...WORLD_EVENT_MOMENTS[event] };
}

export interface SessionWorldEventRuntime {
  connId: string;
  userId: string;
}

/** 处理 world_event 消息：映射成 episode 并异步落库。 */
export async function handleSessionWorldEvent(
  runtime: SessionWorldEventRuntime,
  data: { event?: unknown },
): Promise<void> {
  if (!getConfig().REMI_EPISODE_MEMORY_ENABLED) return;
  const moment = buildWorldEventMoment(data?.event, runtime.userId);
  if (!moment) return;
  try {
    await ingest(moment);
    logger.info("[RemiWorld] world event remembered", {
      event: data.event,
      connId: runtime.connId,
      userId: runtime.userId,
    });
  } catch (err) {
    // 无 DB / embedding 异常时静默降级，不影响世界其余功能
    logger.warn("[RemiWorld] failed to persist world event", {
      event: data.event,
      connId: runtime.connId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
