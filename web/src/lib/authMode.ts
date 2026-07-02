export type RemiWebAuthMode = "disabled" | "legacy_jwt" | "clerk";

export function getRemiWebAuthMode(): RemiWebAuthMode {
  const raw = process.env.NEXT_PUBLIC_REMI_AUTH_MODE?.trim().toLowerCase();
  if (raw === "disabled") return "disabled";
  if (raw === "legacy_jwt") return "legacy_jwt";
  if (raw === "clerk") return "clerk";
  return "disabled";
}

export function isClerkWebAuthEnabled(): boolean {
  return (
    getRemiWebAuthMode() === "clerk" &&
    typeof process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY === "string" &&
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.trim() !== ""
  );
}

export function isLoopbackHostname(hostname: string | null | undefined): boolean {
  const normalized = hostname?.trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1"
  );
}

export function isLiveClerkPublishableKey(
  publishableKey: string | null | undefined,
): boolean {
  return publishableKey?.trim().startsWith("pk_live_") ?? false;
}

export type ClerkRuntimePolicy = {
  clerkEnabled: boolean;
  /**
   * True only when Clerk was disabled specifically by the live-key-on-loopback
   * safety rail (not by REMI_AUTH_MODE=disabled/legacy_jwt). Distinguishes "no
   * auth is configured at all" from "this browser would normally use Clerk but
   * can't right now because it's on loopback with a live key" — the latter
   * still identifies a real, distinct user who needs a *stable* per-browser
   * identity, not the shared DEV_STORAGE_USER_ID placeholder. See
   * web/src/components/RemiAuthProvider.tsx LegacyAuthBridge and
   * server/gateway/loopback_identity.ts for how this is consumed.
   */
  loopbackBlocked: boolean;
};

export function resolveClerkRuntimePolicy(input: {
  hostname?: string | null;
  mode?: RemiWebAuthMode;
  publishableKey?: string | null;
}): ClerkRuntimePolicy {
  const mode = input.mode ?? getRemiWebAuthMode();
  const publishableKey =
    input.publishableKey ?? process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? null;
  const baseClerkEnabled =
    mode === "clerk" &&
    typeof publishableKey === "string" &&
    publishableKey.trim() !== "";

  if (!baseClerkEnabled) {
    return { clerkEnabled: false, loopbackBlocked: false };
  }

  if (isLiveClerkPublishableKey(publishableKey) && isLoopbackHostname(input.hostname)) {
    return { clerkEnabled: false, loopbackBlocked: true };
  }

  return {
    clerkEnabled: true,
    loopbackBlocked: false,
  };
}
