import type { InterruptionType } from "../../avatar/types";
import { classifyInterruption } from "./interruption";
import {
  endsWithSentencePunctuation,
  getMeaningfulTurnPreview,
  isTentativeSpeechText,
  normalizeSpeechText,
  type PartialGrowthTrend,
  type TurnTakingState,
} from "./turn_taking";
import {
  effectiveUtteranceGapMs,
  hesitationHoldMs,
  isSemanticallyCompletePreview,
  parseNonNegativeMs,
  sttPreviewSettleMs,
} from "./runtime_config";

const CARRY_FORWARD_CUE_RE =
  /(继续刚才|继续那个|刚才那个|上次那个|回到刚才|还是那个|接着说|不是那个意思|我想说的是|我其实是想说)/u;

export type PartialShapeSample = {
  at: number;
  normalizedLength: number;
  deltaChars: number;
  semanticallyComplete: boolean;
};

export type PartialShapeAggregates = {
  partialGrowthTrend: PartialGrowthTrend;
  semanticCompletionStreak: number;
  smallDeltaStreak: number;
};

export type PredictionGate = {
  allow: boolean;
  mode: "full" | "short";
  debounceMs: number;
  includeCarryForwardHint: boolean;
  reason: string;
};

export function updatePartialTrackingState(input: {
  content: string;
  lastMeaningfulPartialText: string;
  lastMeaningfulGrowthAt: number;
  recentPartialPlateauCount: number;
  partialShapeSamples: PartialShapeSample[];
  maxSamples: number;
}): {
  preview: string;
  lastMeaningfulPartialText: string;
  lastMeaningfulPartialAt: number;
  lastMeaningfulGrowthAt: number;
  lastMeaningfulGrowthChars: number;
  recentPartialPlateauCount: number;
  partialShapeSamples: PartialShapeSample[];
} | null {
  const preview = getMeaningfulTurnPreview(input.content);
  if (!preview) return null;

  const normalized = normalizeSpeechText(preview);
  if (!normalized) return null;

  const now = Date.now();
  const prevNormalized = normalizeSpeechText(input.lastMeaningfulPartialText);
  let deltaChars = normalized.length;
  let nextGrowthAt = input.lastMeaningfulGrowthAt;
  let nextGrowthChars = 0;
  let nextPlateauCount = input.recentPartialPlateauCount;

  if (!input.lastMeaningfulPartialText || normalized !== prevNormalized) {
    nextGrowthAt = now;
    if (prevNormalized && normalized.startsWith(prevNormalized)) {
      deltaChars = Math.max(0, normalized.length - prevNormalized.length);
      nextGrowthChars = deltaChars;
      nextPlateauCount =
        deltaChars > 0 && deltaChars <= 2 ? input.recentPartialPlateauCount + 1 : 0;
    } else {
      nextGrowthChars = normalized.length;
      deltaChars = normalized.length;
      nextPlateauCount = 0;
    }
  }

  const partialShapeSamples = [
    ...input.partialShapeSamples,
    {
      at: now,
      normalizedLength: normalized.length,
      deltaChars,
      semanticallyComplete: isSemanticallyCompletePreview(preview),
    },
  ];
  if (partialShapeSamples.length > input.maxSamples) {
    partialShapeSamples.splice(0, partialShapeSamples.length - input.maxSamples);
  }

  return {
    preview,
    lastMeaningfulPartialText: preview,
    lastMeaningfulPartialAt: now,
    lastMeaningfulGrowthAt: nextGrowthAt,
    lastMeaningfulGrowthChars: nextGrowthChars,
    recentPartialPlateauCount: nextPlateauCount,
    partialShapeSamples,
  };
}

export function getPartialShapeAggregates(
  samples: PartialShapeSample[],
): PartialShapeAggregates {
  if (samples.length === 0) {
    return {
      partialGrowthTrend: "oscillating",
      semanticCompletionStreak: 0,
      smallDeltaStreak: 0,
    };
  }

  let smallDeltaStreak = 0;
  for (let i = samples.length - 1; i >= 0; i -= 1) {
    if (samples[i].deltaChars > 0 && samples[i].deltaChars <= 2) {
      smallDeltaStreak += 1;
    } else {
      break;
    }
  }

  let semanticCompletionStreak = 0;
  for (let i = samples.length - 1; i >= 0; i -= 1) {
    if (samples[i].semanticallyComplete) {
      semanticCompletionStreak += 1;
    } else {
      break;
    }
  }

  let positiveSteps = 0;
  let negativeSteps = 0;
  for (let i = 1; i < samples.length; i += 1) {
    const delta = samples[i].normalizedLength - samples[i - 1].normalizedLength;
    if (delta > 0) positiveSteps += 1;
    if (delta < 0) negativeSteps += 1;
  }

  const trailing = samples.slice(-3);
  const trailingTinyDelta = trailing.every((entry) => entry.deltaChars <= 2);
  let partialGrowthTrend: PartialGrowthTrend = "oscillating";
  if (smallDeltaStreak >= 2 || trailingTinyDelta) {
    partialGrowthTrend = "plateau";
  } else if (positiveSteps > 0 && negativeSteps === 0) {
    partialGrowthTrend = "expanding";
  }

  return { partialGrowthTrend, semanticCompletionStreak, smallDeltaStreak };
}

function classifyPredictionInterruptionType(
  text: string,
  interruptedReply: string | null,
  lastInterruptionType: InterruptionType | null,
): InterruptionType | null {
  if (text.trim()) {
    return classifyInterruption(text, interruptedReply);
  }
  return lastInterruptionType;
}

export function resolvePredictionGate(input: {
  text: string;
  predictionDebounceMs: number;
  turnTakingState: TurnTakingState;
  aggregates: PartialShapeAggregates;
  interruptedReply: string | null;
  lastInterruptionType: InterruptionType | null;
}): PredictionGate {
  const trimmed = input.text.trim();
  if (!trimmed) {
    return {
      allow: false,
      mode: "full",
      debounceMs: input.predictionDebounceMs,
      includeCarryForwardHint: true,
      reason: "empty_partial",
    };
  }

  const interruptionType = classifyPredictionInterruptionType(
    trimmed,
    input.interruptedReply,
    input.lastInterruptionType,
  );
  const explicitCarryForward = CARRY_FORWARD_CUE_RE.test(trimmed);
  const isHold = input.turnTakingState === "HOLD";

  if (
    isHold &&
    !explicitCarryForward &&
    input.aggregates.partialGrowthTrend === "expanding" &&
    input.aggregates.semanticCompletionStreak === 0
  ) {
    return {
      allow: false,
      mode: "full",
      debounceMs: input.predictionDebounceMs,
      includeCarryForwardHint: true,
      reason: "hold_expanding_partial",
    };
  }

  if (
    isHold &&
    input.aggregates.partialGrowthTrend === "oscillating" &&
    input.aggregates.semanticCompletionStreak === 0 &&
    input.aggregates.smallDeltaStreak < 2
  ) {
    return {
      allow: false,
      mode: "full",
      debounceMs: input.predictionDebounceMs,
      includeCarryForwardHint: true,
      reason: "hold_oscillating_partial",
    };
  }

  if (interruptionType === "topic_switch") {
    const debounceMs = Math.max(120, Math.floor(input.predictionDebounceMs * 0.8));
    if (isHold && input.aggregates.semanticCompletionStreak === 0) {
      return {
        allow: false,
        mode: "short",
        debounceMs,
        includeCarryForwardHint: false,
        reason: "topic_switch_not_stable",
      };
    }
    return {
      allow: true,
      mode: "short",
      debounceMs,
      includeCarryForwardHint: false,
      reason: "topic_switch",
    };
  }

  if (interruptionType === "correction" || interruptionType === "emotional_interrupt") {
    return {
      allow: true,
      mode: "short",
      debounceMs: Math.max(100, Math.floor(input.predictionDebounceMs * 0.65)),
      includeCarryForwardHint: interruptionType === "correction",
      reason: interruptionType,
    };
  }

  if (isHold && input.aggregates.partialGrowthTrend !== "plateau" && input.turnTakingState !== "LIKELY_END") {
    return {
      allow: false,
      mode: "full",
      debounceMs: input.predictionDebounceMs,
      includeCarryForwardHint: true,
      reason: "hold_without_plateau",
    };
  }

  return {
    allow: true,
    mode: "full",
    debounceMs: input.predictionDebounceMs,
    includeCarryForwardHint: true,
    reason: "stable_enough",
  };
}

export function resolveUtteranceGapMs(input: {
  speechDurationMs: number;
  lastPreviewText: string;
  lastPreviewAt: number;
}): number {
  const base = effectiveUtteranceGapMs(input.speechDurationMs);
  if (base <= 0) return 0;

  const preview = input.lastPreviewText.trim();
  if (!preview) return base;

  const holdMs = parseNonNegativeMs(process.env.VAD_UTTERANCE_GAP_PREVIEW_HOLD_MS, 140);
  const releaseMs = parseNonNegativeMs(process.env.VAD_UTTERANCE_GAP_PREVIEW_RELEASE_MS, 60);
  const minMs = parseNonNegativeMs(process.env.VAD_UTTERANCE_GAP_PREVIEW_MIN_MS, 80);
  const maxMs = parseNonNegativeMs(process.env.VAD_UTTERANCE_GAP_PREVIEW_MAX_MS, 520);
  const tentative = isTentativeSpeechText(preview);
  const sentenceClosed = endsWithSentencePunctuation(preview);
  let gap = base;

  if (tentative) {
    gap = Math.max(gap, hesitationHoldMs());
  } else if (sentenceClosed) {
    gap = Math.max(minMs, base - releaseMs);
  } else if (preview.length >= 8) {
    gap = Math.min(maxMs, base + holdMs);
  }

  const settleMs = sttPreviewSettleMs();
  if (settleMs > 0 && !sentenceClosed && input.lastPreviewAt > 0) {
    const age = Date.now() - input.lastPreviewAt;
    if (age < settleMs) {
      gap = Math.max(gap, settleMs - age);
    }
  }
  return gap;
}
