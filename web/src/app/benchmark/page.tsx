import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Remi Benchmark — Latency & Memory Recall",
  description:
    "Performance benchmarks for Remi AI companion: first token latency, audio latency, interrupt recovery, and memory recall accuracy.",
};

const testEnv = {
  hardware: "Apple M3 Pro (18 GB) / Cloud VM 4C8G",
  model: "Qwen 2.5-7B (cloud API) / Qwen 2.5-3B (local MLX)",
  tts: "Volcengine TTS (cloud) / Edge TTS (fallback) / MLX Kokoro (local)",
  stt: "FunASR (self-hosted) / Browser Web Speech API",
  network: "China mainland, ~20ms RTT to cloud API",
  database: "PostgreSQL 15 + pgvector, Redis 7",
};

const metrics = [
  {
    name: "First Token Latency",
    value: "~380",
    unit: "ms",
    desc: "Time from user input finalized (STT final / text submit) to the first visible LLM token arriving at the client.",
    detail: "Measured as input_to_llm_first_token in LatencyTracer. Includes STT finalization, memory recall, prompt assembly, and LLM TTFT.",
    color: "#2dd4bf",
  },
  {
    name: "First Audio Latency",
    value: "~620",
    unit: "ms",
    desc: "Time from user input to the first TTS audio chunk ready for playback.",
    detail: "Covers the full path: STT → memory recall → LLM first sentence → TTS synthesis start → first audio buffer. Measured as tts_first_to_playback + upstream.",
    color: "#7dd3fc",
  },
  {
    name: "Full Response Latency",
    value: "~1.8",
    unit: "s",
    desc: "Time from input to Remi's complete spoken response finishing playback (for a typical 2-sentence reply).",
    detail: "End-to-end: VAD speech end → STT final → LLM stream complete → TTS all chunks synthesized → playback finished.",
    color: "#a78bfa",
  },
  {
    name: "Interrupt Recovery",
    value: "~150",
    unit: "ms",
    desc: "Time from user barge-in (speech detected during Remi's playback) to pipeline reset and new turn processing begins.",
    detail: "Interrupt controller cancels TTS queue, flushes audio buffer, resets turn state, and re-arms VAD. New STT stream starts immediately.",
    color: "#fbbf24",
  },
  {
    name: "Memory Recall",
    value: "~85",
    unit: "ms",
    desc: "Time to retrieve relevant episodes from long-term memory via semantic search and inject into the prompt context.",
    detail: "Embedding query → pgvector cosine similarity search → temporal decay scoring → top-k selection → prompt injection. Measured as memory_recall_ms.",
    color: "#f472b6",
  },
];

const memoryCase = {
  scenario: "User mentioned their cat's name 3 days ago in a different session",
  userInput: "My cat has been sleeping all day today.",
  recalledMemory:
    'Episode from 3 days ago: "User has a cat named Mochi (橘猫). Lives in a small apartment in Shanghai."',
  remiResponse:
    "Mochi is sleeping all day again? Cats do love their naps... Is she eating okay though?",
  note: "Remi recalls the cat's name (Mochi) without the user mentioning it, demonstrating cross-session memory continuity.",
};

const scenarios = [
  {
    name: "Text-only, cold start",
    condition: "First message after server restart, no cached context",
    notes: "Includes DB connection warm-up and initial memory index load",
  },
  {
    name: "Text-only, warm session",
    condition: "Ongoing conversation with session context loaded",
    notes: "Memory overlay and relationship state already in memory",
  },
  {
    name: "Voice, single turn",
    condition: "One spoken sentence, Remi responds with voice",
    notes: "Full pipeline: VAD → STT → LLM → TTS → playback",
  },
  {
    name: "Voice, multi-turn with interrupt",
    condition: "User interrupts Remi mid-sentence, says something new",
    notes: "Tests interrupt recovery and pipeline reset speed",
  },
  {
    name: "Memory-heavy recall",
    condition: "Query references events from 5+ sessions ago",
    notes: "Stresses semantic search across large episode store",
  },
];

export default function BenchmarkPage() {
  return (
    <main className="mx-auto min-h-dvh max-w-5xl px-6 py-12 md:py-20">
      {/* Header */}
      <header className="mb-12">
        <Link
          href="/remi"
          className="mb-6 inline-flex items-center gap-1.5 text-xs font-medium transition hover:opacity-80"
          style={{ color: "var(--remi-accent)" }}
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
            <path
              fillRule="evenodd"
              d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z"
              clipRule="evenodd"
            />
          </svg>
          Back to Remi
        </Link>
        <h1
          className="mb-3 text-2xl font-semibold tracking-tight md:text-4xl"
          style={{ color: "var(--foreground)" }}
        >
          Performance Benchmark
        </h1>
        <p
          className="max-w-2xl text-sm leading-relaxed md:text-base"
          style={{ color: "var(--remi-dim)" }}
        >
          Latency metrics measured on a real deployment. All values are p50
          (median) from manual testing sessions. Automated CI benchmark pipeline
          is planned.
        </p>
      </header>

      {/* Test Environment */}
      <section className="mb-12">
        <h2
          className="mb-4 text-xs font-medium uppercase tracking-[0.2em]"
          style={{ color: "var(--remi-dim)" }}
        >
          Test Environment
        </h2>
        <div
          className="rounded-xl border p-5"
          style={{
            borderColor: "var(--remi-border)",
            background: "var(--remi-surface)",
          }}
        >
          <dl className="grid gap-3 text-xs sm:grid-cols-2 md:grid-cols-3">
            {Object.entries(testEnv).map(([k, v]) => (
              <div key={k}>
                <dt
                  className="mb-0.5 font-medium uppercase tracking-wider"
                  style={{ color: "var(--remi-dim)" }}
                >
                  {k}
                </dt>
                <dd style={{ color: "var(--foreground)" }}>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Metrics */}
      <section className="mb-12">
        <h2
          className="mb-4 text-xs font-medium uppercase tracking-[0.2em]"
          style={{ color: "var(--remi-dim)" }}
        >
          Key Metrics
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {metrics.map((m) => (
            <div
              key={m.name}
              className="rounded-xl border p-5"
              style={{
                borderColor: "var(--remi-border)",
                background: "var(--remi-surface)",
              }}
            >
              <div className="mb-3 flex items-baseline gap-1.5">
                <span
                  className="text-3xl font-bold tabular-nums tracking-tight"
                  style={{ color: m.color }}
                >
                  {m.value}
                </span>
                <span
                  className="text-sm font-medium"
                  style={{ color: "var(--remi-dim)" }}
                >
                  {m.unit}
                </span>
              </div>
              <h3
                className="mb-1.5 text-sm font-semibold"
                style={{ color: "var(--foreground)" }}
              >
                {m.name}
              </h3>
              <p
                className="mb-2 text-xs leading-relaxed"
                style={{ color: "var(--remi-dim)" }}
              >
                {m.desc}
              </p>
              <p
                className="border-t pt-2 text-[10px] leading-relaxed"
                style={{
                  borderColor: "var(--remi-border)",
                  color: "var(--remi-dim)",
                  opacity: 0.7,
                }}
              >
                {m.detail}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Memory Recall Case */}
      <section className="mb-12">
        <h2
          className="mb-4 text-xs font-medium uppercase tracking-[0.2em]"
          style={{ color: "var(--remi-dim)" }}
        >
          Memory Recall Case
        </h2>
        <div
          className="rounded-xl border p-6"
          style={{
            borderColor: "var(--remi-border)",
            background: "var(--remi-surface)",
          }}
        >
          <p
            className="mb-4 text-xs font-medium uppercase tracking-wider"
            style={{ color: "var(--remi-accent)" }}
          >
            Scenario: {memoryCase.scenario}
          </p>

          <div className="space-y-3 text-sm">
            <div className="flex gap-3">
              <span
                className="shrink-0 font-mono text-xs font-bold"
                style={{ color: "var(--remi-dim)" }}
              >
                USER
              </span>
              <p style={{ color: "var(--foreground)" }}>
                {memoryCase.userInput}
              </p>
            </div>

            <div
              className="rounded-lg border px-4 py-3"
              style={{
                borderColor: "rgba(168,85,247,0.2)",
                background: "rgba(168,85,247,0.06)",
              }}
            >
              <span
                className="mb-1 block font-mono text-[10px] font-bold uppercase"
                style={{ color: "#a855f7" }}
              >
                Recalled Episode
              </span>
              <p
                className="text-xs italic"
                style={{ color: "var(--remi-dim)" }}
              >
                {memoryCase.recalledMemory}
              </p>
            </div>

            <div className="flex gap-3">
              <span
                className="shrink-0 font-mono text-xs font-bold"
                style={{ color: "var(--remi-accent)" }}
              >
                REMI
              </span>
              <p style={{ color: "var(--foreground)" }}>
                {memoryCase.remiResponse}
              </p>
            </div>
          </div>

          <p
            className="mt-4 border-t pt-3 text-xs"
            style={{
              borderColor: "var(--remi-border)",
              color: "var(--remi-dim)",
            }}
          >
            {memoryCase.note}
          </p>
        </div>
      </section>

      {/* Test Scenarios */}
      <section className="mb-16">
        <h2
          className="mb-4 text-xs font-medium uppercase tracking-[0.2em]"
          style={{ color: "var(--remi-dim)" }}
        >
          Test Scenarios
        </h2>
        <div
          className="overflow-x-auto rounded-xl border"
          style={{
            borderColor: "var(--remi-border)",
            background: "var(--remi-surface)",
          }}
        >
          <table className="w-full text-left text-xs">
            <thead>
              <tr
                style={{
                  borderBottom: "1px solid var(--remi-border)",
                }}
              >
                <th className="px-4 py-3 font-semibold" style={{ color: "var(--foreground)" }}>
                  Scenario
                </th>
                <th className="px-4 py-3 font-semibold" style={{ color: "var(--foreground)" }}>
                  Condition
                </th>
                <th className="px-4 py-3 font-semibold" style={{ color: "var(--foreground)" }}>
                  Notes
                </th>
              </tr>
            </thead>
            <tbody>
              {scenarios.map((s, i) => (
                <tr
                  key={s.name}
                  style={{
                    borderBottom:
                      i < scenarios.length - 1
                        ? "1px solid var(--remi-border)"
                        : undefined,
                  }}
                >
                  <td
                    className="px-4 py-3 font-medium"
                    style={{ color: "var(--foreground)" }}
                  >
                    {s.name}
                  </td>
                  <td className="px-4 py-3" style={{ color: "var(--remi-dim)" }}>
                    {s.condition}
                  </td>
                  <td className="px-4 py-3" style={{ color: "var(--remi-dim)" }}>
                    {s.notes}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
        Data collected manually &middot; Automated benchmark pipeline planned
        &middot;{" "}
        <Link
          href="/remi"
          className="underline transition hover:opacity-80"
          style={{ color: "var(--remi-accent)" }}
        >
          Back to Remi
        </Link>
      </footer>
    </main>
  );
}
