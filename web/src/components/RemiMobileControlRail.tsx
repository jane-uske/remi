"use client";

import type { ConversationPerformanceModel } from "@/lib/presence/conversationPerformanceModel";

export type RemiMobileControlRailProps = {
  recording: boolean;
  performanceModel: ConversationPerformanceModel;
};

export function RemiMobileControlRail({
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
        className={`flex max-w-[9.5rem] items-center gap-2 rounded-full border px-3 py-2 text-[10px] tracking-[0.08em] shadow-[0_16px_32px_rgba(0,0,0,0.16)] backdrop-blur-xl ${
          recording
            ? "border-rose-300/35 bg-rose-500/14 text-rose-50"
            : performanceModel.phase === "listening" ||
                performanceModel.phase === "open_mic_idle"
              ? "border-sky-300/30 bg-sky-500/12 text-sky-50"
              : performanceModel.phase === "speaking_active" ||
                  performanceModel.phase === "speaking_prepare"
                ? "border-cyan-300/30 bg-cyan-500/12 text-cyan-50"
                : "border-white/10 bg-[rgba(15,10,24,0.38)] text-[#c4b5fd]"
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
