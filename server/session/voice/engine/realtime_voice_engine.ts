/**
 * RealtimeVoiceEngine — Phase 1 SHADOW STUB for the realtime/end-to-end voice shell.
 *
 * Activated by `REMI_VOICE_ENGINE=realtime_shadow`. It does NOT connect to any
 * vendor (OpenAI / Gemini / Qwen / 火山 / Moshi) and ships NO vendor SDK. It is
 * a placeholder that proves the unified event protocol is wired:
 *
 *   - The LEGACY cascade still drives the live call (the session's direct
 *     SpeechRuntime calls are untouched). This engine only *observes*.
 *   - Each observation is mapped into the unified VoiceEngine event protocol and
 *     SHADOW-LOGGED. It never sends a client message, never mutates session
 *     state, never aborts anything.
 *   - Origin tagging demonstrates item 12: the ears/mouth ("shell") may emit
 *     `partial_user_text` / `assistant_audio_chunk` / `interruption_detected` /
 *     `turn_committed`, but `assistant_partial_text` (reply text) is tagged
 *     `brain`. Any brain-only event arriving with origin "shell" is dropped by
 *     `emit()` (BaseVoiceEngine guard).
 *
 * When we later integrate a real engine, this file is where the vendor session
 * gets driven — but that is Phase 2. Today: logging only.
 */
import { createLogger } from "../../../../infra/logger";
import { BaseVoiceEngine } from "./base";
import type {
  VoiceEngineCapabilities,
  VoiceEngineEvent,
  VoiceEngineObservation,
} from "./types";
import type { SpeechRuntime } from "../speech_runtime";

const logger = createLogger("voice_engine_shadow");

export class RealtimeVoiceEngine extends BaseVoiceEngine {
  readonly id = "realtime_shadow" as const;
  protected readonly mode = "shadow" as const;

  /**
   * A SHADOW stub still declares `finalReplyAuthority: "brain"` — it never takes
   * the final say; the Brain does. That is exactly why it passes
   * `resolveVoiceEngine`'s authority gate. The other fields describe what the
   * eventual realtime shell is *expected* to provide, not what this stub does.
   */
  readonly capabilities: VoiceEngineCapabilities = {
    finalReplyAuthority: "brain",
    textControlInjection: "pre_hoc",
    fullDuplex: true,
    nativeBargeIn: false, // stub: no real model
    chinese: "native",
    localDeployable: true,
    emitsUserEmotion: false, // stub: emotion still comes from the legacy SenseVoice side-band
    requiresVerbatimGuard: false,
  };

  private readonly verbose: boolean;

  constructor(connId: string, speechRuntime: SpeechRuntime) {
    super(connId, speechRuntime);
    this.verbose = process.env.REMI_VOICE_ENGINE_SHADOW_LOG === "1";
    logger.info("[VoiceEngine] realtime_shadow active (logging only, legacy drives the call)", {
      connId,
    });
  }

  observe(obs: VoiceEngineObservation): void {
    this.safe(() => {
      switch (obs.kind) {
        case "duplex_start":
          logger.info("[VoiceEngine][shadow] duplex_start — shell would open a realtime session", {
            connId: this.connId,
          });
          return;
        case "duplex_stop":
          logger.info("[VoiceEngine][shadow] duplex_stop — shell would close the realtime session", {
            connId: this.connId,
            emitted: this.emittedEventCount,
            rejected: this.rejectedEventCount,
          });
          return;
        case "partial_user_text":
          // The ears (shell) heard interim speech.
          this.shadowEmit({
            type: "partial_user_text",
            origin: "shell",
            atMs: Date.now(),
            data: { len: obs.text.trim().length },
          });
          return;
        case "turn_state":
          this.mapTurnState(obs);
          return;
      }
    });
  }

  /** Map an authoritative turn-state transition into unified events. */
  private mapTurnState(obs: Extract<VoiceEngineObservation, { kind: "turn_state" }>): void {
    const atMs = Date.now();
    switch (obs.state) {
      case "confirmed_end":
        // The ears decided the user's turn ended.
        this.shadowEmit({ type: "turn_committed", origin: "shell", atMs, data: { reason: obs.reason } });
        return;
      case "assistant_entering":
        // Brain is composing the reply — reply text is ALWAYS the Brain's.
        this.shadowEmit({
          type: "assistant_partial_text",
          origin: "brain",
          atMs,
          data: { reason: obs.reason, ...(obs.data ?? {}) },
        });
        return;
      case "assistant_speaking":
        // The mouth (shell) is producing audio.
        this.shadowEmit({ type: "assistant_audio_chunk", origin: "shell", atMs, data: { reason: obs.reason } });
        return;
      case "interrupted_by_user":
        this.shadowEmit({ type: "interruption_detected", origin: "shell", atMs, data: { reason: obs.reason } });
        return;
      default:
        // listening_active / listening_hold / likely_end — no unified event yet
        return;
    }
  }

  private shadowEmit(event: VoiceEngineEvent): void {
    const delivered = this.emit(event);
    if (delivered && this.verbose) {
      logger.info("[VoiceEngine][shadow] event", {
        connId: this.connId,
        type: event.type,
        origin: event.origin,
        ...(event.data ?? {}),
      });
    } else if (delivered) {
      logger.debug("[VoiceEngine][shadow] event", {
        connId: this.connId,
        type: event.type,
        origin: event.origin,
      });
    }
  }
}
