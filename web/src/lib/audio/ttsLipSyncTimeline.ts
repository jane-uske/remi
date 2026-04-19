import type { TtsLipSyncPatch } from "@/types/avatar";

export type TtsLipSyncTimelineState = {
  generationId: number;
  source: TtsLipSyncPatch["source"];
  complete: boolean;
  cues: TtsLipSyncPatch["cues"];
};

export function applyTtsLipSyncPatch(
  previous: TtsLipSyncTimelineState | null,
  patch: TtsLipSyncPatch,
): TtsLipSyncTimelineState {
  const replace = previous == null || previous.generationId !== patch.generationId || patch.mode === "replace";
  const cues = replace
    ? [...patch.cues]
    : [...previous.cues, ...patch.cues];

  cues.sort((left, right) => left.offsetMs - right.offsetMs);

  return {
    generationId: patch.generationId,
    source: patch.source,
    complete: patch.complete,
    cues,
  };
}

export function resolveActiveTtsLipViseme(
  timeline: TtsLipSyncTimelineState | null,
  elapsedMs: number,
): { name: NonNullable<TtsLipSyncPatch["cues"][number]>["viseme"]; weight: number } | null {
  if (!timeline || elapsedMs < 0) return null;

  for (const cue of timeline.cues) {
    if (elapsedMs < cue.offsetMs) break;
    if (elapsedMs <= cue.offsetMs + cue.durationMs && cue.weight > 0) {
      return {
        name: cue.viseme,
        weight: cue.weight,
      };
    }
  }

  return null;
}

export function clearTtsLipSyncState(
  _timeline: TtsLipSyncTimelineState | null,
): null {
  return null;
}
