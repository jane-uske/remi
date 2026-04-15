import { WebSocket } from "ws";

import {
  buildEmptyRelationshipState,
  buildRelationshipPresetState,
  isPersonaPresetId,
  isRelationshipPresetId,
} from "../../brains/dev_presets";
import type { RemiSessionContext } from "../../brains/remi_session_context";
import { createLogger } from "../../infra/logger";
import {
  RELATIONSHIP_STATE_KEY,
  relationshipStateEnabled,
} from "../../memory/relationship_state";
import { send } from "../gateway";

const logger = createLogger("session");

export function runSessionDevCommand(
  connId: string,
  ws: WebSocket,
  task: Promise<void>,
): void {
  void task.catch((err) => {
    logger.warn("[DevPreset] command failed", {
      error: (err as Error).message,
      connId,
    });
    send(ws, { type: "error", content: "开发预设操作失败，请稍后重试" });
  });
}

export async function clearPersistentRelationshipState(
  brain: RemiSessionContext,
): Promise<void> {
  const repo =
    brain.persistentRelationshipRepo ??
    brain.memory.getPersistentBackend();
  if (!repo) return;
  await repo.delete(RELATIONSHIP_STATE_KEY);
}

interface SessionDeveloperRuntime {
  ws: WebSocket;
  brain: RemiSessionContext;
  resetDeveloperLiveState(): void;
  persistRelationshipContinuityState(): Promise<void>;
}

interface SessionDeveloperLiveResetRuntime {
  interrupt: { interrupt(): void };
  brain: RemiSessionContext;
  cancelPrediction(): void;
  clearPendingUtteranceTimer(): void;
  clearSilenceNudgeTimer(): void;
  resetPreviewState(): void;
  clearSpeechBuffer(): void;
  resetPreRoll(): void;
  setTurnTakingConfirmedEnd(): void;
  clearPredictionDrafts(): void;
  clearActiveGeneration(): void;
  publishConfirmedEndTurnState(): void;
}

export function resetDeveloperLiveSessionState(
  runtime: SessionDeveloperLiveResetRuntime,
): void {
  runtime.cancelPrediction();
  runtime.clearPendingUtteranceTimer();
  runtime.clearSilenceNudgeTimer();
  runtime.resetPreviewState();
  runtime.clearSpeechBuffer();
  runtime.resetPreRoll();
  runtime.setTurnTakingConfirmedEnd();
  runtime.clearPredictionDrafts();
  runtime.interrupt.interrupt();
  runtime.brain.resetSessionArtifacts();
  runtime.clearActiveGeneration();
  runtime.publishConfirmedEndTurnState();
}

export async function applyDeveloperPreset(
  runtime: SessionDeveloperRuntime,
  data: any,
): Promise<void> {
  const personaPreset =
    typeof data.personaPreset === "string" ? data.personaPreset.trim() : "";
  const relationshipPreset =
    typeof data.relationshipPreset === "string"
      ? data.relationshipPreset.trim()
      : "";
  const resetScope =
    data.resetScope === "all" ||
    data.resetScope === "relationship" ||
    data.resetScope === "session"
      ? data.resetScope
      : "session";

  if (personaPreset && !isPersonaPresetId(personaPreset)) {
    send(runtime.ws, {
      type: "error",
      content: `未知 personaPreset：${personaPreset}`,
    });
    return;
  }

  if (relationshipPreset && !isRelationshipPresetId(relationshipPreset)) {
    send(runtime.ws, {
      type: "error",
      content: `未知 relationshipPreset：${relationshipPreset}`,
    });
    return;
  }

  runtime.resetDeveloperLiveState();

  if (resetScope === "all") {
    await runtime.brain.memory.clearLocal();
    await clearPersistentRelationshipState(runtime.brain);
    runtime.brain.slowBrain.hydratePersistentState(buildEmptyRelationshipState());
  } else if (resetScope === "relationship") {
    await clearPersistentRelationshipState(runtime.brain);
    runtime.brain.slowBrain.hydratePersistentState(buildEmptyRelationshipState());
  }

  if (personaPreset) {
    runtime.brain.applyPersonaPreset(personaPreset);
  }

  if (relationshipPreset) {
    const state = buildRelationshipPresetState(relationshipPreset);
    runtime.brain.hydratePersistentRelationshipState(state);
    if (relationshipStateEnabled()) {
      await runtime.persistRelationshipContinuityState();
    }
  }

  send(runtime.ws, {
    type: "dev_preset_applied",
    personaPreset: personaPreset || null,
    relationshipPreset: relationshipPreset || null,
    resetScope,
  });
}

export async function resetDeveloperState(
  runtime: SessionDeveloperRuntime,
  data: any,
): Promise<void> {
  const scope =
    data.scope === "all" || data.scope === "relationship" || data.scope === "session"
      ? data.scope
      : "session";

  runtime.resetDeveloperLiveState();

  if (scope === "all") {
    await runtime.brain.memory.clearLocal();
    await clearPersistentRelationshipState(runtime.brain);
    runtime.brain.slowBrain.hydratePersistentState(buildEmptyRelationshipState());
  } else if (scope === "relationship") {
    await clearPersistentRelationshipState(runtime.brain);
    runtime.brain.slowBrain.hydratePersistentState(buildEmptyRelationshipState());
  }

  send(runtime.ws, { type: "dev_state_reset", scope });
}
