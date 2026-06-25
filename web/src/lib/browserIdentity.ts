export const MESSAGE_STORAGE_KEY = "remi-chat-messages-v1";
export const LEGACY_MESSAGE_STORAGE_KEY = "rem-chat-messages-v1";
export const DEFAULT_DEV_USER_ID = "00000000-0000-4000-8000-000000000001";

export type ResolvedAuthCapabilities = {
  signedIn: boolean;
  canSignOut: boolean;
};

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
