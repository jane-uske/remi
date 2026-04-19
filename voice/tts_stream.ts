import type { Emotion } from "./tts_emotion";
import type { TtsRequestContext } from "./tts_request_context";
import type { TtsLipCue, TtsLipSyncMode, TtsLipSyncSource } from "../avatar/types";

type TtsModule = {
  textToSpeech: (
    sentence: string,
    signal?: AbortSignal,
    emotion?: Emotion,
    context?: TtsRequestContext,
  ) => Promise<Buffer>;
  textToSpeechWithMetadata?: (
    sentence: string,
    signal?: AbortSignal,
    emotion?: Emotion,
    context?: TtsRequestContext,
  ) => Promise<{
    audio: Buffer;
    lipSync?: {
      source: TtsLipSyncSource;
      mode: TtsLipSyncMode;
      complete: boolean;
      cues: TtsLipCue[];
    } | null;
  }>;
  isTtsEnabled: () => boolean;
};

let cachedTtsModule: TtsModule | null = null;

function loadTtsModule(): TtsModule {
  if (cachedTtsModule) return cachedTtsModule;
  try {
    cachedTtsModule = require("./tts") as TtsModule;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "MODULE_NOT_FOUND") {
      throw err;
    }
    cachedTtsModule = require("./tts.ts") as TtsModule;
  }
  return cachedTtsModule;
}

export function isTtsEnabled(): boolean {
  return loadTtsModule().isTtsEnabled();
}

/**
 * Synthesize a single sentence to audio.
 * Accepts an optional AbortSignal — rejects immediately if already aborted,
 * allowing the pipeline to skip remaining sentences on interrupt.
 */
export async function synthesize(
  sentence: string,
  signal?: AbortSignal,
  emotion?: Emotion,
  context?: TtsRequestContext,
): Promise<Buffer> {
  if (signal?.aborted) throw new DOMException("TTS aborted", "AbortError");
  return loadTtsModule().textToSpeech(sentence, signal, emotion, context);
}

export async function synthesizeResult(
  sentence: string,
  signal?: AbortSignal,
  emotion?: Emotion,
  context?: TtsRequestContext,
): Promise<{
  audio: Buffer;
  lipSync?: {
    source: TtsLipSyncSource;
    mode: TtsLipSyncMode;
    complete: boolean;
    cues: TtsLipCue[];
  } | null;
}> {
  if (signal?.aborted) throw new DOMException("TTS aborted", "AbortError");
  const ttsModule = loadTtsModule();
  if (ttsModule.textToSpeechWithMetadata) {
    return ttsModule.textToSpeechWithMetadata(sentence, signal, emotion, context);
  }
  return {
    audio: await ttsModule.textToSpeech(sentence, signal, emotion, context),
    lipSync: null,
  };
}
