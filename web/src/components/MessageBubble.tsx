"use client";

import type { MessageRole } from "@/types/chat";

export type MessageBubbleProps = {
  role: MessageRole;
  children: string;
};

const base =
  "remi-msg-bubble remi-msg-pop flex max-w-[min(86%,24rem)] flex-col whitespace-pre-wrap rounded-[1.15rem] px-3 py-2 text-[14px] leading-relaxed tracking-tight min-[480px]:max-w-[min(80%,25rem)] min-[480px]:px-3.5 md:max-w-[min(84%,21.5rem)] md:rounded-[1.35rem] md:px-3.5 md:py-2.5 md:text-[15px]";

const styles: Record<MessageRole, string> = {
  rem:
    "self-start border border-[color:var(--remi-bubble-rem-border)] bg-[var(--remi-bubble-rem-bg)] text-[var(--remi-bubble-rem-fg)] shadow-[0_14px_28px_rgba(0,0,0,0.16)] backdrop-blur-md",
  user:
    "self-end border border-[color:var(--remi-bubble-user-border)] bg-[var(--remi-bubble-user-bg)] text-[var(--remi-bubble-user-fg)] shadow-[0_12px_24px_rgba(0,0,0,0.14)] backdrop-blur-sm",
  partial:
    "self-end border border-white/12 bg-[rgba(37,41,43,0.72)] text-[#b4c7cd] shadow-sm backdrop-blur-sm italic",
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
  rem: "text-[var(--remi-bubble-speaker-rem)]",
  user: "text-[var(--remi-bubble-speaker-user)]",
  partial: "text-[var(--remi-bubble-speaker-partial)]",
  error: "text-[var(--remi-danger)]",
  sys: "text-[var(--remi-dim)]",
};

export function MessageBubble({ role, children }: MessageBubbleProps) {
  return (
    <div className={`${base} ${styles[role]}`} role="article">
      {role !== "sys" && role !== "error" ? (
        <div
          className={`mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${speakerTone[role]}`}
        >
          {speakerLine[role]}
        </div>
      ) : null}
      <span className="sr-only">{speakerLine[role]}: </span>
      <div>{children}</div>
    </div>
  );
}
