/**
 * VoiceEngine resolver — picks the active voice shell for a session.
 *
 * Precedence:
 *   1. explicit id (per-session WS `set_voice_engine` override), else
 *   2. `REMI_VOICE_ENGINE` config (env + settings overlay), else
 *   3. "legacy" (default).
 *
 * Safety rails (items 5/7/8) — ALL roads lead back to legacy:
 *   - unknown id            → legacy
 *   - construction throws    → legacy
 *   - finalReplyAuthority ≠ "brain" → legacy (Remi never cedes the final say)
 *
 * The legacy engine must always be obtainable, so a failure here can never leave
 * a session without a voice shell.
 */
import { getConfig } from "../../../../server/config";
import { createLogger } from "../../../../infra/logger";
import { LegacyPipelineEngine } from "./legacy_pipeline_engine";
import { RealtimeVoiceEngine } from "./realtime_voice_engine";
import type { VoiceEngine, VoiceEngineId } from "./types";
import type { SpeechRuntime } from "../speech_runtime";

const logger = createLogger("voice_engine");

/** Ids this build can actually construct today. Everything else → legacy. */
const SUPPORTED_IDS = new Set<string>(["legacy", "realtime_shadow"]);

function configuredEngineId(): string {
  // REMI_VOICE_ENGINE is a free-form string in the schema (not a strict enum) so
  // an unrecognized value degrades to legacy here instead of crashing startup.
  return (getConfig().REMI_VOICE_ENGINE ?? "legacy").trim().toLowerCase();
}

/**
 * Resolve the voice engine for a session.
 *
 * @param connId       per-connection id (for logging).
 * @param speechRuntime the session's existing SpeechRuntime, wrapped by the engine.
 * @param explicitId   optional per-session override (WS `set_voice_engine`).
 */
export function resolveVoiceEngine(
  connId: string,
  speechRuntime: SpeechRuntime,
  explicitId?: string,
): VoiceEngine {
  // An empty/whitespace explicit id means "no override" → fall back to config.
  const override = explicitId?.trim();
  const requested = (override ? override : configuredEngineId()).trim().toLowerCase();
  const legacy = () => new LegacyPipelineEngine(connId, speechRuntime);

  if (!SUPPORTED_IDS.has(requested)) {
    if (requested && requested !== "legacy") {
      logger.warn("[VoiceEngine] unknown engine requested → legacy", { connId, requested });
    }
    return legacy();
  }

  let engine: VoiceEngine;
  try {
    switch (requested as VoiceEngineId) {
      case "realtime_shadow":
        engine = new RealtimeVoiceEngine(connId, speechRuntime);
        break;
      case "legacy":
      default:
        engine = legacy();
        break;
    }
  } catch (err) {
    logger.warn("[VoiceEngine] engine construction failed → legacy", {
      connId,
      requested,
      error: (err as Error)?.message,
    });
    return legacy();
  }

  // Item 7: Remi never accepts a shell with the final say. Reject → legacy.
  if (engine.capabilities.finalReplyAuthority !== "brain") {
    logger.warn("[VoiceEngine] engine lacks brain final-reply authority → legacy", {
      connId,
      requested,
      id: engine.id,
    });
    return legacy();
  }

  return engine;
}

export { LegacyPipelineEngine, RealtimeVoiceEngine };
export type { VoiceEngine, VoiceEngineId } from "./types";
