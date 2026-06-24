/**
 * LegacyPipelineEngine — the existing cascade voice shell, behind the VoiceEngine seam.
 *
 * "Shell" here = the whole VAD → STT → turn detector → Brain → TTS pipeline that
 * Remi ships today. This engine is a THIN wrapper around the existing
 * `SpeechRuntime`: it holds a reference for containment/introspection but does
 * NOT re-drive it (the session keeps calling `speechRuntime.observe*` directly,
 * unchanged).
 *
 * `observe()` is a deliberate NO-OP: with `REMI_VOICE_ENGINE=legacy` (the
 * default) the engine adds zero behavior, so the live call is byte-identical to
 * pre-seam code. This is the fallback that must always remain available.
 *
 * Capabilities describe the real cascade:
 *   - finalReplyAuthority "brain": Brain is the sole decider of reply text (C3).
 *   - fullDuplex true:  the existing duplex audio path.
 *   - nativeBargeIn false: barge-in is our acoustic heuristic, not a model.
 *   - chinese "native", localDeployable true (Edge/MLX TTS + SenseVoice STT).
 *   - emitsUserEmotion true: SenseVoice side-band emotion tags.
 */
import { BaseVoiceEngine } from "./base";
import type {
  VoiceEngineCapabilities,
  VoiceEngineObservation,
} from "./types";

export class LegacyPipelineEngine extends BaseVoiceEngine {
  readonly id = "legacy" as const;
  protected readonly mode = "passthrough" as const;

  readonly capabilities: VoiceEngineCapabilities = {
    finalReplyAuthority: "brain",
    textControlInjection: "pre_hoc",
    fullDuplex: true,
    nativeBargeIn: false,
    chinese: "native",
    localDeployable: true,
    emitsUserEmotion: true,
    requiresVerbatimGuard: false,
  };

  /**
   * No-op. The legacy cascade is already driven by the session's direct
   * SpeechRuntime calls; routing observations here must add NOTHING, or legacy
   * mode would no longer equal pre-seam behavior.
   */
  observe(_obs: VoiceEngineObservation): void {
    // intentionally empty — see class doc
  }
}
