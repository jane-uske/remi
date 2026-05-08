"use client";

import type { SkillProgress } from "@/types/japanese";

interface RingProps {
  value: number;
  label: string;
  color: string;
  size?: number;
}

function Ring({ value, label, color, size = 100 }: RingProps) {
  const stroke = 8;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - value / 100);

  return (
    <div className="flex flex-col items-center gap-2">
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--jp-divider)"
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
      <div className="text-center">
        <p
          className="text-[21px] font-semibold text-[var(--jp-ink)]"
          style={{ fontFamily: "var(--jp-font-display)" }}
        >
          {value}%
        </p>
        <p className="text-[12px] text-[var(--jp-ink-48)]">{label}</p>
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
    { value: progress.listening, label: "听力", color: "#0066cc" },
    { value: progress.reading, label: "阅读", color: "#34c759" },
    { value: progress.grammar, label: "语法", color: "#ff9500" },
  ];

  return (
    <div className="rounded-[var(--jp-radius-lg)] border border-[var(--jp-hairline)] bg-white p-[var(--jp-space-lg)]">
      <h3
        className="mb-5 text-[17px] font-semibold text-[var(--jp-ink)]"
        style={{
          fontFamily: "var(--jp-font-display)",
          letterSpacing: "-0.374px",
        }}
      >
        学习进度
      </h3>
      <div className="flex flex-wrap items-center justify-around gap-4">
        {rings.map((r) => (
          <Ring key={r.label} {...r} />
        ))}
      </div>
    </div>
  );
}
