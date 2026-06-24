// ── DL-P1b RemiSelf 会话接线 —— 加载 / 漂移 / soft-patch / 写回 ──────────
// 会话启动：拿到 userId 后【异步】加载 RemiSelf，按已离线时长漂移，再把漂移后
// 的 mood / energy / topicPull soft-patch 回 PersonaLiveState，并把派生的
// currentFocus 暂存到 brain.remiSelfFocus 供 prompt 注入。**绝不阻塞 fast path**：
// PersonaLiveState 先用默认值正常走，加载完成才打补丁；失败 / 无 DB / 无记录静
// 默走默认。
//
// 断连写回：persistRemiSelfState 是 persistRelationshipContinuityState 的兄弟函
// 数，在所有调用后者的地方并排 fire-and-forget 调用。
//
// flag off（REMI_SELF_PERSISTENCE_ENABLED=0，默认）时整条路径短路，行为与现状
// 逐字节一致。设计见 docs/design/DIGITAL_LIFE_NORTH_STAR.md §1。

import type { RemiSessionContext } from "../../brains/remi_session_context";
import { createLogger } from "../../infra/logger";
import { getConfig } from "../config";
import {
  driftRemiSelf,
  normalizeCurrentFocus,
} from "../../memory/remi_self";
import { getRemiSelfRepository } from "../../storage/repositories/remi_self_repository_factory";

const logger = createLogger("remi-self");

export function remiSelfPersistenceEnabled(): boolean {
  return getConfig().REMI_SELF_PERSISTENCE_ENABLED;
}

/**
 * 从慢脑 snapshot 派生「她还惦记着什么」。优先级：未完线（openLoop）→ 最显著
 * 的 proactive topic → 当前对话摘要 / lastTopicSummary。截断封顶，没有就 null。
 * 纯读取，无副作用。
 */
export function deriveRemiSelfFocus(brain: RemiSessionContext): string | null {
  const snapshot = brain.slowBrain.getSnapshot();
  const openLoop = snapshot.workingMemory?.openLoop;
  const proactiveTopic = snapshot.proactiveTopics?.find((t) => t && t.trim());
  const summary = snapshot.conversationSummary;
  const lastTopicSummary = brain.persona.liveState.lastTopicSummary;

  const candidate =
    normalizeCurrentFocus(openLoop) ??
    normalizeCurrentFocus(proactiveTopic) ??
    normalizeCurrentFocus(summary) ??
    normalizeCurrentFocus(
      lastTopicSummary && lastTopicSummary !== "无最近话题" ? lastTopicSummary : null,
    );

  return candidate;
}

/**
 * 会话启动调用：异步加载 RemiSelf → 漂移 → soft-patch 回 PersonaLiveState +
 * 暂存 currentFocus。【不阻塞】：调用方 fire-and-forget（不 await）。flag off /
 * 无记录 / 失败 → 静默 no-op。
 */
export async function loadAndApplyRemiSelf(
  brain: RemiSessionContext,
  userId: string,
  now: Date = new Date(),
): Promise<void> {
  if (!remiSelfPersistenceEnabled() || !userId) return;

  try {
    const repo = getRemiSelfRepository();
    const saved = await repo.load(userId);
    if (!saved) return; // 首次见这个用户 —— 保持默认。

    const drifted = driftRemiSelf(saved, now);

    // soft-patch：只覆盖三个同构字段，其余 PersonaLiveState 派生逻辑不动。
    brain.persona.liveState.mood = drifted.mood;
    brain.persona.liveState.energy = drifted.energy;
    brain.persona.liveState.topicPull = drifted.topicPull;
    // 暂存 currentFocus 供 prompt 注入（漂移按规则刻意保留）。
    brain.remiSelfFocus = normalizeCurrentFocus(drifted.currentFocus);

    logger.debug("[RemiSelf] restored + drifted", {
      userId,
      mood: drifted.mood,
      energy: drifted.energy,
      hasFocus: Boolean(brain.remiSelfFocus),
      offlineMs: now.getTime() - saved.lastSeenAt.getTime(),
    });
  } catch (err) {
    logger.warn("[RemiSelf] load/apply failed", {
      userId,
      error: (err as Error).message,
    });
  }
}

/**
 * 写回时构造记录：从 PersonaLiveState 读 mood/energy/topicPull + 派生 currentFocus
 * + 置 lastSeenAt/lastSavedAt=now。实际持久化在 continuity.persistRemiSelfState
 * （与 persistRelationshipContinuityState 并排）。
 */
export async function saveRemiSelfFromLiveState(
  brain: RemiSessionContext,
  now: Date = new Date(),
): Promise<void> {
  const userId = brain.userId;
  if (!userId) return;
  await getRemiSelfRepository().save(userId, {
    mood: brain.persona.liveState.mood,
    energy: brain.persona.liveState.energy,
    currentFocus: deriveRemiSelfFocus(brain),
    topicPull: brain.persona.liveState.topicPull,
    lastSeenAt: now,
    lastSavedAt: now,
  });
}
