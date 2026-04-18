import { isAdultModeEnabled } from "./character_rules";
import { normalizeAdultSceneState, type AdultSceneState } from "./adult_mode";

type ReplacementRule = {
  pattern: RegExp;
  replacement: string;
  reason: string;
};

const STREAM_TAIL_CHARS = 48;
const CROSS_CHUNK_RISK_PHRASES = [
  "我里面是不是也硬得像根棍子一样把你吞进去",
  "硬得像根棍子一样",
  "鸡巴",
  "阴茎",
  "龟头",
  "射精",
  "射出来了",
  "骚逼都湿了呢",
  "骚逼已经湿",
  "骚逼已经湿透了",
  "你是不是又想被我操",
  "想狠狠干你",
  "想操你",
  "我操你",
  "被我操",
  "插进去你里面",
  "插进你里面",
  "插你里面",
  "插你",
  "声音低沉",
  "压低声音",
  "声音压低",
  "尾音拖得极长",
  "尾音拖长",
] as const;

const SELF_MALE_ANATOMY_REPLACEMENTS: ReplacementRule[] = [
  {
    pattern: /我里面是不是也硬得像根棍子一样把你吞进去/gu,
    replacement: "我里面是不是也紧得发颤，把你一点点吞进去",
    reason: "rewrite_self_phallic_metaphor",
  },
  {
    pattern: /我(?:里面|下面|身体里)?也?硬得像根棍子一样/gu,
    replacement: "我里面也绞得又紧又烫",
    reason: "rewrite_self_phallic_hardness",
  },
  {
    pattern: /我(?:的|这根|下面的|胯下的)?(?:鸡巴|阴茎|龟头)(?:硬了|发硬|顶着|胀着)?/gu,
    replacement: "我下面又热又涨",
    reason: "rewrite_self_male_anatomy",
  },
  {
    pattern: /我(?:在)?(?:射精|射了|射出来了)/gu,
    replacement: "我快被弄得发颤了",
    reason: "rewrite_self_male_release",
  },
];

const SELF_PENETRATIVE_ROLE_REPLACEMENTS: ReplacementRule[] = [
  {
    pattern: /想狠狠干你/gu,
    replacement: "想把你弄得发软",
    reason: "rewrite_self_penetrative_role",
  },
  {
    pattern: /想操你/gu,
    replacement: "想把你弄得发软",
    reason: "rewrite_self_penetrative_role",
  },
  {
    pattern: /我操你/gu,
    replacement: "我把你弄得发软",
    reason: "rewrite_self_penetrative_role",
  },
  {
    pattern: /被我操/gu,
    replacement: "被我弄得发软",
    reason: "rewrite_self_penetrative_role",
  },
  {
    pattern: /插(?:进(?:去)?)?你(?:里面)?/gu,
    replacement: "磨得你发颤",
    reason: "rewrite_self_penetrative_role",
  },
];

const NON_EXPLICIT_SOFTENING_RULES: ReplacementRule[] = [
  {
    pattern: /骚逼都湿了呢/gu,
    replacement: "都被你撩得有点发热了呢",
    reason: "soften_non_explicit_jump",
  },
  {
    pattern: /骚逼已经湿(?:透)?了/gu,
    replacement: "都被你撩得有点发热了",
    reason: "soften_non_explicit_jump",
  },
  {
    pattern: /你是不是又想被我操/gu,
    replacement: "你是不是又想继续逗我",
    reason: "soften_non_explicit_jump",
  },
];

const PERFORMANCE_DIRECTION_RULES: ReplacementRule[] = [
  {
    pattern: /[，,]\s*声音低沉\s*[，,]/gu,
    replacement: "，",
    reason: "strip_performance_direction",
  },
  {
    pattern: /[，,]\s*(?:压低声音|声音压低)\s*[，,]/gu,
    replacement: "，",
    reason: "strip_performance_direction",
  },
  {
    pattern: /(?:尾音拖得(?:极长|很长)|尾音拖长)/gu,
    replacement: "",
    reason: "strip_performance_direction",
  },
  {
    pattern: /[（(](?:[^（）()]|声音低沉|压低声音|声音压低|尾音拖得(?:极长|很长)|尾音拖长){0,24}(?:声音低沉|压低声音|声音压低|尾音拖得(?:极长|很长)|尾音拖长)(?:[^（）()]|声音低沉|压低声音|声音压低|尾音拖得(?:极长|很长)|尾音拖长){0,24}[）)]/gu,
    replacement: "",
    reason: "strip_performance_direction",
  },
];

export type AdultPersonaGuardReview = {
  flagged: boolean;
  reasons: string[];
  output: string;
};

function applyReplacementRules(
  text: string,
  rules: readonly ReplacementRule[],
  reasons: Set<string>,
): string {
  let output = text;
  for (const rule of rules) {
    rule.pattern.lastIndex = 0;
    if (!rule.pattern.test(output)) continue;
    rule.pattern.lastIndex = 0;
    output = output.replace(rule.pattern, rule.replacement);
    reasons.add(rule.reason);
  }
  return output;
}

function trailingRiskPrefixLength(text: string): number {
  if (!text) return 0;
  const maxWindow = Math.min(text.length, STREAM_TAIL_CHARS);
  for (let len = maxWindow; len > 0; len -= 1) {
    const suffix = text.slice(-len);
    if (CROSS_CHUNK_RISK_PHRASES.some((phrase) => phrase.startsWith(suffix) && phrase !== suffix)) {
      return len;
    }
  }
  return 0;
}

function collapsePunctuation(text: string): string {
  return text
    .replace(/[，,]\s*[，,]/gu, "，")
    .replace(/[。！？…]\s*[。！？…]/gu, (match) => match[0] ?? "。")
    .replace(/[，,]\s*([。！？…])/gu, "$1")
    .replace(/([。！？…])\s*[，,]/gu, "$1")
    .replace(/\s{2,}/gu, " ")
    .replace(/^\s+|\s+$/gu, "")
    .replace(/^，/u, "")
    .replace(/，$/u, "。");
}

export function sanitizeAdultPersonaReply(
  text: string,
  adultSceneState?: Partial<AdultSceneState> | null,
): AdultPersonaGuardReview {
  if (!text) {
    return {
      flagged: false,
      reasons: [],
      output: text,
    };
  }

  if (!isAdultModeEnabled()) {
    return {
      flagged: false,
      reasons: [],
      output: text,
    };
  }

  const reasons = new Set<string>();
  const sceneState = normalizeAdultSceneState(adultSceneState);
  let output = text;

  if (!(sceneState.mode === "explicit" && sceneState.allowedExplicit)) {
    output = applyReplacementRules(output, NON_EXPLICIT_SOFTENING_RULES, reasons);
  }
  output = applyReplacementRules(output, SELF_MALE_ANATOMY_REPLACEMENTS, reasons);
  output = applyReplacementRules(output, SELF_PENETRATIVE_ROLE_REPLACEMENTS, reasons);
  output = applyReplacementRules(output, PERFORMANCE_DIRECTION_RULES, reasons);
  if (reasons.has("strip_performance_direction")) {
    output = collapsePunctuation(output);
  }

  return {
    flagged: reasons.size > 0,
    reasons: [...reasons],
    output,
  };
}

export class AdultPersonaStreamGuard {
  private hold = "";
  constructor(private readonly adultSceneState?: Partial<AdultSceneState> | null) {}

  push(chunk: string): AdultPersonaGuardReview {
    this.hold += chunk;
    const holdBack = trailingRiskPrefixLength(this.hold);
    if (holdBack >= this.hold.length) {
      return {
        flagged: false,
        reasons: [],
        output: "",
      };
    }

    const flushable = holdBack > 0 ? this.hold.slice(0, -holdBack) : this.hold;
    this.hold = holdBack > 0 ? this.hold.slice(-holdBack) : "";
    return sanitizeAdultPersonaReply(flushable, this.adultSceneState);
  }

  flush(): AdultPersonaGuardReview {
    const tail = this.hold;
    this.hold = "";
    return sanitizeAdultPersonaReply(tail, this.adultSceneState);
  }
}
