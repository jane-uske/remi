"use client";

import type { DailyGoal } from "@/types/japanese";

const DEFAULT_GOALS: DailyGoal[] = [
  { id: "vocab", title: "背诵 30 个 N3 词汇", progress: 73, icon: "📖" },
  { id: "grammar", title: "完成 て形 语法练习", progress: 45, icon: "✏️" },
  { id: "listen", title: "听力精听 15 分钟", progress: 60, icon: "🎧" },
  { id: "speak", title: "与 Remi 对话 10 分钟", progress: 20, icon: "🗣️" },
];

interface DailyGoalsProps {
  goals?: DailyGoal[];
}

const PROGRESS_COLORS: Record<string, string> = {
  vocab: "#0066cc",
  grammar: "#ff9500",
  listen: "#34c759",
  speak: "#af52de",
};

export function DailyGoals({ goals = DEFAULT_GOALS }: DailyGoalsProps) {
  const completedCount = goals.filter((g) => g.progress >= 100).length;

  return (
    <div
      style={{
        borderRadius: "var(--jp-radius-lg)",
        background: "white",
        padding: "var(--jp-space-lg)",
        boxShadow: "var(--jp-shadow-card)",
      }}
    >
      <div className="mb-5 flex items-center justify-between">
        <h3
          style={{
            fontFamily: "var(--jp-font-display)",
            fontSize: "17px",
            fontWeight: 700,
            letterSpacing: "-0.4px",
            color: "var(--jp-ink)",
          }}
        >
          每日学习目标
        </h3>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
            fontSize: "12px",
            fontWeight: 600,
            color: "#34c759",
            fontFamily: "var(--jp-font-text)",
            background: "rgba(52,199,89,0.08)",
            padding: "3px 10px",
            borderRadius: "9999px",
          }}
        >
          {completedCount}/{goals.length} 完成
        </span>
      </div>
      <div className="space-y-3">
        {goals.map((goal) => {
          const color = PROGRESS_COLORS[goal.id] ?? "#0066cc";
          const done = goal.progress >= 100;
          return (
            <div
              key={goal.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                borderRadius: "12px",
                background: done ? "rgba(52,199,89,0.05)" : "var(--jp-parchment)",
                padding: "12px 14px",
                transition: "background 200ms ease",
              }}
            >
              <span style={{ fontSize: "20px", lineHeight: 1 }}>{goal.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p
                  style={{
                    fontFamily: "var(--jp-font-text)",
                    fontSize: "14px",
                    fontWeight: 500,
                    color: "var(--jp-ink)",
                    letterSpacing: "-0.1px",
                    marginBottom: "8px",
                  }}
                >
                  {goal.title}
                </p>
                {/* Progress bar */}
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
                      width: `${Math.min(goal.progress, 100)}%`,
                      borderRadius: "9999px",
                      background: color,
                      transition: "width 500ms cubic-bezier(0.25,0.46,0.45,0.94)",
                    }}
                  />
                </div>
              </div>
              <span
                style={{
                  minWidth: "36px",
                  textAlign: "right",
                  fontSize: "14px",
                  fontWeight: 700,
                  color: color,
                  fontFamily: "var(--jp-font-display)",
                  letterSpacing: "-0.3px",
                  lineHeight: 1,
                }}
              >
                {goal.progress}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
