"use client";

import type { Assessment } from "@/types/japanese";

const DEFAULT_ASSESSMENT: Assessment = {
  score: 86,
  total: 100,
  categories: [
    { label: "词汇", score: 90 },
    { label: "语法", score: 78 },
    { label: "听力", score: 85 },
    { label: "阅读", score: 92 },
  ],
};

const CAT_COLORS: Record<string, string> = {
  词汇: "#0066cc",
  语法: "#ff9500",
  听力: "#34c759",
  阅读: "#af52de",
};

interface AssessmentCardProps {
  assessment?: Assessment;
}

export function AssessmentCard({ assessment = DEFAULT_ASSESSMENT }: AssessmentCardProps) {
  const { score, total, categories } = assessment;
  const circumference = 2 * Math.PI * 52;
  const offset = circumference * (1 - score / total);

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
          marginBottom: "16px",
        }}
      >
        综合评估
      </h3>

      <div className="flex items-start gap-5">
        {/* Score ring */}
        <div className="relative shrink-0" style={{ width: 120, height: 120 }}>
          <svg width={120} height={120} className="-rotate-90" style={{ display: "block" }}>
            <circle
              cx={60}
              cy={60}
              r={52}
              fill="none"
              stroke="#f0f0f5"
              strokeWidth={10}
            />
            <circle
              cx={60}
              cy={60}
              r={52}
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
                fontSize: "34px",
                fontWeight: 800,
                letterSpacing: "-1.2px",
                color: "var(--jp-ink)",
                lineHeight: 1,
              }}
            >
              {score}
            </span>
            <span
              style={{
                fontSize: "11px",
                color: "var(--jp-ink-48)",
                fontFamily: "var(--jp-font-text)",
                marginTop: "2px",
              }}
            >
              / {total}
            </span>
          </div>
        </div>

        {/* Category bars */}
        <div className="flex-1 space-y-3">
          {categories.map((item) => {
            const color = CAT_COLORS[item.label] ?? "#0066cc";
            return (
              <div key={item.label}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: "5px",
                  }}
                >
                  <span
                    style={{
                      fontSize: "12px",
                      fontWeight: 500,
                      color: "var(--jp-ink-80)",
                      fontFamily: "var(--jp-font-text)",
                    }}
                  >
                    {item.label}
                  </span>
                  <span
                    style={{
                      fontSize: "12px",
                      fontWeight: 700,
                      color,
                      fontFamily: "var(--jp-font-display)",
                    }}
                  >
                    {item.score}
                  </span>
                </div>
                <div
                  style={{
                    height: "4px",
                    width: "100%",
                    borderRadius: "9999px",
                    background: "var(--jp-divider)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${item.score}%`,
                      borderRadius: "9999px",
                      background: color,
                      transition: "width 500ms cubic-bezier(0.25,0.46,0.45,0.94)",
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
