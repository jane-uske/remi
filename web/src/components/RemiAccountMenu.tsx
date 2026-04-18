"use client";

import { useEffect, useRef, useState } from "react";

type RemiAccountMenuProps = {
  emotionLabel: string;
  currentUserId: string;
  isDefaultDevUser: boolean;
  wsTargetLabel: string;
  canSignOut: boolean;
  onSignOut: () => Promise<void>;
};

function accountModeLabel(input: {
  isDefaultDevUser: boolean;
  canSignOut: boolean;
}): string {
  if (input.canSignOut) return "clerk-user";
  if (input.isDefaultDevUser) return "default-user";
  return "token-user";
}

export function RemiAccountMenu({
  emotionLabel,
  currentUserId,
  isDefaultDevUser,
  wsTargetLabel,
  canSignOut,
  onSignOut,
}: RemiAccountMenuProps) {
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  const modeLabel = accountModeLabel({
    isDefaultDevUser,
    canSignOut,
  });
  const userLabel =
    currentUserId.length > 18
      ? `${currentUserId.slice(0, 8)}…${currentUserId.slice(-4)}`
      : currentUserId;
  const primaryLabel = canSignOut ? userLabel : modeLabel;
  const secondaryLabel = canSignOut
    ? "当前会话"
    : isDefaultDevUser
      ? "默认开发身份"
      : "token access";
  const avatarGlyph = (currentUserId[0] ?? "R").toUpperCase();

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="group flex min-w-0 items-center gap-3 rounded-full border border-black/15 bg-[rgba(8,63,77,0.82)] px-2.5 py-2 text-left shadow-lg shadow-black/10 backdrop-blur-md transition hover:bg-[rgba(8,63,77,0.92)]"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/18 bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(210,243,250,0.72))] text-sm font-bold text-[#0a4452] shadow-lg shadow-cyan-950/10">
          {avatarGlyph}
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold tracking-tight text-white sm:text-[15px]">
            {primaryLabel}
          </h1>
          <p className="mt-0.5 truncate text-[11px] text-[#b5d7de]">
            {secondaryLabel}
          </p>
        </div>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+0.75rem)] z-20 w-[min(88vw,22rem)] overflow-hidden rounded-3xl border border-[#0f7287]/22 bg-[rgba(6,17,23,0.92)] shadow-2xl shadow-black/35 backdrop-blur-xl"
        >
          <div className="border-b border-white/10 px-4 py-4">
            <p className="text-xs uppercase tracking-[0.22em] text-[var(--remi-dim)]">
              Account
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] text-[var(--foreground)]">
                {modeLabel}
              </span>
              <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] text-[var(--foreground)]">
                uid: {currentUserId}
              </span>
              {wsTargetLabel ? (
                <span className="max-w-full truncate rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] text-[var(--foreground)]">
                  ws: {wsTargetLabel}
                </span>
              ) : null}
              <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] text-[var(--foreground)]">
                emotion: {emotionLabel}
              </span>
            </div>
          </div>

          <div className="px-3 py-3">
            {canSignOut ? (
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-3 text-sm text-[var(--foreground)] transition hover:border-white/20 hover:bg-white/[0.08] disabled:cursor-wait disabled:opacity-60"
                disabled={signingOut}
                onClick={async () => {
                  setSigningOut(true);
                  try {
                    await onSignOut();
                  } finally {
                    setSigningOut(false);
                    setOpen(false);
                  }
                }}
              >
                <span>{signingOut ? "Signing out…" : "Sign out"}</span>
                <span className="text-xs text-[var(--remi-dim)]">
                  Leave session
                </span>
              </button>
            ) : (
              <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-[var(--remi-dim)]">
                当前入口未托管正式 Clerk 会话，不能从这里执行真实登出。
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
