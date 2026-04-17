import type { DbEpisode } from "../storage/repositories/episode_repository";
import { normalizeText } from "./prompt_memory_support";

export type EpisodeHygieneLanguage = "zh";

export type EpisodeHygieneReasonId =
  | "zh_meta_prompt"
  | "zh_dev_probe"
  | "zh_low_value_filler";

export interface EpisodeHygieneReason {
  id: EpisodeHygieneReasonId;
  summary: string;
  evidence: string[];
}

export interface EpisodeHygieneJudgment {
  shouldArchive: boolean;
  reasons: EpisodeHygieneReason[];
}

interface EpisodeHygieneLanguagePack {
  language: EpisodeHygieneLanguage;
  metaPromptPhrases: string[];
  technicalCuePatterns: RegExp[];
  probeCuePatterns: RegExp[];
  strongProbePatterns: RegExp[];
  fillerPatterns: RegExp[];
}

const ZH_RULE_PACK: EpisodeHygieneLanguagePack = {
  language: "zh",
  metaPromptPhrases: [
    "请只回复一句",
    "不要解释",
    "不要反问",
    "语气",
    "自然一点",
    "像靠在我耳边",
    "你会怎么拿捏语气",
  ],
  technicalCuePatterns: [
    /\[storage\]/i,
    /\bredis\b/i,
    /\btts\b/i,
    /\bios\b/i,
    /dev key/i,
    /网页测试/u,
    /火山/u,
  ],
  probeCuePatterns: [
    /\btest\b/i,
    /\bsmoke\b/i,
    /\bping\b/i,
    /测试/u,
    /probe/i,
    /idle send/i,
    /现在是(?:上午|下午|凌晨|晚上|中午)?\d+点\d+分/u,
  ],
  strongProbePatterns: [
    /^idle send test$/i,
    /^现在是(?:上午|下午|凌晨|晚上|中午)?\d+点\d+分[。！!]?$/u,
  ],
  fillerPatterns: [
    /^1+$/u,
    /^哈+$/u,
    /^哈哈+$/u,
    /^h+a+h+a+h*$/i,
    /^你好[啊呀呀~！!。]*$/u,
    /^哈喽[\p{L}\p{N}\u4e00-\u9fff]*$/u,
    /^[\p{S}\p{P}\s~♥♡❤💗💖💘💞💓💝💟😳😍😘🥺💕]+$/u,
  ],
};

const LANGUAGE_PACKS: Record<EpisodeHygieneLanguage, EpisodeHygieneLanguagePack> = {
  zh: ZH_RULE_PACK,
};

function getLanguagePack(language: EpisodeHygieneLanguage): EpisodeHygieneLanguagePack {
  return LANGUAGE_PACKS[language];
}

function clip(text: string, maxLength: number = 80): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1)}…`;
}

function extractQuotedFragments(text: string): string[] {
  const matches = [...text.matchAll(/[「“"]([^」”"]+)[」”"]/gu)];
  if (matches.length === 0) {
    return [text];
  }
  return matches
    .map((match) => match[1]?.trim() ?? "")
    .filter(Boolean);
}

function getEpisodeUserFragments(episode: Pick<DbEpisode, "summary" | "origin_moment_summaries">): string[] {
  const rawTexts = [
    episode.summary,
    ...(episode.origin_moment_summaries ?? []),
  ].filter(Boolean);
  const fragments = rawTexts.flatMap((text) => extractQuotedFragments(text));
  return [...new Set(fragments.map((fragment) => fragment.trim()).filter(Boolean))];
}

function countPhraseHits(text: string, phrases: string[]): string[] {
  return phrases.filter((phrase) => text.includes(phrase));
}

function buildMetaPromptReason(
  episode: Pick<DbEpisode, "summary" | "origin_moment_summaries" | "recurrence_count">,
  pack: EpisodeHygieneLanguagePack,
): EpisodeHygieneReason | null {
  const fragments = getEpisodeUserFragments(episode);
  const matchedEvidence = fragments.flatMap((fragment) => {
    const hits = countPhraseHits(fragment, pack.metaPromptPhrases);
    const hasStrongDirective =
      fragment.includes("请只回复一句") ||
      (fragment.includes("不要解释") && fragment.includes("不要反问"));
    if (!hasStrongDirective && hits.length < 2) {
      return [];
    }
    return [`${clip(fragment)} | directives=${hits.join(",") || "strong_directive"}`];
  });

  if (matchedEvidence.length === 0) {
    return null;
  }

  return {
    id: "zh_meta_prompt",
    summary: "episode 主要由中文语气/回复格式控制 prompt 派生，不应进入长期关系记忆",
    evidence: matchedEvidence.slice(0, 3),
  };
}

function buildDevProbeReason(
  episode: Pick<DbEpisode, "summary" | "origin_moment_summaries" | "recurrence_count" | "relationship_weight">,
  pack: EpisodeHygieneLanguagePack,
): EpisodeHygieneReason | null {
  const fragments = getEpisodeUserFragments(episode);
  const matchedEvidence = fragments.flatMap((fragment) => {
    const hasTechnicalCue = pack.technicalCuePatterns.some((pattern) => pattern.test(fragment));
    const hasProbeCue = pack.probeCuePatterns.some((pattern) => pattern.test(fragment));
    const hasStrongProbeCue = pack.strongProbePatterns.some((pattern) => pattern.test(fragment.trim()));
    const isStructuredLog = /\[[^\]]+\]/u.test(fragment);
    if (
      !isStructuredLog &&
      !hasStrongProbeCue &&
      !(hasTechnicalCue && hasProbeCue) &&
      !(hasTechnicalCue && episode.recurrence_count <= 2)
    ) {
      return [];
    }
    return [clip(fragment)];
  });

  if (matchedEvidence.length === 0) {
    return null;
  }

  return {
    id: "zh_dev_probe",
    summary: "episode 更像中文环境下的开发测试/系统探针/日志片段，应从 recall 排除",
    evidence: matchedEvidence.slice(0, 3),
  };
}

function looksLikeFiller(fragment: string, pack: EpisodeHygieneLanguagePack): boolean {
  const normalized = normalizeText(fragment);
  if (!normalized) return true;
  return pack.fillerPatterns.some((pattern) => pattern.test(fragment.trim()));
}

function buildLowValueFillerReason(
  episode: Pick<DbEpisode, "summary" | "origin_moment_summaries" | "recurrence_count" | "relationship_weight">,
  pack: EpisodeHygieneLanguagePack,
): EpisodeHygieneReason | null {
  if (episode.recurrence_count > 2 || episode.relationship_weight > 0.5) {
    return null;
  }

  const fragments = getEpisodeUserFragments(episode);
  if (fragments.length === 0) {
    return null;
  }

  if (!fragments.every((fragment) => looksLikeFiller(fragment, pack))) {
    return null;
  }

  return {
    id: "zh_low_value_filler",
    summary: "episode 只来自中文低价值寒暄/填充/表情文本，不适合长期 recall",
    evidence: fragments.slice(0, 3).map((fragment) => clip(fragment)),
  };
}

export function listEpisodeHygieneLanguages(): EpisodeHygieneLanguage[] {
  return Object.keys(LANGUAGE_PACKS) as EpisodeHygieneLanguage[];
}

export function classifyEpisodeForHygiene(
  episode: Pick<
    DbEpisode,
    "id" | "title" | "summary" | "topics" | "recurrence_count" | "relationship_weight" | "origin_moment_summaries"
  >,
  language: EpisodeHygieneLanguage = "zh",
): EpisodeHygieneJudgment {
  const pack = getLanguagePack(language);
  const reasons = [
    buildMetaPromptReason(episode, pack),
    buildDevProbeReason(episode, pack),
    buildLowValueFillerReason(episode, pack),
  ].filter(Boolean) as EpisodeHygieneReason[];

  return {
    shouldArchive: reasons.length > 0,
    reasons,
  };
}
