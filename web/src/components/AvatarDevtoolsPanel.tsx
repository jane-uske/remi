"use client";

import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { clearAvatarDevtoolsLogs, useAvatarDevtoolsState } from "@/lib/rem3d/devtoolsStore";
import type { RemiTurnState, RemiTurnStateReason } from "@/types/avatar";

type AvatarDevtoolsPanelProps = {
  title?: string;
  className?: string;
  onClose?: () => void;
  draggable?: boolean;
};

const MAX_RENDERED_LOGS = 60;
const DEFAULT_FLOAT_WIDTH = 448;
const DEFAULT_FLOAT_HEIGHT = 620;
const MIN_FLOAT_WIDTH = 320;
const MIN_FLOAT_HEIGHT = 360;
const MAX_FLOAT_WIDTH = 720;
const MAX_FLOAT_HEIGHT = 840;

function formatTs(ts: number): string {
  return new Date(ts).toLocaleTimeString("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function getTurnStateLabel(turnState: RemiTurnState | null | undefined): string {
  switch (turnState) {
    case "listening_active":
      return "专心听";
    case "listening_hold":
      return "等你说完";
    case "likely_end":
      return "准备接话";
    case "confirmed_end":
      return "准备回复";
    case "assistant_entering":
      return "要开口了";
    case "assistant_speaking":
      return "正在说";
    case "interrupted_by_user":
      return "被你打断";
    default:
      return "none";
  }
}

function getTurnReasonLabel(reason: RemiTurnStateReason | null | undefined): string {
  switch (reason) {
    case "speech_start":
      return "speech_start";
    case "partial_growth":
      return "partial_growth";
    case "semantic_hold":
      return "semantic_hold";
    case "likely_end":
      return "likely_end";
    case "confirmed_end":
      return "confirmed_end";
    case "tts_prepare":
      return "tts_prepare";
    case "playback_start":
      return "playback_start";
    case "user_interrupt":
      return "user_interrupt";
    default:
      return "none";
  }
}

function getTurnStateAccent(turnState: RemiTurnState | null | undefined): string {
  switch (turnState) {
    case "listening_active":
      return "border-sky-400/30 bg-sky-500/10 text-sky-100";
    case "listening_hold":
      return "border-cyan-400/30 bg-cyan-500/10 text-cyan-100";
    case "likely_end":
    case "confirmed_end":
      return "border-amber-400/30 bg-amber-500/10 text-amber-100";
    case "assistant_entering":
      return "border-orange-400/30 bg-orange-500/10 text-orange-100";
    case "assistant_speaking":
      return "border-emerald-400/30 bg-emerald-500/10 text-emerald-100";
    case "interrupted_by_user":
      return "border-rose-400/30 bg-rose-500/10 text-rose-100";
    default:
      return "border-white/10 bg-black/20 text-[var(--foreground)]";
  }
}

function formatDuration(ms: number | null | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "--";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms >= 10_000 ? 0 : 1)} s`;
}

export function AvatarDevtoolsPanel({
  title = "Avatar DevTools",
  className = "",
  onClose,
  draggable = false,
}: AvatarDevtoolsPanelProps) {
  const { logs, snapshot } = useAvatarDevtoolsState();
  const deferredLogs = useDeferredValue(logs);
  const deferredSnapshot = useDeferredValue(snapshot);
  const dragOriginRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const resizeOriginRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originWidth: number;
    originHeight: number;
  } | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [floatingSize, setFloatingSize] = useState({
    width: DEFAULT_FLOAT_WIDTH,
    height: DEFAULT_FLOAT_HEIGHT,
  });

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 250);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!draggable || typeof window === "undefined") return;
    try {
      const raw = window.sessionStorage.getItem("remi-avatar-devtools-offset");
      if (!raw) return;
      const parsed = JSON.parse(raw) as { x?: number; y?: number };
      const nextX = typeof parsed.x === "number" && Number.isFinite(parsed.x) ? parsed.x : 0;
      const nextY = typeof parsed.y === "number" && Number.isFinite(parsed.y) ? parsed.y : 0;
      setOffset({
        x: nextX,
        y: nextY,
      });
    } catch {
      /* ignore persisted drag state */
    }
  }, [draggable]);

  useEffect(() => {
    if (!draggable || typeof window === "undefined") return;
    try {
      const raw = window.sessionStorage.getItem("remi-avatar-devtools-size");
      if (!raw) return;
      const parsed = JSON.parse(raw) as { width?: number; height?: number };
      const width =
        typeof parsed.width === "number" && Number.isFinite(parsed.width)
          ? Math.max(MIN_FLOAT_WIDTH, Math.min(MAX_FLOAT_WIDTH, parsed.width))
          : DEFAULT_FLOAT_WIDTH;
      const height =
        typeof parsed.height === "number" && Number.isFinite(parsed.height)
          ? Math.max(MIN_FLOAT_HEIGHT, Math.min(MAX_FLOAT_HEIGHT, parsed.height))
          : DEFAULT_FLOAT_HEIGHT;
      setFloatingSize({ width, height });
    } catch {
      /* ignore persisted size */
    }
  }, [draggable]);

  useEffect(() => {
    if (!draggable || typeof window === "undefined") return;
    window.sessionStorage.setItem("remi-avatar-devtools-offset", JSON.stringify(offset));
  }, [draggable, offset]);

  useEffect(() => {
    if (!draggable || typeof window === "undefined") return;
    window.sessionStorage.setItem(
      "remi-avatar-devtools-size",
      JSON.stringify(floatingSize),
    );
  }, [draggable, floatingSize]);

  const visibleLogs = useMemo(
    () => deferredLogs.slice(-MAX_RENDERED_LOGS).slice().reverse(),
    [deferredLogs],
  );
  const snapshotIntentJson = useMemo(
    () => safeStringify(deferredSnapshot?.intent ?? null),
    [deferredSnapshot],
  );
  const expressionWeightsJson = useMemo(
    () => safeStringify(deferredSnapshot?.expressionWeights ?? {}),
    [deferredSnapshot],
  );
  const turnStateLabel = getTurnStateLabel(deferredSnapshot?.turnState);
  const turnReasonLabel = getTurnReasonLabel(deferredSnapshot?.turnReason);
  const turnElapsed = deferredSnapshot?.turnStateAtMs
    ? Math.max(0, nowMs - deferredSnapshot.turnStateAtMs)
    : null;

  const handlePointerMove = useCallback((event: PointerEvent) => {
    const drag = dragOriginRef.current;
    if (drag && drag.pointerId === event.pointerId) {
      setOffset({
        x: drag.originX + event.clientX - drag.startX,
        y: drag.originY + event.clientY - drag.startY,
      });
      return;
    }

    const resize = resizeOriginRef.current;
    if (resize && resize.pointerId === event.pointerId) {
      setFloatingSize({
        width: Math.max(
          MIN_FLOAT_WIDTH,
          Math.min(MAX_FLOAT_WIDTH, resize.originWidth + event.clientX - resize.startX),
        ),
        height: Math.max(
          MIN_FLOAT_HEIGHT,
          Math.min(MAX_FLOAT_HEIGHT, resize.originHeight + event.clientY - resize.startY),
        ),
      });
    }
  }, []);

  const stopDragging = useCallback((pointerId?: number) => {
    if (pointerId != null && dragOriginRef.current?.pointerId !== pointerId) return;
    dragOriginRef.current = null;
    setDragging(false);
  }, []);

  const stopResizing = useCallback((pointerId?: number) => {
    if (pointerId != null && resizeOriginRef.current?.pointerId !== pointerId) return;
    resizeOriginRef.current = null;
  }, []);

  useEffect(() => {
    if (!draggable) return;
    const onPointerMove = (event: PointerEvent) => handlePointerMove(event);
    const onPointerUp = (event: PointerEvent) => {
      stopDragging(event.pointerId);
      stopResizing(event.pointerId);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [draggable, handlePointerMove, stopDragging, stopResizing]);

  const handleDragStart = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!draggable) return;
      const target = event.target as HTMLElement;
      if (target.closest("button, summary, pre, details")) return;
      dragOriginRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: offset.x,
        originY: offset.y,
      };
      setDragging(true);
    },
    [draggable, offset.x, offset.y],
  );

  const handleResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!draggable) return;
      event.preventDefault();
      event.stopPropagation();
      resizeOriginRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originWidth: floatingSize.width,
        originHeight: floatingSize.height,
      };
    },
    [draggable, floatingSize.height, floatingSize.width],
  );

  return (
    <section
      style={
        draggable
          ? {
              position: "fixed",
              right: "12px",
              bottom: "12px",
              zIndex: 20,
              transform: `translate3d(${offset.x}px, ${offset.y}px, 0)`,
              width: `${floatingSize.width}px`,
              height: `${floatingSize.height}px`,
              maxWidth: "min(92vw, 720px)",
              maxHeight: "80vh",
              pointerEvents: "auto",
            }
          : undefined
      }
      className={`flex min-h-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-black/55 text-[var(--foreground)] shadow-[0_18px_80px_rgba(0,0,0,0.28)] backdrop-blur-xl ${className}`}
    >
      <header
        onPointerDown={handleDragStart}
        className={`flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3 ${draggable ? (dragging ? "cursor-grabbing select-none" : "cursor-grab select-none") : ""}`}
      >
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--remi-dim)]">
            Debug Surface
          </p>
          <h2 className="text-sm font-semibold">{title}</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => clearAvatarDevtoolsLogs()}
            className="rounded-full border border-white/10 px-3 py-1 text-[11px] text-[var(--remi-dim)] transition hover:border-white/20 hover:text-[var(--foreground)]"
          >
            清日志
          </button>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-white/10 px-3 py-1 text-[11px] text-[var(--remi-dim)] transition hover:border-white/20 hover:text-[var(--foreground)]"
            >
              关闭
            </button>
          ) : null}
        </div>
      </header>

      <div className="grid gap-3 p-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="space-y-3">
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <div className="mb-2 text-xs font-medium text-[var(--remi-dim)]">当前快照</div>
            {deferredSnapshot ? (
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                  <div className="text-[10px] text-[var(--remi-dim)]">Emotion</div>
                  <div className="mt-1 font-medium">{deferredSnapshot.emotion}</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                  <div className="text-[10px] text-[var(--remi-dim)]">State</div>
                  <div className="mt-1 font-medium">{deferredSnapshot.remState}</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                  <div className="text-[10px] text-[var(--remi-dim)]">Turn</div>
                  <div
                    className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${getTurnStateAccent(deferredSnapshot.turnState)}`}
                  >
                    {turnStateLabel}
                  </div>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                  <div className="text-[10px] text-[var(--remi-dim)]">Turn Reason</div>
                  <div className="mt-1 font-medium">{turnReasonLabel}</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                  <div className="text-[10px] text-[var(--remi-dim)]">Turn For</div>
                  <div className="mt-1 font-medium">{formatDuration(turnElapsed)}</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                  <div className="text-[10px] text-[var(--remi-dim)]">Lip</div>
                  <div className="mt-1 font-medium">{deferredSnapshot.lipEnvelope.toFixed(2)}</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                  <div className="text-[10px] text-[var(--remi-dim)]">Voice</div>
                  <div className="mt-1 font-medium">{deferredSnapshot.voiceActive ? "active" : "idle"}</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                  <div className="text-[10px] text-[var(--remi-dim)]">Prediction</div>
                  <div className="mt-1 break-words font-medium">
                    {deferredSnapshot.sttPredictionPreview ?? "none"}
                  </div>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                  <div className="text-[10px] text-[var(--remi-dim)]">Interrupt</div>
                  <div className="mt-1 font-medium">
                    {deferredSnapshot.interruptionType ?? "none"}
                  </div>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                  <div className="text-[10px] text-[var(--remi-dim)]">Cue</div>
                  <div className="mt-1 font-medium">{deferredSnapshot.activeCue ?? "none"}</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                  <div className="text-[10px] text-[var(--remi-dim)]">Action</div>
                  <div className="mt-1 font-medium">{deferredSnapshot.activeAction?.action ?? "none"}</div>
                </div>
              </div>
            ) : (
              <p className="text-xs text-[var(--remi-dim)]">还没有 runtime 快照。</p>
            )}
          </div>

          <details className="rounded-xl border border-white/10 bg-white/[0.03] p-3" open>
            <summary className="cursor-pointer text-xs font-medium text-[var(--remi-dim)]">
              Latest Intent
            </summary>
            <pre className="mt-3 overflow-auto rounded-lg bg-black/25 p-3 text-[11px] leading-5 text-[var(--foreground)]/85">
              {snapshotIntentJson}
            </pre>
          </details>

          <details className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <summary className="cursor-pointer text-xs font-medium text-[var(--remi-dim)]">
              Expression Merge
            </summary>
            <pre className="mt-3 max-h-56 overflow-auto rounded-lg bg-black/25 p-3 text-[11px] leading-5 text-[var(--foreground)]/85">
              {expressionWeightsJson}
            </pre>
          </details>
        </div>

        <div className="min-h-0 rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-medium text-[var(--remi-dim)]">事件流</div>
            <div className="text-[10px] text-[var(--remi-dim)]">
              {visibleLogs.length}/{deferredLogs.length} entries
            </div>
          </div>
          <div className="max-h-[32rem] space-y-2 overflow-auto pr-1">
            {visibleLogs.length === 0 ? (
              <p className="text-xs text-[var(--remi-dim)]">暂无日志。</p>
            ) : (
              visibleLogs.map((entry) => (
                  <details
                    key={entry.id}
                    className="rounded-lg border border-white/10 bg-black/20 px-3 py-2"
                  >
                    <summary className="cursor-pointer list-none">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-[11px] font-medium">{entry.summary}</div>
                          <div className="mt-1 text-[10px] uppercase tracking-[0.16em] text-[var(--remi-dim)]">
                            {entry.kind}
                          </div>
                        </div>
                        <div className="shrink-0 text-[10px] text-[var(--remi-dim)]">
                          {formatTs(entry.ts)}
                        </div>
                      </div>
                    </summary>
                    {entry.data !== undefined ? (
                      <pre className="mt-3 overflow-auto rounded-lg bg-black/25 p-3 text-[11px] leading-5 text-[var(--foreground)]/80">
                        {safeStringify(entry.data)}
                      </pre>
                    ) : null}
                  </details>
                ))
            )}
          </div>
        </div>
      </div>

      {draggable ? (
        <button
          type="button"
          aria-label="调整日志窗口大小"
          onPointerDown={handleResizeStart}
          className="absolute bottom-0 right-0 h-5 w-5 cursor-se-resize rounded-tl-xl border-l border-t border-white/10 bg-white/[0.04]"
        >
          <span className="pointer-events-none absolute bottom-1 right-1 h-2.5 w-2.5 border-b-2 border-r-2 border-white/35" />
        </button>
      ) : null}
    </section>
  );
}
