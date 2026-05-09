import type { WebSocket } from "ws";

import type { AvatarController } from "../../avatar/avatar_controller";
import type {
  InterruptionType,
  RemiTurnState,
  RemiTurnStateReason,
} from "../../avatar/types";
import type { RemiSessionContext } from "../../brains/remi_session_context";
import { createLogger } from "../../infra/logger";
import { getLatencyTracer } from "../../infra/latency_tracer";
import { runPipeline } from "../pipeline";
import { send } from "../gateway";
import { synthesize, isTtsEnabled } from "../../voice/tts_stream";
import type { InterruptController } from "../../voice/interrupt_controller";
import { randomInterruptReaction } from "./runtime_config";
import type { SessionTtsTransport } from "./tts_transport";

const logger = createLogger("session");

export type SessionTextChatRuntime = {
  ws: WebSocket;
  connId: string;
  brain: RemiSessionContext;
  interrupt: InterruptController;
  avatar: AvatarController;
  sessionId: string | null;
  activeGenerationId: number | null;
  touchUserActivity: (userMessage?: string) => void;
  classifyCarryForward: (userText: string) => {
    interruptionType: InterruptionType | null;
    carryForwardHint?: string;
  };
  sendInterrupt: (generationId?: number | null) => void;
  nextGenerationId: () => number;
  createTraceId: (
    source: "voice" | "text" | "silence_nudge",
    generationId?: number,
  ) => string;
  bindActiveGeneration: (
    generationId: number,
    traceId: string,
    source: "voice" | "text" | "silence_nudge",
  ) => void;
  publishTurnState: (
    state: RemiTurnState,
    reason: RemiTurnStateReason,
    extras?: {
      generationId?: number;
      preview?: string;
      interruptionType?: InterruptionType | null;
      force?: boolean;
    },
  ) => void;
  setPipelineChain: (next: Promise<void>) => void;
  getPipelineChain: () => Promise<void>;
  getResolvedTtsTransport: () => SessionTtsTransport;
};

export function handleSessionTextChat(
  runtime: SessionTextChatRuntime,
  data: { content?: string | null },
): void {
  const content = data.content ?? "";
  if (!content?.trim()) {
    send(runtime.ws, { type: "error", content: "消息内容为空" });
    return;
  }

  logger.info(`[用户] ${content}`, { connId: runtime.connId });
  runtime.touchUserActivity(content);
  if (runtime.interrupt.active && runtime.brain.currentAssistantDraft?.trim()) {
    runtime.brain.lastInterruptedReply = runtime.brain.currentAssistantDraft.trim();
  }
  const { interruptionType, carryForwardHint } = runtime.classifyCarryForward(content);

  const interruptedGenerationId = runtime.activeGenerationId;
  const interruptReactionEnabled =
    process.env.interrupt_reaction !== "0" && isTtsEnabled();
  if (runtime.interrupt.active && interruptReactionEnabled) {
    void synthesize(
      randomInterruptReaction(),
      undefined,
      runtime.brain.emotion.getEmotion() as any,
      {
        connId: runtime.connId,
        generationId: interruptedGenerationId ?? 0,
        usage: "interrupt_reaction",
        relationalStance: runtime.brain.persona.liveState.relationalStance,
        responsePolicy: runtime.brain.lastResponsePolicy ?? null,
      },
    )
      .then((buf) => {
        send(runtime.ws, {
          type: "voice",
          audio: buf.toString("base64"),
          generationId: interruptedGenerationId ?? 0,
        });
        runtime.sendInterrupt(interruptedGenerationId ?? null);
      })
      .catch(() => {
        runtime.sendInterrupt(interruptedGenerationId ?? null);
      });
    runtime.interrupt.interrupt();
    logger.info("[Chat] → interrupted pipeline with reaction", {
      connId: runtime.connId,
    });
    runtime.publishTurnState("interrupted_by_user", "user_interrupt", {
      generationId: interruptedGenerationId ?? undefined,
      interruptionType: interruptionType ?? "unknown",
      force: true,
    });
  } else if (runtime.interrupt.active) {
    runtime.sendInterrupt(interruptedGenerationId ?? null);
    runtime.interrupt.interrupt();
    runtime.publishTurnState("interrupted_by_user", "user_interrupt", {
      generationId: interruptedGenerationId ?? undefined,
      interruptionType: interruptionType ?? "unknown",
      force: true,
    });
  }

  const generationId = runtime.nextGenerationId();
  const traceId = runtime.createTraceId("text", generationId);
  runtime.bindActiveGeneration(generationId, traceId, "text");
  getLatencyTracer(runtime.connId).mark("input_received", traceId);
  getLatencyTracer(runtime.connId).annotateTrace(traceId, {
    finalTranscript: content,
    interruptionType: interruptionType ?? null,
  });
  runtime.publishTurnState("assistant_entering", "tts_prepare", {
    generationId,
    interruptionType,
    force: true,
  });

  const nextPipelineChain = runtime
    .getPipelineChain()
    .then(() =>
      runPipeline(
        runtime.ws,
        content,
        runtime.interrupt,
        runtime.avatar,
        runtime.sessionId,
        runtime.brain,
        generationId,
        traceId,
        {
          carryForwardHint,
          interruptionType: interruptionType ?? undefined,
          inputSource: "text",
          ttsTransport: runtime.getResolvedTtsTransport(),
        },
      ),
    )
    .catch((err) => logger.error("[pipeline]", { error: err, connId: runtime.connId }));
  runtime.setPipelineChain(nextPipelineChain);
}
