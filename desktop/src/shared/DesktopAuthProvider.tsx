import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { load } from "@tauri-apps/plugin-store";
import { open as openExternal } from "@tauri-apps/plugin-shell";

import { DEFAULT_DEV_USER_ID } from "@/hooks/useRemiChatHelpers";

// Shared with the Rust auth handler (desktop/src-tauri/src/lib.rs).
const AUTH_STORE_FILE = "auth.json";
const AUTH_TOKEN_KEY = "session_token";
const AUTH_EVENT = "auth-token-updated";
const AUTH_STORE_OPTIONS = { defaults: {}, autoSave: false } as const;

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

const SIGNED_OUT_CONTEXT: RemiWebAuthContextValue = {
  clerkEnabled: false,
  ready: false,
  signedIn: false,
  canSignOut: false,
  currentUserId: DEFAULT_DEV_USER_ID,
  isDefaultDevUser: true,
  getSessionToken: async () => null,
  signOut: async () => {},
};

const RemiWebAuthContext =
  createContext<RemiWebAuthContextValue>(SIGNED_OUT_CONTEXT);

/** Decode the `id` claim from a legacy JWT without verifying it (display only). */
function decodeUserId(token: string): string | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(json) as { id?: unknown };
    return typeof payload.id === "string" ? payload.id : null;
  } catch {
    return null;
  }
}

/** Resolve the web app's HTTP base URL, falling back to the WS URL's origin. */
function resolveWebBaseUrl(): string | null {
  const explicit = process.env.NEXT_PUBLIC_WEB_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  const wsUrl = process.env.NEXT_PUBLIC_WS_URL?.trim();
  if (!wsUrl) return null;
  try {
    const url = new URL(wsUrl);
    url.protocol = url.protocol === "wss:" ? "https:" : "http:";
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/** Shape returned by the Rust `start_auth_loopback` command. */
type LoopbackInfo = { port: number; state: string };

/**
 * Open the web sign-in page in the system browser. Clerk (incl. Google OAuth)
 * runs in the real browser; on success the page navigates back to our one-shot
 * loopback listener (RFC 8252 §7.3), which persists the token and fires
 * AUTH_EVENT so the app connects without a restart.
 *
 * We start the listener first and pass only its ephemeral `port` plus a
 * CSRF-binding `state` nonce to the browser — never a full callback URL — so
 * the web page rebuilds the loopback target from constants and there is no
 * open-redirect surface.
 */
export async function openDesktopSignIn(): Promise<void> {
  const base = resolveWebBaseUrl();
  if (!base) {
    console.error(
      "[desktop-auth] cannot open sign-in: set VITE_WEB_URL or VITE_WS_URL",
    );
    return;
  }
  let info: LoopbackInfo;
  try {
    info = await invoke<LoopbackInfo>("start_auth_loopback");
  } catch (err) {
    console.error("[desktop-auth] failed to start loopback listener", err);
    return;
  }
  const url =
    `${base}/sign-in?desktop=1&port=${info.port}` +
    `&state=${encodeURIComponent(info.state)}`;
  await openExternal(url);
}

export function RemiAuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;

    void (async () => {
      try {
        const store = await load(AUTH_STORE_FILE, AUTH_STORE_OPTIONS);
        const saved = await store.get<string>(AUTH_TOKEN_KEY);
        if (active && saved) setToken(saved);
      } catch (err) {
        console.error("[desktop-auth] failed to load stored token", err);
      }
      if (active) setReady(true);

      try {
        unlisten = await listen<string>(AUTH_EVENT, (event) => {
          if (event.payload) setToken(event.payload);
        });
      } catch (err) {
        console.error("[desktop-auth] failed to subscribe to auth events", err);
      }
    })();

    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  const signOut = useCallback(async () => {
    try {
      const store = await load(AUTH_STORE_FILE, AUTH_STORE_OPTIONS);
      await store.delete(AUTH_TOKEN_KEY);
      await store.save();
    } catch (err) {
      console.error("[desktop-auth] failed to clear token", err);
    }
    setToken(null);
  }, []);

  const value = useMemo<RemiWebAuthContextValue>(() => {
    const userId = token ? decodeUserId(token) : null;
    return {
      clerkEnabled: false,
      ready,
      signedIn: Boolean(token),
      canSignOut: Boolean(token),
      currentUserId: userId ?? DEFAULT_DEV_USER_ID,
      isDefaultDevUser: !userId,
      getSessionToken: async () => token,
      signOut,
    };
  }, [token, ready, signOut]);

  return (
    <RemiWebAuthContext.Provider value={value}>
      {children}
    </RemiWebAuthContext.Provider>
  );
}

export function useRemiWebAuth(): RemiWebAuthContextValue {
  return useContext(RemiWebAuthContext);
}
