"use client";

import { useState, useCallback, type ReactNode } from "react";
import type { MessageRole } from "@/types/chat";
import { InlineVideo } from "./InlineVideo";

export type MessageBubbleProps = {
  role: MessageRole;
  children: ReactNode;
  wide?: boolean;
  /** User-attached image (data URL or blob URL) — displayed above the text. */
  imageUrl?: string;
};

const base =
  "remi-msg-bubble remi-msg-pop flex flex-col whitespace-pre-wrap rounded-[1.15rem] px-3 py-2 text-[14px] leading-relaxed tracking-tight min-[480px]:px-3.5 md:rounded-[1.35rem] md:px-3.5 md:py-2.5 md:text-[15px]";

const baseWidth = {
  default:
    "max-w-[min(86%,24rem)] min-[480px]:max-w-[min(80%,25rem)] md:max-w-[min(84%,21.5rem)]",
  wide:
    "max-w-[min(92%,36rem)] min-[480px]:max-w-[min(90%,38rem)] md:max-w-[min(88%,42rem)]",
} as const;

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
/**
 * Video marker: `[video:runName](videoUrl|posterUrl)`
 * Rendered as InlineVideo — same security filter as images (must be our proxy).
 */
const VIDEO_RE = /\[video:([^\]]+)\]\(([^|)]+)\|([^)]+)\)/g;
const TRUSTED_VIDEO_PREFIX = "/api/comfyui/video";
/**
 * Live progress marker: `[videoprogress:<pct>|<label>]` — pushed/upserted while
 * a video render is running. Self-generated (never from the LLM), so no URL
 * filter is needed; the percent is clamped at render time.
 */
const VIDEOPROGRESS_RE = /\[videoprogress:(\d{1,3})\|([^\]]*)\]/g;

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

/* ── Live video-generation progress bar ─────────────────────────────── */

function VideoProgressBar({ percent, label }: { percent: number; label: string }) {
  const pct = Math.min(100, Math.max(0, percent));
  return (
    <div className="mt-1.5 w-[min(18rem,100%)]">
      <div className="mb-1 flex items-center justify-between gap-2 text-[12px] opacity-80">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="inline-block h-2 w-2 shrink-0 animate-pulse rounded-full bg-[var(--remi-accent)]" />
          <span className="truncate">{label || "生成中…"}</span>
        </span>
        <span className="shrink-0 tabular-nums">{pct}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-[var(--remi-accent)] transition-[width] duration-700 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function renderContent(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  // Collect all image and video matches, sort by position, and render in order.
  type Match = { index: number; length: number; node: React.ReactNode };
  const matches: Match[] = [];

  IMG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = IMG_RE.exec(text)) !== null) {
    const [full, alt, src] = match;
    if (!src.startsWith(TRUSTED_IMG_PREFIX)) continue;
    matches.push({
      index: match.index,
      length: full.length,
      node: <InlineImage key={`img-${key++}`} src={src} alt={alt} />,
    });
  }

  VIDEO_RE.lastIndex = 0;
  while ((match = VIDEO_RE.exec(text)) !== null) {
    const [full, label, videoUrl, posterUrl] = match;
    if (!videoUrl.startsWith(TRUSTED_VIDEO_PREFIX)) continue;
    matches.push({
      index: match.index,
      length: full.length,
      node: (
        <InlineVideo
          key={`vid-${key++}`}
          src={videoUrl}
          poster={posterUrl}
          label={label}
        />
      ),
    });
  }

  VIDEOPROGRESS_RE.lastIndex = 0;
  while ((match = VIDEOPROGRESS_RE.exec(text)) !== null) {
    const [full, pct, label] = match;
    matches.push({
      index: match.index,
      length: full.length,
      node: (
        <VideoProgressBar
          key={`vidprog-${key++}`}
          percent={Number(pct)}
          label={label}
        />
      ),
    });
  }

  matches.sort((a, b) => a.index - b.index);

  for (const m of matches) {
    if (m.index > lastIndex) {
      parts.push(text.slice(lastIndex, m.index));
    }
    parts.push(m.node);
    lastIndex = m.index + m.length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length === 1 && typeof parts[0] === "string" ? parts[0] : parts;
}

export function MessageBubble({ role, children, wide = false, imageUrl }: MessageBubbleProps) {
  return (
    <div
      className={`${base} ${baseWidth[wide ? "wide" : "default"]} ${styles[role]}`}
      role="article"
    >
      {role !== "sys" && role !== "error" ? (
        <div
          className={`mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${speakerTone[role]}`}
        >
          {speakerLine[role]}
        </div>
      ) : null}
      <span className="sr-only">{speakerLine[role]}: </span>
      {/* User-attached image */}
      {imageUrl && (
        <InlineImage src={imageUrl} alt="用户发送的图片" />
      )}
      <div>
        {typeof children === "string" ? renderContent(children) : children}
      </div>
    </div>
  );
}
