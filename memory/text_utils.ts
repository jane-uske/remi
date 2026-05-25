const STOP_WORDS = new Set([
  "我们",
  "你们",
  "他们",
  "这个",
  "那个",
  "现在",
  "最近",
  "刚才",
  "还是",
  "已经",
  "真的",
  "有点",
  "一下",
  "因为",
  "所以",
  "可以",
  "今天",
  "昨天",
  "晚上",
]);

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}一-鿿]+/gu, " ")
    .trim();
}

export function extractKeywords(text: string): string[] {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  const raw = normalized.split(/\s+/);
  const seen = new Set<string>();
  const keywords: string[] = [];

  for (const token of raw) {
    const trimmed = token.trim();
    if (trimmed.length < 2 || STOP_WORDS.has(trimmed)) continue;
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      keywords.push(trimmed);
    }
    if (/^[一-鿿]{4,}$/.test(trimmed)) {
      for (let size = 2; size <= 3; size++) {
        for (let i = 0; i + size <= trimmed.length; i++) {
          const slice = trimmed.slice(i, i + size);
          if (STOP_WORDS.has(slice) || seen.has(slice)) continue;
          seen.add(slice);
          keywords.push(slice);
        }
      }
    }
  }

  return keywords;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function keywordOverlapScore(
  haystack: string,
  keywords: string[],
  weight: number,
  maxScore: number,
): number {
  let score = 0;
  for (const keyword of keywords) {
    if (!keyword || keyword.length < 2) continue;
    if (haystack.includes(keyword)) {
      score += weight;
      if (score >= maxScore) return maxScore;
    }
  }
  return score;
}

export function sanitizeMemoryEvidenceText(text: string, title?: string): string {
  let value = text.trim();
  const normalizedTitle = title?.trim();
  if (normalizedTitle) {
    value = value.replace(new RegExp(`^${escapeRegExp(normalizedTitle)}[：:]\\s*`, "u"), "");
  }
  value = value.replace(/^[\p{L}\p{N}]{1,16}[：:]\s*(?=(?:上次|用户|最近|昨晚|前天|一周前|那次|这条|从))/u, "");

  value = value
    .replace(/^上次你提到「([^」]+)」，我们在继续聊([^。]+)。?$/u, "用户围绕$2提到「$1」。")
    .replace(/^上次你提到「([^」]+)」，我们顺着那个话题聊了下去。?$/u, "用户提到「$1」。")
    .replace(/^上次聊到的([^，。]+)，后来怎么样了[？?]?$/u, "$1后续")
    .replace(/^上次聊到的([^，。]+)，后来(.+)$/u, "$1这条线后来$2")
    .replace(/^上次你想推进的([^，。]+)，后来(.+)$/u, "$1这件你想推进的事后来$2")
    .replace(/^上次你说想做的那件事，后来(.+)$/u, "你想做的那件事后来$1")
    .replace(/^上次那个([^，。]+)，后来(.+)$/u, "那个$1后来$2")
    .replace(/上次你提到/u, "用户提到")
    .replace(/上次聊到的/u, "")
    .replace(/上次那个/u, "那个")
    .replace(/你之前/u, "用户曾")
    .replace(/之前你/u, "用户曾")
    .replace(/我们在继续聊/u, "相关主题是");

  return value.trim();
}
