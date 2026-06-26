"use client";

import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";

import { useRemiWebAuth } from "@/components/RemiAuthProvider";
import { RemiChatApp } from "@/components/RemiChatApp";
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
 * `/chat` — the chat surface. Requires auth and a valid invite code redemption.
 *
 * Guard contract:
 * - While auth is resolving (Clerk not yet settled): show loading, no redirect.
 * - Signed-out after Clerk settled: redirect to `/`.
 * - Signed-in, invite not yet checked: show loading.
 * - Signed-in, invite not verified: show invite gate.
 * - Signed-in, invite verified: render chat.
 *
 * Pairs with RemiHomeGate at `/`; the two never loop because each redirects
 * only in its own auth state and both wait for `ready`.
 */
export function RemiChatGate() {
  const router = useRouter();
  const auth = useRemiWebAuth();

  // When Clerk is enabled, `auth.ready` is `isLoaded && isSignedIn !== undefined`
  // — it only flips true after Clerk has definitively resolved the session.
  // This prevents the SW-cached fast-boot window from triggering a false redirect.
  const ready = !auth.clerkEnabled || auth.ready;
  const signedIn = auth.signedIn;
  const invite = useInviteVerification();

  // Redirect only fires when auth is truly settled AND sign-in state is known.
  useEffect(() => {
    if (ready && !signedIn) router.replace("/");
  }, [ready, signedIn, router]);

  const handleInviteVerified = useCallback(() => {
    markInviteVerified();
    router.refresh();
  }, [router]);

  // Auth not yet settled — show loading, never redirect.
  if (!ready) return <AuthLoadingScreen />;

  // Signed out — redirect in flight (effect above), show nothing meanwhile.
  if (!signedIn) return null;

  // Auth settled, invite status loading.
  if (invite.loading) return <AuthLoadingScreen />;

  // Invite not redeemed yet.
  if (!invite.verified) return <RemiInviteGate onVerified={handleInviteVerified} />;

  return <RemiChatApp />;
}
