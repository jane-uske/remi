export interface SessionTtsRuntimeOverride {
  volcVoiceType?: string;
  /** Preset ID from voice_style_presets (e.g. "yujie"). Per-session, set by user chat command or UI. */
  mlxVoiceStyleId?: string;
  /** Speed modifier appended to instruct (e.g. "，语速偏慢"). */
  mlxSpeedModifier?: string;
  /** Pitch modifier appended to instruct (e.g. "，语调偏高"). */
  mlxPitchModifier?: string;
}

const sessionTtsRuntimeOverrides = new Map<string, SessionTtsRuntimeOverride>();

/** True when no fields remain — safe to delete the map entry. */
function isEmpty(o: SessionTtsRuntimeOverride): boolean {
  return (
    !o.volcVoiceType &&
    !o.mlxVoiceStyleId &&
    !o.mlxSpeedModifier &&
    !o.mlxPitchModifier
  );
}

function upsert(connId: string, patch: Partial<SessionTtsRuntimeOverride>): void {
  const next: SessionTtsRuntimeOverride = {
    ...(sessionTtsRuntimeOverrides.get(connId) ?? {}),
    ...patch,
  };
  // Delete any keys set to falsy.
  for (const k of Object.keys(next) as (keyof SessionTtsRuntimeOverride)[]) {
    if (!next[k]) delete next[k];
  }
  if (isEmpty(next)) {
    sessionTtsRuntimeOverrides.delete(connId);
  } else {
    sessionTtsRuntimeOverrides.set(connId, next);
  }
}

export function getSessionTtsRuntimeOverride(
  connId?: string | null,
): SessionTtsRuntimeOverride | null {
  if (!connId) return null;
  return sessionTtsRuntimeOverrides.get(connId) ?? null;
}

export function setSessionVolcVoiceTypeOverride(
  connId: string,
  voiceType?: string | null,
): void {
  upsert(connId, { volcVoiceType: voiceType?.trim() || undefined });
}

export function setSessionMlxVoiceStyle(
  connId: string,
  presetId?: string | null,
): void {
  upsert(connId, { mlxVoiceStyleId: presetId?.trim() || undefined });
}

export function setSessionMlxSpeedModifier(
  connId: string,
  modifier?: string | null,
): void {
  upsert(connId, { mlxSpeedModifier: modifier?.trim() || undefined });
}

export function setSessionMlxPitchModifier(
  connId: string,
  modifier?: string | null,
): void {
  upsert(connId, { mlxPitchModifier: modifier?.trim() || undefined });
}

export function clearSessionTtsRuntimeOverride(connId: string): void {
  sessionTtsRuntimeOverrides.delete(connId);
}
