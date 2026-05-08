"use client";

/* ---------- Inline SVG illustrations ---------- */

/** APT教材 — open book with Japanese text lines */
function IllustrationTextbook() {
  return (
    <svg
      width="100"
      height="88"
      viewBox="0 0 100 88"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Book spine shadow */}
      <rect
        x="13"
        y="18"
        width="74"
        height="56"
        rx="4"
        fill="var(--jp-parchment)"
      />
      {/* Left page */}
      <path
        d="M50 16 C50 16 48 14 30 14 C16 14 12 16 12 16 L12 68 C12 68 16 66 30 66 C44 66 48 68 50 68 Z"
        fill="white"
        stroke="var(--jp-primary)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* Right page */}
      <path
        d="M50 16 C50 16 52 14 70 14 C84 14 88 16 88 16 L88 68 C88 68 84 66 70 66 C56 66 52 68 50 68 Z"
        fill="white"
        stroke="var(--jp-primary)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* Spine */}
      <line
        x1="50"
        y1="16"
        x2="50"
        y2="68"
        stroke="var(--jp-primary)"
        strokeWidth="1.5"
      />
      {/* Left page — horizontal text lines */}
      <line x1="22" y1="26" x2="42" y2="26" stroke="#b3d4f0" strokeWidth="2" strokeLinecap="round" />
      <line x1="22" y1="33" x2="38" y2="33" stroke="#b3d4f0" strokeWidth="2" strokeLinecap="round" />
      <line x1="22" y1="40" x2="40" y2="40" stroke="#b3d4f0" strokeWidth="2" strokeLinecap="round" />
      <line x1="22" y1="47" x2="36" y2="47" stroke="#b3d4f0" strokeWidth="2" strokeLinecap="round" />
      {/* Right page — Japanese characters あ い う */}
      <text
        x="70"
        y="32"
        textAnchor="middle"
        fill="var(--jp-primary)"
        fontSize="11"
        fontFamily="serif"
        opacity="0.7"
      >
        あ
      </text>
      <text
        x="70"
        y="46"
        textAnchor="middle"
        fill="var(--jp-primary)"
        fontSize="11"
        fontFamily="serif"
        opacity="0.7"
      >
        い
      </text>
      <text
        x="70"
        y="60"
        textAnchor="middle"
        fill="var(--jp-primary)"
        fontSize="11"
        fontFamily="serif"
        opacity="0.7"
      >
        う
      </text>
      {/* Small bookmark ribbon */}
      <path
        d="M60 14 L60 8 L64 11 L68 8 L68 14"
        fill="var(--jp-primary)"
        opacity="0.25"
      />
      {/* N5 badge bottom-right */}
      <rect x="72" y="72" width="20" height="12" rx="6" fill="var(--jp-primary)" opacity="0.12" />
      <text
        x="82"
        y="81"
        textAnchor="middle"
        fill="var(--jp-primary)"
        fontSize="8"
        fontWeight="600"
        fontFamily="var(--jp-font-text), sans-serif"
      >
        N5
      </text>
    </svg>
  );
}

/** 私人定制 — person silhouette with gear/customization arcs */
function IllustrationPersonalized() {
  return (
    <svg
      width="100"
      height="88"
      viewBox="0 0 100 88"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Head */}
      <circle cx="50" cy="24" r="12" fill="var(--jp-primary)" opacity="0.12" />
      <circle
        cx="50"
        cy="24"
        r="12"
        stroke="var(--jp-primary)"
        strokeWidth="1.5"
        fill="none"
      />
      {/* Body / torso */}
      <path
        d="M30 62 C30 46 38 38 50 38 C62 38 70 46 70 62"
        stroke="var(--jp-primary)"
        strokeWidth="1.5"
        fill="var(--jp-primary)"
        fillOpacity="0.08"
        strokeLinecap="round"
      />
      {/* Gear — top-right */}
      <g transform="translate(72, 16)">
        <circle cx="0" cy="0" r="7" fill="white" stroke="var(--jp-primary)" strokeWidth="1.2" />
        <circle cx="0" cy="0" r="2.5" fill="var(--jp-primary)" opacity="0.3" />
        {/* Gear teeth */}
        {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
          <line
            key={angle}
            x1={0}
            y1={-7}
            x2={0}
            y2={-10}
            stroke="var(--jp-primary)"
            strokeWidth="1.8"
            strokeLinecap="round"
            transform={`rotate(${angle})`}
          />
        ))}
      </g>
      {/* Adjustment arcs — left side */}
      <path
        d="M18 36 A18 18 0 0 0 18 52"
        stroke="#b3d4f0"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M12 32 A24 24 0 0 0 12 56"
        stroke="#b3d4f0"
        strokeWidth="1.2"
        strokeLinecap="round"
        fill="none"
        opacity="0.5"
      />
      {/* Small slider dots */}
      <circle cx="18" cy="40" r="2.5" fill="var(--jp-primary)" opacity="0.4" />
      <circle cx="12" cy="48" r="2" fill="var(--jp-primary)" opacity="0.25" />
      {/* Sparkle / star — right side */}
      <g transform="translate(82, 48)">
        <line x1="0" y1="-5" x2="0" y2="5" stroke="var(--jp-primary)" strokeWidth="1.2" strokeLinecap="round" opacity="0.4" />
        <line x1="-5" y1="0" x2="5" y2="0" stroke="var(--jp-primary)" strokeWidth="1.2" strokeLinecap="round" opacity="0.4" />
        <line x1="-3" y1="-3" x2="3" y2="3" stroke="var(--jp-primary)" strokeWidth="1" strokeLinecap="round" opacity="0.25" />
        <line x1="3" y1="-3" x2="-3" y2="3" stroke="var(--jp-primary)" strokeWidth="1" strokeLinecap="round" opacity="0.25" />
      </g>
      {/* Progress bar at bottom */}
      <rect x="28" y="72" width="44" height="4" rx="2" fill="#b3d4f0" opacity="0.5" />
      <rect x="28" y="72" width="28" height="4" rx="2" fill="var(--jp-primary)" opacity="0.3" />
    </svg>
  );
}

/** 沉浸式対話 — chat bubbles with Japanese text */
function IllustrationConversation() {
  return (
    <svg
      width="100"
      height="88"
      viewBox="0 0 100 88"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Left bubble (user) */}
      <rect
        x="8"
        y="12"
        width="48"
        height="28"
        rx="14"
        fill="var(--jp-primary)"
        opacity="0.1"
        stroke="var(--jp-primary)"
        strokeWidth="1.5"
      />
      {/* Left bubble tail */}
      <path
        d="M20 40 L16 48 L28 40"
        fill="var(--jp-primary)"
        opacity="0.1"
        stroke="var(--jp-primary)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* Text in left bubble */}
      <text
        x="32"
        y="30"
        textAnchor="middle"
        fill="var(--jp-primary)"
        fontSize="12"
        fontFamily="serif"
        opacity="0.7"
      >
        こんにちは
      </text>
      {/* Right bubble (Remi) */}
      <rect
        x="44"
        y="46"
        width="48"
        height="28"
        rx="14"
        fill="var(--jp-primary)"
        opacity="0.08"
        stroke="var(--jp-primary)"
        strokeWidth="1.5"
      />
      {/* Right bubble tail */}
      <path
        d="M80 74 L84 82 L72 74"
        fill="var(--jp-primary)"
        opacity="0.08"
        stroke="var(--jp-primary)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* Text in right bubble */}
      <text
        x="68"
        y="64"
        textAnchor="middle"
        fill="var(--jp-primary)"
        fontSize="12"
        fontFamily="serif"
        opacity="0.7"
      >
        元気です
      </text>
      {/* Sound wave arcs — top-right */}
      <path
        d="M76 10 A8 8 0 0 1 76 24"
        stroke="#b3d4f0"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M82 6 A14 14 0 0 1 82 28"
        stroke="#b3d4f0"
        strokeWidth="1.2"
        strokeLinecap="round"
        fill="none"
        opacity="0.5"
      />
      <path
        d="M88 2 A20 20 0 0 1 88 32"
        stroke="#b3d4f0"
        strokeWidth="1"
        strokeLinecap="round"
        fill="none"
        opacity="0.3"
      />
      {/* Small dot accents */}
      <circle cx="12" cy="56" r="2" fill="var(--jp-primary)" opacity="0.15" />
      <circle cx="18" cy="62" r="1.5" fill="var(--jp-primary)" opacity="0.1" />
    </svg>
  );
}

/* ---------- Illustrations map ---------- */

const illustrations: Record<string, () => React.JSX.Element> = {
  textbook: IllustrationTextbook,
  personalized: IllustrationPersonalized,
  conversation: IllustrationConversation,
};

/* ---------- Component ---------- */

export function FeatureCards() {
  const features = [
    {
      illustration: "textbook" as const,
      title: "APT 教材",
      desc: "自适应进度教学，基于 JLPT 标准体系",
      detail: "N5-N1 全覆盖",
    },
    {
      illustration: "personalized" as const,
      title: "私人定制",
      desc: "根据学习习惯与薄弱项，智能调整学习路径",
      detail: "千人千面",
    },
    {
      illustration: "conversation" as const,
      title: "沉浸式对话",
      desc: "与 Remi 真实对话练习，纠正发音与语法",
      detail: "实时反馈",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-[var(--jp-space-lg)] lg:grid-cols-3">
      {features.map((f) => {
        const Illust = illustrations[f.illustration];
        return (
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
            <div className="mb-[var(--jp-space-md)] flex items-center justify-center">
              <Illust />
            </div>
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
        );
      })}
    </div>
  );
}
