export const MESSAGE_STORAGE_KEY = "remi-chat-messages-v1";
export const LEGACY_MESSAGE_STORAGE_KEY = "rem-chat-messages-v1";
export const DEFAULT_DEV_USER_ID = "00000000-0000-4000-8000-000000000001";

export type ResolvedAuthCapabilities = {
  signedIn: boolean;
  canSignOut: boolean;
};

// ── Loopback device identity ────────────────────────────────────────────
//
// Fix for the "same browser resolves to a different storage user" bug: when
// Clerk is disabled specifically by the live-key-on-loopback safety rail
// (resolveClerkRuntimePolicy's loopbackBlocked), the app used to fall back to
// the single shared DEV_STORAGE_USER_ID for every such visit/visitor. This
// generates (once) and persists a random UUID per browser in localStorage —
// same pattern GuestTrialGate already uses for guest tokens — so repeated
// loopback visits from this browser always resolve to the same, non-shared
// storage user. The UUID itself is exchanged server-side for a signed legacy
// JWT via POST /api/loopback-identity (server/gateway/loopback_identity.ts);
// it's never used as a credential directly.
const LOOPBACK_DEVICE_ID_KEY = "remi_loopback_device_id";

/** Reads the persisted per-browser loopback device id, generating and storing one if absent. */
export function getOrCreateLoopbackDeviceId(): string {
  if (typeof window === "undefined") return "";
  try {
    const existing = window.localStorage.getItem(LOOPBACK_DEVICE_ID_KEY);
    if (existing && UUID_LIKE_RE.test(existing)) return existing;
    const fresh = crypto.randomUUID();
    window.localStorage.setItem(LOOPBACK_DEVICE_ID_KEY, fresh);
    return fresh;
  } catch {
    // localStorage unavailable (private browsing, quota, etc.) — fall back to
    // a session-only id; identity won't persist across reloads, but at least
    // won't collide with the shared dev placeholder within this page life.
    return crypto.randomUUID();
  }
}

const UUID_LIKE_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const json = atob(padded);
    const payload = JSON.parse(json) as unknown;
    if (!payload || typeof payload !== "object") return null;
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function tokenUserId(token?: string | null): string {
  if (!token) return "";
  const payload = decodeJwtPayload(token);
  return typeof payload?.id === "string" ? payload.id.trim() : "";
}

/**
 * A URL-provided (`?token=`) credential only counts as auth if it's present AND
 * not expired. A dead token must never shadow Clerk's real-time state — a stale
 * `?token=` (e.g. a 60s Clerk JWT left in the address bar) otherwise (a) keeps
 * `signedIn` stuck true after a Clerk sign-out — "logged out but still on the
 * chat page" — and (b) is handed to the WebSocket forever, causing a permanent
 * 401 → reconnect loop. Opaque/non-JWT tokens and JWTs without `exp` keep the
 * prior "present = usable" behavior (legacy long-lived tokens).
 */
export function isLegacyTokenUsable(token?: string | null): boolean {
  if (!token) return false;
  const payload = decodeJwtPayload(token);
  if (!payload) return true;
  const exp = typeof payload.exp === "number" ? payload.exp : null;
  if (exp === null) return true;
  return exp * 1000 > Date.now();
}

export function resolveCurrentUserId(input?: {
  clerkUserId?: string | null;
  legacyToken?: string | null;
}): string {
  const clerkUserId = input?.clerkUserId?.trim();
  if (clerkUserId) return clerkUserId;
  const legacyUserId = tokenUserId(input?.legacyToken);
  return legacyUserId || DEFAULT_DEV_USER_ID;
}

export function resolveIsDefaultDevUser(input?: {
  clerkUserId?: string | null;
  legacyToken?: string | null;
}): boolean {
  return resolveCurrentUserId(input) === DEFAULT_DEV_USER_ID;
}

export function resolveAuthCapabilities(input?: {
  clerkEnabled?: boolean;
  clerkSignedIn?: boolean;
  legacyToken?: string | null;
}): ResolvedAuthCapabilities {
  const hasLegacyToken = isLegacyTokenUsable(input?.legacyToken);
  const clerkEnabled = Boolean(input?.clerkEnabled);
  const clerkSignedIn = Boolean(input?.clerkSignedIn);

  if (!clerkEnabled) {
    return {
      signedIn: true,
      canSignOut: false,
    };
  }

  return {
    signedIn: clerkSignedIn || hasLegacyToken,
    canSignOut: clerkSignedIn && !hasLegacyToken,
  };
}

export function resolveMessageStorageKey(input?: {
  clerkUserId?: string | null;
  legacyToken?: string | null;
  currentUserId?: string | null;
  isDefaultDevUser?: boolean;
}): string {
  const currentUserId =
    input?.currentUserId?.trim() ||
    input?.clerkUserId?.trim() ||
    tokenUserId(input?.legacyToken) ||
    DEFAULT_DEV_USER_ID;
  const isDefaultUser =
    input?.isDefaultDevUser ?? currentUserId === DEFAULT_DEV_USER_ID;
  if (isDefaultUser) return MESSAGE_STORAGE_KEY;
  return `${MESSAGE_STORAGE_KEY}:${currentUserId}`;
}
