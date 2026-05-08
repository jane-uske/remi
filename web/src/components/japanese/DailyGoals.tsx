"use client";

const GOALS = [
  { id: "vocab", title: "背诵 30 个 N3 词汇", progress: 73, icon: "📖" },
  { id: "grammar", title: "完成 て形 语法练习", progress: 45, icon: "✏️" },
  { id: "listen", title: "听力精听 15 分钟", progress: 60, icon: "🎧" },
  { id: "speak", title: "与 Remi 对话 10 分钟", progress: 20, icon: "🗣️" },
];

export function DailyGoals() {
  return (
    <div className="rounded-[var(--jp-radius-lg)] border border-[var(--jp-hairline)] bg-white p-[var(--jp-space-lg)]">
      <div className="mb-4 flex items-center justify-between">
        <h3
          className="text-[17px] font-semibold text-[var(--jp-ink)]"
          style={{
            fontFamily: "var(--jp-font-display)",
            letterSpacing: "-0.374px",
          }}
        >
          每日学习目标
        </h3>
        <span className="text-[12px] text-[var(--jp-ink-48)]">
          {GOALS.filter((g) => g.progress >= 100).length}/{GOALS.length} 已完成
        </span>
      </div>
      <div className="space-y-3">
        {GOALS.map((goal) => (
          <div
            key={goal.id}
            className="flex items-center gap-3 rounded-[var(--jp-radius-sm)] bg-[var(--jp-parchment)] p-3"
          >
            <span className="text-lg">{goal.icon}</span>
            <div className="flex-1">
              <p className="text-[14px] font-medium text-[var(--jp-ink)]">
                {goal.title}
              </p>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[var(--jp-hairline)]">
                <div
                  className="h-full rounded-full bg-[var(--jp-primary)] transition-all duration-500"
                  style={{ width: `${Math.min(goal.progress, 100)}%` }}
                />
              </div>
            </div>
            <span className="min-w-[36px] text-right text-[14px] font-semibold text-[var(--jp-primary)]">
              {goal.progress}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
