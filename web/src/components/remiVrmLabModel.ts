import type { RemiAvatarRuntimeModel } from "../../../runtime";

export const BUNDLED_VRM_LAB_MODEL_URL = "/vrm/1497262518610234440.vrm";

function pluralizeCue(count: number): string {
  return count === 1 ? "1 cue" : `${count} cues`;
}

export type RemiVrmLabStatus = {
  phaseLabel: string;
  turnLabel: string;
  intentLabel: string;
  lipSyncLabel: string;
  cueCount: number;
};

export function buildRemiVrmLabStatus(
  model: RemiAvatarRuntimeModel,
): RemiVrmLabStatus {
  const intent = model.avatarIntent;
  const lipSync = model.lipSync;
  const cueCount = lipSync.cues.length;

  return {
    phaseLabel: `${model.phase} / ${model.phaseReason}`,
    turnLabel: `${model.turnState ?? "none"} / ${model.turnReason ?? "none"}`,
    intentLabel: intent
      ? `${intent.source} · ${intent.emotion} · ${intent.gesture} · ${intent.facialAccent}`
      : "none",
    lipSyncLabel: lipSync.generationId == null
      ? "none"
      : [
          `gen ${lipSync.generationId}`,
          pluralizeCue(cueCount),
          lipSync.complete ? "complete" : "streaming",
          lipSync.source ?? "unknown-source",
        ].join(" · "),
    cueCount,
  };
}

export function resolveVrmLabModelUrl(configuredUrl: string): string {
  const trimmed = configuredUrl.trim();
  if (/\.vrm(?:$|[?#])/i.test(trimmed)) return trimmed;
  return BUNDLED_VRM_LAB_MODEL_URL;
}
