import { WebSocket } from "ws";

import type {
  InterruptionType,
  RemiTurnState,
  RemiTurnStateReason,
} from "../../avatar/types";
import { createLogger } from "../../infra/logger";
import { send } from "../gateway";
import { buildTurnTimingSnapshot } from "./turn_timing";

const logger = createLogger("session");

export interface SessionTurnStateRuntime {
  connId: string;
  ws: WebSocket;
  turnState: RemiTurnState;
  lastPublishedTurnState: RemiTurnState | null;
  lastPublishedTurnReason: RemiTurnStateReason | null;
  turnStateEnteredAt: number;
  lastSpeechStartAt: number;
  lastSpeechEndAt: number;
  lastSttFinalAt: number;
  lastAssistantEnterAt: number;
  lastPlaybackStartAt: number;
  lastMeaningfulGrowthAt: number;
  lastMeaningfulPartialAt: number;
  setTurnState(state: RemiTurnState): void;
  setTurnStateEnteredAt(timestamp: number): void;
  setLastAssistantEnterAt(timestamp: number): void;
  setLastPlaybackStartAt(timestamp: number): void;
  setLastPublishedTurnState(state: RemiTurnState | null): void;
  setLastPublishedTurnReason(reason: RemiTurnStateReason | null): void;
}

export function publishSessionTurnState(
  runtime: SessionTurnStateRuntime,
  state: RemiTurnState,
  reason: RemiTurnStateReason,
  extras?: {
    generationId?: number;
    preview?: string;
    interruptionType?: InterruptionType | null;
    force?: boolean;
  },
): void {
  const now = Date.now();
  const preview = extras?.preview?.trim();
  if (
    !extras?.force &&
    runtime.lastPublishedTurnState === state &&
    runtime.lastPublishedTurnReason === reason
  ) {
    if (!preview && !extras?.interruptionType) {
      return;
    }
  }

  const previousState = runtime.turnState;
  const previousReason = runtime.lastPublishedTurnReason;
  const stateEnteredAt = runtime.turnStateEnteredAt || now;
  const timing = buildTurnTimingSnapshot({
    previousState,
    nextState: state,
    reason,
    nowMs: now,
    stateEnteredAtMs: stateEnteredAt,
    speechStartAtMs: runtime.lastSpeechStartAt || null,
    speechEndAtMs: runtime.lastSpeechEndAt || null,
    sttFinalAtMs: runtime.lastSttFinalAt || null,
    assistantEnterAtMs: runtime.lastAssistantEnterAt || null,
    playbackStartAtMs: runtime.lastPlaybackStartAt || null,
    partialGrowthAtMs: runtime.lastMeaningfulGrowthAt || null,
    partialUpdateAtMs: runtime.lastMeaningfulPartialAt || null,
  });

  runtime.setTurnState(state);
  if (previousState !== state || runtime.turnStateEnteredAt === 0) {
    runtime.setTurnStateEnteredAt(now);
  }
  if (state === "assistant_entering") {
    runtime.setLastAssistantEnterAt(now);
  } else if (state === "assistant_speaking") {
    runtime.setLastPlaybackStartAt(now);
  }
  runtime.setLastPublishedTurnState(state);
  runtime.setLastPublishedTurnReason(reason);

  logger.info("[TurnState]", {
    connId: runtime.connId,
    state,
    reason,
    generationId: extras?.generationId,
    preview: preview || undefined,
    interruptionType: extras?.interruptionType ?? undefined,
  });

  const shouldLogTiming =
    previousState !== state || previousReason !== reason || extras?.force;
  if (shouldLogTiming) {
    logger.info("[TurnTiming]", {
      connId: runtime.connId,
      state,
      reason,
      generationId: extras?.generationId,
      metrics: timing,
    });
  }

  send(runtime.ws, {
    type: "turn_state",
    state,
    reason,
    generationId: extras?.generationId,
    preview: preview || undefined,
    interruptionType: extras?.interruptionType ?? undefined,
  });
}
