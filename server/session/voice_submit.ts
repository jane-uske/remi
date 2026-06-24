import type { MessageSink } from "../gateway/types";

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
import { assessTranscriptConfidence } from "./voice/repair_signal";
import type { InterruptController } from "../../voice/interrupt_controller";
import { runPipeline } from "../pipeline";
import { send } from "../gateway";
import type { SessionTtsTransport } from "./tts_transport";

const logger = createLogger("session");

interface SessionVoiceSubmitRuntime {
  sink: MessageSink;
  connId: string;
  brain: RemiSessionContext;
  interrupt: InterruptController;
  avatar: AvatarController;
  sessionId: string | null;
  ensureDbSession: () => Promise<string | null>;
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
  getResolvedTtsTransport(): SessionTtsTransport;
  /** PR7 (shadow): forward a SpeechRuntime observation (e.g. repair.requested). */
  observeSpeechEvent?(type: string, data?: Record<string, unknown>): void;
}

interface SubmitVoicePipelineTurnInput {
  text: string;
  traceId: string;
  logPrefix?: string;
  logMeta?: Record<string, unknown>;
  clearPredictionAfterRun?: boolean;
  allowPredictionReuse?: boolean;
  markSttFinalTimestamp?: boolean;
  /** User vocal emotion/event from SenseVoice STT — injected into the LLM prompt. */
  userVocalTone?: string;
}

interface PreparedVoicePipelineTurn {
  traceId: string;
  finalText: string;
  generationId: number;
  carryForwardHint?: string;
  interruptionType: InterruptionType | null;
  allowPredictionReuse: boolean;
  predictionPartialText: string;
  predictedReply: string;
  predictedStructuredAnalysis: TurnAnalysisBundle | null;
  userVocalTone?: string;
}

export function prepareVoicePipelineTurn(
  runtime: SessionVoiceSubmitRuntime,
  input: SubmitVoicePipelineTurnInput,
): PreparedVoicePipelineTurn {
  const disambiguation = disambiguateSttFinal(input.text);
  const finalText = disambiguation.text;
  const allowPredictionReuse = Boolean(input.allowPredictionReuse) && !disambiguation.changed;
  const predictionPartialText = runtime.currentPartialText;
  const predictedReply = runtime.predictedReply;
  const predictedStructuredAnalysis = runtime.predictedStructuredAnalysis;

  if (disambiguation.changed && sttFinalDisambiguationLogDiffEnabled()) {
    logger.info("[STT final disambiguation]", {
      connId: runtime.connId,
      rawText: input.text,
      correctedText: finalText,
      matchedRuleIds: disambiguation.matchedRuleIds,
    });
  }

  // PR7 (shadow): measure how often a committed final would trigger a
  // clarification. Observation only — no clarification is sent, no reply gated.
  const repair = assessTranscriptConfidence(input.text, {
    changed: disambiguation.changed,
    matchedRuleIds: disambiguation.matchedRuleIds,
  });
  if (repair.lowConfidence) {
    runtime.observeSpeechEvent?.("repair.requested", { reason: repair.reason });
  }

  const generationId = runtime.nextGenerationId();
  runtime.bindActiveGeneration(generationId, input.traceId, "voice");
  if (input.markSttFinalTimestamp !== false) {
    runtime.setLastSttFinalAt(Date.now());
  }
  getLatencyTracer(runtime.connId).mark("stt_final", input.traceId);
  getLatencyTracer(runtime.connId).mark("input_received", input.traceId);
  send(runtime.sink, { type: "stt_final", content: finalText });
  logger.info(`${input.logPrefix ?? "[用户·语音]"} ${finalText}`, {
    connId: runtime.connId,
    ...input.logMeta,
  });
  runtime.touchUserActivity(finalText);
  const { interruptionType, carryForwardHint } =
    runtime.classifyCarryForward(finalText);
  getLatencyTracer(runtime.connId).annotateTrace(input.traceId, {
    finalTranscript: finalText,
    interruptionType: interruptionType ?? null,
  });
  runtime.publishTurnState("assistant_entering", "tts_prepare", {
    generationId,
    interruptionType,
    force: true,
  });

  // Final STT has arrived: abort any pending/scheduled prediction before the
  // real reply starts so both paths do not contend for the same LLM/runtime.
  runtime.cancelPrediction();

  return {
    traceId: input.traceId,
    finalText,
    generationId,
    carryForwardHint,
    interruptionType,
    allowPredictionReuse,
    predictionPartialText,
    predictedReply,
    predictedStructuredAnalysis,
    userVocalTone: input.userVocalTone,
  };
}

export async function runPreparedVoicePipelineTurn(
  runtime: SessionVoiceSubmitRuntime,
  prepared: PreparedVoicePipelineTurn,
): Promise<void> {

  const hasValidPrediction =
    prepared.allowPredictionReuse &&
    prepared.predictedReply &&
    prepared.finalText.startsWith(prepared.predictionPartialText) &&
    prepared.predictionPartialText.length > 3;

  if (hasValidPrediction) {
    logger.info("[预判] 命中，复用提前生成的回复", {
      partial: prepared.predictionPartialText.slice(0, 30),
      final: prepared.finalText.slice(0, 30),
      replyPreview: prepared.predictedReply.slice(0, 30),
    });
    await runPipeline(
      runtime.sink,
      prepared.finalText,
      runtime.interrupt,
      runtime.avatar,
      runtime.sessionId,
      runtime.brain,
      prepared.generationId,
      prepared.traceId,
      {
        pregeneratedReply: prepared.predictedReply,
        structuredAnalysis: prepared.predictedStructuredAnalysis ?? undefined,
        carryForwardHint: prepared.carryForwardHint,
        interruptionType: prepared.interruptionType ?? undefined,
        inputSource: "voice",
        ttsTransport: runtime.getResolvedTtsTransport(),
        ensureSessionId: () => runtime.ensureDbSession(),
        userVocalTone: prepared.userVocalTone,
      },
    );
  } else {
    if (prepared.allowPredictionReuse) {
      logger.debug("[预判] 未命中，走正常生成流程", {
        hasPrediction: Boolean(prepared.predictedReply),
        partialLength: prepared.predictionPartialText.length,
      });
    }
    await runPipeline(
      runtime.sink,
      prepared.finalText,
      runtime.interrupt,
      runtime.avatar,
      runtime.sessionId,
      runtime.brain,
      prepared.generationId,
      prepared.traceId,
        {
          carryForwardHint: prepared.carryForwardHint,
          interruptionType: prepared.interruptionType ?? undefined,
          inputSource: "voice",
          ttsTransport: runtime.getResolvedTtsTransport(),
          ensureSessionId: () => runtime.ensureDbSession(),
          userVocalTone: prepared.userVocalTone,
        },
      );
  }
}

export async function submitVoicePipelineTurn(
  runtime: SessionVoiceSubmitRuntime,
  input: SubmitVoicePipelineTurnInput,
): Promise<void> {
  const prepared = prepareVoicePipelineTurn(runtime, input);
  await runPreparedVoicePipelineTurn(runtime, prepared);
}
