/**
 * VoiceEngine — Phase 1 abstraction for the *swappable realtime voice shell*.
 *
 * Read docs/voice/VOICE_NATIVE_MODE.md §6/§7 first. The one-line stance:
 *
 *   端到端语音大模型 = Remi 可插拔的「实时语音外壳」（耳朵、嘴、即时反应、打断、语气）。
 *   Remi 自有系统 = 不可替换的「灵魂」（人格、记忆、角色、工具、偏好、世界状态、**最终发言权**）。
 *
 * This is a HIGHER-level seam than `TurnDetectorProvider` / `TTSProvider`:
 *   - A VoiceEngine wraps a WHOLE voice shell. The existing cascade
 *     (VAD → STT → turn detector → Brain → TTS) is one engine: `LegacyPipelineEngine`.
 *   - TurnDetectorProvider / TTSProvider live *inside* an engine. Containment,
 *     not competition. A future vendor engine would own its own ears/mouth.
 *
 * Phase 1 is OBSERVATIONAL ONLY (mirrors the SpeechRuntime contract):
 *   - `legacy` engine: pure pass-through; `observe()` is a no-op so behavior is
 *     byte-identical to pre-seam code.
 *   - `realtime_shadow` engine: maps observations into the unified event protocol
 *     and ONLY logs them. It never sends to the client, never mutates session
 *     state, never connects to any vendor. The legacy shell still drives the call.
 *
 * The take-over surface (start / pushAudioFrame / speak / stop / dispose), where
 * an engine actually owns the audio path, is Phase 2 and intentionally NOT part
 * of this interface yet — adding it now would invite "不改变现有行为" violations.
 */
import type { RemiTurnState, RemiTurnStateReason } from "../../../../avatar/types";
import type { SpeechRuntime } from "../speech_runtime";

/** Identity of a voice shell. Only `legacy` and `realtime_shadow` exist today. */
export type VoiceEngineId =
  | "legacy"
  | "realtime_shadow"
  // ── Phase 2+ vendor placeholders (NOT implemented; listed for the contract) ──
  | "volc_rtc"
  | "openai_realtime"
  | "gemini_live"
  | "qwen_omni"
  | "minicpm_o"
  | "moshi";

/**
 * Who has the FINAL say on what Remi says.
 *   - "brain": Remi Brain is the sole decider of reply text. **Remi only accepts this.**
 *   - "shell": the voice model decides its own words (pure audio-token S2S). Rejected.
 */
export type FinalReplyAuthority = "brain" | "shell";

/**
 * Where (if anywhere) Brain text can be injected to keep authority.
 * Maps to the C1/C2/C3 taxonomy in VOICE_NATIVE_MODE.md §2:
 *   - "none":     C1 — no injection point (can't return authority to Brain).
 *   - "post_hoc": C2 — read-script mouth (verbatim fidelity unreliable → needs guard).
 *   - "pre_hoc":  C3 — Brain is the sole text decider before synthesis (cascade, frozen-LLM).
 */
export type TextControlInjection = "none" | "post_hoc" | "pre_hoc";

export interface VoiceEngineCapabilities {
  /** Remi only accepts "brain". `resolveVoiceEngine` rejects "shell" → legacy. */
  finalReplyAuthority: FinalReplyAuthority;
  /** Text-control injection point (C1/C2/C3). */
  textControlInjection: TextControlInjection;
  /** Can listen and speak at the same time. */
  fullDuplex: boolean;
  /** Engine performs barge-in natively (vs. our acoustic heuristic). */
  nativeBargeIn: boolean;
  /** Chinese support tier. */
  chinese: "native" | "multilingual" | "none";
  /** Can run fully on-device / self-hosted. */
  localDeployable: boolean;
  /** Emits a user-emotion side-band hint (e.g. SenseVoice tags). */
  emitsUserEmotion: boolean;
  /** post_hoc engines need a verbatim guard before we trust their spoken text. */
  requiresVerbatimGuard: boolean;
}

// ── Unified event protocol (item 11) ────────────────────────────────────────

/**
 * The 9 events any VoiceEngine speaks in. A superset of the SpeechRuntime event
 * stream; vendor-neutral so swapping the shell never changes the session's
 * consumer code.
 */
export type VoiceEngineEventType =
  | "user_audio_frame"
  | "partial_user_text"
  | "assistant_partial_text"
  | "assistant_audio_chunk"
  | "interruption_detected"
  | "user_emotion_hint"
  | "turn_committed"
  | "tool_request"
  | "memory_write_candidate";

/**
 * Where an event came from.
 *   - "brain":    Remi Brain produced it (reply text, tools, memory writes).
 *   - "sideband": a non-voice-model analyzer produced it (e.g. SenseVoice emotion tags).
 *   - "shell":    the voice model / acoustic shell produced it (ears + mouth + barge-in).
 */
export type VoiceEventOrigin = "brain" | "sideband" | "shell";

export interface VoiceEngineEvent {
  type: VoiceEngineEventType;
  origin: VoiceEventOrigin;
  atMs: number;
  data?: Record<string, unknown>;
}

/**
 * Events that may ONLY originate from Brain or a side-band — NEVER from the voice
 * model (item 12). The voice shell hears and speaks; it does not get to invent
 * tool calls, write memories, decide reply text, or assert the user's emotion.
 * `emit()` drops any of these carrying `origin: "shell"`.
 */
export const BRAIN_OR_SIDEBAND_ONLY_EVENTS: ReadonlySet<VoiceEngineEventType> =
  new Set<VoiceEngineEventType>([
    "assistant_partial_text", // reply text is Brain's, always
    "tool_request", // tools are Brain's, always
    "memory_write_candidate", // memory writes are Brain's, always
    "user_emotion_hint", // emotion comes from side-band (SenseVoice) or Brain, never the shell
  ]);

/**
 * Returns true if `origin` is allowed to produce `type`. The voice shell is
 * forbidden from the brain-only events; everything else is unrestricted.
 */
export function isAllowedEventOrigin(
  type: VoiceEngineEventType,
  origin: VoiceEventOrigin,
): boolean {
  if (origin === "shell" && BRAIN_OR_SIDEBAND_ONLY_EVENTS.has(type)) {
    return false;
  }
  return true;
}

// ── Observations (what the session feeds the engine) ─────────────────────────

/**
 * A minimal, vendor-neutral observation the live session hands to the engine.
 * The engine maps each observation into zero or more unified events. Kept
 * deliberately small so the number of session-side tap points stays tiny and
 * additive (no rewrite of the existing SpeechRuntime call sites).
 */
export type VoiceEngineObservation =
  | { kind: "duplex_start" }
  | { kind: "duplex_stop" }
  | { kind: "turn_state"; state: RemiTurnState; reason: RemiTurnStateReason; data?: Record<string, unknown> }
  | { kind: "partial_user_text"; text: string };

// ── Engine interface (item 1) ────────────────────────────────────────────────

export interface VoiceEngineSnapshot {
  id: VoiceEngineId;
  mode: "passthrough" | "shadow";
  capabilities: VoiceEngineCapabilities;
  /** Unified events emitted so far (shadow engines only; legacy stays 0). */
  emittedEventCount: number;
  /** brain-only events rejected for carrying origin "shell" (item 12 guard). */
  rejectedEventCount: number;
}

export type VoiceEngineEventListener = (event: VoiceEngineEvent) => void;

export interface VoiceEngine {
  readonly id: VoiceEngineId;
  readonly capabilities: VoiceEngineCapabilities;
  /**
   * The legacy speech runtime this engine wraps. Phase 1 keeps the existing
   * cascade as the source of truth; the engine contains it (introspection /
   * snapshot) but does NOT re-drive it.
   */
  readonly speechRuntime: SpeechRuntime;
  /**
   * Feed a session-side observation. The engine maps it into unified events.
   * MUST NEVER throw — a shell bug must not break a live call.
   */
  observe(obs: VoiceEngineObservation): void;
  /** Subscribe to the unified event stream (Phase 1: shadow consumers / tests). */
  on(type: VoiceEngineEventType, cb: VoiceEngineEventListener): void;
  /** Snapshot for tests / telemetry. */
  snapshot(): VoiceEngineSnapshot;
}
