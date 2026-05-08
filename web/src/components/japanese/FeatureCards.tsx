"use client";

export function FeatureCards() {
  const features = [
    {
      title: "APT 教材",
      desc: "自适应进度教学，基于 JLPT 标准体系",
      detail: "N5-N1 全覆盖",
      accent: "bg-blue-50",
    },
    {
      title: "私人定制",
      desc: "根据学习习惯与薄弱项，智能调整学习路径",
      detail: "千人千面",
      accent: "bg-amber-50",
    },
    {
      title: "沉浸式对话",
      desc: "与 Remi 真实对话练习，纠正发音与语法",
      detail: "实时反馈",
      accent: "bg-green-50",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-[var(--jp-space-lg)] lg:grid-cols-3">
      {features.map((f) => (
        <div
          key={f.title}
          className="cursor-default rounded-[var(--jp-radius-lg)] border border-[var(--jp-hairline)] bg-white p-[var(--jp-space-lg)]"
          style={{ transition: "border-color 200ms ease" }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.borderColor = "var(--jp-primary)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.borderColor = "var(--jp-hairline)")
          }
        >
          <h3
            className="text-[17px] font-semibold text-[var(--jp-ink)]"
            style={{
              fontFamily: "var(--jp-font-display)",
              letterSpacing: "-0.374px",
            }}
          >
            {f.title}
          </h3>
          <p
            className="mt-2 text-[14px] leading-[1.43] text-[var(--jp-ink-80)]"
            style={{
              fontFamily: "var(--jp-font-text)",
              letterSpacing: "-0.224px",
            }}
          >
            {f.desc}
          </p>
          <span className="mt-3 inline-block rounded-[var(--jp-radius-pill)] bg-[var(--jp-parchment)] px-3 py-1 text-[12px] font-medium text-[var(--jp-primary)]">
            {f.detail}
          </span>
        </div>
      ))}
    </div>
  );
}
