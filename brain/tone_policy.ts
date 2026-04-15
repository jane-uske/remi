export type ToneContractInput = {
  relationshipStage?: string;
  familiarity?: number;
  emotionalBond?: number;
  userMessage?: string;
  sceneImmersion?: boolean;
  shortInput?: boolean;
  negativeEmotionalContext?: boolean;
  continuingTopic?: boolean;
  decisionSeeking?: boolean;
  answerNow?: boolean;
};

export type ToneReview = {
  assistanty: boolean;
  score: number;
  reasons: string[];
};

type TonePattern = {
  reason: string;
  score: number;
  pattern: RegExp;
};

const ASSISTANTY_PATTERNS: TonePattern[] = [
  {
    reason: "主持式邀请",
    score: 3,
    pattern: /(要不要|想不想).{0,10}(陪你|一起|让我)/u,
  },
  {
    reason: "客服式让渡",
    score: 3,
    pattern: /如果你愿意|如果你需要|如果可以的话/u,
  },
  {
    reason: "建议腔过重",
    score: 2,
    pattern: /建议你|你可以先|也许可以试试|不如先/u,
  },
  {
    reason: "流程主持感",
    score: 2,
    pattern: /先告诉我|先和我说说|要不先/u,
  },
  {
    reason: "破角色表达",
    score: 4,
    pattern: /作为.?AI|我是.?AI/u,
  },
];

function classifyRelationshipDistance(input: ToneContractInput): "early" | "warm" | "close" {
  const stage = input.relationshipStage ?? "";
  if (stage.includes("亲密")) return "close";
  if (stage.includes("熟悉")) return "warm";
  const familiarity = input.familiarity ?? 0;
  const emotionalBond = input.emotionalBond ?? 0;
  if (familiarity >= 0.55 || emotionalBond >= 0.5) return "warm";
  return "early";
}

export function detectDecisionSeekingSignal(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return /(?:要不要|是不是该|应不应该|该不该|需不需要|要不要换|你觉得我(?:该|要)|你觉得我.*应该|我是不是需要|我该不该|我现在应该|你怎么看)/u.test(
    trimmed,
  );
}

export function detectAnswerNowSignal(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return /(?:我在问你|你怎么老是问我|别老问我|先回答我|直接说你的看法|我是在问你|^(你说|直说|直接说|说你的看法|说说你的判断)$)/u.test(
    trimmed,
  );
}

export function buildToneContract(input: ToneContractInput): string {
  const distance = classifyRelationshipDistance(input);
  const lines: string[] = [
    "像真人接话，不像客服、主持人或通用助手。",
    "先接住用户此刻的点，再往前推一步；不要上来总结、教育或给流程建议。",
    "能短就短，少解释你自己，少用模板化安慰句。",
  ];

  if (input.sceneImmersion) {
    lines.push("用户已经在共同场景里时，直接承接当前画面，不要退回成邀请开始想象。");
  }

  if (input.negativeEmotionalContext) {
    lines.push("碰到委屈、难过、焦虑这类情绪，先陪着和确认感受，别急着讲道理。");
  }

  if (input.shortInput) {
    lines.push("用户说得短时，优先贴着上下文接一句，不要条件反射地抛主持式追问。");
  }

  if (input.continuingTopic) {
    lines.push("明显在续聊上一条线时，不要像新话题重开。");
  }

  if (input.decisionSeeking) {
    lines.push("用户是在向你要判断或建议时，先明确回答，不要先反问。");
  }

  if (input.answerNow) {
    lines.push("用户已经明确嫌你一直在问，这一轮先直接说你的判断，禁止继续绕着反问。");
  }

  if (distance === "early") {
    lines.push("关系还在建立时，温柔但别过熟，不要突然用力定义亲密感。");
  } else if (distance === "warm") {
    lines.push("关系已在升温，可以更生活化、更口语一点，但别滑回油腻或表演感。");
  } else {
    lines.push("关系已较亲近，允许更贴近、更在场，但仍然要像自然接话，不像台词表演。");
  }

  lines.push("少用这些开头：‘如果你愿意’、‘要不要我陪你’、‘想不想让我’、‘建议你’。");
  return lines.join("；");
}

export function reviewReplyTone(reply: string): ToneReview {
  const normalized = reply.trim();
  if (!normalized) {
    return { assistanty: false, score: 0, reasons: [] };
  }

  const reasons: string[] = [];
  let score = 0;
  for (const entry of ASSISTANTY_PATTERNS) {
    if (entry.pattern.test(normalized)) {
      reasons.push(entry.reason);
      score += entry.score;
    }
  }

  if (normalized.length > 90 && /你可以|建议|不如|先/u.test(normalized)) {
    reasons.push("长句建议味偏重");
    score += 2;
  }

  return {
    assistanty: score >= 3,
    score,
    reasons,
  };
}
