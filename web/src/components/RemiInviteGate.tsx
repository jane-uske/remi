"use client";

import { useEffect, useRef, useState } from "react";
import { useRemiWebAuth } from "@/components/RemiAuthProvider";
import { markInviteVerified } from "@/hooks/useInviteVerification";

const PENDING_INVITE_CODE_KEY = "remi_pending_invite_code";

interface RedeemResult {
  ok: boolean;
  codes?: string[];
  alreadyVerified?: boolean;
  error?: string;
}

async function redeemCode(code: string, token: string | null): Promise<RedeemResult> {
  const res = await fetch("/api/invite/redeem", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ code }),
  });
  const body = await res.json() as RedeemResult & { error?: string };
  if (!res.ok) return { ok: false, error: body.error ?? `HTTP ${res.status}` };
  return body;
}

type Props = {
  onVerified: () => void;
};

/**
 * Fullscreen invite-code entry shown to newly-registered users who haven't yet
 * redeemed an invite code. Pre-fills from `localStorage.remi_pending_invite_code`
 * if the user came from the guest trial CTA.
 */
export function RemiInviteGate({ onVerified }: Props) {
  const auth = useRemiWebAuth();

  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Pre-fill code from localStorage if user came via guest trial
  useEffect(() => {
    try {
      const pending = localStorage.getItem(PENDING_INVITE_CODE_KEY);
      if (pending) {
        setCode(pending.trim().toUpperCase());
        localStorage.removeItem(PENDING_INVITE_CODE_KEY);
      }
    } catch {}
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;

    setLoading(true);
    setError(null);

    try {
      const token = await auth.getSessionToken().catch(() => null);
      const result = await redeemCode(trimmed, token);

      if (!result.ok) {
        setError(result.error ?? "兑换失败，请重试");
        setLoading(false);
        return;
      }

      markInviteVerified();

      if (result.alreadyVerified) {
        onVerified();
        return;
      }

      // Show the user their new codes before proceeding
      setNewCodes(result.codes ?? []);
    } catch {
      setError("网络错误，请稍后重试");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async (text: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 2000);
    } catch {}
  };

  // ── Codes issued screen ──────────────────────────────────────────────────
  if (newCodes !== null) {
    const shareBase = typeof window !== "undefined" ? window.location.origin : "";

    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#080f14] px-6 py-12">
        <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#111827] p-8 text-center">
          <div className="mb-2 text-3xl" aria-hidden>🎉</div>
          <h1 className="mb-2 text-lg font-semibold text-neutral-100">欢迎加入！</h1>
          <p className="mb-6 text-sm text-neutral-400">
            你已获得 {newCodes.length} 个专属邀请码，可以分享给朋友使用。
          </p>

          <div className="mb-6 space-y-3">
            {newCodes.map((c, i) => {
              const shareUrl = `${shareBase}/try/${c}`;
              return (
                <div key={c} className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-left">
                  <p className="mb-1 text-xs text-neutral-500">邀请码 {i + 1}</p>
                  <p className="font-mono text-base font-semibold tracking-widest text-neutral-100">{c}</p>
                  <button
                    type="button"
                    onClick={() => void handleCopy(shareUrl, i)}
                    className="mt-2 text-[11px] text-neutral-500 hover:text-neutral-300 transition"
                  >
                    {copiedIdx === i ? "已复制！" : "复制分享链接"}
                  </button>
                </div>
              );
            })}
          </div>

          <button
            type="button"
            onClick={onVerified}
            className="inline-flex w-full items-center justify-center rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black shadow transition hover:bg-neutral-100"
          >
            开始使用
          </button>
        </div>
      </div>
    );
  }

  // ── Code entry screen ────────────────────────────────────────────────────
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#080f14] px-6 py-12">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#111827] p-8">
        <h1 className="mb-2 text-lg font-semibold text-neutral-100">输入邀请码</h1>
        <p className="mb-6 text-sm text-neutral-400">
          Remi 目前处于受邀内测阶段。请输入好友分享给你的邀请码继续使用。
        </p>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <input
            ref={inputRef}
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="例：ABCD1234"
            maxLength={16}
            autoCapitalize="characters"
            spellCheck={false}
            className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 font-mono text-base tracking-widest text-neutral-100 placeholder-neutral-600 outline-none focus:border-white/30"
          />

          {error && (
            <p className="text-sm text-red-400">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !code.trim()}
            className="inline-flex w-full items-center justify-center rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black shadow transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "验证中…" : "验证并进入"}
          </button>
        </form>
      </div>
    </div>
  );
}
