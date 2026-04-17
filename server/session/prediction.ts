import type { WebSocket } from "ws";

import type { TurnAnalysisBundle } from "../../brain/turn_interpreter";
import { analyzeTurn } from "../../brain/turn_interpreter";
import { fastBrainPredictOnly } from "../../brains/fast_brain";
import { trimHistoryToTokenBudget } from "../../brains/history_budget";
import type { RemiSessionContext } from "../../brains/remi_session_context";
import { getLatencyTracer } from "../../infra/latency_tracer";
import { retrievePromptMemory } from "../../memory/memory_agent";
import { send } from "../gateway";
import { buildCarryForwardHint, classifyInterruption } from "./interruption";

export type SessionPredictionOptions = {
  mode?: "full" | "short";
  includeCarryForwardHint?: boolean;
};

export type ComputeSessionPredictionInput = {
  connId: string;
  ws: WebSocket;
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

  if (latencyTracer && input.traceId) {
    latencyTracer.mark("memory_recall_start", input.traceId);
  }
  const memory = await retrievePromptMemory(brain.memory, {
    userId: brain.userId,
    userMessage: text,
    slowBrainSnapshot: brain.slowBrain.getSnapshot(),
    maxEntries: options?.mode === "short" ? 4 : 5,
  }).finally(() => {
    if (latencyTracer && input.traceId) {
      latencyTracer.mark("memory_recall_end", input.traceId);
    }
  });

  const slowBrainContext = brain.slowBrain.synthesizeContext();
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
    slowBrainSnapshot: brain.slowBrain.getSnapshot(),
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
  const reply = await fastBrainPredictOnly({
    userMessage: text,
    emotion: brain.emotion.getEmotion(),
    memory,
    history: predictionHistory,
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
  });

  if (!signal.aborted && input.pushPrediction && reply) {
    send(input.ws, {
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
