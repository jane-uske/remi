import { randomUUID } from "crypto";

import { createLogger } from "../infra/logger";
import { getEmotionVoiceParams, type Emotion } from "./tts_emotion";
import type { TtsRequestContext } from "./tts_request_context";
import { getSessionTtsRuntimeOverride } from "./tts_runtime_overrides";

const logger = createLogger("tts_volc");

const DEFAULT_VOLC_TTS_URL = "https://openspeech.bytedance.com/api/v3/tts/unidirectional";
const DEFAULT_VOLC_RESOURCE_ID = "seed-tts-2.0";
const DEFAULT_VOLC_SAMPLE_RATE = 24_000;
const DEFAULT_VOLC_FORMAT = "mp3";
const DEFAULT_VOLC_UID = "remi";
const DEFAULT_DYNAMIC_SPEECH_RATE_BOOST = 3;

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
  emotion?: string;
  emotionScale?: number;
  explicitLanguage?: string;
  contextText?: string;
  silenceDuration: number;
  postProcessPitch: number;
  useServiceCache: boolean;
  dynamicStyleEnabled: boolean;
  expressionPreset: VolcExpressionPreset;
}

export type VolcExpressionPreset =
  | "neutral_natural"
  | "grounded_comfort"
  | "serious_close"
  | "playful_light"
  | "playful_tease"
  | "soft_intimate"
  | "intimate_tease";

interface VolcExpressionPlan {
  preset: VolcExpressionPreset;
  speechRate: number;
  contextText?: string;
  emotion?: string;
  emotionScale?: number;
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

function resolveBaseSpeechRate(emotion?: Emotion): number {
  const explicit = firstEnv("volc_tts_speech_rate", "VOLC_TTS_SPEECH_RATE");
  if (explicit) {
    return clamp(parseNumberEnv(explicit, 0), -50, 100);
  }
  if (!emotion) return DEFAULT_DYNAMIC_SPEECH_RATE_BOOST;
  return clamp(
    Math.round((getEmotionVoiceParams(emotion).speed - 1) * 100) + DEFAULT_DYNAMIC_SPEECH_RATE_BOOST,
    -50,
    100,
  );
}

function isDynamicStyleEnabled(): boolean {
  return firstEnv("volc_tts_enable_dynamic_style", "VOLC_TTS_ENABLE_DYNAMIC_STYLE") !== "0";
}

function detectExpressionIntent(text: string): "comfort" | "serious" | "playful" | "intimate" | null {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return null;
  if (/(别怕|没事|我在|休息|慢一点|慢点|先别|抱抱|睡吧|辛苦了)/u.test(normalized)) {
    return "comfort";
  }
  if (/(答应|保证|会陪|陪着你|认真|相信我|别担心|稳住|先听我说)/u.test(normalized)) {
    return "serious";
  }
  if (/(终于|坏|撩|想我|想不想|敢不敢|是不是|啧|哼|乖|骗你)/u.test(normalized)) {
    return "playful";
  }
  if (/(耳边|靠近|贴近|过来|小声|悄悄|别急|先看我)/u.test(normalized)) {
    return "intimate";
  }
  return null;
}

function buildContextTextFromLiveState(context?: TtsRequestContext): string | undefined {
  const stance = context?.relationalStance;
  const policy = context?.responsePolicy;
  const clauses: string[] = [];

  if (stance?.boundary === "close") {
    clauses.push("可以更贴近一点");
  } else if (stance?.boundary === "light") {
    clauses.push("保持一点边界感");
  }

  if (stance?.soothingStyle === "grounded_reassurance") {
    clauses.push("更稳一点，像在接住对方");
  } else if (stance?.soothingStyle === "easy_banter") {
    clauses.push("可以带一点自然笑意");
  } else if (stance?.soothingStyle === "listen_first") {
    clauses.push("先轻一点，不要压过去");
  }

  if (stance?.expressionDirectness === "clear" || policy?.directness === "high") {
    clauses.push("说得更直接一点");
  } else if (stance?.expressionDirectness === "soft" || policy?.directness === "low") {
    clauses.push("说得更轻一点");
  }

  if (policy?.warmth === "high") {
    clauses.push("保持贴近和温度");
  }

  if (context?.usage === "backchannel") {
    clauses.push("更短、更像随口接话");
  } else if (context?.usage === "interrupt_reaction") {
    clauses.push("像被突然打断时的本能反应");
  } else if (context?.usage === "thinking_filler") {
    clauses.push("尽量轻，不要抢主回复");
  }

  if (clauses.length === 0) return undefined;
  return `${clauses.join("，")}，保持自然克制，不要刻意发骚，也不要像夸张角色配音。`;
}

function resolveExpressionPreset(
  intent: "comfort" | "serious" | "playful" | "intimate" | null,
  emotion: Emotion | undefined,
  context: TtsRequestContext | undefined,
): VolcExpressionPreset {
  if (context?.usage === "thinking_filler" || context?.usage === "backchannel") {
    return "neutral_natural";
  }
  if (context?.usage === "interrupt_reaction") {
    return "neutral_natural";
  }
  if (intent === "comfort" || emotion === "sad") return "grounded_comfort";
  if (intent === "serious") return "serious_close";
  if (intent === "intimate") return "soft_intimate";
  if (intent === "playful") return "playful_tease";
  if (emotion === "happy") return "playful_light";
  if (emotion === "shy") return "soft_intimate";
  return "neutral_natural";
}

export function planVolcExpression(
  text: string,
  emotion?: Emotion,
  context?: TtsRequestContext,
): VolcExpressionPlan {
  const baseSpeechRate = resolveBaseSpeechRate(emotion);
  const explicitContext = firstEnv("volc_tts_context_text", "VOLC_TTS_CONTEXT_TEXT");
  const explicitEmotion = firstEnv("volc_tts_emotion", "VOLC_TTS_EMOTION");
  const explicitEmotionScale = firstEnv("volc_tts_emotion_scale", "VOLC_TTS_EMOTION_SCALE");
  const liveStateContext = buildContextTextFromLiveState(context);
  const intent = detectExpressionIntent(text);
  const preset = resolveExpressionPreset(intent, emotion, context);
  if (!isDynamicStyleEnabled()) {
    return {
      preset,
      speechRate: baseSpeechRate,
      contextText: explicitContext || liveStateContext,
      emotion: explicitEmotion,
      emotionScale: explicitEmotion
        ? clamp(parseNumberEnv(explicitEmotionScale, 4), 1, 5)
        : undefined,
    };
  }

  if (explicitContext || explicitEmotion) {
    return {
      preset,
      speechRate: baseSpeechRate,
      contextText: explicitContext,
      emotion: explicitEmotion,
      emotionScale: explicitEmotion
        ? clamp(parseNumberEnv(explicitEmotionScale, 4), 1, 5)
        : undefined,
    };
  }

  let speechRate = baseSpeechRate;
  let contextText: string | undefined;
  let volcEmotion: string | undefined;
  let emotionScale: number | undefined;

  switch (preset) {
    case "grounded_comfort":
      speechRate = clamp(baseSpeechRate - 6, -50, 100);
      contextText = "更轻一点，更稳一点，像在安抚对方，不要播报腔。";
      if (emotion === "sad") {
        volcEmotion = "sad";
        emotionScale = 4;
      }
      break;
    case "serious_close":
      speechRate = clamp(baseSpeechRate - 4, -50, 100);
      contextText = "更认真一点，更稳一点，减少表演感，像真人在当面说话。";
      break;
    case "playful_light":
      speechRate = clamp(baseSpeechRate + 3, -50, 100);
      contextText = "带一点笑意和亲近感，但保持自然克制，不要太撩，也不要像角色配音。";
      volcEmotion = "happy";
      emotionScale = 2;
      break;
    case "playful_tease":
      speechRate = clamp(baseSpeechRate + 4, -50, 100);
      contextText = "带一点坏笑和调情感，明显会撩一点，但保持自然，不要太骚，也不要像角色配音。";
      volcEmotion = "happy";
      emotionScale = 3;
      break;
    case "soft_intimate":
      speechRate = clamp(baseSpeechRate - 4, -50, 100);
      contextText = emotion === "shy"
        ? "更轻一点，带一点犹豫和克制，像在贴近地说话。"
        : "更近一点，更轻一点，像靠近耳边说话，但保持自然克制，不要太暧昧。";
      break;
    case "intimate_tease":
      speechRate = clamp(baseSpeechRate - 1, -50, 100);
      contextText = "更近一点，更轻一点，像靠近耳边说话，允许带一点暧昧，但别直接变露骨床戏。";
      volcEmotion = "happy";
      emotionScale = 3;
      break;
    default:
      if (emotion === "curious") {
        contextText = "带一点好奇和贴近感，停顿自然一些。";
      } else {
        contextText = "自然一点，像真人说话，不要播报腔。";
      }
      break;
  }

  if (liveStateContext) {
    contextText = contextText ? `${contextText} ${liveStateContext}` : liveStateContext;
  }

  return {
    preset,
    speechRate,
    contextText,
    emotion: volcEmotion,
    emotionScale,
  };
}

function resolveFormat(): "mp3" | "ogg_opus" | "pcm" {
  const raw = (firstEnv("volc_tts_format", "VOLC_TTS_FORMAT") || DEFAULT_VOLC_FORMAT).toLowerCase();
  if (raw === "ogg_opus" || raw === "pcm") return raw;
  return "mp3";
}

export function resolveVolcTtsConfig(
  emotion?: Emotion,
  text?: string,
  context?: TtsRequestContext,
): VolcTtsConfig | null {
  const apiKey = firstEnv("volc_tts_api_key", "VOLC_TTS_API_KEY", "tts_key");
  const runtimeOverride = getSessionTtsRuntimeOverride(context?.connId);
  const voiceType =
    runtimeOverride?.volcVoiceType ??
    firstEnv("volc_tts_voice_type", "VOLC_TTS_VOICE_TYPE", "tts_voice");
  if (!apiKey || !voiceType) return null;

  const expression = planVolcExpression(text || "", emotion, context);

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
    speechRate: expression.speechRate,
    loudnessRate: clamp(
      parseNumberEnv(firstEnv("volc_tts_loudness_rate", "VOLC_TTS_LOUDNESS_RATE"), 0),
      -50,
      100,
    ),
    uid: firstEnv("volc_tts_uid", "VOLC_TTS_UID") || DEFAULT_VOLC_UID,
    model: firstEnv("volc_tts_model", "VOLC_TTS_MODEL"),
    emotion: expression.emotion,
    emotionScale: expression.emotionScale,
    explicitLanguage: firstEnv("volc_tts_explicit_language", "VOLC_TTS_EXPLICIT_LANGUAGE"),
    contextText: expression.contextText,
    silenceDuration: clamp(
      parseNumberEnv(firstEnv("volc_tts_silence_duration", "VOLC_TTS_SILENCE_DURATION"), 0),
      0,
      30_000,
    ),
    postProcessPitch: clamp(
      parseNumberEnv(firstEnv("volc_tts_post_process_pitch", "VOLC_TTS_POST_PROCESS_PITCH"), 0),
      -12,
      12,
    ),
    useServiceCache: firstEnv("volc_tts_use_cache", "VOLC_TTS_USE_CACHE") !== "0",
    dynamicStyleEnabled: isDynamicStyleEnabled(),
    expressionPreset: expression.preset,
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
  if (config.silenceDuration > 0) {
    additions.silence_duration = config.silenceDuration;
  }
  if (config.postProcessPitch !== 0) {
    additions.post_process = { pitch: config.postProcessPitch };
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
  if (config.emotion) {
    reqParams.audio_params = {
      ...((reqParams.audio_params as Record<string, unknown>) || {}),
      emotion: config.emotion,
      ...(config.emotionScale ? { emotion_scale: config.emotionScale } : {}),
    };
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
  context?: TtsRequestContext,
): Promise<Buffer> {
  const config = resolveVolcTtsConfig(emotion, text, context);
  if (!config) {
    throw new Error(
      "TTS 未配置：请设置 VOLC_TTS_API_KEY、VOLC_TTS_RESOURCE_ID 和 VOLC_TTS_VOICE_TYPE",
    );
  }

  const connectId = randomUUID();
  const requestHeaders = {
    "Content-Type": "application/json",
    "X-Api-Key": config.apiKey,
    "X-Api-Resource-Id": config.resourceId,
    "X-Api-Connect-Id": connectId,
  };

  logger.debug("volc 表达规划", {
    connId: context?.connId,
    generationId: context?.generationId,
    usage: context?.usage ?? null,
    preset: config.expressionPreset,
    voiceType: config.voiceType,
    speechRate: config.speechRate,
    contextText: config.contextText || null,
    emotion: config.emotion || null,
    emotionScale: config.emotionScale ?? null,
    silenceDuration: config.silenceDuration,
    postProcessPitch: config.postProcessPitch,
    dynamicStyleEnabled: config.dynamicStyleEnabled,
  });

  async function requestAudio(activeConfig: VolcTtsConfig): Promise<Buffer> {
    const response = await fetch(activeConfig.baseUrl, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(buildVolcTtsRequest(text, activeConfig)),
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

    return decodeVolcUnidirectionalResponse(await response.text());
  }

  let audio: Buffer;
  try {
    audio = await requestAudio(config);
  } catch (err) {
    const canRetryWithoutAdvancedControls =
      !!config.contextText || !!config.emotion || config.emotionScale !== undefined;
    if (!canRetryWithoutAdvancedControls || signal?.aborted) {
      throw err;
    }
    logger.warn("volc 高级表达控制失败，降级重试基础参数", {
      error: (err as Error).message,
      voiceType: config.voiceType,
      hadContextText: !!config.contextText,
      hadEmotion: !!config.emotion,
    });
    audio = await requestAudio({
      ...config,
      contextText: undefined,
      emotion: undefined,
      emotionScale: undefined,
    });
  }

  logger.info("volc 合成完成", {
    bytes: audio.length,
    voiceType: config.voiceType,
    resourceId: config.resourceId,
  });
  return audio;
}
