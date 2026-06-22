import { getEmotionVoiceParams, type Emotion } from "./tts_emotion";

export type TtsProvider = "openai" | "piper" | "edge" | "volc" | "mlx";

export type TtsTextNormalizationConfig = {
  maxChars: number;
  stripParenthetical: boolean;
  stripEmoji: boolean;
  /** Map ellipsis/tildes to speakable punctuation; does not remove words. */
  speakablePunct?: boolean;
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

const MOAN_CHAR_RE = /[嗯啊哈嘶呜噢哦呀]/;
const MOAN_SYLLABLE_COMMA_RE = /([嗯啊哈嘶呜噢哦呀])[，,](?=[嗯啊哈嘶呜噢哦呀])/g;
const ROLE_PREFIX_RE = /^(?:Remi|remi)\s*[,，:：]\s*/i;
const ROLE_LABEL_SPLIT_RE = /(?:Remi|remi)\s*[:：]\s*/i;
/** Characters considered non-speakable punctuation/whitespace for TTS guard. */
const PUNCT_ONLY_RE = /[，,。！？!?、；;：:\s~～…\-.—–\n*_#]/g;

/** Return null if the text contains no speakable content after stripping punctuation. */
function guardPunctOnly(text: string | null | undefined): string | null {
  if (!text) return null;
  return text.replace(PUNCT_ONLY_RE, "").length > 0 ? text : null;
}

/**
 * MLX/Qwen3-TTS often emits long silence after ellipsis-heavy tokens.
 * Only rewrites decorative punctuation — semantic words (including NSFW) stay intact.
 */
export function normalizeSpeakablePunctuation(text: string): string {
  return text
    .replace(/\.{2,}/g, "，")
    .replace(/……+/g, "，")
    .replace(/…+/g, "，")
    .replace(/[～~]+/g, "")
    .replace(/-{3,}/g, "")         // markdown HR "---" or longer → strip
    .replace(/-{2}/g, "，")         // "--" (informal em-dash) → comma
    .replace(/[—–]+/g, "，")        // em-dash U+2014 / en-dash U+2013 → comma
    .replace(/\s*，\s*/g, "，")     // collapse spaces around Chinese commas
    .replace(/，{2,}/g, "，")
    .replace(/,{2,}/g, ",")
    .replace(/\s{2,}/g, " ")       // collapse multiple spaces
    .replace(/^[，,\s]+|[，,\s]+$/g, "") // strip leading/trailing commas & space
    .trim();
}

/**
 * Fold moaning interjection commas in pairs — not all at once.
 *
 * `嗯，啊，哈，嘶，不行了` → `嗯啊，哈嘶，不行了`
 *
 * Previous behavior folded everything into `嗯啊哈嘶，不行了`, which made MLX
 * TTS try to sustain one impossibly long vocalization. Keeping a comma every
 * two syllables gives a natural panting rhythm (inhale–exhale pairs).
 */
export function foldMoaningInterjections(text: string): string {
  const MOAN = /^[嗯啊哈嘶呜噢哦呀]$/;
  const COMMA = /^[，,]$/;
  const parts = text.split(/([，,])/);
  // parts is alternating [segment, comma, segment, comma, ...]
  const out: string[] = [];
  let runChars: string[] = []; // moan characters in current run

  function flushRun() {
    if (runChars.length === 0) return;
    // Group in pairs: ["嗯","啊","哈","嘶"] → "嗯啊，哈嘶"
    const pairs: string[] = [];
    for (let i = 0; i < runChars.length; i += 2) {
      if (i + 1 < runChars.length) {
        pairs.push(runChars[i] + runChars[i + 1]);
      } else {
        pairs.push(runChars[i]);
      }
    }
    out.push(pairs.join("，"));
    runChars = [];
  }

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    if (COMMA.test(part)) {
      // Check if this comma is between two single-moan-char segments
      const prev = parts[i - 1] || "";
      const next = parts[i + 1] || "";
      if (MOAN.test(prev) && MOAN.test(next)) {
        // Part of a moan run — the prev was already added to runChars
        continue;
      }
      // Not a moan-to-moan comma — flush any pending run, then emit comma
      flushRun();
      out.push(part);
    } else if (MOAN.test(part)) {
      // Check if next is a comma followed by another moan char
      const nextComma = parts[i + 1] || "";
      const nextPart = parts[i + 2] || "";
      if (COMMA.test(nextComma) && MOAN.test(nextPart)) {
        // Start or continue a moan run
        runChars.push(part);
      } else if (runChars.length > 0) {
        // End of a moan run
        runChars.push(part);
        flushRun();
      } else {
        // Standalone moan char not in a run
        out.push(part);
      }
    } else {
      flushRun();
      out.push(part);
    }
  }
  flushRun();
  return out.join("");
}

export function stripRolePrefixForTts(text: string): string {
  return text.replace(ROLE_PREFIX_RE, "").trim();
}

export function isMoaningDenseText(text: string): boolean {
  const stripped = text.replace(/[，,。！？!?：:\s~～…\\.]/g, "");
  if (stripped.length < 6) return false;
  const moanCount = (stripped.match(/[嗯啊哈嘶呜噢哦呀]/g) || []).length;
  return moanCount >= 4 && moanCount / stripped.length >= 0.25;
}

function isMoanClause(seg: string): boolean {
  const stripped = seg.replace(/[，,。！？!?：:\s~～…\\.]/g, "");
  if (!stripped) return false;
  const moanCount = (stripped.match(/[嗯啊哈嘶呜噢哦呀]/g) || []).length;
  return moanCount >= 2 && moanCount / stripped.length >= 0.4;
}

/** In-character action / direct speech — keep for NSFW vocal TTS. */
function isNsfwActionSpeechClause(seg: string): boolean {
  const t = seg.trim();
  if (!t || t.length > 24) return false;
  if (isMoanClause(t)) return true;
  if (MOAN_CHAR_RE.test(t) && t.length <= 4) return true;
  return /(?:舔|含|吞|吸|吮|咬|蹭|夹|绞|好深|顶到|喉咙|不行了|要去了|给你)/u.test(t);
}

/**
 * Literary scene description in a mixed moan line. MLX vocalizes interjections
 * but leaves these clauses near-silent, which sounds like TTS "skipping" ahead.
 *
 * Only drop clauses that carry an explicit purple-prose marker or are an overt
 * third-person stage direction. Plain first-person speech ("我腿软得站不住了",
 * "全靠你那只手掐着腰") is the in-character performance the user wants to hear —
 * the old `length >= 10 && no-moan-char` heuristic wrongly deleted those and made
 * playback sound like it skipped whole clauses.
 */
function isNsfwDescriptiveNarrationClause(seg: string): boolean {
  const t = seg.trim();
  if (!t || isMoanClause(t) || isNsfwActionSpeechClause(t)) return false;
  if (/(?:津液|嘴角|流下来|发酸|舍不得|顺着|甘甜|被.+撑)/u.test(t)) return true;
  // Overt third-person stage direction (她/他 narrating) — not a spoken line.
  if (/[她他](?:正在|会|的|正|被|地|逐渐|慢慢)/u.test(t)) return true;
  return false;
}

/** Drop undeliverable description from mixed moan + narration NSFW lines. */
export function filterMixedNsfwVocalForTts(text: string): string | null {
  const parts = text
    .split(/[，,、]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  const kept = parts.filter((p) => !isNsfwDescriptiveNarrationClause(p));
  if (kept.length === 0) return null;
  return kept.join("，");
}

/** Third-person scene description / inner monologue — not for TTS in NSFW vocal turns. */
export function isNsfwNarrationSegment(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (isMoaningDenseText(t)) return false;
  if (/[她他](?:正在|会|的|正)/u.test(t)) return true;
  if (/被挑逗|内心独白|身体回应|快感|逐渐变得/u.test(t)) return true;
  if (/^Remi[,，]/i.test(t)) return true;
  return false;
}

/** Pull moaning performance out of mixed narration + `Remi:` blocks. */
export function extractNsfwVocalLine(text: string): string | null {
  let t = text.trim();
  if (!t) return null;

  const roleParts = t.split(ROLE_LABEL_SPLIT_RE);
  if (roleParts.length > 1) {
    t = roleParts[roleParts.length - 1].trim();
  }
  t = stripRolePrefixForTts(t);

  const moanStart = t.search(MOAN_CHAR_RE);
  if (moanStart > 0) {
    const prefix = t.slice(0, moanStart).trim();
    if (!isMoaningDenseText(prefix)) {
      t = t.slice(moanStart).trim();
    }
  }

  t = stripRolePrefixForTts(t);
  if (!t || !isMoaningDenseText(t)) return null;
  return t;
}

export function prepareNsfwVocalForTts(
  text: string,
  speakablePunct = false,
): string {
  let t = text.trim();
  if (speakablePunct) {
    t = normalizeSpeakablePunctuation(t);
    t = foldMoaningInterjections(t);
  }
  return t;
}

/**
 * Resolve text for the TTS queue. In NSFW mode, skip narration and keep only vocal lines.
 * Returns null when the segment should not be synthesized.
 */
export function resolveTtsQueueText(
  text: string,
  options?: { nsfw?: boolean; speakablePunct?: boolean },
): string | null {
  let trimmed = stripImageMarkdownForTts(text).trim();
  if (!trimmed) return null;

  if (!options?.nsfw) return guardPunctOnly(trimmed);

  // Strip parenthetical stage directions before any other processing —
  // e.g. （双腿发软地跪在地板上，膝盖磨出红印）are visual narration, not speech.
  trimmed = stripParentheticalStageDirections(trimmed, true).trim();
  if (!trimmed) return null;

  const vocal = extractNsfwVocalLine(trimmed);
  if (vocal) {
    const prepared = prepareNsfwVocalForTts(vocal, options.speakablePunct);
    return guardPunctOnly(prepared);
  }
  if (isNsfwNarrationSegment(trimmed)) return null;

  let working = trimmed;
  if (MOAN_CHAR_RE.test(working)) {
    const filtered = filterMixedNsfwVocalForTts(working);
    if (filtered) working = filtered;
  }

  const prepared = prepareNsfwVocalForTts(working, options.speakablePunct);
  return guardPunctOnly(prepared);
}

/**
 * Like normalizeSpeakablePunctuation but preserves \n characters so the
 * SentenceChunker can split on paragraph boundaries.
 */
function normalizeSpeakablePunctForChunking(text: string): string {
  return text
    .replace(/\.{2,}/g, "，")
    .replace(/……+/g, "，")
    .replace(/…+/g, "，")
    .replace(/[～~]+/g, "")
    .replace(/-{3,}/g, "")         // markdown HR "---" or longer → strip
    .replace(/-{2}/g, "，")         // "--" (informal em-dash) → comma
    .replace(/[—–]+/g, "，")        // em-dash U+2014 / en-dash U+2013 → comma
    .replace(/\s*，\s*/g, "，")     // collapse spaces around Chinese commas
    .replace(/，{2,}/g, "，")
    .replace(/,{2,}/g, ",")
    .replace(/\s{2,}/g, " ")       // collapse multiple spaces
    .replace(/[，,]+$/g, "");       // strip trailing commas (no leading — chunker accumulates)
  // No .trim() — keep \n for chunker hard boundary detection.
}

/** Strip pasted chat history noise from user messages (Remi / Remi: replay blocks). */
export function sanitizePastedChatContent(content: string): string {
  let t = content.trim();
  if (!t) return t;

  t = t.replace(/\bRemi\s*\n+\s*Remi\s*[:：]\s*/gi, "");
  t = t.replace(/\bRemi\s*[:：]\s*/gi, "");

  const replayIdx = t.search(
    /嗯[\.…，,]*啊[\.…，,]*哈|啊[\.…，,]*啊[\.…，,]*啊|要高潮了|娇喘|呻吟/u,
  );
  if (replayIdx > 0 && /演出来|播放|念念|读一下|再来一遍|照着/u.test(t.slice(0, replayIdx))) {
    t = t.slice(0, replayIdx).trim();
  }

  return t.trim();
}

/** Normalize streaming tokens before SentenceChunker (ellipsis must not become hard `.` cuts). */
export function prepareTextForTtsChunking(
  text: string,
  speakablePunct = false,
): string {
  if (!speakablePunct || !text) return text;
  // Apply speakable-punct transforms but preserve \n — the chunker uses
  // \n as a hard sentence boundary (SENTENCE_END = /[。！？!?\n]/).
  // normalizeSpeakablePunctuation() .trim()s the result, which strips
  // newline-only tokens and merges paragraphs into one giant segment.
  return normalizeSpeakablePunctForChunking(text);
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
  const rawHadVisibleContent = raw.trim().length > 0;
  let working = stripEmojiForTts(
    stripParentheticalStageDirections(raw, config.stripParenthetical),
    config.stripEmoji,
  );
  if (config.speakablePunct) {
    working = normalizeSpeakablePunctuation(working);
    working = foldMoaningInterjections(working);
  }
  const nsfwVocal = extractNsfwVocalLine(working);
  if (nsfwVocal) {
    working = nsfwVocal;
  } else {
    working = stripRolePrefixForTts(working);
  }
  const clean = stripDecorativeTailForTts(working)
    .replace(/\s+/g, " ")
    .trim();

  if (!clean) return rawHadVisibleContent ? "" : "嗯。";
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

const IMAGE_MARKDOWN_RE = /!\[[^\]]*\]\([^)]+\)/;

/** Markdown image embed present — TTS should skip the turn (do not read URLs aloud). */
export function containsImageMarkdown(text: string): boolean {
  return IMAGE_MARKDOWN_RE.test(text);
}

/** Remove markdown image tags before sentence chunking / TTS. */
export function stripImageMarkdownForTts(text: string): string {
  return text.replace(IMAGE_MARKDOWN_RE, "").trim();
}

export function buildTtsShortCacheKey(
  provider: TtsProvider,
  normalizedText: string,
  emotion: Emotion | undefined,
  variant: string,
): string {
  return `${provider}\0${variant}\0${emotion ?? "neutral"}\0${normalizedText}`;
}
