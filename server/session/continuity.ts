import type { MessageSink } from "../gateway/types";

import type { AvatarController } from "../../avatar/avatar_controller";
import type { RemiSessionContext } from "../../brains/remi_session_context";
import {
  buildSilenceNudgeUserMessage,
  planProactiveNudge,
} from "../../brains/proactive_planner";
import { createLogger } from "../../infra/logger";
import {
  relationshipStateEnabled,
  savePersistentRelationshipState,
} from "../../memory/relationship_state";
import { markReferenced as markReferencedEpisode } from "../../memory/episode_store";
import type { InterruptController } from "../../voice/interrupt_controller";
import { getLatencyTracer } from "../../infra/latency_tracer";
import { runPipeline } from "../pipeline";
import {
  proactivePlannerMainPathEnabled,
  relationshipPeriodicSaveEnabled,
  relationshipPeriodicSaveTurns,
  silenceNudgeMs,
} from "./runtime_config";
import {
  remiSelfPersistenceEnabled,
  saveRemiSelfFromLiveState,
} from "./remi_self";
import { detectFarewellSignal, deriveFarewellFocus } from "./greeting_opener";
import type { SessionTtsTransport } from "./tts_transport";

const logger = createLogger("session");

type TraceSource = "voice" | "text" | "silence_nudge";

export interface SessionContinuityRuntime {
  connId: string;
  sink: MessageSink;
  brain: RemiSessionContext;
  interrupt: InterruptController;
  avatar: AvatarController;
  sessionId: string | null;
  getPipelineChain(): Promise<void>;
  setPipelineChain(next: Promise<void>): void;
  getSilenceNudgeTimer(): ReturnType<typeof setTimeout> | null;
  setSilenceNudgeTimer(timer: ReturnType<typeof setTimeout> | null): void;
  getLastInteractionAt(): number;
  setLastInteractionAt(timestamp: number): void;
  getRecentInteractionCount(): number;
  setRecentInteractionCount(count: number): void;
  continuousConversationThreshold: number;
  continuousConversationTimeoutMs: number;
  continuousSilenceFrames: number;
  defaultSilenceFrames: number;
  syncVadSilenceFrames(frames: number): void;
  nextGenerationId(): number;
  createTraceId(source: TraceSource, generationId?: number): string;
  bindActiveGeneration(generationId: number, traceId: string, source: TraceSource): void;
  getResolvedTtsTransport(): SessionTtsTransport;
}

// ── 关系状态周期性保存 ────────────────────────────────────────────────
//
// persistRelationshipContinuityState 原先只在会话优雅销毁时调用（WS 正常断连
// /error → cleanupSessionResources；SSE pool 30min TTL 回收 → destroyEntry）。
// docker restart / 进程被杀会跳过这两条路径，导致最近一段对话积累的关系演进
// （familiarity/emotionalBond/topicHistory 等）整段丢失。
//
// 这里在原有保存点之外，按用户消息轮次计数，每
// relationshipPeriodicSaveTurns() 轮额外异步写回一次——复用同一个
// persistRelationshipContinuityState，不新增持久化机制。计数器按 connId 隔离，
// 在 touchSessionUserActivity（WS 语音 + SSE 文本共用的每轮入口）里递增，写回
// 本身 fire-and-forget、不 await，绝不阻塞 fast path。flag off 时整段短路，
// 行为与现状逐字节一致。
const periodicSaveTurnCounts = new Map<string, number>();

function notePeriodicSaveTurn(
  runtime: Pick<SessionContinuityRuntime, "brain" | "connId">,
): void {
  if (!relationshipPeriodicSaveEnabled()) return;
  const threshold = relationshipPeriodicSaveTurns();
  if (!(threshold > 0)) return;

  const nextCount = (periodicSaveTurnCounts.get(runtime.connId) ?? 0) + 1;
  if (nextCount < threshold) {
    periodicSaveTurnCounts.set(runtime.connId, nextCount);
    return;
  }

  periodicSaveTurnCounts.set(runtime.connId, 0);
  void persistRelationshipContinuityState(runtime).catch((err) => {
    logger.warn("[陪伴] 周期性关系状态保存失败", {
      error: (err as Error).message,
      connId: runtime.connId,
    });
  });
}

/** 会话结束时清理该 connId 的周期性保存计数器，避免 Map 无界增长。 */
export function clearPeriodicSaveTurnCount(connId: string): void {
  periodicSaveTurnCounts.delete(connId);
}

// ── 收场钩子（活人感闭环，任务 B）────────────────────────────────────────
//
// 用户告别时（"拜拜/晚安/回头聊"…）本轮正常回复不受影响——这里只是在
// touchSessionUserActivity 的每轮入口旁路一个 fire-and-forget 写回，把"下次线头"
// 存进 RemiSelf.currentFocus。不需要她本轮说"我会记住的"：钩子是暗埋的，下次开场
// （server/session/greeting_opener.ts 的素材 a）兑现才是惊喜。
//
// 复用 saveRemiSelfFromLiveState 的持久化路径 + overrideFocus 顶替它默认派生的
// currentFocus；gate 条件对齐 persistRemiSelfState（remiSelfPersistenceEnabled()
// off 时这里也不写，避免在 flag off 时产生现状没有的额外 DB/内存写入）。
function noteFarewellHook(
  runtime: Pick<SessionContinuityRuntime, "brain" | "connId">,
  userMessage: string,
): void {
  if (!remiSelfPersistenceEnabled()) return;
  if (!detectFarewellSignal(userMessage)) return;

  const focus = deriveFarewellFocus(runtime.brain, userMessage);
  void saveRemiSelfFromLiveState(runtime.brain, new Date(), focus).catch((err) => {
    logger.warn("[开场] 收场钩子写入失败", {
      error: (err as Error).message,
      connId: runtime.connId,
    });
  });
}

export function isContinuousConversation(runtime: SessionContinuityRuntime): boolean {
  const now = Date.now();
  return (
    runtime.getRecentInteractionCount() >= runtime.continuousConversationThreshold &&
    now - runtime.getLastInteractionAt() < runtime.continuousConversationTimeoutMs
  );
}

export function syncSessionVadSilenceThreshold(runtime: SessionContinuityRuntime): void {
  runtime.syncVadSilenceFrames(
    isContinuousConversation(runtime)
      ? runtime.continuousSilenceFrames
      : runtime.defaultSilenceFrames,
  );
}

export function touchSessionUserActivity(
  runtime: SessionContinuityRuntime,
  userMessage?: string,
): void {
  const timer = runtime.getSilenceNudgeTimer();
  if (timer) {
    clearTimeout(timer);
    runtime.setSilenceNudgeTimer(null);
  }

  const ms = silenceNudgeMs();
  runtime.brain.slowBrain.recordUserTurnActivity(userMessage);
  if (ms > 0) {
    runtime.setSilenceNudgeTimer(setTimeout(() => fireSessionSilenceNudge(runtime), ms));
  }

  runtime.setLastInteractionAt(Date.now());
  runtime.setRecentInteractionCount(
    Math.min(
      runtime.getRecentInteractionCount() + 1,
      runtime.continuousConversationThreshold,
    ),
  );
  syncSessionVadSilenceThreshold(runtime);

  // 周期性关系状态保存：计数 + 达阈值即 fire-and-forget 写回，不 await、不
  // 影响本轮任何 fast path 时序（详见上方注释）。
  notePeriodicSaveTurn(runtime);

  // 收场钩子：命中告别意图即 fire-and-forget 暗埋下次线头，不影响本轮回复
  // （详见上方注释）。userMessage 可能是 undefined（如打断反应等无文本触发），
  // 此时直接跳过检测。
  if (userMessage) {
    noteFarewellHook(runtime, userMessage);
  }
}

export async function persistRelationshipContinuityState(
  runtime: Pick<SessionContinuityRuntime, "brain" | "connId">,
): Promise<void> {
  if (!relationshipStateEnabled()) return;
  const relationshipRepo =
    runtime.brain.persistentRelationshipRepo ??
    runtime.brain.memory.getPersistentBackend() ??
    runtime.brain.memory;

  try {
    await savePersistentRelationshipState(
      relationshipRepo,
      runtime.brain.slowBrain.exportPersistentState(),
    );
  } catch (err) {
    logger.warn("[陪伴] 连续性状态持久化失败", {
      error: (err as Error).message,
      connId: runtime.connId,
    });
  }
}

/**
 * DL-P1b: RemiSelf 断连写回 —— persistRelationshipContinuityState 的兄弟函数。
 * 在所有调用 persistRelationshipContinuityState 的地方并排 fire-and-forget 调用。
 * flag off（默认）/ 无 userId → no-op；失败只 warn，绝不抛。设计见
 * docs/design/DIGITAL_LIFE_NORTH_STAR.md §1。
 */
export async function persistRemiSelfState(
  runtime: Pick<SessionContinuityRuntime, "brain" | "connId">,
): Promise<void> {
  if (!remiSelfPersistenceEnabled()) return;
  try {
    await saveRemiSelfFromLiveState(runtime.brain);
  } catch (err) {
    logger.warn("[RemiSelf] 自我状态持久化失败", {
      error: (err as Error).message,
      connId: runtime.connId,
    });
  }
}

export function fireSessionSilenceNudge(runtime: SessionContinuityRuntime): void {
  runtime.setSilenceNudgeTimer(null);
  const ms = silenceNudgeMs();
  if (ms <= 0) return;

  if (runtime.interrupt.active) {
    runtime.setSilenceNudgeTimer(
      setTimeout(() => fireSessionSilenceNudge(runtime), 8000),
    );
    return;
  }

  const legacyGatePlan = runtime.brain.slowBrain.buildSilenceNudgePlan();
  if (!legacyGatePlan) {
    runtime.setSilenceNudgeTimer(
      setTimeout(() => fireSessionSilenceNudge(runtime), ms),
    );
    return;
  }

  logger.info("[陪伴] 沉默搭话", { connId: runtime.connId });
  const nextChain = runtime.getPipelineChain()
    .then(async () => {
      const legacyPlan = runtime.brain.slowBrain.buildSilenceNudgePlan();
      if (!legacyPlan) {
        return;
      }

      let nudgePlan = legacyPlan;
      if (proactivePlannerMainPathEnabled()) {
        try {
          const proactivePlan = await planProactiveNudge(
            runtime.brain.userId,
            runtime.brain.slowBrain.getSnapshot(),
          );
          if (proactivePlan) {
            nudgePlan = {
              userMessage: buildSilenceNudgeUserMessage(proactivePlan),
              proactiveCandidate:
                proactivePlan.mode === "presence" ? undefined : proactivePlan.text,
              proactiveCandidateKey: proactivePlan.ledgerKey,
              sharedMomentCandidate: undefined,
              strategyMode: proactivePlan.mode,
              episodeId: proactivePlan.episodeId,
            };
          }
        } catch (err) {
          logger.warn(
            "[陪伴] proactive planner failed, fallback to legacy nudge plan",
            {
              error: (err as Error).message,
              connId: runtime.connId,
            },
          );
        }
      }

      const generationId = runtime.nextGenerationId();
      const traceId = runtime.createTraceId("silence_nudge", generationId);
      const latencyTracer = getLatencyTracer(runtime.connId);
      if (nudgePlan.episodeId) {
        latencyTracer.annotateTrace(traceId, {
          episodeRecallSource: "episode_store",
          episodeRecallIds: [nudgePlan.episodeId],
          episodeReferenceApplied: false,
          episodeRecallFallback: false,
        });
      }
      runtime.bindActiveGeneration(generationId, traceId, "silence_nudge");
      await runPipeline(
        runtime.sink,
        nudgePlan.userMessage,
        runtime.interrupt,
        runtime.avatar,
        runtime.sessionId,
        runtime.brain,
        generationId,
        traceId,
        {
          silenceNudge: true,
          ttsTransport: runtime.getResolvedTtsTransport(),
        },
      );

      const completedWithoutInterrupt =
        !runtime.interrupt.active &&
        runtime.brain.lastInterruptedReply === null;
      if (completedWithoutInterrupt) {
        runtime.brain.slowBrain.recordProactiveOutreach(
          nudgePlan.strategyMode,
          nudgePlan.proactiveCandidateKey,
        );
        if (nudgePlan.episodeId) {
          try {
            await markReferencedEpisode(nudgePlan.episodeId);
            latencyTracer.annotateTrace(traceId, {
              episodeRecallSource: "episode_store",
              episodeRecallIds: [nudgePlan.episodeId],
              episodeReferenceApplied: true,
              episodeRecallFallback: false,
            });
          } catch (err) {
            logger.warn("[陪伴] proactive episode reference update failed", {
              error: (err as Error).message,
              connId: runtime.connId,
              episodeId: nudgePlan.episodeId,
            });
          }
        }
        runtime.brain.slowBrain.markContinuityCueUsed({
          proactiveCandidate: nudgePlan.proactiveCandidate,
          sharedMomentCandidate: nudgePlan.sharedMomentCandidate,
        });
        await persistRelationshipContinuityState(runtime);
      }
    })
    .catch((err) => {
      logger.warn("[陪伴] 沉默搭话失败", {
        error: (err as Error).message,
        connId: runtime.connId,
      });
    })
    .finally(() => {
      if (silenceNudgeMs() > 0) {
        runtime.setSilenceNudgeTimer(
          setTimeout(() => fireSessionSilenceNudge(runtime), ms),
        );
      }
    });

  runtime.setPipelineChain(nextChain);
}
