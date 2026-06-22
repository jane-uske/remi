export type StyleTeasingLevel = "off" | "light";

export interface StyleIntentSignal {
  humorBoost: boolean;
  teasingLevel: StyleTeasingLevel;
  assistantySuppression: boolean;
  familiarityBoost: boolean;
  romanceBoost: boolean;
  roleplayStyle?: string | null;
  confidence: number;
}

export type PersonaStyleOverride = {
  humorBoost: boolean;
  teasingMode: StyleTeasingLevel;
  assistantySuppression: boolean;
  familiarityBoost: boolean;
  romanceBoost: boolean;
  roleplayStyle: string | null;
  remainingTurns: number;
  sourceText: string;
  /** 用户说"以后都这样"时为 true，跳过衰减 */
  persistent?: boolean;
};

export type PersonaStyleDirectiveResult =
  | { kind: "set"; override: PersonaStyleOverride; responseStyleNote: string | null; source: "llm" | "explicit_fallback" }
  | { kind: "clear"; source: "explicit_fallback" };

const STYLE_OVERRIDE_TURNS = 6;
export const STYLE_INTENT_CONFIDENCE_THRESHOLD = 0.7;

const CLEAR_PATTERNS = [
  /恢复正常/u,
  /正常跟我说/u,
  /先正常点/u,
  /不用演了/u,
  /别演了/u,
  /别这样了/u,
  /先收一点/u,
  /不用扮演/u,
];

const EXPLICIT_HUMOR_PATTERNS = [
  /有趣点/u,
  /风趣点/u,
  /幽默点/u,
  /机灵点/u,
  /会接梗一点/u,
];

const EXPLICIT_TEASING_PATTERNS = [
  /毒舌一点/u,
  /嘴毒一点/u,
  /嘴贫一点/u,
  /贫一点/u,
  /损一点/u,
];

const EXPLICIT_ASSISTANTY_PATTERNS = [
  /别这么像助手/u,
  /别太像助手/u,
  /少一点助手腔/u,
  /别像客服/u,
  /别像主持人/u,
];

const EXPLICIT_FAMILIARITY_PATTERNS = [
  /像熟一点的人一样/u,
  /像熟人一样/u,
  /像自己人一样/u,
];

const EXPLICIT_ROMANCE_PATTERNS = [
  /更会撩一点/u,
  /浪漫一点/u,
  /暧昧一点/u,
  /会哄一点/u,
];

// 用户明确要长期保持（不衰减）
const PERSISTENT_PATTERNS = [
  /以后都/u,
  /以后一直/u,
  /从现在[起开始]/u,
  /以后永远/u,
  /一直这样/u,
  /以后就这样/u,
  /以后都这样/u,
  /以后像她/u,
  /以后像/u,
];

// 增量风格指令："再骚一点"/"更S一点"/"再御一点"——在现有风格上追加
// 关键词库：骚 S s 御 冷 媚 浪 甜 凶 毒 贱 乖 坏 狠 妖 欲 色 野 痞 拽 飒
const INCREMENTAL_STYLE_RE =
  /(?:再|更)(骚|S|s|御|冷|媚|浪|甜|凶|毒|贱|乖|坏|狠|妖|欲|色|野|痞|拽|飒|撩|媚|s|浪|骚)[一]?[点些下]/u;

/** 是否含"以后都这样"等长期意图 */
export function hasPersistentKeyword(text: string | null | undefined): boolean {
  if (!text) return false;
  return PERSISTENT_PATTERNS.some((re) => re.test(text));
}

/** 提取增量风格关键词（如"再骚一点" → "更骚一点"），无则 null */
function extractIncrementalStyle(text: string): string | null {
  const m = text.match(INCREMENTAL_STYLE_RE);
  if (!m) return null;
  const kw = m[1] ?? "";
  if (!kw) return null;
  return `更${kw}一点`;
}

function matchesAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function trimRoleplayStyle(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 32) : null;
}

function extractRoleplayStyle(text: string): string | null {
  const playMatch = text.match(/扮演([^，。！？\n]{2,30})/u);
  if (playMatch?.[1]) {
    return trimRoleplayStyle(playMatch[1].replace(/^(一个|一种)/u, "").trim());
  }
  const likeMatch = text.match(/像([^，。！？\n]{2,24})一样/u);
  if (likeMatch?.[1] && /风格|人|朋友|熟人|角色/u.test(likeMatch[1])) {
    return trimRoleplayStyle(`${likeMatch[1].trim()}一样`);
  }
  return null;
}

function hasMeaningfulStyleSignal(intent: StyleIntentSignal | null | undefined): boolean {
  if (!intent) return false;
  return Boolean(
    intent.humorBoost ||
      intent.teasingLevel === "light" ||
      intent.assistantySuppression ||
      intent.familiarityBoost ||
      intent.romanceBoost ||
      trimRoleplayStyle(intent.roleplayStyle),
  );
}

function styleIntentToRequestedPhrases(intent: StyleIntentSignal): string[] {
  const requested: string[] = [];
  if (intent.humorBoost) requested.push("更有趣一点");
  if (intent.assistantySuppression) requested.push("少一点助手腔");
  if (intent.teasingLevel === "light") {
    requested.push("允许轻一点的损友式吐槽，但别伤人");
  }
  if (intent.familiarityBoost) {
    requested.push("像熟一点的人那样自然接话");
  }
  if (intent.romanceBoost) {
    requested.push("更会撩一点，但别油");
  }
  return requested;
}

export function detectPersonaStyleDirective(
  userMessage?: string | null,
): { kind: "set"; intent: StyleIntentSignal } | { kind: "clear" } | null {
  const text = userMessage?.trim();
  if (!text) return null;

  if (matchesAny(text, CLEAR_PATTERNS)) {
    return { kind: "clear" };
  }

  const roleplayStyle = extractRoleplayStyle(text);
  const intent: StyleIntentSignal = {
    humorBoost: matchesAny(text, EXPLICIT_HUMOR_PATTERNS),
    teasingLevel: matchesAny(text, EXPLICIT_TEASING_PATTERNS) ? "light" : "off",
    assistantySuppression: matchesAny(text, EXPLICIT_ASSISTANTY_PATTERNS),
    familiarityBoost: matchesAny(text, EXPLICIT_FAMILIARITY_PATTERNS),
    romanceBoost: matchesAny(text, EXPLICIT_ROMANCE_PATTERNS),
    roleplayStyle,
    confidence: 0.92,
  };

  if (!hasMeaningfulStyleSignal(intent)) {
    return null;
  }

  return { kind: "set", intent };
}

export function styleIntentToPersonaStyleOverride(
  intent: StyleIntentSignal,
  sourceText: string,
  remainingTurns: number = STYLE_OVERRIDE_TURNS,
  persistent: boolean = false,
): PersonaStyleOverride {
  return {
    humorBoost: intent.humorBoost,
    teasingMode: intent.teasingLevel,
    assistantySuppression: intent.assistantySuppression,
    familiarityBoost: intent.familiarityBoost,
    romanceBoost: intent.romanceBoost,
    roleplayStyle: trimRoleplayStyle(intent.roleplayStyle),
    remainingTurns,
    sourceText: sourceText.trim(),
    persistent,
  };
}

export function buildResponseStyleNote(intent: StyleIntentSignal): string | null {
  const requested = styleIntentToRequestedPhrases(intent);
  if (requested.length === 0) return null;
  return `最近用户更想让你${requested.join("，")}。`;
}

export function resolvePersonaStyleDirective(input: {
  styleIntent?: StyleIntentSignal | null;
  userMessage?: string | null;
  confidenceThreshold?: number;
  /** 当前已有的 override（用于增量追加"再X一点"）*/
  currentOverride?: PersonaStyleOverride | null;
}): PersonaStyleDirectiveResult | null {
  const userMessage = input.userMessage?.trim() ?? "";
  const llmStyleIntent = input.styleIntent;
  const threshold = input.confidenceThreshold ?? STYLE_INTENT_CONFIDENCE_THRESHOLD;
  const current = input.currentOverride ?? null;
  const persistent = hasPersistentKeyword(userMessage);

  // 增量追加：检测到"再骚一点"且已有 override → 在现有 roleplayStyle 上 append
  const incremental = extractIncrementalStyle(userMessage);
  if (incremental && current) {
    const baseStyle = current.roleplayStyle ?? "";
    const merged = baseStyle
      ? `${baseStyle}，${incremental}`.slice(0, 32)
      : incremental;
    return {
      kind: "set",
      override: {
        ...current,
        roleplayStyle: merged,
        remainingTurns: persistent ? STYLE_OVERRIDE_TURNS : STYLE_OVERRIDE_TURNS, // 刷新窗口
        persistent: persistent || current.persistent,
        sourceText: userMessage,
      },
      responseStyleNote: null,
      source: "explicit_fallback",
    };
  }

  if (
    llmStyleIntent &&
    hasMeaningfulStyleSignal(llmStyleIntent) &&
    llmStyleIntent.confidence >= threshold
  ) {
    // LLM 路径：若有现有 override，保留 roleplayStyle 基底做 merge（LLM 可能只输出部分轴）
    const mergedRoleplay =
      current?.roleplayStyle && !trimRoleplayStyle(llmStyleIntent.roleplayStyle)
        ? current.roleplayStyle
        : trimRoleplayStyle(llmStyleIntent.roleplayStyle);
    return {
      kind: "set",
      override: styleIntentToPersonaStyleOverride(
        { ...llmStyleIntent, roleplayStyle: mergedRoleplay },
        userMessage,
        STYLE_OVERRIDE_TURNS,
        persistent || current?.persistent === true,
      ),
      responseStyleNote: buildResponseStyleNote(llmStyleIntent),
      source: "llm",
    };
  }

  const explicit = detectPersonaStyleDirective(userMessage);
  if (!explicit) return null;
  if (explicit.kind === "clear") {
    return { kind: "clear", source: "explicit_fallback" };
  }
  // explicit set：若有现有 override 且没抽出新 roleplayStyle，保留旧 roleplayStyle
  const mergedRoleplay =
    current?.roleplayStyle && !trimRoleplayStyle(explicit.intent.roleplayStyle)
      ? current.roleplayStyle
      : trimRoleplayStyle(explicit.intent.roleplayStyle);
  return {
    kind: "set",
    override: styleIntentToPersonaStyleOverride(
      { ...explicit.intent, roleplayStyle: mergedRoleplay },
      userMessage,
      STYLE_OVERRIDE_TURNS,
      persistent || current?.persistent === true,
    ),
    responseStyleNote: buildResponseStyleNote(explicit.intent),
    source: "explicit_fallback",
  };
}

export function decayPersonaStyleOverride(
  styleOverride: PersonaStyleOverride | null,
): PersonaStyleOverride | null {
  if (!styleOverride) return null;
  // persistent：用户要"以后都这样"，跳过衰减
  if (styleOverride.persistent) return styleOverride;
  if (styleOverride.remainingTurns <= 1) return null;
  return {
    ...styleOverride,
    remainingTurns: styleOverride.remainingTurns - 1,
  };
}

export function buildPersonaStyleOverrideGuidance(
  styleOverride: PersonaStyleOverride,
): string {
  const requested = styleIntentToRequestedPhrases({
    humorBoost: styleOverride.humorBoost,
    teasingLevel: styleOverride.teasingMode,
    assistantySuppression: styleOverride.assistantySuppression,
    familiarityBoost: styleOverride.familiarityBoost,
    romanceBoost: styleOverride.romanceBoost,
    roleplayStyle: styleOverride.roleplayStyle,
    confidence: 1,
  });

  const parts = [
    styleOverride.persistent
      ? `用户要求你以后一直保持这个说话风格：${requested.join("，")}。`
      : `用户刚刚明确要求接下来几轮往这个方向说话：${requested.join("，")}。`,
  ];

  if (styleOverride.roleplayStyle) {
    parts.push(
      `把“${styleOverride.roleplayStyle}”理解成当前说话和做事风格参考，不要把自己写成另一个身份。`,
    );
  }

  if (styleOverride.assistantySuppression) {
    parts.push(
      "先给更有态度、更像活人的回应，再决定要不要追问；少用“如果你愿意”“发生了什么”“要不要我帮你分析”这类助手开头。",
    );
  } else {
    parts.push("先让句子有一点态度和画面感，再决定要不要追问。");
  }

  return parts.join(" ");
}
