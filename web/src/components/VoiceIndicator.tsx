"use client";

export type VoiceIndicatorProps = {
  active: boolean;
};

export function VoiceIndicator({ active }: VoiceIndicatorProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex shrink-0 items-center gap-2.5 rounded-2xl border border-white/15 bg-white/[0.08] px-3 py-2 shadow-lg backdrop-blur-xl dark:bg-black/35"
    >
      <div
        className="rem-voice-bars flex h-9 items-end justify-center gap-1"
        data-active={active ? "true" : "false"}
        aria-hidden
      >
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className="rem-voice-bar inline-block w-[4px] self-end rounded-sm bg-[var(--remi-dot-off)] transition-colors"
          />
        ))}
      </div>
      <span className="max-w-[5rem] truncate text-[11px] font-medium text-[var(--remi-dim)]">
        {active ? "播放中" : "语音"}
      </span>
    </div>
  );
}
