"use client";

type RemiAvatarProps = {
  /** Diameter in pixels. Defaults to 72 for the welcome hero. */
  size?: number;
  /** Accessible alt text. */
  alt?: string;
  /** Additional CSS classes on the outer wrapper. */
  className?: string;
};

/**
 * Branded Remi avatar for the Japanese dashboard.
 *
 * Renders the official portrait asset inside a clean circular frame that
 * follows the `--jp-*` design tokens (Apple-style: no box-shadow, thin
 * hairline border, subtle gradient backdrop).
 *
 * Usage:
 *   <RemiAvatar />            — 72 px default for the welcome hero
 *   <RemiAvatar size={40} />  — smaller variant for headers / lists
 */
export function RemiAvatar({
  size = 72,
  alt = "Remi",
  className = "",
}: RemiAvatarProps) {
  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-full ${className}`.trim()}
      style={{
        width: size,
        height: size,
        border: "1px solid var(--jp-hairline)",
        background:
          "linear-gradient(180deg, var(--jp-canvas) 0%, var(--jp-parchment) 100%)",
      }}
    >
      {/* Subtle accent ring visible behind the portrait */}
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
        alt={alt}
        className="relative h-full w-full select-none object-cover"
        draggable={false}
      />
    </div>
  );
}
