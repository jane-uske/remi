"use client";

/* ---------- Inline SVG illustrations — larger, more colorful ---------- */

function IllustrationTextbook() {
  return (
    <svg
      width="120"
      height="104"
      viewBox="0 0 120 104"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Book shadow */}
      <ellipse cx="60" cy="96" rx="36" ry="5" fill="rgba(0,102,204,0.10)" />
      {/* Book back cover */}
      <rect x="14" y="20" width="92" height="68" rx="6" fill="#c9deff" />
      {/* Left page */}
      <path
        d="M60 18C60 18 57 15 36 15C18 15 13 18 13 18L13 82C13 82 18 79 36 79C54 79 57 82 60 82Z"
        fill="white"
        stroke="#0066cc"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* Right page */}
      <path
        d="M60 18C60 18 63 15 84 15C102 15 107 18 107 18L107 82C107 82 102 79 84 79C66 79 63 82 60 82Z"
        fill="white"
        stroke="#0066cc"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* Spine line */}
      <line x1="60" y1="18" x2="60" y2="82" stroke="#0066cc" strokeWidth="1.5" />
      {/* Left page — text lines */}
      <line x1="26" y1="30" x2="50" y2="30" stroke="#b3d4f5" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="26" y1="39" x2="46" y2="39" stroke="#b3d4f5" strokeWidth="2" strokeLinecap="round" />
      <line x1="26" y1="48" x2="48" y2="48" stroke="#b3d4f5" strokeWidth="2" strokeLinecap="round" />
      <line x1="26" y1="57" x2="44" y2="57" stroke="#b3d4f5" strokeWidth="2" strokeLinecap="round" />
      <line x1="26" y1="66" x2="50" y2="66" stroke="#b3d4f5" strokeWidth="1.5" strokeLinecap="round" />
      {/* Right page — Japanese characters, larger */}
      <text x="84" y="38" textAnchor="middle" fill="#0066cc" fontSize="16" fontFamily="serif" fontWeight="600" opacity="0.75">あ</text>
      <text x="84" y="56" textAnchor="middle" fill="#0066cc" fontSize="16" fontFamily="serif" fontWeight="600" opacity="0.55">い</text>
      <text x="84" y="74" textAnchor="middle" fill="#0066cc" fontSize="16" fontFamily="serif" fontWeight="600" opacity="0.40">う</text>
      {/* N5 badge */}
      <rect x="86" y="85" width="26" height="14" rx="7" fill="#0066cc" opacity="0.18" />
      <text x="99" y="95" textAnchor="middle" fill="#0066cc" fontSize="9" fontWeight="700">N5</text>
      {/* Bookmark */}
      <path d="M72 15L72 8L76 11L80 8L80 15" fill="#0066cc" opacity="0.30" />
    </svg>
  );
}

function IllustrationPersonalized() {
  return (
    <svg
      width="120"
      height="104"
      viewBox="0 0 120 104"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Shadow */}
      <ellipse cx="60" cy="96" rx="30" ry="4" fill="rgba(52,199,89,0.12)" />
      {/* Head */}
      <circle cx="60" cy="26" r="16" fill="#ddf5e8" stroke="#34c759" strokeWidth="1.5" />
      {/* Face details */}
      <circle cx="55" cy="24" r="1.5" fill="#34c759" opacity="0.6" />
      <circle cx="65" cy="24" r="1.5" fill="#34c759" opacity="0.6" />
      <path d="M55 30 Q60 34 65 30" stroke="#34c759" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.7" />
      {/* Body */}
      <path
        d="M34 78 C34 60 44 50 60 50 C76 50 86 60 86 78"
        stroke="#34c759"
        strokeWidth="1.5"
        fill="#ddf5e8"
        fillOpacity="0.5"
        strokeLinecap="round"
      />
      {/* Gear — top right */}
      <g transform="translate(90, 20)">
        <circle cx="0" cy="0" r="9" fill="white" stroke="#34c759" strokeWidth="1.5" />
        <circle cx="0" cy="0" r="3.5" fill="#34c759" opacity="0.35" />
        {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
          <line key={angle} x1="0" y1="-9" x2="0" y2="-13" stroke="#34c759" strokeWidth="2.5" strokeLinecap="round" transform={`rotate(${angle})`} />
        ))}
      </g>
      {/* Adjustment arcs */}
      <path d="M18 44 A22 22 0 0 0 18 64" stroke="#a8f0c2" strokeWidth="2" strokeLinecap="round" fill="none" />
      <path d="M10 38 A30 30 0 0 0 10 70" stroke="#a8f0c2" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.5" />
      {/* Slider handles */}
      <circle cx="18" cy="50" r="3.5" fill="white" stroke="#34c759" strokeWidth="1.5" />
      <circle cx="10" cy="58" r="2.5" fill="white" stroke="#34c759" strokeWidth="1.2" opacity="0.6" />
      {/* Progress bar */}
      <rect x="34" y="85" width="52" height="5" rx="2.5" fill="#b8f0cf" />
      <rect x="34" y="85" width="33" height="5" rx="2.5" fill="#34c759" opacity="0.6" />
    </svg>
  );
}

function IllustrationConversation() {
  return (
    <svg
      width="120"
      height="104"
      viewBox="0 0 120 104"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Left bubble */}
      <rect x="6" y="8" width="64" height="34" rx="17" fill="#fff5e8" stroke="#ff9500" strokeWidth="1.5" />
      {/* Left bubble tail */}
      <path d="M24 42 L18 52 L36 42" fill="#fff5e8" stroke="#ff9500" strokeWidth="1.5" strokeLinejoin="round" />
      {/* Left bubble text */}
      <text x="38" y="29" textAnchor="middle" fill="#c07000" fontSize="14" fontFamily="serif" fontWeight="600" opacity="0.85">こんにちは</text>
      {/* Right bubble */}
      <rect x="50" y="54" width="64" height="34" rx="17" fill="#fff5e8" stroke="#ff9500" strokeWidth="1.5" />
      {/* Right bubble tail */}
      <path d="M96 88 L102 96 L86 88" fill="#fff5e8" stroke="#ff9500" strokeWidth="1.5" strokeLinejoin="round" />
      {/* Right bubble text */}
      <text x="82" y="75" textAnchor="middle" fill="#c07000" fontSize="13" fontFamily="serif" fontWeight="500" opacity="0.75">元気です！</text>
      {/* Sound waves */}
      <path d="M96 12 A9 9 0 0 1 96 28" stroke="#ffd090" strokeWidth="2" strokeLinecap="round" fill="none" />
      <path d="M104 6 A16 16 0 0 1 104 34" stroke="#ffd090" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.6" />
      <path d="M112 1 A23 23 0 0 1 112 40" stroke="#ffd090" strokeWidth="1" strokeLinecap="round" fill="none" opacity="0.35" />
      {/* Dot accents */}
      <circle cx="10" cy="66" r="2.5" fill="#ff9500" opacity="0.18" />
      <circle cx="17" cy="74" r="1.8" fill="#ff9500" opacity="0.12" />
    </svg>
  );
}

/* ---------- Features data + colors ---------- */

const features = [
  {
    illustration: "textbook" as const,
    bg: "var(--jp-card-blue)",
    accentColor: "#0066cc",
    accentBg: "rgba(0,102,204,0.10)",
    title: "APT 教材",
    desc: "自适应进度教学，基于 JLPT 标准体系，从 N5 到 N1 系统覆盖。",
    tag: "N5–N1 全覆盖",
  },
  {
    illustration: "personalized" as const,
    bg: "var(--jp-card-green)",
    accentColor: "#1d8348",
    accentBg: "rgba(52,199,89,0.10)",
    title: "私人定制",
    desc: "根据学习习惯与薄弱项，智能调整学习路径，千人千面。",
    tag: "千人千面",
  },
  {
    illustration: "conversation" as const,
    bg: "var(--jp-card-orange)",
    accentColor: "#b45309",
    accentBg: "rgba(255,149,0,0.10)",
    title: "沉浸式对话",
    desc: "与 Remi 真实对话练习，实时纠正发音与语法，完全沉浸。",
    tag: "实时反馈",
  },
];

const illustrations = {
  textbook: IllustrationTextbook,
  personalized: IllustrationPersonalized,
  conversation: IllustrationConversation,
};

/* ---------- Component ---------- */

export function FeatureCards() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
      {features.map((f) => {
        const Illust = illustrations[f.illustration];
        return (
          <div
            key={f.title}
            className="group relative cursor-default overflow-hidden rounded-[var(--jp-radius-xl)]"
            style={{ background: f.bg }}
          >
            {/* Illustration area */}
            <div className="flex items-center justify-center px-6 pt-7 pb-2">
              <Illust />
            </div>

            {/* Text area */}
            <div className="px-6 pb-6">
              <h3
                style={{
                  fontFamily: "var(--jp-font-display)",
                  fontSize: "20px",
                  fontWeight: 700,
                  letterSpacing: "-0.4px",
                  color: "var(--jp-ink)",
                  lineHeight: 1.2,
                }}
              >
                {f.title}
              </h3>
              <p
                style={{
                  fontFamily: "var(--jp-font-text)",
                  fontSize: "14px",
                  lineHeight: 1.6,
                  letterSpacing: "-0.1px",
                  color: "var(--jp-ink-80)",
                  marginTop: "6px",
                }}
              >
                {f.desc}
              </p>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  marginTop: "14px",
                  background: f.accentBg,
                  color: f.accentColor,
                  borderRadius: "var(--jp-radius-pill)",
                  padding: "4px 12px",
                  fontSize: "12px",
                  fontWeight: 600,
                  letterSpacing: "-0.1px",
                  fontFamily: "var(--jp-font-text)",
                }}
              >
                {f.tag}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
