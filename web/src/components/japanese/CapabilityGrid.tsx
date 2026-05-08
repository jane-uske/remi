"use client";

import type { NavId } from "./Sidebar";

const CAPABILITIES: { title: string; desc: string; icon: string; color: string; bg: string; navId: NavId }[] = [
  {
    title: "语法精讲",
    desc: "N5-N1 语法点逐条讲解与例句",
    icon: "📐",
    color: "#0066cc",
    bg: "rgba(0,102,204,0.06)",
    navId: "progress",
  },
  {
    title: "词汇记忆",
    desc: "间隔重复 + 语境联想记忆",
    icon: "📚",
    color: "#34c759",
    bg: "rgba(52,199,89,0.06)",
    navId: "daily",
  },
  {
    title: "听力训练",
    desc: "真题听力 + Remi 语速调节",
    icon: "🎧",
    color: "#ff9500",
    bg: "rgba(255,149,0,0.06)",
    navId: "progress",
  },
  {
    title: "口语对话",
    desc: "场景化对话练习 + 发音纠正",
    icon: "🗣️",
    color: "#af52de",
    bg: "rgba(175,82,222,0.06)",
    navId: "practice",
  },
  {
    title: "阅读理解",
    desc: "分级阅读 + 逐句解析",
    icon: "📰",
    color: "#ff3b30",
    bg: "rgba(255,59,48,0.06)",
    navId: "progress",
  },
  {
    title: "模拟考试",
    desc: "JLPT 真题模拟 + 成绩分析",
    icon: "🏆",
    color: "#5856d6",
    bg: "rgba(88,86,214,0.06)",
    navId: "progress",
  },
  {
    title: "文化知识",
    desc: "日本文化、礼仪、日常用语",
    icon: "🏯",
    color: "#ff2d55",
    bg: "rgba(255,45,85,0.06)",
    navId: "capability",
  },
];

interface CapabilityGridProps {
  onNavigate?: (navId: NavId) => void;
}

export function CapabilityGrid({ onNavigate }: CapabilityGridProps) {
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
          Remi 可覆盖能力
        </h3>
        <span
          style={{
            fontSize: "13px",
            color: "var(--jp-ink-48)",
            fontFamily: "var(--jp-font-text)",
          }}
        >
          {CAPABILITIES.length} 项技能
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {CAPABILITIES.map((cap) => (
          <button
            key={cap.title}
            onClick={() => onNavigate?.(cap.navId)}
            className="group text-left active:scale-95"
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "10px",
              borderRadius: "14px",
              background: cap.bg,
              padding: "14px",
              border: "none",
              cursor: "pointer",
              transition: "background 200ms ease, transform 150ms ease",
            }}
          >
            <span style={{ fontSize: "24px", lineHeight: 1, flexShrink: 0, marginTop: "1px" }}>
              {cap.icon}
            </span>
            <div>
              <p
                style={{
                  fontFamily: "var(--jp-font-display)",
                  fontSize: "14px",
                  fontWeight: 600,
                  letterSpacing: "-0.2px",
                  color: "var(--jp-ink)",
                  lineHeight: 1.3,
                }}
              >
                {cap.title}
              </p>
              <p
                style={{
                  fontFamily: "var(--jp-font-text)",
                  fontSize: "11px",
                  color: "var(--jp-ink-48)",
                  lineHeight: 1.4,
                  marginTop: "3px",
                  letterSpacing: "-0.1px",
                }}
              >
                {cap.desc}
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
