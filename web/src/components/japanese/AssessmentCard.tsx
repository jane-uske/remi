"use client";

export function AssessmentCard() {
  const score = 86;

  return (
    <div className="rounded-[var(--jp-radius-lg)] border border-[var(--jp-hairline)] bg-white p-[var(--jp-space-lg)]">
      <h3
        className="mb-4 text-[17px] font-semibold text-[var(--jp-ink)]"
        style={{
          fontFamily: "var(--jp-font-display)",
          letterSpacing: "-0.374px",
        }}
      >
        综合评估
      </h3>
      <div className="flex items-center gap-6">
        <div className="relative flex h-[120px] w-[120px] items-center justify-center">
          <svg width={120} height={120} className="-rotate-90">
            <circle
              cx={60}
              cy={60}
              r={52}
              fill="none"
              stroke="var(--jp-divider)"
              strokeWidth={10}
            />
            <circle
              cx={60}
              cy={60}
              r={52}
              fill="none"
              stroke="var(--jp-primary)"
              strokeWidth={10}
              strokeDasharray={2 * Math.PI * 52}
              strokeDashoffset={2 * Math.PI * 52 * (1 - score / 100)}
              strokeLinecap="round"
              className="transition-all duration-700 ease-out"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span
              className="text-[34px] font-semibold text-[var(--jp-ink)]"
              style={{
                fontFamily: "var(--jp-font-display)",
                letterSpacing: "-0.374px",
              }}
            >
              {score}
            </span>
            <span className="text-[12px] text-[var(--jp-ink-48)]">/100</span>
          </div>
        </div>

        <div className="flex-1 space-y-3">
          {[
            { label: "词汇", score: 90 },
            { label: "语法", score: 78 },
            { label: "听力", score: 85 },
            { label: "阅读", score: 92 },
          ].map((item) => (
            <div key={item.label}>
              <div className="mb-1 flex justify-between text-[12px]">
                <span className="text-[var(--jp-ink-80)]">{item.label}</span>
                <span className="font-medium text-[var(--jp-ink)]">
                  {item.score}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--jp-divider)]">
                <div
                  className="h-full rounded-full bg-[var(--jp-primary)] transition-all duration-500"
                  style={{ width: `${item.score}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
