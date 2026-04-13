"use client";

import type { MessageRole } from "@/types/chat";

export type MessageBubbleProps = {
  role: MessageRole;
  children: string;
};

const base =
  "remi-msg-bubble remi-msg-pop max-w-[min(92%,32rem)] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[15px] leading-relaxed tracking-tight min-[480px]:max-w-[min(85%,32rem)] min-[480px]:px-4 min-[480px]:py-3";

const styles: Record<MessageRole, string> = {
  rem:
    "self-start rounded-bl-md border border-white/12 bg-[var(--remi-bubble-rem)] text-[var(--foreground)] shadow-md backdrop-blur-md dark:border-white/10",
  user:
    "self-end rounded-br-md border border-[var(--remi-accent)]/30 bg-[var(--remi-user-bg)] text-[var(--remi-user-fg)] shadow-md backdrop-blur-sm",
  partial:
    "self-end rounded-br-md border border-white/20 bg-white/5 text-[var(--remi-dim)] shadow-sm backdrop-blur-sm italic",
  error:
    "self-center rounded-xl border border-[var(--remi-danger)]/30 bg-[var(--remi-error-bg)] px-4 py-2.5 text-[13px] text-[var(--remi-danger)]",
  sys: "self-center bg-transparent px-1 py-1 text-center text-[11px] text-[var(--remi-dim)]",
};

const speakerLine: Record<MessageRole, string> = {
  rem: "Remi",
  user: "你",
  partial: "你（识别中）",
  error: "Error",
  sys: "System",
};

export function MessageBubble({ role, children }: MessageBubbleProps) {
  return (
    <div className={`${base} ${styles[role]}`} role="article">
      <span className="sr-only">{speakerLine[role]}: </span>
      {children}
    </div>
  );
}
