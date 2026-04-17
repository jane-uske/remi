import { WebSocket } from "ws";

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
import type { InterruptController } from "../../voice/interrupt_controller";
import { runPipeline } from "../pipeline";
import { proactivePlannerMainPathEnabled, silenceNudgeMs } from "./runtime_config";
import type { SessionTtsTransport } from "./tts_transport";

const logger = createLogger("session");

type TraceSource = "voice" | "text" | "silence_nudge";

export interface SessionContinuityRuntime {
  connId: string;
  ws: WebSocket;
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
      runtime.bindActiveGeneration(generationId, traceId, "silence_nudge");
      await runPipeline(
        runtime.ws,
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
