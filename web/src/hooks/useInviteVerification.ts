"use client";

import { useEffect, useState } from "react";
import { useRemiWebAuth } from "@/components/RemiAuthProvider";

const SESSION_KEY = "remi_invite_verified";

export type InviteVerificationState = {
  verified: boolean | null; // null = still loading
  loading: boolean;
};

function readCachedVerified(): boolean {
  try {
    return typeof window !== "undefined" && sessionStorage.getItem(SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Checks whether the current Clerk user has redeemed a registration invite code.
 * - Initializes synchronously from sessionStorage to avoid flash for verified users.
 * - Fails open on network/server errors (don't block the user for infra issues).
 * - Returns `verified: true` when Clerk auth is disabled (dev/legacy mode).
 */
export function useInviteVerification(): InviteVerificationState {
  const auth = useRemiWebAuth();

  // Synchronous init: already-verified users get loading=false immediately,
  // preventing the blank-screen flash on normal /chat refreshes.
  const [state, setState] = useState<InviteVerificationState>(() => {
    if (!auth.clerkEnabled) return { verified: true, loading: false };
    if (readCachedVerified()) return { verified: true, loading: false };
    return { verified: null, loading: true };
  });

  useEffect(() => {
    // Non-Clerk mode: always verified, nothing to check.
    if (!auth.clerkEnabled) {
      setState({ verified: true, loading: false });
      return;
    }

    // Still loading Clerk session — wait for it to settle.
    if (!auth.ready) return;

    // Not signed in — auth gates will redirect, invite check is irrelevant.
    if (!auth.signedIn) {
      setState({ verified: null, loading: false });
      return;
    }

    // Already confirmed via sessionStorage — skip the API call.
    if (readCachedVerified()) {
      setState({ verified: true, loading: false });
      return;
    }

    let cancelled = false;

    const check = async () => {
      try {
        const token = await auth.getSessionToken();
        const res = await fetch("/api/invite/status", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (cancelled) return;
        if (!res.ok) {
          // Fail open: server error should not block the user.
          setState({ verified: true, loading: false });
          return;
        }
        const body = await res.json() as { verified?: boolean };
        const verified = body.verified === true;
        if (verified) {
          try { sessionStorage.setItem(SESSION_KEY, "1"); } catch {}
        }
        if (!cancelled) setState({ verified, loading: false });
      } catch {
        if (!cancelled) setState({ verified: true, loading: false }); // fail open
      }
    };

    void check();
    return () => { cancelled = true; };
  // auth.getSessionToken is stable (memoized), but list all primitives used.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.clerkEnabled, auth.ready, auth.signedIn]);

  return state;
}

/** Call this after a successful invite code redemption to update the cached state. */
export function markInviteVerified(): void {
  try { sessionStorage.setItem(SESSION_KEY, "1"); } catch {}
}

/** Call on sign-out so the next account in this tab re-checks invite status. */
export function clearInviteVerified(): void {
  try { sessionStorage.removeItem(SESSION_KEY); } catch {}
}
