"use client";

import {
  ClerkProvider,
  useClerk,
  useAuth,
} from "@clerk/nextjs";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  getRemiWebAuthMode,
  resolveClerkRuntimePolicy,
} from "@/lib/authMode";
import {
  DEFAULT_DEV_USER_ID,
  getQueryTokenFromWindow,
  resolveAuthCapabilities,
  resolveCurrentUserId,
  resolveIsDefaultDevUser,
} from "@/hooks/useRemiChatHelpers";
import { isLegacyTokenUsable } from "@/lib/browserIdentity";

async function clearSwCaches(): Promise<void> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    reg.active?.postMessage({ type: "CLEAR_CACHES" });
  } catch {
    // SW not available or message blocked
  }
}

function forceSignOutNavigation(): void {
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.setItem("remi_signing_out", "1");
  }
  void clearSwCaches();
  window.location.replace("/sign-in");
}

type RemiWebAuthContextValue = {
  clerkEnabled: boolean;
  ready: boolean;
  signedIn: boolean;
  canSignOut: boolean;
  currentUserId: string;
  isDefaultDevUser: boolean;
  getSessionToken: () => Promise<string | null>;
  signOut: () => Promise<void>;
};

const DEFAULT_CONTEXT: RemiWebAuthContextValue = {
  clerkEnabled: false,
  ready: true,
  signedIn: true,
  canSignOut: false,
  currentUserId: DEFAULT_DEV_USER_ID,
  isDefaultDevUser: true,
  getSessionToken: async () => getQueryTokenFromWindow(),
  signOut: async () => {},
};

const RemiWebAuthContext =
  createContext<RemiWebAuthContextValue>(DEFAULT_CONTEXT);

function LegacyAuthBridge({ children }: { children: ReactNode }) {
  const legacyToken = getQueryTokenFromWindow();
  const value = useMemo<RemiWebAuthContextValue>(
    () => ({
      clerkEnabled: false,
      ready: true,
      signedIn: true,
      canSignOut: false,
      currentUserId: resolveCurrentUserId({ legacyToken }),
      isDefaultDevUser: resolveIsDefaultDevUser({ legacyToken }),
      getSessionToken: async () => legacyToken,
      signOut: async () => {},
    }),
    [legacyToken],
  );

  return (
    <RemiWebAuthContext.Provider value={value}>
      {children}
    </RemiWebAuthContext.Provider>
  );
}

function ClerkAuthBridge({ children }: { children: ReactNode }) {
  const legacyToken = getQueryTokenFromWindow();
  const { isLoaded, isSignedIn, userId, getToken } = useAuth();
  const clerk = useClerk();
  // Tracks consecutive getToken() null returns while isSignedIn=true.
  // When the Clerk session is dead server-side, getToken() keeps returning
  // null; after MAX_TOKEN_FAILURES consecutive failures we force a hard
  // sign-out instead of looping forever with 404 token-refresh requests.
  const getTokenFailRef = useRef(0);
  const MAX_TOKEN_FAILURES = 3;

  // A `?token=` in the address bar is only meaningful for the legacy/desktop
  // (clerk-disabled) flow. In clerk mode it's spurious — a stale one hijacks
  // auth: it keeps `signedIn` stuck (so sign-out bounces back to the chat page)
  // and gets handed to the WebSocket forever (permanent 401 loop). Strip it on
  // mount so it can't persist across reloads or navigations.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.has("token")) {
      url.searchParams.delete("token");
      window.history.replaceState(null, "", url.toString());
    }
  }, []);

  const authCapabilities = resolveAuthCapabilities({
    clerkEnabled: true,
    clerkSignedIn: Boolean(isSignedIn),
    legacyToken,
  });
  const value = useMemo<RemiWebAuthContextValue>(
    () => ({
      clerkEnabled: true,
      ready: isLoaded || isLegacyTokenUsable(legacyToken),
      signedIn: authCapabilities.signedIn,
      canSignOut: authCapabilities.canSignOut,
      currentUserId: resolveCurrentUserId({
        clerkUserId: userId ?? null,
        legacyToken,
      }),
      isDefaultDevUser: resolveIsDefaultDevUser({
        clerkUserId: userId ?? null,
        legacyToken,
      }),
      getSessionToken: async () => {
        // Clerk is the source of truth when signed in — always use its
        // auto-refreshed session token. Only fall back to a URL `?token=` when
        // Clerk isn't signed in AND that token is still usable (not expired);
        // a stale one must never shadow Clerk — a dead `?token=` otherwise gets
        // handed to the WebSocket forever, causing a permanent 401 → reconnect
        // loop even though the Clerk session is alive.
        if (isSignedIn) {
          const token = await getToken();
          if (!token) {
            // Fix A: getToken() returned null while isSignedIn=true — the
            // session is dead server-side (404 on /tokens endpoint). Count
            // consecutive failures; after MAX_TOKEN_FAILURES force a hard
            // sign-out so the 404-retry loop stops immediately.
            getTokenFailRef.current += 1;
            if (getTokenFailRef.current >= MAX_TOKEN_FAILURES) {
              getTokenFailRef.current = 0;
              void clerk.signOut().catch(() => {});
              forceSignOutNavigation();
            }
            return null;
          }
          getTokenFailRef.current = 0;
          return token;
        }
        if (isLegacyTokenUsable(legacyToken)) return legacyToken;
        return getToken();
      },
      // Fix B: signOut always navigates to /sign-in, regardless of
      // canSignOut. When the Clerk session is already dead server-side,
      // canSignOut is false (clerkSignedIn flipped to false) but the user
      // still needs a way out. We fire clerk.signOut() for cleanup and use
      // forceSignOutNavigation() as the guaranteed escape hatch — it sets the
      // remi_signing_out sessionStorage flag (Fix C guard) and clears SW
      // caches (Fix D) before navigating.
      signOut: async () => {
        void clerk.signOut().catch(() => {});
        forceSignOutNavigation();
      },
    }),
    [authCapabilities.canSignOut, authCapabilities.signedIn, clerk, getToken, isLoaded, isSignedIn, legacyToken, userId],
  );

  return (
    <RemiWebAuthContext.Provider value={value}>
      {children}
    </RemiWebAuthContext.Provider>
  );
}

export function RemiAuthProvider({ children }: { children: ReactNode }) {
  // resolveClerkRuntimePolicy is a pure sync function. Compute it synchronously
  // on the first render (lazy initializer) so the chat subtree mounts on frame
  // 1 and the WebSocket connects immediately on page load — instead of being
  // deferred by a useEffect → setState cycle that left the whole app
  // unmounted (`return null`) for one render and made "first refresh"
  // connections miss.
  //
  // On the server, `window` is absent; resolveClerkRuntimePolicy only touches
  // `window.location.hostname` when clerk is enabled, which is gated on a
  // build-time env var — so SSR is safe. After mount, re-resolve with the real
  // client hostname in case Clerk was promoted/demoted by a loopback rule
  // (live key on localhost).
  const [runtimePolicy, setRuntimePolicy] = useState(() =>
    resolveClerkRuntimePolicy({
      hostname: typeof window !== "undefined" ? window.location.hostname : null,
      mode: getRemiWebAuthMode(),
      publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? null,
    }),
  );

  useEffect(() => {
    setRuntimePolicy(
      resolveClerkRuntimePolicy({
        hostname: window.location.hostname,
        mode: getRemiWebAuthMode(),
        publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? null,
      }),
    );
  }, []);

  if (!runtimePolicy.clerkEnabled) {
    return <LegacyAuthBridge>{children}</LegacyAuthBridge>;
  }

  return (
    <ClerkProvider
      signInUrl="/sign-in"
      signInFallbackRedirectUrl="/"
      afterSignOutUrl="/sign-in"
    >
      <ClerkAuthBridge>{children}</ClerkAuthBridge>
    </ClerkProvider>
  );
}

export function useRemiWebAuth(): RemiWebAuthContextValue {
  return useContext(RemiWebAuthContext);
}
