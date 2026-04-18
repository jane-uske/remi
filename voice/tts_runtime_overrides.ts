export interface SessionTtsRuntimeOverride {
  volcVoiceType?: string;
}

const sessionTtsRuntimeOverrides = new Map<string, SessionTtsRuntimeOverride>();

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
  const trimmed = voiceType?.trim();
  const current = sessionTtsRuntimeOverrides.get(connId) ?? {};
  const next: SessionTtsRuntimeOverride = { ...current };

  if (trimmed) {
    next.volcVoiceType = trimmed;
  } else {
    delete next.volcVoiceType;
  }

  if (!next.volcVoiceType) {
    sessionTtsRuntimeOverrides.delete(connId);
    return;
  }

  sessionTtsRuntimeOverrides.set(connId, next);
}

export function clearSessionTtsRuntimeOverride(connId: string): void {
  sessionTtsRuntimeOverrides.delete(connId);
}
