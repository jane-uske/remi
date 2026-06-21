import type { WebSocket } from "ws";

import { send } from "../server/gateway";
import { cacheGet, cacheSet, cacheDel } from "../storage/redis";
import { createLogger } from "../infra/logger";

/**
 * Sentinel id that unauthenticated / loopback requests collapse to. Kept in sync
 * with `DEV_STORAGE_USER_ID` in infra/user_identity.ts (inlined here on purpose
 * so this lightweight, widely-imported module doesn't pull the auth/config chain
 * into unit tests). It's a fixed sentinel UUID and effectively never changes.
 */
const SHARED_ANON_USER_ID = "00000000-0000-4000-8000-000000000001";

const logger = createLogger("nsfw_mode");

const WS_OPEN = 1;

/**
 * Per-session "adult / NSFW mode" flag.
 *
 * Toggled at runtime by the user saying "开启成人模式" / "退出成人模式" (handled
 * by the mode_control direct capability), and read by the prompt builder (to
 * switch the chat persona) and the image-generation capability (to switch the
 * ComfyUI checkpoint / negatives). The live flag is scoped to a connection,
 * like {@link ../voice/tts_runtime_overrides}, and cleared when the session
 * ends.
 *
 * On top of the per-connection flag we keep a short-lived **per-user restore
 * window**: when adult mode is on we remember `userId -> expiresAt`. If the same
 * user reconnects within the window (because the WS dropped on a crash / network
 * blip / redeploy — not because they asked to leave), {@link restoreNsfwForUser}
 * re-enables it for the new connection so an *involuntary* disconnect no longer
 * silently drops them back to normal mode. A brand-new session after the window
 * expires still starts off, preserving the "say a phrase to enable" intent.
 *
 * The window is mirrored to Redis (with TTL) so it also survives a process
 * restart; without Redis it falls back to the in-memory map (survives reconnect
 * but not a restart). Saying "退出成人模式" closes the window immediately.
 *
 * The whole feature is additionally gated by the REMI_NSFW_ENABLED config flag
 * (the settings-page master switch); this store is only ever populated while
 * that switch is on.
 */
const nsfwSessions = new Set<string>();
const wsByConn = new Map<string, WebSocket>();

/**
 * How long adult mode survives an involuntary disconnect. Short enough that a
 * genuinely new session next day starts clean; long enough to ride out a crash,
 * redeploy or flaky network. Mirrors the text-session pool's idle TTL feel.
 */
const NSFW_RESTORE_TTL_MS = 30 * 60 * 1000;
const NSFW_RESTORE_TTL_SEC = Math.floor(NSFW_RESTORE_TTL_MS / 1000);

/** userId -> expiresAt(ms). In-memory mirror of the Redis restore window. */
const restoreByUser = new Map<string, number>();

function restoreKey(userId: string): string {
  return `nsfw:restore:${userId}`;
}

/**
 * A shared/anonymous identity must never carry adult mode across people. On a
 * deploy with auth on every user has a unique id; only the unauthenticated
 * fallback collapses to {@link SHARED_ANON_USER_ID}, which we refuse to persist.
 */
function isRestorableUser(userId?: string | null): userId is string {
  const trimmed = userId?.trim();
  return !!trimmed && trimmed !== SHARED_ANON_USER_ID;
}

/** Drop expired in-memory entries so the map can't grow unbounded. */
function pruneExpiredRestores(now: number): void {
  for (const [userId, expiresAt] of restoreByUser) {
    if (now > expiresAt) restoreByUser.delete(userId);
  }
}

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

export function setNsfw(connId: string, on: boolean, userId?: string | null): void {
  const prev = nsfwSessions.has(connId);
  if (on) {
    nsfwSessions.add(connId);
  } else {
    nsfwSessions.delete(connId);
  }

  if (isRestorableUser(userId)) {
    if (on) {
      const now = Date.now();
      pruneExpiredRestores(now);
      const expiresAt = now + NSFW_RESTORE_TTL_MS;
      restoreByUser.set(userId, expiresAt);
      void cacheSet(restoreKey(userId), String(expiresAt), NSFW_RESTORE_TTL_SEC).catch(
        () => {},
      );
    } else {
      // Explicit "退出成人模式": close the restore window right away so a later
      // reconnect does NOT bring adult mode back.
      restoreByUser.delete(userId);
      void cacheDel(restoreKey(userId)).catch(() => {});
    }
  }

  if (prev !== on) {
    publishNsfwModeState(connId, on);
  }
}

/**
 * Clear the *live* per-connection flag on disconnect. Deliberately does NOT
 * touch the per-user restore window — an involuntary disconnect should leave the
 * window open so the user's next connection can restore adult mode.
 */
export function clearNsfw(connId: string): void {
  nsfwSessions.delete(connId);
}

/**
 * On a new connection, re-enable adult mode for `connId` if the user has a live
 * restore window (set while they were last in adult mode and not explicitly
 * exited). Returns whether it was restored. Safe to call for every session;
 * it's a no-op for users without a window / for the shared anonymous id.
 */
export async function restoreNsfwForUser(
  connId: string,
  userId?: string | null,
): Promise<boolean> {
  if (!isRestorableUser(userId)) return false;
  const now = Date.now();

  let expiresAt = restoreByUser.get(userId);
  try {
    const raw = await cacheGet(restoreKey(userId));
    if (raw) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) {
        expiresAt = Math.max(expiresAt ?? 0, parsed);
      }
    }
  } catch {
    // Redis hiccup — fall back to whatever the in-memory mirror knows.
  }

  if (!expiresAt || now > expiresAt) {
    restoreByUser.delete(userId);
    void cacheDel(restoreKey(userId)).catch(() => {});
    return false;
  }

  nsfwSessions.add(connId);
  // Refresh the window so an actively-reconnecting user keeps adult mode alive.
  const renewed = now + NSFW_RESTORE_TTL_MS;
  restoreByUser.set(userId, renewed);
  void cacheSet(restoreKey(userId), String(renewed), NSFW_RESTORE_TTL_SEC).catch(() => {});
  logger.info("adult mode restored after reconnect", { connId });
  return true;
}
