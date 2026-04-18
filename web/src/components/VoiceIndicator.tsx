"use client";

import type { VoiceIndicatorModel } from "@/runtime/remiRuntimeSelectors";

export type VoiceIndicatorProps = {
  model: VoiceIndicatorModel;
};

export function VoiceIndicator({ model }: VoiceIndicatorProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex shrink-0 items-center gap-2.5 rounded-full border border-white/10 bg-[rgba(12,16,18,0.62)] px-3.5 py-2 shadow-lg backdrop-blur-xl"
    >
      <div
        className="remi-voice-bars flex h-9 items-end justify-center gap-1"
        data-active={model.active ? "true" : "false"}
        aria-hidden
      >
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className="remi-voice-bar inline-block w-[4px] self-end rounded-sm bg-[var(--remi-dot-off)] transition-colors"
          />
        ))}
      </div>
      <span className="max-w-[5rem] truncate text-[11px] font-medium uppercase tracking-[0.16em] text-[#c8e9ef]">
        {model.label}
      </span>
    </div>
  );
}
