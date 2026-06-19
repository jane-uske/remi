/**
 * Per-session "adult / NSFW mode" flag.
 *
 * Toggled at runtime by the user saying "开启成人模式" / "退出成人模式" (handled
 * by the mode_control direct capability), and read by the prompt builder (to
 * switch the chat persona) and the image-generation capability (to switch the
 * ComfyUI checkpoint / negatives). Scoped to a connection, like
 * {@link ../voice/tts_runtime_overrides}, and cleared when the session ends.
 *
 * The whole feature is additionally gated by the REMI_NSFW_ENABLED config flag
 * (the settings-page master switch); this store is only ever populated while
 * that switch is on.
 */
const nsfwSessions = new Set<string>();

export function isNsfwEnabled(connId?: string | null): boolean {
  if (!connId) return false;
  return nsfwSessions.has(connId);
}

export function setNsfw(connId: string, on: boolean): void {
  if (on) {
    nsfwSessions.add(connId);
  } else {
    nsfwSessions.delete(connId);
  }
}

export function clearNsfw(connId: string): void {
  nsfwSessions.delete(connId);
}
