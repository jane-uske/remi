import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Remi — Real-time AI Companion",
  description:
    "A real-time AI companion system with personality continuity, long-term memory, full-duplex voice, and plugin architecture.",
};

const capabilities = [
  {
    title: "Real-time Conversation",
    desc: "Full-duplex WebSocket pipeline with VAD-based turn detection, streaming LLM responses, and natural interrupt handling.",
    tag: "WebSocket / SSE",
  },
  {
    title: "Voice Interaction",
    desc: "PCM streaming STT, multi-backend TTS (Volcengine / Edge / MLX), emotion-driven prosody, and sub-second first-audio latency.",
    tag: "STT / TTS / VAD",
  },
  {
    title: "Long-term Memory",
    desc: "Episode-based memory store with semantic recall, relationship state tracking, temporal decay, and cross-session continuity.",
    tag: "PostgreSQL / Embedding",
  },
  {
    title: "Plugin Architecture",
    desc: "Capability extension layer decoupled from core conversation loop. Supports time, weather, and custom skill registration.",
    tag: "Adapter Pattern",
  },
  {
    title: "AI Coding Workflow",
    desc: "Entire system built with AI-assisted development — architecture design, implementation, testing, and iteration via Claude Code.",
    tag: "Claude Code / Devix",
  },
];

const techStack = [
  "Next.js 15",
  "React 19",
  "TypeScript",
  "Node.js",
  "WebSocket",
  "PostgreSQL",
  "Redis",
  "Qwen 2.5",
  "Volcengine TTS",
  "MLX",
  "Live2D / VRM",
  "Tailwind CSS",
];

const links = [
  {
    label: "GitHub",
    href: "https://github.com/jane-uske/remi",
    icon: "gh",
  },
  { label: "Live Demo", href: "/", icon: "demo" },
  { label: "Benchmark", href: "/benchmark", icon: "bench" },
  { label: "Video", href: "#", icon: "video" },
];

function LinkIcon({ type }: { type: string }) {
  switch (type) {
    case "gh":
      return (
        <svg viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
        </svg>
      );
    case "demo":
      return (
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
            clipRule="evenodd"
          />
        </svg>
      );
    case "bench":
      return (
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
          <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zm6-4a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zm6-3a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
        </svg>
      );
    case "video":
      return (
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
          <path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6zm12.553 1.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z" />
        </svg>
      );
    default:
      return null;
  }
}

export default function RemiPortalPage() {
  return (
    <main className="mx-auto min-h-dvh max-w-5xl px-6 py-12 md:py-20">
      {/* Hero */}
      <header className="mb-16 text-center">
        <p
          className="mb-3 text-xs font-medium uppercase tracking-[0.25em]"
          style={{ color: "var(--remi-accent)" }}
        >
          Portfolio Project
        </p>
        <h1
          className="mb-4 text-3xl font-semibold tracking-tight md:text-5xl"
          style={{ color: "var(--foreground)" }}
        >
          Remi
        </h1>
        <p
          className="mx-auto max-w-2xl text-base leading-relaxed md:text-lg"
          style={{ color: "var(--remi-dim)" }}
        >
          A real-time AI companion with personality continuity &amp; long-term
          memory. She remembers who you are, speaks with emotion, and stays
          consistent across sessions.
        </p>
      </header>

      {/* Links */}
      <nav className="mb-16 flex flex-wrap justify-center gap-3">
        {links.map((l) => (
          <Link
            key={l.label}
            href={l.href}
            className="inline-flex items-center gap-2 rounded-full border px-5 py-2 text-sm font-medium transition hover:border-[var(--remi-accent)]"
            style={{
              borderColor: "var(--remi-border)",
              color: "var(--foreground)",
            }}
            {...(l.href.startsWith("http")
              ? { target: "_blank", rel: "noopener noreferrer" }
              : {})}
          >
            <LinkIcon type={l.icon} />
            {l.label}
          </Link>
        ))}
      </nav>

      {/* Quick Start */}
      <section className="mb-16">
        <h2
          className="mb-6 text-xs font-medium uppercase tracking-[0.2em]"
          style={{ color: "var(--remi-dim)" }}
        >
          Developer Quick Start
        </h2>
        <div
          className="rounded-xl border p-6"
          style={{
            borderColor: "var(--remi-border)",
            background: "var(--remi-surface)",
          }}
        >
          <pre
            className="mb-4 overflow-x-auto text-sm leading-relaxed"
            style={{ color: "var(--foreground)" }}
          >
            <code>{`git clone https://github.com/jane-uske/remi.git && cd remi
npm install && npm install --prefix web
cp .env.localhost.example .env.localhost   # add your LLM API key + base URL
npm run dev             # open http://localhost:3001`}</code>
          </pre>
          <p
            className="text-xs leading-relaxed"
            style={{ color: "var(--remi-dim)" }}
          >
            Only 2 env vars needed: <code className="font-mono" style={{ color: "var(--remi-accent)" }}>REMI_LLM_API_KEY</code> +{" "}
            <code className="font-mono" style={{ color: "var(--remi-accent)" }}>REMI_LLM_BASE_URL</code>.
            No database, no Redis, no TTS key required.
            Text chat works out of the box. Model name auto-detects from your base URL.
          </p>
        </div>
      </section>

      {/* Capabilities */}
      <section className="mb-16">
        <h2
          className="mb-6 text-xs font-medium uppercase tracking-[0.2em]"
          style={{ color: "var(--remi-dim)" }}
        >
          Core Capabilities
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {capabilities.map((c) => (
            <div
              key={c.title}
              className="rounded-xl border p-5"
              style={{
                borderColor: "var(--remi-border)",
                background: "var(--remi-surface)",
              }}
            >
              <div className="mb-2 flex items-start justify-between gap-2">
                <h3
                  className="text-sm font-semibold"
                  style={{ color: "var(--foreground)" }}
                >
                  {c.title}
                </h3>
                <span
                  className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium"
                  style={{
                    background: "rgba(45,212,191,0.12)",
                    color: "var(--remi-accent)",
                  }}
                >
                  {c.tag}
                </span>
              </div>
              <p
                className="text-xs leading-relaxed"
                style={{ color: "var(--remi-dim)" }}
              >
                {c.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Architecture */}
      <section className="mb-16">
        <h2
          className="mb-6 text-xs font-medium uppercase tracking-[0.2em]"
          style={{ color: "var(--remi-dim)" }}
        >
          System Architecture
        </h2>
        <div
          className="overflow-hidden rounded-xl border p-6 md:p-8"
          style={{
            borderColor: "var(--remi-border)",
            background: "var(--remi-surface)",
          }}
        >
          <div className="flex flex-col gap-3 font-mono text-xs md:text-sm">
            {/* Layer 1 */}
            <div
              className="rounded-lg border px-4 py-3 text-center"
              style={{
                borderColor: "rgba(45,212,191,0.3)",
                background: "rgba(45,212,191,0.08)",
                color: "var(--foreground)",
              }}
            >
              <div className="mb-1 font-semibold" style={{ color: "var(--remi-accent)" }}>
                Interaction Layer
              </div>
              <div style={{ color: "var(--remi-dim)" }}>
                Next.js 15 &middot; WebSocket Gateway &middot; VAD &middot; STT
                Stream &middot; TTS Pipeline &middot; Interrupt Controller
              </div>
            </div>

            <div className="flex justify-center" style={{ color: "var(--remi-dim)" }}>
              &darr;
            </div>

            {/* Layer 2 */}
            <div
              className="rounded-lg border px-4 py-3 text-center"
              style={{
                borderColor: "rgba(125,211,252,0.3)",
                background: "rgba(125,211,252,0.06)",
                color: "var(--foreground)",
              }}
            >
              <div className="mb-1 font-semibold" style={{ color: "#7dd3fc" }}>
                Brain Layer
              </div>
              <div style={{ color: "var(--remi-dim)" }}>
                Fast Brain (streaming) &middot; Slow Brain (analysis) &middot;
                Emotion Engine &middot; Prompt Builder &middot; Personality
                System
              </div>
            </div>

            <div className="flex justify-center" style={{ color: "var(--remi-dim)" }}>
              &darr;
            </div>

            {/* Layer 3 */}
            <div
              className="rounded-lg border px-4 py-3 text-center"
              style={{
                borderColor: "rgba(168,85,247,0.3)",
                background: "rgba(168,85,247,0.06)",
                color: "var(--foreground)",
              }}
            >
              <div className="mb-1 font-semibold" style={{ color: "#a855f7" }}>
                Memory &amp; Storage Layer
              </div>
              <div style={{ color: "var(--remi-dim)" }}>
                Episode Store &middot; Semantic Recall &middot; Relationship
                State &middot; Temporal Decay &middot; PostgreSQL &middot; Redis
              </div>
            </div>

            <div className="flex justify-center" style={{ color: "var(--remi-dim)" }}>
              &darr;
            </div>

            {/* Layer 4 */}
            <div
              className="rounded-lg border px-4 py-3 text-center"
              style={{
                borderColor: "rgba(251,191,36,0.3)",
                background: "rgba(251,191,36,0.06)",
                color: "var(--foreground)",
              }}
            >
              <div className="mb-1 font-semibold" style={{ color: "#fbbf24" }}>
                Extension Layer
              </div>
              <div style={{ color: "var(--remi-dim)" }}>
                Plugin System &middot; Capability Registry &middot; Time /
                Weather Skills &middot; Platform Adapters
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Screenshots */}
      <section className="mb-16">
        <h2
          className="mb-6 text-xs font-medium uppercase tracking-[0.2em]"
          style={{ color: "var(--remi-dim)" }}
        >
          Screenshots
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {["Chat Interface", "Voice Interaction", "Memory Recall", "3D Avatar"].map(
            (label) => (
              <div
                key={label}
                className="flex aspect-video items-center justify-center rounded-xl border"
                style={{
                  borderColor: "var(--remi-border)",
                  background: "var(--remi-surface)",
                }}
              >
                <span
                  className="text-xs font-medium"
                  style={{ color: "var(--remi-dim)" }}
                >
                  {label} — placeholder
                </span>
              </div>
            ),
          )}
        </div>
      </section>

      {/* Tech Stack */}
      <section className="mb-16">
        <h2
          className="mb-6 text-xs font-medium uppercase tracking-[0.2em]"
          style={{ color: "var(--remi-dim)" }}
        >
          Tech Stack
        </h2>
        <div className="flex flex-wrap gap-2">
          {techStack.map((t) => (
            <span
              key={t}
              className="rounded-full border px-3 py-1 text-xs font-medium"
              style={{
                borderColor: "var(--remi-border)",
                color: "var(--foreground)",
              }}
            >
              {t}
            </span>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer
        className="border-t pt-8 text-center text-xs"
        style={{
          borderColor: "var(--remi-border)",
          color: "var(--remi-dim)",
        }}
      >
        Built by Wu Jian &middot; AI Application Frontend Engineer &middot;
        2024&ndash;2025
      </footer>
    </main>
  );
}
