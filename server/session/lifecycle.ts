import type { WebSocket } from "ws";

import { isDbReady } from "../../infra/app_state";
import { createLogger } from "../../infra/logger";
import { removeLatencyTracer } from "../../infra/latency_tracer";
import { endSession } from "../../storage/repositories/session_repository";
import { clearNsfw, unbindNsfwNotifier } from "../../brains/nsfw_mode";
import { clearPeriodicSaveTurnCount } from "./continuity";
import { clearGreetingOpenerState } from "./greeting_opener";

const logger = createLogger("session");

export function cleanupSessionResources(input: {
  connId: string;
  sessionId: string | null;
  setDuplexActive: (active: boolean) => void;
  clearDevRuntimeOverrides: () => void;
  resetVad: () => void;
  clearPendingUtteranceTimer: () => void;
  clearSilenceNudgeTimer: () => void;
  resetPreviewState: () => void;
  interruptPipeline: () => void;
  resetStt: () => void;
  clearSpeechBuffer: () => void;
  resetPreRoll: () => void;
  saveRelationshipState?: () => Promise<void>;
}): void {
  try {
    input.setDuplexActive(false);

    try {
      input.resetVad();
    } catch (error) {
      logger.warn("[Cleanup] VAD reset failed", { error, connId: input.connId });
    }

    input.clearPendingUtteranceTimer();
    input.clearSilenceNudgeTimer();
    input.resetPreviewState();

    try {
      input.interruptPipeline();
    } catch (error) {
      logger.warn("[Cleanup] Interrupt failed", { error, connId: input.connId });
    }

    try {
      input.resetStt();
    } catch (error) {
      logger.warn("[Cleanup] STT reset failed", { error, connId: input.connId });
    }

    input.clearSpeechBuffer();
    input.resetPreRoll();
    input.clearDevRuntimeOverrides();
    clearNsfw(input.connId);
    unbindNsfwNotifier(input.connId);

    // 周期性保存计数器（server/session/continuity.ts）随会话销毁一并清理，
    // 避免 Map 无界增长；未触发过周期性保存时是无害的 no-op delete。
    clearPeriodicSaveTurnCount(input.connId);

    // 开场主动语的会话内状态（lastSeenAt / 已发送标记）同理清理。
    clearGreetingOpenerState(input.connId);

    // 断连时保存关系状态（fire-and-forget，不阻塞清理）
    if (input.saveRelationshipState) {
      void input.saveRelationshipState().catch((error) => {
        logger.warn("[Cleanup] Relationship state save failed", {
          error,
          connId: input.connId,
        });
      });
    }

    if (isDbReady() && input.sessionId) {
      void endSession(input.sessionId).catch((error) => {
        logger.warn("[Storage] Failed to end session", {
          error,
          sessionId: input.sessionId,
        });
      });
    }

    removeLatencyTracer(input.connId);
    logger.debug("[Cleanup] All resources released", { connId: input.connId });
  } catch (error) {
    logger.error("[Cleanup] Unexpected error during cleanup", {
      error,
      connId: input.connId,
    });
  }
}

export function attachSessionCloseHandlers(input: {
  ws: WebSocket;
  connId: string;
  cleanup: () => void;
}): void {
  input.ws.on("close", () => {
    logger.info("[Remi] 客户端已断开", { connId: input.connId });
    input.cleanup();
  });

  input.ws.on("error", (error) => {
    logger.error("[WebSocket 错误]", { error, connId: input.connId });
    input.cleanup();
  });
}
