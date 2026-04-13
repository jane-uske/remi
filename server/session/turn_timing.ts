import type { RemiTurnState } from "../../avatar/types";

export interface TurnTimingInput {
  previousState: RemiTurnState | null;
  nextState: RemiTurnState;
  reason: string;
  nowMs: number;
  stateEnteredAtMs: number | null;
  speechStartAtMs: number | null;
  speechEndAtMs: number | null;
  sttFinalAtMs: number | null;
  assistantEnterAtMs: number | null;
  playbackStartAtMs: number | null;
  partialGrowthAtMs: number | null;
  partialUpdateAtMs: number | null;
}

export interface TurnTimingSnapshot {
  transition: string;
  reason: string;
  stateAgeMs?: number;
  sinceSpeechStartMs?: number;
  sinceSpeechEndMs?: number;
  sinceSttFinalMs?: number;
  sinceAssistantEnterMs?: number;
  sincePlaybackStartMs?: number;
  sincePartialGrowthMs?: number;
  sincePartialUpdateMs?: number;
  speechEndToAssistantEnterMs?: number;
  assistantEnterToPlaybackMs?: number;
}

function elapsed(nowMs: number, startedAtMs: number | null): number | undefined {
  if (!startedAtMs || startedAtMs > nowMs) return undefined;
  return nowMs - startedAtMs;
}

export function buildTurnTimingSnapshot(input: TurnTimingInput): TurnTimingSnapshot {
  const previousState = input.previousState ?? "none";
  const transition = `${previousState}->${input.nextState}`;

  const stateAgeMs = elapsed(input.nowMs, input.stateEnteredAtMs);
  const sinceSpeechStartMs = elapsed(input.nowMs, input.speechStartAtMs);
  const sinceSpeechEndMs = elapsed(input.nowMs, input.speechEndAtMs);
  const sinceSttFinalMs = elapsed(input.nowMs, input.sttFinalAtMs);
  const sinceAssistantEnterMs = elapsed(input.nowMs, input.assistantEnterAtMs);
  const sincePlaybackStartMs = elapsed(input.nowMs, input.playbackStartAtMs);
  const sincePartialGrowthMs = elapsed(input.nowMs, input.partialGrowthAtMs);
  const sincePartialUpdateMs = elapsed(input.nowMs, input.partialUpdateAtMs);

  return {
    transition,
    reason: input.reason,
    ...(stateAgeMs !== undefined ? { stateAgeMs } : {}),
    ...(sinceSpeechStartMs !== undefined ? { sinceSpeechStartMs } : {}),
    ...(sinceSpeechEndMs !== undefined ? { sinceSpeechEndMs } : {}),
    ...(sinceSttFinalMs !== undefined ? { sinceSttFinalMs } : {}),
    ...(sinceAssistantEnterMs !== undefined ? { sinceAssistantEnterMs } : {}),
    ...(sincePlaybackStartMs !== undefined ? { sincePlaybackStartMs } : {}),
    ...(sincePartialGrowthMs !== undefined ? { sincePartialGrowthMs } : {}),
    ...(sincePartialUpdateMs !== undefined ? { sincePartialUpdateMs } : {}),
    ...(input.speechEndAtMs && input.assistantEnterAtMs && input.assistantEnterAtMs >= input.speechEndAtMs
      ? { speechEndToAssistantEnterMs: input.assistantEnterAtMs - input.speechEndAtMs }
      : {}),
    ...(input.assistantEnterAtMs && input.playbackStartAtMs && input.playbackStartAtMs >= input.assistantEnterAtMs
      ? { assistantEnterToPlaybackMs: input.playbackStartAtMs - input.assistantEnterAtMs }
      : {}),
  };
}
