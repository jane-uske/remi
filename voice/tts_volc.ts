import { randomUUID } from "crypto";

import { createLogger } from "../infra/logger";
import { getEmotionVoiceParams, type Emotion } from "./tts_emotion";

const logger = createLogger("tts_volc");

const DEFAULT_VOLC_TTS_URL = "https://openspeech.bytedance.com/api/v3/tts/unidirectional";
const DEFAULT_VOLC_RESOURCE_ID = "seed-tts-2.0";
const DEFAULT_VOLC_SAMPLE_RATE = 24_000;
const DEFAULT_VOLC_FORMAT = "mp3";
const DEFAULT_VOLC_UID = "remi";

export interface VolcTtsConfig {
  apiKey: string;
  resourceId: string;
  baseUrl: string;
  voiceType: string;
  format: "mp3" | "ogg_opus" | "pcm";
  sampleRate: number;
  speechRate: number;
  loudnessRate: number;
  uid: string;
  model?: string;
  explicitLanguage?: string;
  contextText?: string;
  useServiceCache: boolean;
}

function firstEnv(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

function parseNumberEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function resolveSpeechRate(emotion?: Emotion): number {
  const explicit = firstEnv("volc_tts_speech_rate", "VOLC_TTS_SPEECH_RATE");
  if (explicit) {
    return clamp(parseNumberEnv(explicit, 0), -50, 100);
  }
  if (!emotion) return 0;
  return clamp(Math.round((getEmotionVoiceParams(emotion).speed - 1) * 100), -50, 100);
}

function resolveFormat(): "mp3" | "ogg_opus" | "pcm" {
  const raw = (firstEnv("volc_tts_format", "VOLC_TTS_FORMAT") || DEFAULT_VOLC_FORMAT).toLowerCase();
  if (raw === "ogg_opus" || raw === "pcm") return raw;
  return "mp3";
}

export function resolveVolcTtsConfig(emotion?: Emotion): VolcTtsConfig | null {
  const apiKey = firstEnv("volc_tts_api_key", "VOLC_TTS_API_KEY", "tts_key");
  const voiceType = firstEnv("volc_tts_voice_type", "VOLC_TTS_VOICE_TYPE", "tts_voice");
  if (!apiKey || !voiceType) return null;

  return {
    apiKey,
    resourceId:
      firstEnv("volc_tts_resource_id", "VOLC_TTS_RESOURCE_ID") || DEFAULT_VOLC_RESOURCE_ID,
    baseUrl: firstEnv("volc_tts_base_url", "VOLC_TTS_BASE_URL") || DEFAULT_VOLC_TTS_URL,
    voiceType,
    format: resolveFormat(),
    sampleRate: parseNumberEnv(
      firstEnv("volc_tts_sample_rate", "VOLC_TTS_SAMPLE_RATE"),
      DEFAULT_VOLC_SAMPLE_RATE,
    ),
    speechRate: resolveSpeechRate(emotion),
    loudnessRate: clamp(
      parseNumberEnv(firstEnv("volc_tts_loudness_rate", "VOLC_TTS_LOUDNESS_RATE"), 0),
      -50,
      100,
    ),
    uid: firstEnv("volc_tts_uid", "VOLC_TTS_UID") || DEFAULT_VOLC_UID,
    model: firstEnv("volc_tts_model", "VOLC_TTS_MODEL"),
    explicitLanguage: firstEnv("volc_tts_explicit_language", "VOLC_TTS_EXPLICIT_LANGUAGE"),
    contextText: firstEnv("volc_tts_context_text", "VOLC_TTS_CONTEXT_TEXT"),
    useServiceCache: firstEnv("volc_tts_use_cache", "VOLC_TTS_USE_CACHE") !== "0",
  };
}

export function buildVolcTtsRequest(
  text: string,
  config: VolcTtsConfig,
): Record<string, unknown> {
  const additions: Record<string, unknown> = {};
  if (config.explicitLanguage) {
    additions.explicit_language = config.explicitLanguage;
  }
  if (config.contextText) {
    additions.context_texts = [config.contextText];
  }
  if (config.useServiceCache) {
    additions.cache_config = {
      text_type: 1,
      use_cache: true,
      use_segment_cache: true,
    };
  }

  const reqParams: Record<string, unknown> = {
    text,
    speaker: config.voiceType,
    audio_params: {
      format: config.format,
      sample_rate: config.sampleRate,
      speech_rate: config.speechRate,
      loudness_rate: config.loudnessRate,
    },
  };

  if (config.model) {
    reqParams.model = config.model;
  }
  if (Object.keys(additions).length > 0) {
    reqParams.additions = JSON.stringify(additions);
  }

  return {
    user: {
      uid: config.uid,
    },
    req_params: reqParams,
  };
}

export function decodeVolcUnidirectionalResponse(raw: string): Buffer {
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    throw new Error("Volc TTS 返回了空响应");
  }

  const audioParts: Buffer[] = [];
  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`Volc TTS 返回了非 JSON 响应: ${line.slice(0, 120)}`);
    }

    const code = (parsed as { code?: unknown }).code;
    const message = (parsed as { message?: unknown }).message;
    if (code !== undefined && Number(code) !== 0 && Number(code) !== 20000000) {
      throw new Error(`Volc TTS 响应错误 (${String(code)}): ${String(message ?? "")}`.trim());
    }

    const data = (parsed as { data?: unknown }).data;
    if (typeof data === "string" && data.trim()) {
      const audio = Buffer.from(data, "base64");
      if (audio.length > 0) {
        audioParts.push(audio);
      }
    }
  }

  if (audioParts.length === 0) {
    throw new Error("Volc TTS 响应里缺少可用的音频 data 字段");
  }
  return Buffer.concat(audioParts);
}

export async function speakWithVolc(
  text: string,
  signal?: AbortSignal,
  emotion?: Emotion,
): Promise<Buffer> {
  const config = resolveVolcTtsConfig(emotion);
  if (!config) {
    throw new Error(
      "TTS 未配置：请设置 VOLC_TTS_API_KEY、VOLC_TTS_RESOURCE_ID 和 VOLC_TTS_VOICE_TYPE",
    );
  }

  const connectId = randomUUID();
  const response = await fetch(config.baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": config.apiKey,
      "X-Api-Resource-Id": config.resourceId,
      "X-Api-Connect-Id": connectId,
    },
    body: JSON.stringify(buildVolcTtsRequest(text, config)),
    signal,
  });

  if (!response.ok) {
    const errorText = (await response.text().catch(() => "")).trim();
    throw new Error(
      errorText
        ? `Volc TTS 请求失败 (${response.status}): ${errorText.slice(0, 240)}`
        : `Volc TTS 请求失败 (${response.status})`,
    );
  }

  const rawText = await response.text();
  const audio = decodeVolcUnidirectionalResponse(rawText);

  logger.info("volc 合成完成", {
    bytes: audio.length,
    voiceType: config.voiceType,
    resourceId: config.resourceId,
  });
  return audio;
}
