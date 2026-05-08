"use client";

import type { JlptLevel } from "@/types/japanese";

const DEFAULT_MASTERY = 43;

const NEXT_LEVEL: Record<JlptLevel, JlptLevel | null> = {
  N5: "N4",
  N4: "N3",
  N3: "N2",
  N2: "N1",
  N1: null,
};

interface MasteryGaugeProps {
  mastery?: number;
  currentLevel?: JlptLevel;
}

export function MasteryGauge({ mastery = DEFAULT_MASTERY, currentLevel = "N4" }: MasteryGaugeProps) {
  const nextLevel = NEXT_LEVEL[currentLevel];
  const need = Math.max(0, 60 - mastery);
  const circumference = 2 * Math.PI * 58;
  const offset = circumference * (1 - mastery / 100);

  return (
    <div
      style={{
        borderRadius: "var(--jp-radius-lg)",
        background: "white",
        padding: "var(--jp-space-lg)",
        boxShadow: "var(--jp-shadow-card)",
      }}
    >
      <h3
        style={{
          fontFamily: "var(--jp-font-display)",
          fontSize: "17px",
          fontWeight: 700,
          letterSpacing: "-0.4px",
          color: "var(--jp-ink)",
          marginBottom: "20px",
        }}
      >
        综合掌握度
      </h3>

      <div className="flex flex-col items-center gap-4">
        {/* Large circular gauge */}
        <div className="relative" style={{ width: 130, height: 130 }}>
          <svg width={130} height={130} className="-rotate-90" style={{ display: "block" }}>
            {/* Track */}
            <circle
              cx={65}
              cy={65}
              r={58}
              fill="none"
              stroke="#f0f0f5"
              strokeWidth={10}
            />
            {/* Progress arc with gradient-like effect */}
            <circle
              cx={65}
              cy={65}
              r={58}
              fill="none"
              stroke="#0066cc"
              strokeWidth={10}
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              strokeLinecap="round"
              className="transition-all duration-700 ease-out"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span
              style={{
                fontFamily: "var(--jp-font-display)",
                fontSize: "40px",
                fontWeight: 800,
                letterSpacing: "-1.5px",
                color: "var(--jp-primary)",
                lineHeight: 1,
              }}
            >
              {mastery}
            </span>
            <span
              style={{
                fontSize: "12px",
                color: "var(--jp-ink-48)",
                fontFamily: "var(--jp-font-text)",
                marginTop: "2px",
              }}
            >
              / 100
            </span>
          </div>
        </div>

        {/* Caption */}
        <p
          style={{
            fontSize: "13px",
            color: "var(--jp-ink-48)",
            fontFamily: "var(--jp-font-text)",
            letterSpacing: "-0.1px",
            textAlign: "center",
          }}
        >
          {nextLevel ? (
            <>
              距 {nextLevel} 还需提升{" "}
              <strong style={{ color: "var(--jp-primary)", fontWeight: 700 }}>
                {need}%
              </strong>
            </>
          ) : (
            <strong style={{ color: "#34c759", fontWeight: 700 }}>已达到 N1 最高等级</strong>
          )}
        </p>
      </div>
    </div>
  );
}
