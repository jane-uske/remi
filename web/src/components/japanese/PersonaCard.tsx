"use client";

/**
 * PersonaCard — displays Remi's Japanese tutor persona at a glance.
 *
 * Self-contained card with hardcoded data derived from the
 * `japanese_sensei` preset in `persona/presets.ts`.
 *
 * Apple design style: white card, hairline border, --jp-* tokens,
 * pill-shaped trait tags, no shadows.
 */

const PERSONA = {
  name: "日本語先生 Remi",
  subtitle: "にほんごせんせい",
  description:
    "耐心温暖的日语老师。用中日混合教学方式，让学习像聊天一样轻松。每一个小进步都会认真肯定。",
  traits: ["温柔", "耐心", "鼓励式教学"] as const,
  attributes: [
    { label: "温暖度", value: "bright" },
    { label: "教学风格", value: "balanced" },
    { label: "主动性", value: "balanced" },
  ] as const,
};

export function PersonaCard() {
  return (
    <div
      className="overflow-hidden rounded-[var(--jp-radius-lg)] border border-[var(--jp-hairline)] bg-white"
      style={{ maxHeight: 200 }}
    >
      <div className="flex h-full gap-4 p-[var(--jp-space-lg)]">
        {/* Avatar */}
        <div className="flex shrink-0 flex-col items-center gap-2">
          <div
            className="relative overflow-hidden rounded-full"
            style={{
              width: 56,
              height: 56,
              border: "1px solid var(--jp-hairline)",
              background:
                "linear-gradient(180deg, var(--jp-canvas) 0%, var(--jp-parchment) 100%)",
            }}
          >
            <div
              aria-hidden
              className="absolute inset-0 rounded-full"
              style={{
                background:
                  "radial-gradient(circle at 50% 40%, color-mix(in srgb, var(--jp-primary) 8%, transparent) 0%, transparent 72%)",
              }}
            />
            <img
              src="/avatar/assets/remi-selected-portrait.png"
              alt="Remi"
              className="relative h-full w-full select-none object-cover"
              draggable={false}
            />
          </div>
          {/* Online indicator dot */}
          <div
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: "#34c759" }}
            aria-label="オンライン"
          />
        </div>

        {/* Text content */}
        <div className="min-w-0 flex-1">
          {/* Name row */}
          <h3
            className="truncate text-[15px] font-semibold text-[var(--jp-ink)]"
            style={{
              fontFamily: "var(--jp-font-display)",
              letterSpacing: "-0.374px",
              lineHeight: 1.3,
            }}
          >
            {PERSONA.name}
          </h3>
          <p
            className="mt-0.5 text-[12px] text-[var(--jp-ink-48)]"
            style={{
              fontFamily: "var(--jp-font-text)",
              letterSpacing: "-0.2px",
            }}
          >
            {PERSONA.subtitle}
          </p>

          {/* Description */}
          <p
            className="mt-2 line-clamp-2 text-[13px] leading-[1.46] text-[var(--jp-ink-80)]"
            style={{
              fontFamily: "var(--jp-font-text)",
              letterSpacing: "-0.224px",
            }}
          >
            {PERSONA.description}
          </p>

          {/* Trait pills */}
          <div className="mt-3 flex flex-wrap gap-[6px]">
            {PERSONA.traits.map((trait) => (
              <span
                key={trait}
                className="inline-flex items-center rounded-[var(--jp-radius-pill)] px-[10px] py-[3px] text-[11px] font-medium"
                style={{
                  fontFamily: "var(--jp-font-text)",
                  letterSpacing: "-0.1px",
                  color: "var(--jp-primary)",
                  backgroundColor:
                    "color-mix(in srgb, var(--jp-primary) 8%, transparent)",
                }}
              >
                {trait}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
