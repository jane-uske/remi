"use client";

import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";

import { useRemiWebAuth } from "@/components/RemiAuthProvider";
import { RemiLanding } from "@/components/RemiLanding";
import { useInviteVerification, markInviteVerified } from "@/hooks/useInviteVerification";
import { RemiInviteGate } from "@/components/RemiInviteGate";

function AuthLoadingScreen() {
  return (
    <div className="flex h-dvh items-center justify-center bg-[#080f14]">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/10 border-t-white/40" />
    </div>
  );
}

/**
 * `/` — smart entry.
 *
 * Guard contract:
 * - While auth is resolving: show loading, no redirect.
 * - Signed-out: show landing.
 * - Signed-in, invite verified: redirect to `/chat`.
 * - Signed-in, invite not verified: show invite gate.
 *
 * Pairs with RemiChatGate at `/chat`; the two never loop because each
 * redirects only in its own auth state and both wait for `ready`.
 */
export function RemiHomeGate() {
  const router = useRouter();
  const auth = useRemiWebAuth();

  // See RemiChatGate for the `ready` timing fix rationale.
  const ready = !auth.clerkEnabled || auth.ready;
  const signedIn = auth.signedIn;
  const invite = useInviteVerification();

  useEffect(() => {
    if (ready && signedIn && invite.verified) router.replace("/chat");
  }, [ready, signedIn, invite.verified, router]);

  const handleInviteVerified = useCallback(() => {
    markInviteVerified();
    router.replace("/chat");
  }, [router]);

  // Auth not yet settled — show loading, never redirect.
  if (!ready) return <AuthLoadingScreen />;

  // Signed out — show landing (entry point to sign-in).
  if (!signedIn) return <RemiLanding onEnter={() => router.push("/sign-in")} />;

  // Signed in, invite status loading.
  if (invite.loading) return <AuthLoadingScreen />;

  // Signed in, invite not redeemed yet.
  if (!invite.verified) return <RemiInviteGate onVerified={handleInviteVerified} />;

  // Signed in + verified — redirect in flight (effect above).
  return null;
}
