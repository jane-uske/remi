"use client";

const DEFAULT_MASTERY = 43;

interface MasteryGaugeProps {
  mastery?: number;
}

export function MasteryGauge({ mastery = DEFAULT_MASTERY }: MasteryGaugeProps) {
  return (
    <div className="rounded-[var(--jp-radius-lg)] border border-[var(--jp-hairline)] bg-white p-[var(--jp-space-lg)]">
      <h3
        className="mb-4 text-[17px] font-semibold text-[var(--jp-ink)]"
        style={{
          fontFamily: "var(--jp-font-display)",
          letterSpacing: "-0.374px",
        }}
      >
        综合掌握度
      </h3>
      <div className="flex items-end gap-4">
        <p
          className="text-[56px] font-semibold leading-none text-[var(--jp-primary)]"
          style={{
            fontFamily: "var(--jp-font-display)",
            letterSpacing: "-0.28px",
          }}
        >
          {mastery}%
        </p>
        <div className="mb-2 flex-1">
          <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--jp-divider)]">
            <div
              className="h-full rounded-full bg-[var(--jp-primary)] transition-all duration-700 ease-out"
              style={{ width: `${mastery}%` }}
            />
          </div>
          <p className="mt-2 text-[12px] text-[var(--jp-ink-48)]">
            距离 N3 还需提升 {Math.max(0, 60 - mastery)}%
          </p>
        </div>
      </div>
    </div>
  );
}
