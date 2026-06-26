"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { RemiWebAuthProvider, type RemiWebAuthContextValue } from "@/components/RemiAuthProvider";
import { RemiChatApp } from "@/components/RemiChatApp";
import { DEFAULT_DEV_USER_ID } from "@/hooks/useRemiChatHelpers";

// ── Token persistence ──────────────────────────────────────────────────────

const GUEST_TOKEN_KEY = "remi_guest_token";
const GUEST_MSG_COUNT_KEY = "remi_guest_msg_count";

interface StoredGuestSession {
  token: string;
  guestId: string;
  expiresAt: number; // epoch ms
  messageCap: number;
}

function readStoredSession(): StoredGuestSession | null {
  try {
    const raw = localStorage.getItem(GUEST_TOKEN_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as StoredGuestSession;
    if (typeof s.token !== "string" || !s.token) return null;
    if (typeof s.expiresAt !== "number" || Date.now() >= s.expiresAt) return null;
    return s;
  } catch {
    return null;
  }
}

function writeStoredSession(session: StoredGuestSession): void {
  try {
    localStorage.setItem(GUEST_TOKEN_KEY, JSON.stringify(session));
  } catch {}
}

function clearStoredSession(): void {
  try {
    localStorage.removeItem(GUEST_TOKEN_KEY);
    localStorage.removeItem(GUEST_MSG_COUNT_KEY);
  } catch {}
}

function readMsgCount(): number {
  try {
    const raw = localStorage.getItem(GUEST_MSG_COUNT_KEY);
    return raw ? parseInt(raw, 10) || 0 : 0;
  } catch {
    return 0;
  }
}

function writeMsgCount(n: number): void {
  try {
    localStorage.setItem(GUEST_MSG_COUNT_KEY, String(n));
  } catch {}
}

// ── Token fetch ────────────────────────────────────────────────────────────

interface GuestTokenResponse {
  token: string;
  guestId: string;
  expiresIn: number;
  messageCap: number;
}

async function fetchGuestToken(inviteCode: string): Promise<GuestTokenResponse> {
  const qs = inviteCode ? `?code=${encodeURIComponent(inviteCode)}` : "";
  const res = await fetch(`/api/guest-token${qs}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<GuestTokenResponse>;
}

// ── GuestAuthProvider ──────────────────────────────────────────────────────

type TokenState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; session: StoredGuestSession };

function useGuestSession(inviteCode: string): TokenState {
  const [state, setState] = useState<TokenState>({ phase: "loading" });

  useEffect(() => {
    const stored = readStoredSession();
    if (stored) {
      setState({ phase: "ready", session: stored });
      return;
    }

    let cancelled = false;
    fetchGuestToken(inviteCode)
      .then((resp) => {
        if (cancelled) return;
        const session: StoredGuestSession = {
          token: resp.token,
          guestId: resp.guestId,
          expiresAt: Date.now() + resp.expiresIn * 1000,
          messageCap: resp.messageCap,
        };
        writeStoredSession(session);
        setState({ phase: "ready", session });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setState({ phase: "error", message: msg });
      });

    return () => { cancelled = true; };
  }, [inviteCode]);

  return state;
}

function GuestRemiAuthProvider({
  session,
  children,
}: {
  session: StoredGuestSession;
  children: ReactNode;
}) {
  const value = useMemo<RemiWebAuthContextValue>(
    () => ({
      clerkEnabled: false,
      ready: true,
      signedIn: true,
      canSignOut: false,
      currentUserId: session.guestId,
      isDefaultDevUser: session.guestId === DEFAULT_DEV_USER_ID,
      getSessionToken: async () => session.token,
      signOut: async () => {
        clearStoredSession();
        window.location.replace("/");
      },
    }),
    [session],
  );

  return <RemiWebAuthProvider value={value}>{children}</RemiWebAuthProvider>;
}

// ── GuestLoginCTA ──────────────────────────────────────────────────────────

const PENDING_INVITE_CODE_KEY = "remi_pending_invite_code";

function GuestLoginCTA({ remaining, inviteCode }: { remaining: number; inviteCode: string }) {
  const handleLoginClick = () => {
    try {
      if (inviteCode) localStorage.setItem(PENDING_INVITE_CODE_KEY, inviteCode);
    } catch {}
  };

  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 z-40 flex flex-col items-center pb-[max(env(safe-area-inset-bottom),1.5rem)] pt-6"
      style={{ background: "linear-gradient(to top, rgba(9,15,20,0.92) 60%, transparent)" }}
    >
      <div className="pointer-events-auto mx-4 w-full max-w-sm rounded-2xl border border-white/10 bg-[#111827]/90 p-5 text-center shadow-2xl backdrop-blur-md">
        {remaining > 0 ? (
          <p className="mb-1 text-sm font-medium text-neutral-100">
            还剩 {remaining} 条体验额度
          </p>
        ) : (
          <p className="mb-1 text-sm font-medium text-neutral-100">体验额度已用完</p>
        )}
        <p className="mb-4 text-[13px] text-neutral-400">如需继续请登录使用</p>
        <Link
          href="/sign-in"
          onClick={handleLoginClick}
          className="inline-flex w-full items-center justify-center rounded-xl border border-transparent bg-white px-4 py-3 text-sm font-semibold text-black shadow transition hover:bg-neutral-100"
        >
          登录 / 注册
        </Link>
        <p className="mt-3 text-[11px] text-neutral-500">登录后历史对话将保存至账号</p>
      </div>
    </div>
  );
}

// ── GuestChatGate ──────────────────────────────────────────────────────────

function GuestChatGate({ session, inviteCode }: { session: StoredGuestSession; inviteCode: string }) {
  const sentCountRef = useRef(readMsgCount());
  const [capReached, setCapReached] = useState(
    () => sentCountRef.current >= session.messageCap,
  );
  const [remaining, setRemaining] = useState(
    () => Math.max(0, session.messageCap - sentCountRef.current),
  );

  // Show warning banner 3 messages before cap
  const showBanner = capReached || remaining <= 3;

  const handleBeforeSend = useCallback(
    (_text: string): boolean => {
      if (sentCountRef.current >= session.messageCap) {
        setCapReached(true);
        setRemaining(0);
        return false;
      }
      sentCountRef.current += 1;
      writeMsgCount(sentCountRef.current);
      const left = Math.max(0, session.messageCap - sentCountRef.current);
      setRemaining(left);
      if (left === 0) setCapReached(true);
      return true;
    },
    [session.messageCap],
  );

  return (
    <div className="relative h-dvh overflow-hidden">
      <RemiChatApp onBeforeSend={handleBeforeSend} />
      {showBanner && (
        <GuestLoginCTA remaining={remaining} inviteCode={inviteCode} />
      )}
    </div>
  );
}

// ── GuestTrialPage ─────────────────────────────────────────────────────────

function LoadingScreen() {
  return (
    <div className="flex h-dvh items-center justify-center bg-[#080f14]">
      <div className="text-center text-neutral-400 text-sm">正在初始化体验…</div>
    </div>
  );
}

function ErrorScreen({ message }: { message: string }) {
  const isInvalidCode = message.toLowerCase().includes("invalid") || message.toLowerCase().includes("code");
  return (
    <div className="flex h-dvh items-center justify-center bg-[#080f14] px-6">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#111827] p-8 text-center">
        <h1 className="mb-2 text-lg font-semibold text-neutral-100">
          {isInvalidCode ? "邀请码无效" : "无法启动体验"}
        </h1>
        <p className="mb-6 text-sm text-neutral-400">
          {isInvalidCode
            ? "此邀请码不正确或已失效，请确认链接是否正确。"
            : `体验链接暂时不可用。（${message}）`}
        </p>
        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-black shadow"
        >
          回到首页
        </Link>
      </div>
    </div>
  );
}

export function GuestTrialPage({ inviteCode }: { inviteCode: string }) {
  const tokenState = useGuestSession(inviteCode);

  if (tokenState.phase === "loading") return <LoadingScreen />;
  if (tokenState.phase === "error") return <ErrorScreen message={tokenState.message} />;

  return (
    <GuestRemiAuthProvider session={tokenState.session}>
      <GuestChatGate session={tokenState.session} inviteCode={inviteCode} />
    </GuestRemiAuthProvider>
  );
}
