"use client";

import { useState, useCallback } from "react";
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

/**
 * Markdown image pattern: `![alt](url)`
 * Only renders images from our own ComfyUI proxy — LLM-hallucinated image
 * markdown with arbitrary URLs is stripped back to plain text.
 */
const IMG_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;
const TRUSTED_IMG_PREFIX = "/api/comfyui/view";

/* ── Lightbox overlay for full-screen image preview ─────────────────── */

function ImageLightbox({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-label={alt || "图片预览"}
    >
      {/* Close button */}
      <button
        className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/70 transition-colors hover:bg-white/20 hover:text-white"
        onClick={onClose}
        aria-label="关闭"
      >
        ✕
      </button>
      <img
        src={src}
        alt={alt}
        className="max-h-[90vh] max-w-[92vw] rounded-lg object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

/* ── Inline image with click-to-expand ──────────────────────────────── */

function InlineImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const open = useCallback(() => setExpanded(true), []);
  const close = useCallback(() => setExpanded(false), []);

  if (failed) return null;
  return (
    <>
      <img
        src={src}
        alt={alt}
        className="mt-1.5 cursor-pointer rounded-lg transition-opacity hover:opacity-85"
        style={{ maxWidth: "100%", height: "auto" }}
        loading="lazy"
        onClick={open}
        onError={() => setFailed(true)}
      />
      {expanded && <ImageLightbox src={src} alt={alt} onClose={close} />}
    </>
  );
}

function renderContent(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  IMG_RE.lastIndex = 0;
  while ((match = IMG_RE.exec(text)) !== null) {
    const alt = match[1];
    const src = match[2];

    // Only render images from our trusted proxy; strip LLM-hallucinated ones.
    if (!src.startsWith(TRUSTED_IMG_PREFIX)) {
      continue;
    }

    // Text before the image
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(<InlineImage key={key++} src={src} alt={alt} />);
    lastIndex = match.index + match[0].length;
  }

  // Trailing text (or the entire string if no images)
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length === 1 && typeof parts[0] === "string" ? parts[0] : parts;
}

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
      <div>{renderContent(children)}</div>
    </div>
  );
}
