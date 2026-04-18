import type { TurnTakingProsodyHint } from "./turn_taking";

export interface PredictorScores {
  pUserSpeech: number;
  pInterruptValid: number;
  pTurnEndSoon: number;
  pNonSpeechMedia: number;
}

export interface TurnTakingPredictorWindow {
  previewText?: string | null;
  recognizedText?: string | null;
  speechDurationMs?: number;
  utteranceMaxRms?: number;
  utteranceFrameCount?: number;
  utteranceStrongFrames?: number;
  assistantSpeaking?: boolean;
  prosody?: TurnTakingProsodyHint | null;
  stableMs?: number | null;
  semanticallyComplete?: boolean;
  sentenceClosed?: boolean;
  incompleteTail?: boolean;
  recentGrowth?: boolean;
}

export interface TurnTakingPredictor {
  score(window: TurnTakingPredictorWindow): PredictorScores;
}

export type NonSpeechRejectReason =
  | "non_speech_tag_rejected"
  | "noise_phrase_rejected"
  | "onomatopoeia_rejected"
  | "previewless_short_feedback_rejected"
  | "noise_like_short_utterance";

export interface NonSpeechRejectDecision {
  reject: boolean;
  reason: NonSpeechRejectReason | null;
  normalizedTranscript: string;
}

const NON_SPEECH_TAGS = [
  "音乐",
  "背景音乐",
  "笑声",
  "音效",
  "噪声",
  "掌声",
  "music",
  "backgroundmusic",
  "laughter",
  "soundeffect",
  "noise",
  "applause",
] as const;

const NOISE_PHRASES = [
  "谢谢观看",
  "谢谢收看",
  "点赞",
  "订阅",
  "转发",
  "打赏",
  "点赞订阅转发",
] as const;
const NOISE_PHRASE_PATTERNS = [/谢谢(?:大家)?的?(?:观看|收看)/u] as const;

const ONOMATOPOEIA_TRANSCRIPTS = [
  "咳",
  "咳咳",
  "咳咳咳",
  "噗",
  "噗噗",
  "噗哧",
  "呃",
  "呃呃",
  "啊",
  "啊啊",
  "唔",
  "唔唔",
  "哼",
  "哼哼",
  "哈",
  "哈哈",
  "呵",
  "呵呵",
  "噢",
  "哦",
] as const;

const PREVIEWLESS_SHORT_FEEDBACKS = [
  "嗯",
  "嗯嗯",
  "对",
  "对啊",
  "对呀",
  "对呢",
  "谢谢",
  "谢谢啊",
  "谢谢呀",
  "谢谢啦",
  "谢谢你",
  "谢啦",
  "好吧",
] as const;

const NON_SPEECH_TAG_SET = new Set<string>(NON_SPEECH_TAGS);
const NOISE_PHRASE_SET = new Set<string>(NOISE_PHRASES);
const ONOMATOPOEIA_SET = new Set<string>(ONOMATOPOEIA_TRANSCRIPTS);
const PREVIEWLESS_SHORT_FEEDBACK_SET = new Set<string>(PREVIEWLESS_SHORT_FEEDBACKS);
const BRACKET_TAG_RE = /^[\[(（【<＜]\s*([^()[\]（）【】<>＜＞]+?)\s*[\])）】>＞]$/u;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function compactTranscript(text: string | null | undefined): string {
  return String(text ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[，。！？!?、,.~～…:：;；"'`“”‘’\-—_]/gu, "");
}

function previewLength(text: string | null | undefined): number {
  return compactTranscript(text).length;
}

export function isBracketedNonSpeechTag(text: string | null | undefined): boolean {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return false;
  const match = trimmed.match(BRACKET_TAG_RE);
  if (!match) return false;
  return NON_SPEECH_TAG_SET.has(compactTranscript(match[1]));
}

export function isNoisePhraseTranscript(text: string | null | undefined): boolean {
  const compact = compactTranscript(text);
  if (!compact) return false;
  if (NOISE_PHRASE_SET.has(compact)) return true;
  for (const pattern of NOISE_PHRASE_PATTERNS) {
    if (pattern.test(compact)) return true;
  }
  for (const phrase of NOISE_PHRASES) {
    if (compact.includes(phrase)) return true;
  }
  return false;
}

export function isOnomatopoeiaTranscript(text: string | null | undefined): boolean {
  const compact = compactTranscript(text);
  if (!compact) return false;
  if (ONOMATOPOEIA_SET.has(compact)) return true;
  for (const phrase of ONOMATOPOEIA_TRANSCRIPTS) {
    if (compact === phrase) {
      return true;
    }
    if (
      compact.length > phrase.length &&
      compact.length % phrase.length === 0 &&
      compact === phrase.repeat(compact.length / phrase.length)
    ) {
      return true;
    }
  }
  return false;
}

export function isPreviewlessShortFeedbackTranscript(
  text: string | null | undefined,
): boolean {
  const compact = compactTranscript(text);
  if (!compact) return false;
  if (PREVIEWLESS_SHORT_FEEDBACK_SET.has(compact)) return true;
  for (const phrase of PREVIEWLESS_SHORT_FEEDBACKS) {
    if (compact === phrase) {
      return true;
    }
    if (
      compact.length > phrase.length &&
      compact.length % phrase.length === 0 &&
      compact === phrase.repeat(compact.length / phrase.length)
    ) {
      return true;
    }
  }
  return false;
}

export function classifyNonSpeechTranscript(
  text: string | null | undefined,
): NonSpeechRejectDecision {
  const normalizedTranscript = compactTranscript(text);
  if (!normalizedTranscript) {
    return {
      reject: false,
      reason: null,
      normalizedTranscript,
    };
  }
  if (isBracketedNonSpeechTag(text)) {
    return {
      reject: true,
      reason: "non_speech_tag_rejected",
      normalizedTranscript,
    };
  }
  if (isNoisePhraseTranscript(text)) {
    return {
      reject: true,
      reason: "noise_phrase_rejected",
      normalizedTranscript,
    };
  }
  if (isOnomatopoeiaTranscript(text)) {
    return {
      reject: true,
      reason: "onomatopoeia_rejected",
      normalizedTranscript,
    };
  }
  return {
    reject: false,
    reason: null,
    normalizedTranscript,
  };
}

export interface PreviewlessShortDuplexRejectInput {
  text: string | null | undefined;
  previewText?: string | null;
  userSpeechScore?: number | null;
  nonSpeechMediaScore?: number | null;
  maxChars?: number;
}

export function classifyPreviewlessShortDuplexTranscript(
  input: PreviewlessShortDuplexRejectInput,
): NonSpeechRejectDecision {
  const normalizedTranscript = compactTranscript(input.text);
  if (!normalizedTranscript) {
    return {
      reject: false,
      reason: null,
      normalizedTranscript,
    };
  }

  if (previewLength(input.previewText) > 0) {
    return {
      reject: false,
      reason: null,
      normalizedTranscript,
    };
  }

  if (isPreviewlessShortFeedbackTranscript(input.text)) {
    return {
      reject: true,
      reason: "previewless_short_feedback_rejected",
      normalizedTranscript,
    };
  }

  const maxChars = Math.max(1, Math.floor(input.maxChars ?? 4));
  const userSpeechScore = clamp01(input.userSpeechScore ?? 1);
  const nonSpeechMediaScore = clamp01(input.nonSpeechMediaScore ?? 0);
  const shortEnough = normalizedTranscript.length <= maxChars;
  const weakSemanticEvidence = userSpeechScore <= 0.42 || nonSpeechMediaScore >= 0.72;

  if (shortEnough && weakSemanticEvidence) {
    return {
      reject: true,
      reason: "noise_like_short_utterance",
      normalizedTranscript,
    };
  }

  return {
    reject: false,
    reason: null,
    normalizedTranscript,
  };
}

export class HeuristicTurnTakingPredictor implements TurnTakingPredictor {
  score(window: TurnTakingPredictorWindow): PredictorScores {
    const previewChars = previewLength(window.previewText);
    const transcriptChars = previewLength(window.recognizedText);
    const durationMs = Math.max(0, Math.floor(window.speechDurationMs ?? 0));
    const rms = Math.max(0, window.utteranceMaxRms ?? 0);
    const totalFrames = Math.max(0, Math.floor(window.utteranceFrameCount ?? 0));
    const strongFrames = Math.max(0, Math.floor(window.utteranceStrongFrames ?? 0));
    const strongRatio =
      totalFrames > 0 ? Math.max(0, Math.min(1, strongFrames / totalFrames)) : 0;
    const prosody = window.prosody?.reliable ? window.prosody : null;
    const nonSpeechDecision = classifyNonSpeechTranscript(window.recognizedText);

    let pUserSpeech = 0.12;
    if (previewChars >= 1) pUserSpeech += 0.24;
    if (previewChars >= 3) pUserSpeech += 0.18;
    if (durationMs >= 220) pUserSpeech += 0.1;
    if (durationMs >= 320) pUserSpeech += 0.08;
    if (rms >= 0.035) pUserSpeech += 0.12;
    if (rms >= 0.045) pUserSpeech += 0.08;
    if (strongRatio >= 0.08) pUserSpeech += 0.08;
    if (strongRatio >= 0.22) pUserSpeech += 0.12;
    if (prosody && prosody.voicedRatio >= 0.45) pUserSpeech += 0.08;
    if (nonSpeechDecision.reject) pUserSpeech -= 0.35;
    const userSpeech = clamp01(pUserSpeech);

    let pInterruptValid = window.assistantSpeaking ? 0.06 : 0.18;
    if (previewChars >= 3) pInterruptValid += 0.34;
    if (rms >= 0.045) pInterruptValid += 0.22;
    if (strongRatio >= 0.22) pInterruptValid += 0.24;
    if (durationMs >= 320) pInterruptValid += 0.12;
    if (
      prosody &&
      prosody.voicedRatio >= 0.45 &&
      (prosody.sustainedVoicedTail || prosody.pitchConfidence >= 0.62)
    ) {
      pInterruptValid += 0.12;
    }
    if (nonSpeechDecision.reject) pInterruptValid -= 0.4;
    const interruptValid = clamp01(pInterruptValid);

    let pTurnEndSoon = 0.12;
    const stableMs = Math.max(0, Math.floor(window.stableMs ?? 0));
    if (stableMs >= 280) pTurnEndSoon += 0.2;
    if (stableMs >= 420) pTurnEndSoon += 0.12;
    if (window.semanticallyComplete) pTurnEndSoon += 0.14;
    if (window.sentenceClosed) pTurnEndSoon += 0.12;
    if (window.incompleteTail) pTurnEndSoon -= 0.2;
    if (window.recentGrowth) pTurnEndSoon -= 0.18;
    if (
      prosody &&
      prosody.fallingTail &&
      (prosody.tailEnergyDrop ?? 0) >= 0.01 &&
      (prosody.pitchSlopeHz ?? 0) <= -10
    ) {
      pTurnEndSoon += 0.28;
    }
    if (prosody?.risingTail || prosody?.sustainedVoicedTail) {
      pTurnEndSoon -= 0.18;
    }
    const turnEndSoon = clamp01(pTurnEndSoon);

    let pNonSpeechMedia = nonSpeechDecision.reject ? 0.95 : 0.04;
    if (!nonSpeechDecision.reject && transcriptChars > 0 && transcriptChars <= 6) {
      if (previewChars === 0) pNonSpeechMedia += 0.14;
      if (rms < 0.035) pNonSpeechMedia += 0.16;
      if (strongRatio < 0.08) pNonSpeechMedia += 0.16;
    }
    if (prosody && prosody.voicedRatio < 0.32) pNonSpeechMedia += 0.08;
    if (window.assistantSpeaking && previewChars === 0) pNonSpeechMedia += 0.06;
    const nonSpeechMedia = clamp01(pNonSpeechMedia);

    return {
      pUserSpeech: userSpeech,
      pInterruptValid: interruptValid,
      pTurnEndSoon: turnEndSoon,
      pNonSpeechMedia: nonSpeechMedia,
    };
  }
}

export const heuristicTurnTakingPredictor: TurnTakingPredictor =
  new HeuristicTurnTakingPredictor();
