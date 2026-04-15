import { WebSocket } from "ws";

import type {
  InterruptionType,
  RemiTurnState,
  RemiTurnStateReason,
} from "../../avatar/types";
import type { AvatarController } from "../../avatar/avatar_controller";
import type { TurnAnalysisBundle } from "../../brain/turn_interpreter";
import type { RemiSessionContext } from "../../brains/remi_session_context";
import { createLogger } from "../../infra/logger";
import { getLatencyTracer } from "../../infra/latency_tracer";
import {
  disambiguateSttFinal,
  sttFinalDisambiguationLogDiffEnabled,
} from "../../voice/stt_final_disambiguator";
import type { InterruptController } from "../../voice/interrupt_controller";
import { runPipeline } from "../pipeline";
import { send } from "../gateway";

const logger = createLogger("session");

interface SessionVoiceSubmitRuntime {
  ws: WebSocket;
  connId: string;
  brain: RemiSessionContext;
  interrupt: InterruptController;
  avatar: AvatarController;
  sessionId: string | null;
  currentPartialText: string;
  predictedReply: string;
  predictedStructuredAnalysis: TurnAnalysisBundle | null;
  nextGenerationId(): number;
  bindActiveGeneration(
    generationId: number,
    traceId: string,
    source: "voice" | "text" | "silence_nudge",
  ): void;
  touchUserActivity(userMessage?: string): void;
  classifyCarryForward(userText: string): {
    interruptionType: InterruptionType | null;
    carryForwardHint?: string;
  };
  publishTurnState(
    state: RemiTurnState,
    reason: RemiTurnStateReason,
    extras?: {
      generationId?: number;
      preview?: string;
      interruptionType?: InterruptionType | null;
      force?: boolean;
    },
  ): void;
  setLastSttFinalAt(timestamp: number): void;
  cancelPrediction(): void;
}

interface SubmitVoicePipelineTurnInput {
  text: string;
  traceId: string;
  logPrefix?: string;
  logMeta?: Record<string, unknown>;
  clearPredictionAfterRun?: boolean;
  allowPredictionReuse?: boolean;
  markSttFinalTimestamp?: boolean;
}

export async function submitVoicePipelineTurn(
  runtime: SessionVoiceSubmitRuntime,
  input: SubmitVoicePipelineTurnInput,
): Promise<void> {
  const disambiguation = disambiguateSttFinal(input.text);
  const finalText = disambiguation.text;
  const allowPredictionReuse = Boolean(input.allowPredictionReuse) && !disambiguation.changed;

  if (disambiguation.changed && sttFinalDisambiguationLogDiffEnabled()) {
    logger.info("[STT final disambiguation]", {
      connId: runtime.connId,
      rawText: input.text,
      correctedText: finalText,
      matchedRuleIds: disambiguation.matchedRuleIds,
    });
  }

  const generationId = runtime.nextGenerationId();
  runtime.bindActiveGeneration(generationId, input.traceId, "voice");
  if (input.markSttFinalTimestamp !== false) {
    runtime.setLastSttFinalAt(Date.now());
  }
  getLatencyTracer(runtime.connId).mark("stt_final", input.traceId);
  getLatencyTracer(runtime.connId).mark("input_received", input.traceId);
  send(runtime.ws, { type: "stt_final", content: finalText });
  logger.info(`${input.logPrefix ?? "[用户·语音]"} ${finalText}`, {
    connId: runtime.connId,
    ...input.logMeta,
  });
  runtime.touchUserActivity(finalText);
  const { interruptionType, carryForwardHint } =
    runtime.classifyCarryForward(finalText);
  runtime.publishTurnState("assistant_entering", "tts_prepare", {
    generationId,
    interruptionType,
    force: true,
  });

  const hasValidPrediction =
    allowPredictionReuse &&
    runtime.predictedReply &&
    finalText.startsWith(runtime.currentPartialText) &&
    runtime.currentPartialText.length > 3;

  if (hasValidPrediction) {
    logger.info("[预判] 命中，复用提前生成的回复", {
      partial: runtime.currentPartialText.slice(0, 30),
      final: input.text.slice(0, 30),
      replyPreview: runtime.predictedReply.slice(0, 30),
    });
    await runPipeline(
      runtime.ws,
      finalText,
      runtime.interrupt,
      runtime.avatar,
      runtime.sessionId,
      runtime.brain,
      generationId,
      input.traceId,
      {
        pregeneratedReply: runtime.predictedReply,
        structuredAnalysis: runtime.predictedStructuredAnalysis ?? undefined,
        carryForwardHint,
        interruptionType: interruptionType ?? undefined,
        inputSource: "voice",
      },
    );
  } else {
    if (input.allowPredictionReuse) {
      logger.debug("[预判] 未命中，走正常生成流程", {
        hasPrediction: Boolean(runtime.predictedReply),
        partialLength: runtime.currentPartialText.length,
        disambiguated: disambiguation.changed,
      });
    }
    await runPipeline(
      runtime.ws,
      finalText,
      runtime.interrupt,
      runtime.avatar,
      runtime.sessionId,
      runtime.brain,
      generationId,
      input.traceId,
      {
        carryForwardHint,
        interruptionType: interruptionType ?? undefined,
        inputSource: "voice",
      },
    );
  }

  if (input.clearPredictionAfterRun) {
    runtime.cancelPrediction();
  }
}
