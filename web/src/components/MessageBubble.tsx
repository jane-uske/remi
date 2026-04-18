"use client";

import type { MessageRole } from "@/types/chat";

export type MessageBubbleProps = {
  role: MessageRole;
  children: string;
};

const base =
  "remi-msg-bubble remi-msg-pop flex max-w-[min(92%,32rem)] flex-col whitespace-pre-wrap rounded-[1.45rem] px-3.5 py-3 text-[15px] leading-relaxed tracking-tight min-[480px]:max-w-[min(85%,32rem)] min-[480px]:px-4";

const styles: Record<MessageRole, string> = {
  rem:
    "self-start rounded-bl-md border border-[#0e7084]/35 bg-[rgba(4,67,83,0.92)] text-[#eefcff] shadow-[0_16px_36px_rgba(0,0,0,0.22)] backdrop-blur-md",
  user:
    "self-end rounded-br-md border border-white/[0.08] bg-[rgba(37,41,43,0.94)] text-[#f5f7f8] shadow-[0_16px_32px_rgba(0,0,0,0.22)] backdrop-blur-sm",
  partial:
    "self-end rounded-br-md border border-white/12 bg-[rgba(37,41,43,0.72)] text-[#b4c7cd] shadow-sm backdrop-blur-sm italic",
  error:
    "self-center rounded-xl border border-[var(--remi-danger)]/30 bg-[var(--remi-error-bg)] px-4 py-2.5 text-[13px] text-[var(--remi-danger)]",
  sys: "self-center bg-transparent px-1 py-1 text-center text-[11px] text-[var(--remi-dim)]",
};

const speakerLine: Record<MessageRole, string> = {
  rem: "Remi",
  user: "你",
  partial: "你",
  error: "Error",
  sys: "System",
};

const speakerTone: Record<MessageRole, string> = {
  rem: "text-[#89d6e3]",
  user: "text-white/[0.65]",
  partial: "text-white/[0.45]",
  error: "text-[var(--remi-danger)]",
  sys: "text-[var(--remi-dim)]",
};

export function MessageBubble({ role, children }: MessageBubbleProps) {
  return (
    <div className={`${base} ${styles[role]}`} role="article">
      {role !== "sys" && role !== "error" ? (
        <div
          className={`mb-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] ${speakerTone[role]}`}
        >
          {speakerLine[role]}
        </div>
      ) : null}
      <span className="sr-only">{speakerLine[role]}: </span>
      <div>{children}</div>
    </div>
  );
}
