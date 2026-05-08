"use client";

const CAPABILITIES = [
  {
    title: "语法精讲",
    desc: "N5-N1 语法点逐条讲解与例句",
    icon: "📐",
  },
  {
    title: "词汇记忆",
    desc: "间隔重复 + 语境联想记忆",
    icon: "📚",
  },
  {
    title: "听力训练",
    desc: "真题听力 + Remi 语速调节",
    icon: "🎧",
  },
  {
    title: "口语对话",
    desc: "场景化对话练习 + 发音纠正",
    icon: "🗣️",
  },
  {
    title: "阅读理解",
    desc: "分级阅读 + 逐句解析",
    icon: "📰",
  },
  {
    title: "模拟考试",
    desc: "JLPT 真题模拟 + 成绩分析",
    icon: "🏆",
  },
  {
    title: "文化知识",
    desc: "日本文化、礼仪、日常用语",
    icon: "🏯",
  },
];

export function CapabilityGrid() {
  return (
    <div className="rounded-[var(--jp-radius-lg)] border border-[var(--jp-hairline)] bg-white p-[var(--jp-space-lg)]">
      <h3
        className="mb-5 text-[17px] font-semibold text-[var(--jp-ink)]"
        style={{
          fontFamily: "var(--jp-font-display)",
          letterSpacing: "-0.374px",
        }}
      >
        Remi 可覆盖能力
      </h3>
      <div className="grid grid-cols-2 gap-[var(--jp-space-sm)] sm:grid-cols-4">
        {CAPABILITIES.map((cap) => (
          <button
            key={cap.title}
            className="group flex flex-col items-center gap-2 rounded-[var(--jp-radius-md)] border border-[var(--jp-hairline)] bg-[var(--jp-parchment)] px-3 py-4 text-center hover:border-[var(--jp-primary)] hover:bg-white active:scale-95"
          >
            <span className="text-2xl">{cap.icon}</span>
            <p
              className="text-[14px] font-semibold text-[var(--jp-ink)]"
              style={{
                fontFamily: "var(--jp-font-display)",
                letterSpacing: "-0.224px",
              }}
            >
              {cap.title}
            </p>
            <p className="text-[12px] leading-[1.3] text-[var(--jp-ink-48)]">
              {cap.desc}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}
