"use client";

import { SignIn } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { RemiAuthProvider, useRemiWebAuth } from "@/components/RemiAuthProvider";
import { isClerkWebAuthEnabled } from "@/lib/authMode";

type DesktopHandoff =
  | { desktop: false }
  | { desktop: true; valid: false }
  | { desktop: true; valid: true; port: number; state: string };

/**
 * Read the desktop loopback hand-off params (RFC 8252 §7.3). The desktop app
 * passes only an integer `port` and a `state` nonce — never a full callback URL.
 * We rebuild the loopback target from constants in {@link loopbackCallbackUrl},
 * so the redirect can never be pointed at an arbitrary origin: the hand-off has
 * no open-redirect surface.
 */
function readDesktopHandoff(): DesktopHandoff {
  if (typeof window === "undefined") return { desktop: false };
  const params = new URLSearchParams(window.location.search);
  if (params.get("desktop") !== "1") return { desktop: false };

  const rawPort = params.get("port");
  const state = params.get("state");
  const port = Number(rawPort);
  const portValid =
    rawPort !== null && Number.isInteger(port) && port >= 1 && port <= 65535;
  const stateValid = !!state && /^[A-Za-z0-9-]{1,200}$/.test(state);
  if (!portValid || !stateValid) return { desktop: true, valid: false };
  return { desktop: true, valid: true, port, state: state as string };
}

/**
 * Build the loopback callback URL. Scheme/host/path are constants and only the
 * already-validated integer `port` is interpolated, preserving the
 * no-open-redirect property of the original deep-link hand-off.
 */
function loopbackCallbackUrl(port: number, token: string, state: string): string {
  const qs = new URLSearchParams({ token, state });
  return `http://127.0.0.1:${port}/callback?${qs.toString()}`;
}

function SignInPageInner() {
  const router = useRouter();
  const auth = useRemiWebAuth();
  // Computed fresh each render so a Clerk redirect that updates the query string
  // (e.g. after sign-up) is picked up; the effect depends on primitives below.
  const handoff = readDesktopHandoff();
  const desktop = handoff.desktop;
  const handoffPort =
    handoff.desktop && handoff.valid ? handoff.port : null;
  const handoffState =
    handoff.desktop && handoff.valid ? handoff.state : null;
  const [exchangeError, setExchangeError] = useState<string | null>(null);
  const handedOff = useRef(false);

  // Fix C: if we arrived here from a signOut() or from the dead-session
  // force-navigation, a remi_signing_out flag is set in sessionStorage.
  // Read it once on mount: while this flag is live we must NOT redirect even
  // if auth.signedIn is still true (Clerk hasn't cleared its local state yet).
  // The flag is consumed on first read so it can't survive a subsequent
  // deliberate sign-in.
  const [blockAutoRedirect] = useState<boolean>(() => {
    if (typeof sessionStorage === "undefined") return false;
    const flag = sessionStorage.getItem("remi_signing_out") === "1";
    if (flag) sessionStorage.removeItem("remi_signing_out");
    return flag;
  });

  useEffect(() => {
    if (!isClerkWebAuthEnabled()) {
      router.replace("/");
      return;
    }
    // Fix C: block the "already signed in → redirect" path while Clerk is
    // still clearing its local state after a signOut/force-navigation.
    if (blockAutoRedirect) return;
    if (!auth.ready || !auth.signedIn) return;

    if (!desktop) {
      router.replace("/");
      return;
    }
    // Desktop sign-in but the loopback params are missing/invalid — we can't
    // hand the token back. Surface an error instead of redirecting anywhere.
    if (handoffPort === null || handoffState === null) {
      setExchangeError("缺少有效的桌面回调参数，请从桌面端重新发起登录。");
      return;
    }

    if (handedOff.current) return;
    handedOff.current = true;

    const port = handoffPort;
    const state = handoffState;
    let cancelled = false;
    (async () => {
      try {
        const clerkToken = await auth.getSessionToken();
        if (!clerkToken) throw new Error("missing Clerk session token");

        const resp = await fetch("/api/desktop/exchange-token", {
          method: "POST",
          headers: { Authorization: `Bearer ${clerkToken}` },
        });
        if (!resp.ok) {
          throw new Error(`token exchange failed (${resp.status})`);
        }
        const { token } = (await resp.json()) as { token?: string };
        if (!token) throw new Error("token missing from exchange response");
        if (cancelled) return;

        // Hand the long-lived legacy token back to the desktop app's one-shot
        // loopback listener. This MUST be a top-level navigation (not fetch): a
        // top-level navigation to http://127.0.0.1 is exempt from mixed-content
        // and Private Network Access blocking, whereas a fetch would be blocked.
        window.location.href = loopbackCallbackUrl(port, token, state);
      } catch (err) {
        if (cancelled) return;
        handedOff.current = false;
        setExchangeError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [auth, blockAutoRedirect, desktop, handoffPort, handoffState, router]);

  if (!isClerkWebAuthEnabled()) {
    return null;
  }

  if (desktop && auth.ready && auth.signedIn) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6 py-10">
        <div className="max-w-sm text-center text-sm text-neutral-300">
          {exchangeError ? (
            <p>
              登录回传桌面端失败：{exchangeError}
              <br />
              请关闭此窗口后在桌面端重试登录。
            </p>
          ) : (
            <p>正在把登录信息发送回 Remi 桌面端…完成后可关闭此窗口。</p>
          )}
        </div>
      </main>
    );
  }

  // Preserve port & state through Clerk's post-auth redirect so the hand-off
  // params survive a sign-up round-trip.
  const redirectTarget = !handoff.desktop
    ? "/"
    : handoff.valid
      ? `/sign-in?desktop=1&port=${handoff.port}&state=${encodeURIComponent(handoff.state)}`
      : "/sign-in?desktop=1";

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-10">
      <SignIn
        path="/sign-in"
        routing="path"
        signUpForceRedirectUrl={redirectTarget}
        forceRedirectUrl={redirectTarget}
      />
    </main>
  );
}

export default function SignInPage() {
  return (
    <RemiAuthProvider>
      <SignInPageInner />
    </RemiAuthProvider>
  );
}
