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

export function resolveClerkRuntimePolicy(input: {
  hostname?: string | null;
  mode?: RemiWebAuthMode;
  publishableKey?: string | null;
}): { clerkEnabled: boolean } {
  const mode = input.mode ?? getRemiWebAuthMode();
  const publishableKey =
    input.publishableKey ?? process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? null;
  const baseClerkEnabled =
    mode === "clerk" &&
    typeof publishableKey === "string" &&
    publishableKey.trim() !== "";

  if (!baseClerkEnabled) {
    return { clerkEnabled: false };
  }

  if (isLiveClerkPublishableKey(publishableKey) && isLoopbackHostname(input.hostname)) {
    return { clerkEnabled: false };
  }

  return {
    clerkEnabled: true,
  };
}
