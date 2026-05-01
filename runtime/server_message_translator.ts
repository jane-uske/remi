import type {
  AvatarFrame,
  AvatarIntent,
  Emotion,
  RemiTurnState,
  RemiTurnStateReason,
  TtsLipCue,
  TtsLipSyncMode,
  TtsLipSyncSource,
} from "../avatar/types";
import type { RemiRuntimeEvent } from "./protocol";

const DEFAULT_AUDIO_SAMPLE_RATE = 24000;

const IGNORED_SERVER_EVENT_TYPES = new Set([
  "history_page",
  "stt_partial",
  "stt_final",
  "stt_prediction",
  "vad_start",
  "vad_end",
  "interrupt",
  "persona_preset_state",
  "dev_preset_applied",
  "dev_tts_voice_applied",
  "dev_state_reset",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function parseGenerationId(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.floor(raw);
  if (typeof raw === "string") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return Math.floor(parsed);
  }
  return null;
}

function parseSampleRate(raw: unknown): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_AUDIO_SAMPLE_RATE;
}

function parseLipSyncMode(raw: unknown): TtsLipSyncMode {
  return raw === "append" ? "append" : "replace";
}

function parseLipSyncSource(raw: unknown): TtsLipSyncSource {
  return raw === "provider_viseme"
    ? "provider_viseme"
    : "provider_word_boundary_derived";
}

export function translateRemiServerMessageToRuntimeEvent(
  raw: unknown,
): RemiRuntimeEvent | null {
  if (!isRecord(raw)) return null;
  const type = typeof raw.type === "string" ? raw.type : "";
  if (!type || IGNORED_SERVER_EVENT_TYPES.has(type)) return null;

  switch (type) {
    case "chat_chunk": {
      const generationId = parseGenerationId(raw.generationId);
      if (generationId == null) return null;
      return {
        type: "text_delta",
        text: typeof raw.content === "string" ? raw.content : "",
        generationId,
      };
    }

    case "chat_end": {
      const generationId = parseGenerationId(raw.generationId);
      if (generationId == null) return null;
      return {
        type: "text_final",
        text: typeof raw.content === "string" ? raw.content : "",
        generationId,
      };
    }

    case "voice":
    case "voice_chunk":
    case "voice_pcm_chunk": {
      const generationId = parseGenerationId(raw.generationId);
      if (generationId == null || typeof raw.audio !== "string") return null;
      return {
        type: "audio_chunk",
        audio: raw.audio,
        sampleRate: type === "voice" ? DEFAULT_AUDIO_SAMPLE_RATE : parseSampleRate(raw.sampleRate),
        generationId,
      };
    }

    case "tts_lip_sync": {
      const generationId = parseGenerationId(raw.generationId);
      if (generationId == null || !Array.isArray(raw.cues)) return null;
      return {
        type: "lip_sync",
        cues: raw.cues as TtsLipCue[],
        generationId,
        complete: raw.complete === true,
        mode: parseLipSyncMode(raw.mode),
        source: parseLipSyncSource(raw.source),
      };
    }

    case "turn_state": {
      const state = typeof raw.state === "string" && raw.state ? raw.state : null;
      const reason = typeof raw.reason === "string" && raw.reason ? raw.reason : null;
      if (!state || !reason) return null;
      const generationId = parseGenerationId(raw.generationId);
      const preview =
        typeof raw.preview === "string" && raw.preview.trim() ? raw.preview.trim() : undefined;
      return {
        type: "turn_state",
        state: state as RemiTurnState,
        reason: reason as RemiTurnStateReason,
        ...(generationId != null ? { generationId } : {}),
        ...(preview ? { preview } : {}),
      };
    }

    case "emotion":
      if (raw.emotion == null) return null;
      return {
        type: "emotion",
        emotion: raw.emotion as Emotion | string,
      };

    case "avatar_frame":
      if (!isRecord(raw.frame)) return null;
      return {
        type: "avatar_frame",
        frame: raw.frame as AvatarFrame,
      };

    case "avatar_intent":
      if (!isRecord(raw.intent)) return null;
      return {
        type: "avatar_intent",
        intent: raw.intent as unknown as AvatarIntent,
      };

    case "error":
      return {
        type: "error",
        message: String(raw.content ?? raw.message ?? "错误"),
      };

    default:
      return null;
  }
}
