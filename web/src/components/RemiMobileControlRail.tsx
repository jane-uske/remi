"use client";

import type { ConversationPerformanceModel } from "@/lib/presence/conversationPerformanceModel";
import type { RemiConnectionPhase } from "@/hooks/useRemiChat";

export type RemiMobileControlRailProps = {
  connectionPhase: RemiConnectionPhase;
  reconnectInSec: number | null;
  recording: boolean;
  performanceModel: ConversationPerformanceModel;
};

function connectionDotClass(
  phase: RemiConnectionPhase,
  reconnectInSec: number | null,
): string {
  const base = "h-2 w-2 shrink-0 rounded-full";
  switch (phase) {
    case "connecting":
      return `${base} bg-sky-400`;
    case "open":
      return `${base} bg-[var(--remi-accent)]`;
    case "closed":
      return reconnectInSec != null
        ? `${base} bg-amber-400`
        : `${base} bg-[var(--remi-dot-off)]`;
  }
}

function connectionLabel(
  phase: RemiConnectionPhase,
  reconnectInSec: number | null,
): string {
  switch (phase) {
    case "connecting":
      return "连接中";
    case "open":
      return "在线";
    case "closed":
      return reconnectInSec != null ? "重连中" : "离线";
  }
}

export function RemiMobileControlRail({
  connectionPhase,
  reconnectInSec,
  recording,
  performanceModel,
}: RemiMobileControlRailProps) {
  const presenceLabel =
    performanceModel.chatSync.statusLabel ??
    performanceModel.phaseCueText ??
    "在这里";

  return (
    <div
      className="remi-mobile-control-rail pointer-events-auto flex flex-col items-end gap-2"
      data-conversation-phase={performanceModel.phase}
      aria-label="会话状态"
    >
      <div
        className="flex items-center gap-2 rounded-full border border-white/12 bg-[rgba(7,14,20,0.42)] px-3 py-2 shadow-[0_16px_32px_rgba(0,0,0,0.18)] backdrop-blur-xl"
        aria-live="polite"
      >
        <span
          className={connectionDotClass(connectionPhase, reconnectInSec)}
          aria-hidden
        />
        <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-[#c8e9ef]">
          {connectionLabel(connectionPhase, reconnectInSec)}
        </span>
      </div>

      <div
        className={`flex max-w-[9.5rem] items-center gap-2 rounded-full border px-3 py-2 text-[10px] tracking-[0.08em] shadow-[0_16px_32px_rgba(0,0,0,0.16)] backdrop-blur-xl ${
          recording
            ? "border-rose-300/35 bg-rose-500/14 text-rose-50"
            : performanceModel.phase === "listening" ||
                performanceModel.phase === "open_mic_idle"
              ? "border-sky-300/30 bg-sky-500/12 text-sky-50"
              : performanceModel.phase === "speaking_active" ||
                  performanceModel.phase === "speaking_prepare"
                ? "border-cyan-300/30 bg-cyan-500/12 text-cyan-50"
                : "border-white/10 bg-[rgba(7,14,20,0.38)] text-[#c8e9ef]"
        }`}
        role="status"
      >
        {recording ? (
          <span
            className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-rose-300"
            aria-hidden
          />
        ) : null}
        <span className="truncate">{presenceLabel}</span>
      </div>
    </div>
  );
}