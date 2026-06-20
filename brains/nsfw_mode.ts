import type { WebSocket } from "ws";

import { send } from "../server/gateway";

const WS_OPEN = 1;

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
const wsByConn = new Map<string, WebSocket>();

export function isNsfwEnabled(connId?: string | null): boolean {
  if (!connId) return false;
  return nsfwSessions.has(connId);
}

function publishNsfwModeState(connId: string, enabled: boolean): void {
  const ws = wsByConn.get(connId);
  if (!ws || ws.readyState !== WS_OPEN) return;
  send(ws, { type: "nsfw_mode_state", enabled });
}

export function bindNsfwNotifier(connId: string, ws: WebSocket): void {
  wsByConn.set(connId, ws);
}

export function unbindNsfwNotifier(connId: string): void {
  wsByConn.delete(connId);
}

export function sendNsfwModeState(connId: string): void {
  publishNsfwModeState(connId, isNsfwEnabled(connId));
}

export function setNsfw(connId: string, on: boolean): void {
  const prev = nsfwSessions.has(connId);
  if (on) {
    nsfwSessions.add(connId);
  } else {
    nsfwSessions.delete(connId);
  }
  if (prev !== on) {
    publishNsfwModeState(connId, on);
  }
}

export function clearNsfw(connId: string): void {
  nsfwSessions.delete(connId);
}