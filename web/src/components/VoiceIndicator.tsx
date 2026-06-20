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
      className="flex shrink-0 items-center gap-2 rounded-full border border-white/10 bg-[rgba(9,14,18,0.34)] px-2.5 py-1.5 shadow-[0_14px_28px_rgba(0,0,0,0.1)] backdrop-blur-xl"
    >
      <div
        className="remi-voice-bars flex h-7 items-end justify-center gap-1"
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
      <span className="max-w-[5.5rem] truncate text-[10px] font-medium tracking-[0.08em] text-[#c8e9ef]">
        {model.label}
      </span>
    </div>
  );
}
