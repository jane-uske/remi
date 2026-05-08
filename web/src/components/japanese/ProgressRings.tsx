"use client";

import type { SkillProgress } from "@/types/japanese";

interface RingProps {
  value: number;
  label: string;
  color: string;
  trackColor: string;
  size?: number;
}

function Ring({ value, label, color, trackColor, size = 120 }: RingProps) {
  const stroke = 9;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - value / 100);

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90" style={{ display: "block" }}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={trackColor}
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className="transition-all duration-700 ease-out"
          />
        </svg>
        {/* Value overlaid on ring */}
        <div
          className="absolute inset-0 flex flex-col items-center justify-center"
          style={{ transform: "rotate(0deg)" }}
        >
          <span
            style={{
              fontFamily: "var(--jp-font-display)",
              fontSize: "26px",
              fontWeight: 700,
              letterSpacing: "-0.8px",
              color: "var(--jp-ink)",
              lineHeight: 1,
            }}
          >
            {value}
          </span>
          <span
            style={{
              fontSize: "11px",
              color: "var(--jp-ink-48)",
              fontFamily: "var(--jp-font-text)",
              marginTop: "2px",
            }}
          >
            %
          </span>
        </div>
      </div>
      <div className="text-center">
        <p
          style={{
            fontFamily: "var(--jp-font-text)",
            fontSize: "13px",
            fontWeight: 600,
            letterSpacing: "-0.1px",
            color: "var(--jp-ink-80)",
          }}
        >
          {label}
        </p>
      </div>
    </div>
  );
}

const DEFAULT_PROGRESS: SkillProgress = {
  listening: 42,
  reading: 68,
  grammar: 39,
};

interface ProgressRingsProps {
  progress?: SkillProgress;
}

export function ProgressRings({ progress = DEFAULT_PROGRESS }: ProgressRingsProps) {
  const rings = [
    { value: progress.listening, label: "听力", color: "#0066cc", trackColor: "#ddeaff" },
    { value: progress.reading, label: "阅读", color: "#34c759", trackColor: "#ddf5e8" },
    { value: progress.grammar, label: "语法", color: "#ff9500", trackColor: "#ffecce" },
  ];

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
        学习进度
      </h3>
      <div className="flex items-center justify-around gap-2">
        {rings.map((r) => (
          <Ring key={r.label} {...r} />
        ))}
      </div>
    </div>
  );
}
