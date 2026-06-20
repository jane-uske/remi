const OFFICIAL_CENSORED_PATTERNS = [
  /^qwen\/qwen3\.6-35b-a3b$/i,
  /^qwen\/qwen3\.6-27b$/i,
  /^qwen3\.6-35b-a3b$/i,
];

export function isLikelyOfficialCensoredModel(model: string | undefined): boolean {
  const id = model?.trim();
  if (!id) return false;
  if (/uncensored|hauhaucs|abliterated|uncensor/i.test(id)) return false;
  return OFFICIAL_CENSORED_PATTERNS.some((re) => re.test(id));
}

export function warnLlmModelChoice(model: string | undefined, fastBrainModel?: string): void {
  if (fastBrainModel?.trim() && fastBrainModel.trim() !== model?.trim()) {
    console.warn(
      `[remi:config] REMI_FAST_BRAIN_MODEL is deprecated and ignored; all paths use REMI_LLM_MODEL=${model ?? "(unset)"}`,
    );
  }
  if (isLikelyOfficialCensoredModel(model)) {
    console.warn(
      `[remi:config] REMI_LLM_MODEL looks like an official censored checkpoint (${model}). ` +
        "For local HauhauCS stack use e.g. qwen3.6-35b-a3b-uncensored-hauhaucs-aggressive " +
        "(run: node scripts/pick_lmstudio_model.mjs).",
    );
  }
}