"use client";

import { SignIn } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { RemiAuthProvider, useRemiWebAuth } from "@/components/RemiAuthProvider";
import { isClerkWebAuthEnabled } from "@/lib/authMode";

/**
 * Custom URL scheme the Tauri desktop app registers. The redirect target is
 * built from this constant only — never from a query param — so the desktop
 * hand-off has no open-redirect surface.
 */
const DESKTOP_DEEP_LINK_SCHEME = "ai.remi.desktop";

function isDesktopSignIn(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("desktop") === "1";
}

function SignInPageInner() {
  const router = useRouter();
  const auth = useRemiWebAuth();
  const desktop = isDesktopSignIn();
  const [exchangeError, setExchangeError] = useState<string | null>(null);
  const handedOff = useRef(false);

  useEffect(() => {
    if (!isClerkWebAuthEnabled()) {
      router.replace("/");
      return;
    }
    if (!auth.ready || !auth.signedIn) return;

    if (!desktop) {
      router.replace("/");
      return;
    }

    if (handedOff.current) return;
    handedOff.current = true;

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

        // Hand the long-lived legacy token back to the desktop app.
        window.location.href =
          `${DESKTOP_DEEP_LINK_SCHEME}://auth?token=${encodeURIComponent(token)}`;
      } catch (err) {
        if (cancelled) return;
        handedOff.current = false;
        setExchangeError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [auth, desktop, router]);

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

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-10">
      <SignIn
        path="/sign-in"
        routing="path"
        signUpForceRedirectUrl={desktop ? "/sign-in?desktop=1" : "/"}
        forceRedirectUrl={desktop ? "/sign-in?desktop=1" : "/"}
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
