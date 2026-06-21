import type { MessageSink } from "../gateway/types";

import type { TurnAnalysisBundle } from "../../brain/turn_interpreter";
import { analyzeTurn } from "../../brain/turn_interpreter";
import { fastBrainPredictOnly } from "../../brains/reply_stream";
import { trimHistoryToTokenBudget } from "../../brains/history_budget";
import type { RemiSessionContext } from "../../brains/remi_session_context";
import { getLatencyTracer } from "../../infra/latency_tracer";
import {
  retrievePromptMemory,
} from "../../memory/memory_agent";
import { send } from "../gateway";
import { buildCarryForwardHint, classifyInterruption } from "./interruption";

export type SessionPredictionOptions = {
  mode?: "full" | "short";
  includeCarryForwardHint?: boolean;
};

export type ComputeSessionPredictionInput = {
  connId: string;
  sink: MessageSink;
  brain: RemiSessionContext;
  text: string;
  signal: AbortSignal;
  traceId?: string | null;
  pushPrediction: boolean;
  options?: SessionPredictionOptions;
};

export type ComputeSessionPredictionResult = {
  reply: string;
  analysis: TurnAnalysisBundle | null;
};

export async function computeSessionPrediction(
  input: ComputeSessionPredictionInput,
): Promise<ComputeSessionPredictionResult> {
  const { brain, text, signal, options } = input;
  const latencyTracer = input.traceId ? getLatencyTracer(input.connId) : null;
  const slowBrainSnapshot = brain.slowBrain.getSnapshot();

  if (latencyTracer && input.traceId) {
    latencyTracer.mark("memory_recall_start", input.traceId);
  }
  const memory = await retrievePromptMemory(brain.memory, {
    userId: brain.userId,
    userMessage: text,
    slowBrainSnapshot,
    maxEntries: options?.mode === "short" ? 4 : 5,
    touchSelected: false,
    markEpisodeReferenced: false,
    diagnostics: (meta) => {
      if (latencyTracer && input.traceId) {
        latencyTracer.annotateTrace(input.traceId, {
          episodeRecallSource: meta.episodeRecallSource,
          episodeRecallIds: meta.episodeRecallIds,
          episodeReferenceApplied: meta.episodeReferenceApplied,
        });
      }
    },
  }).finally(() => {
    if (latencyTracer && input.traceId) {
      latencyTracer.mark("memory_recall_end", input.traceId);
    }
  });

  const slowBrainContext = brain.slowBrain.synthesizeContext({
    suppressResponseStyleNotes: Boolean(brain.persona.liveState.styleOverride),
  });
  const historyForPrompt = trimHistoryToTokenBudget(
    [...brain.history],
    options?.mode === "short" ? 1000 : 1200,
  );
  const predictionHistory =
    options?.mode === "short" ? historyForPrompt.slice(-4) : historyForPrompt;

  if (latencyTracer && input.traceId) {
    latencyTracer.mark("turn_analysis_start", input.traceId);
  }
  const analysis = await analyzeTurn({
    userMessage: text,
    history: predictionHistory,
    slowBrainSnapshot,
    inputSource: "voice",
    signal,
  }).finally(() => {
    if (latencyTracer && input.traceId) {
      latencyTracer.mark("turn_analysis_end", input.traceId);
    }
  });

  const interruptedReply =
    brain.lastInterruptedReply?.trim() || brain.currentAssistantDraft?.trim() || null;
  const carryForwardHint =
    options?.includeCarryForwardHint !== false && interruptedReply
      ? buildCarryForwardHint(
          classifyInterruption(text, interruptedReply),
          interruptedReply,
        )
      : undefined;
  const guidance = brain.slowBrain.buildConversationGuidance(
    text,
    analysis?.used ? analysis : null,
  );
  const workingMemoryDraft = analysis?.used
    ? brain.slowBrain.buildWorkingMemoryDraft({
        userMessage: text,
        interpretation: analysis.interpretation,
        responsePolicy: analysis.policy,
      })
    : null;
  const currentContext = brain.slowBrain.buildWorkingMemoryPromptBlock(workingMemoryDraft);
  const reply = await fastBrainPredictOnly({
    userMessage: text,
    emotion: brain.emotion.getEmotion(),
    memory,
    history: predictionHistory,
    currentContext,
    strategyHints: [
      guidance.hints,
      carryForwardHint,
      options?.mode === "short"
        ? "【实时策略】当前是打断/修正语境，请优先用一句短承接。"
        : "",
    ]
      .filter((part): part is string => Boolean(part?.trim()))
      .join("\n\n"),
    slowBrainContext,
    signal,
    persona: brain.persona,
    connId: input.connId,
  });

  if (!signal.aborted && input.pushPrediction && reply) {
    send(input.sink, {
      type: "stt_prediction",
      status: "finished",
      preview: reply.slice(0, 50),
    });
  }

  return {
    reply,
    analysis: analysis?.used ? analysis : null,
  };
}
