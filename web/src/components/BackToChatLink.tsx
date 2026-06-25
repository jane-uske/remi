import Link from "next/link";

/**
 * A small fixed pill that takes the user from a standalone sub-page (world,
 * benchmark, develop, demo) back to the chat. Fixed-positioned, so it can be
 * dropped anywhere in a page's tree without affecting layout.
 */
export function BackToChatLink({ label = "回聊天" }: { label?: string }) {
  return (
    <Link
      href="/chat"
      aria-label={label}
      className="fixed left-4 top-[max(1rem,calc(env(safe-area-inset-top)+0.5rem))] z-50 inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium backdrop-blur-md transition hover:border-[var(--remi-accent)]"
      style={{
        borderColor: "var(--remi-border)",
        background: "color-mix(in srgb, var(--remi-surface) 80%, transparent)",
        color: "var(--foreground)",
      }}
    >
      <span aria-hidden>←</span> {label}
    </Link>
  );
}
