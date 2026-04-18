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

  const authCapabilities = resolveAuthCapabilities({
    clerkEnabled: true,
    clerkSignedIn: Boolean(isSignedIn),
    legacyToken,
  });
  const value = useMemo<RemiWebAuthContextValue>(
    () => ({
      clerkEnabled: true,
      ready: isLoaded || Boolean(legacyToken),
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
        if (legacyToken) return legacyToken;
        return getToken();
      },
      signOut: async () => {
        if (!authCapabilities.canSignOut) return;
        await clerk.signOut({ redirectUrl: "/sign-in" });
      },
    }),
    [authCapabilities.canSignOut, authCapabilities.signedIn, clerk, getToken, isLoaded, legacyToken, userId],
  );

  return (
    <RemiWebAuthContext.Provider value={value}>
      {children}
    </RemiWebAuthContext.Provider>
  );
}

export function RemiAuthProvider({ children }: { children: ReactNode }) {
  const [runtimePolicy, setRuntimePolicy] = useState<{ clerkEnabled: boolean } | null>(null);

  useEffect(() => {
    setRuntimePolicy(
      resolveClerkRuntimePolicy({
        hostname: window.location.hostname,
        mode: getRemiWebAuthMode(),
        publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? null,
      }),
    );
  }, []);

  if (!runtimePolicy) {
    return null;
  }

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
