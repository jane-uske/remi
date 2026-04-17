import { getEmotionVoiceParams, type Emotion } from "./tts_emotion";

export type TtsProvider = "openai" | "piper" | "edge" | "volc";

export type TtsTextNormalizationConfig = {
  maxChars: number;
  stripParenthetical: boolean;
  stripEmoji: boolean;
};

export type TtsCacheVariantConfig = {
  voice: string;
  lang: string;
  rate: string;
  pitch: string;
  model: string;
  piperModel: string | null;
};

function stripParentheticalStageDirections(text: string, enabled: boolean): string {
  if (!enabled) return text;
  let out = text;
  let prev = "";
  while (out !== prev) {
    prev = out;
    out = out.replace(/（[^）]*）/g, "");
    out = out.replace(/\([^)]*\)/g, "");
    out = out.replace(/\[[^\]]*\]/g, "");
    out = out.replace(/【[^】]*】/g, "");
    out = out.replace(/<[^>]*>/g, "");
    out = out.replace(/《[^》]*》/g, "");
    out = out.replace(/\{[^}]*\}/g, "");
  }
  return out;
}

function stripEmojiForTts(text: string, enabled: boolean): string {
  if (!enabled) return text;
  return text
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\uFE0F/g, "")
    .replace(/\u200D/g, "");
}

function stripDecorativeTailForTts(text: string): string {
  return text
    .replace(/\p{Mark}+/gu, "")
    .replace(/([。！？.!?~～]+)\s*[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Thaana}\p{S}\p{Mark}]+$/gu, "$1")
    .replace(/[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Thaana}\p{S}\p{Mark}]+$/gu, "")
    .trim();
}

export function normalizeTtsTextWithConfig(
  raw: string,
  config: TtsTextNormalizationConfig,
): string {
  const clean = stripDecorativeTailForTts(
    stripEmojiForTts(
      stripParentheticalStageDirections(raw, config.stripParenthetical),
      config.stripEmoji,
    ),
  )
    .replace(/\s+/g, " ")
    .trim();

  if (!clean) return "嗯。";
  if (clean.length <= config.maxChars) return clean;

  const cut = clean.slice(0, config.maxChars);
  const lastPunc = Math.max(
    cut.lastIndexOf("。"),
    cut.lastIndexOf("！"),
    cut.lastIndexOf("？"),
    cut.lastIndexOf("."),
    cut.lastIndexOf("!"),
    cut.lastIndexOf("?"),
    cut.lastIndexOf("，"),
    cut.lastIndexOf(","),
  );
  if (lastPunc >= 16) return cut.slice(0, lastPunc + 1);
  return `${cut}。`;
}

export function buildTtsCacheVariant(
  provider: TtsProvider,
  emotion: Emotion | undefined,
  config: TtsCacheVariantConfig,
): string {
  if (provider === "edge") {
    const resolved = emotion ?? "neutral";
    const rate =
      resolved === "neutral" ? config.rate : getEmotionVoiceParams(resolved).rate;
    const pitch =
      resolved === "neutral" ? config.pitch : getEmotionVoiceParams(resolved).pitch;
    return `${config.voice}\0${config.lang}\0${rate}\0${pitch}`;
  }

  if (provider === "openai") {
    const speed = getEmotionVoiceParams(emotion ?? "neutral").speed;
    return `${config.model}\0${config.voice}\0${speed}`;
  }

  if (provider === "volc") {
    return `${config.voice}\0${config.lang}\0${config.model}\0${config.rate}\0${config.pitch}`;
  }

  return config.piperModel || "piper-default";
}

export function buildTtsShortCacheKey(
  provider: TtsProvider,
  normalizedText: string,
  emotion: Emotion | undefined,
  variant: string,
): string {
  return `${provider}\0${variant}\0${emotion ?? "neutral"}\0${normalizedText}`;
}
