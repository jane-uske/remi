"use client";

import { useRef } from "react";
import { RemiPortraitAvatar } from "@/components/RemiPortraitAvatar";
import type { LipSignal } from "@/types/avatar";

/**
 * A visually prominent section that embeds Remi's portrait avatar.
 *
 * Used in the Japanese dashboard overview to display the Remi character
 * with a subtle Japanese-styled background and a greeting speech bubble.
 *
 * Uses RemiPortraitAvatar directly (the portrait fallback) rather than
 * the full CharacterStage to avoid Live2D/VRM loading overhead in a
 * static dashboard context.
 */
export function RemiCharacterSection() {
  const lipSignalRef = useRef<LipSignal>({ envelope: 0, active: false });

  return (
    <section
      aria-label="Remi character"
      className="relative overflow-hidden rounded-[var(--jp-radius-lg)]"
      style={{
        height: "clamp(320px, 40vw, 420px)",
        background:
          "linear-gradient(168deg, var(--jp-canvas) 0%, color-mix(in srgb, var(--jp-primary) 4%, var(--jp-parchment)) 48%, var(--jp-parchment) 100%)",
        border: "1px solid var(--jp-hairline)",
      }}
    >
      {/* Soft decorative gradient orbs */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-10 -top-10 h-64 w-64 rounded-full blur-3xl"
        style={{
          background:
            "radial-gradient(circle, color-mix(in srgb, var(--jp-primary) 10%, transparent) 0%, transparent 70%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-8 -right-8 h-56 w-56 rounded-full blur-3xl"
        style={{
          background:
            "radial-gradient(circle, color-mix(in srgb, var(--jp-primary) 6%, transparent) 0%, transparent 70%)",
        }}
      />

      {/* Speech bubble */}
      <div className="absolute left-6 top-6 z-20 sm:left-8 sm:top-8">
        <div
          className="max-w-[16rem] rounded-[1rem] px-4 py-3 sm:max-w-[18rem]"
          style={{
            background: "rgba(255, 255, 255, 0.82)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            border: "1px solid var(--jp-hairline)",
          }}
        >
          <p
            className="text-[15px] font-medium leading-relaxed text-[var(--jp-ink)]"
            style={{
              fontFamily: "var(--jp-font-display)",
              letterSpacing: "-0.2px",
            }}
          >
            こんにちは！
          </p>
          <p
            className="mt-1 text-[13px] leading-relaxed text-[var(--jp-ink-48)]"
            style={{
              fontFamily: "var(--jp-font-text)",
              letterSpacing: "-0.2px",
            }}
          >
            一緒に日本語を学びましょう。今日もがんばろうね！
          </p>
        </div>
        {/* Bubble tail */}
        <div
          aria-hidden
          className="ml-8 mt-[-1px] h-3 w-3 rotate-45"
          style={{
            background: "rgba(255, 255, 255, 0.82)",
            borderRight: "1px solid var(--jp-hairline)",
            borderBottom: "1px solid var(--jp-hairline)",
          }}
        />
      </div>

      {/* Portrait avatar -- positioned to fill the right portion */}
      <div className="absolute bottom-0 right-0 h-full w-[60%] min-w-[260px] sm:w-[50%]">
        <RemiPortraitAvatar
          emotion="happy"
          turnState="confirmed_end"
          lipSignalRef={lipSignalRef}
          className="h-full w-full"
        />
      </div>
    </section>
  );
}
