/**
 * Image-generation intent: regex prefilter + regex classifier (fallback) +
 * subject extraction. Final hybrid resolution lives in resolve_image_intent.ts.
 */

export type ImageIntent =
  | { kind: "generate"; subject: string; comfyPrompt?: string }
  /** Incremental edit on the last generated image (e.g. 更骚点 / 丝袜脱掉). */
  | { kind: "refine"; delta: string; comfyPrompt?: string }
  | { kind: "redraw" }
  | { kind: "restyle"; style: string; subject?: string; comfyPrompt?: string }
  | { kind: "none" };

// Cheap prefilter: does this message merit a fast-brain confirmation call?
// Intentionally broad — false positives are corrected by the LLM layer.
const IMAGE_CANDIDATE_RE =
  /画|图|照|插画|生图|绘制|画风|重画|出图|自拍|写真/u;

// Explicit "draw this" triggers for regex fallback / offline mode.
const GENERATE_RE =
  /(帮我画|给我画|帮忙画|替我画|请画|画一[张幅个副只条头朵颗座群]|画个|画张|画幅|绘制|画图|(?:帮我|给我|帮忙|替我|请|麻烦)?(?:来|做|出|生)(?:一|几)?[张幅个]\S{0,4}(?:图|画|照)|生成(?:一[张幅])?\S{0,6}(?:图片?|图像|插画|画|照片?|图)|(?:给我|帮我)?生图|生成图|用.{0,16}提示词生图|提示词生图|(?:看看|给我看|让我看|我要看|我想看).{0,6}(?:照片?|相片?|自拍|写真)|(?:发|拍|来|秀)[个张一]?.{0,4}(?:照片?|自拍|写真))/u;

const REDRAW_RE =
  /(重画|重新画|再画一?[张幅个]?|换一[张幅个]|再来一?[张幅个]?|重新生成|再生成一?[张幅]?|换张图|再画张|重新来一?[张幅])/u;

const RESTYLE_RE =
  /(?:换成?|改成|画成|用)(.+?)(?:风格|画风)|换[个一种]?(?:风格|画风)|换个?画风|(.+?)(?:风格|画风)(?:重?画|再画|生成|出图)/u;

const LEADING_COMMAND_RE =
  /^[\s,，。!！~～]*(?:别\S+了[，,]?\s*)?(?:帮我|给我|帮忙|替我|请|麻烦)?(?:画|绘制|生成|做|来|出|生|看看|给我看|让我看|我要看|我想看|发|拍|秀)(?:一|两|三|四|五|几)?[张幅个副只条头朵颗座群]?(?:图片?|图像|插画|画|图|照片|自拍|写真|相片)?[:：,，、的\s]*/u;

const TRAILING_COMMAND_RE =
  /[\s,，]*(?:帮我|给我|帮忙|替我|请|麻烦)?(?:画|绘制|生成|做|来|出|生)(?:一|两|三|四|五|几)?[张幅个副只条头朵颗座群]?(?:图片?|图像|插画|画|图|照片)?[\s,，。!！?？~～]*$/u;

/** Scene tweaks without explicit 画/图 — only valid when a prior image exists. */
const IMAGE_CONTINUATION_RE =
  /更[骚欲色火辣]|再[骚色]点|再[骚色]一点|骚一点|性感一点|再露|多露|少穿|脱掉|脱下|摘下|掀起|撩起|翘|撅|掰|张开|转过身|转过来|转过去|背对|趴着|跪|撅着|继续画|接着画|还是.*(?:画|图)|换个姿势|换姿势|改一下|改改|加上|去掉|把.{0,8}(?:脱|掀|撩|翘|掰|张)/u;

export function isImageContinuationCommand(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return false;
  return IMAGE_CONTINUATION_RE.test(trimmed);
}

export function mightBeImageCommand(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return false;
  return IMAGE_CANDIDATE_RE.test(trimmed);
}

/** Prefilter for step-1 intent when session already has an image. */
export function mightBeImageFollowUp(message: string, hasPreviousImage: boolean): boolean {
  if (mightBeImageCommand(message)) return true;
  return hasPreviousImage && isImageContinuationCommand(message);
}

function cleanSubject(text: string): string {
  return text
    .replace(/^[\s,，:：、。!！?？~～]+/u, "")
    .replace(/[\s,，。!！?？~～]+$/u, "")
    .replace(/(谢谢|拜托|呗|吧|呀|啦|哦|哈|嘛|呢|麻烦了?)$/u, "")
    .replace(/(出来|出图|一下|看看)$/u, "")
    .replace(/[\s,，。!！?？~～]+$/u, "")
    .trim();
}

/**
 * Extract what the user wants drawn from a generate-style message by removing
 * the leading command words. Returns "" when nothing meaningful remains.
 */
export function extractSubject(message: string): string {
  const trimmed = message.trim();
  const stripped = trimmed
    .replace(
      /^[\s,，。!！~～]*(?:用(?:这个|此)?提示词生图|按(?:这个|此)?提示词生图)[:：,，、\s]*/u,
      "",
    )
    .replace(LEADING_COMMAND_RE, "")
    .replace(TRAILING_COMMAND_RE, "");
  return cleanSubject(stripped);
}

function extractStyle(message: string): string {
  const match = RESTYLE_RE.exec(message);
  if (!match) return "";
  const style = (match[1] || match[2] || "").trim();
  return style ? cleanSubject(style) : "";
}

/**
 * Reject sentences that merely mention image-related words in a
 * non-imperative context: questions, negations, meta-discussion, etc.
 * This fires *before* GENERATE_RE to prevent false positives like
 * "记得我之前让你生成什么图片吗" or "不是让你生图".
 */
const IMAGE_REJECT_RE =
  /^(?:不是|不要|别|没有?|没让|我没|并没|并不|不用|不需要|没叫|不让).*(?:画|图|生图|绘制|出图)|(?:什么|哪个|哪张|怎么|为什么|啥|几张?).*(?:图片?|图像|画|照片?).*[吗呢？?]$|记得.*(?:画|图|生图)|谈谈|聊聊|讨论|说说.*(?:生图|画图|图片)/u;

/** Regex-only classifier — used as fallback when the fast-brain agent is off or fails. */
export function classifyImageIntentRegex(message: string): ImageIntent {
  const trimmed = message.trim();
  if (!trimmed) return { kind: "none" };

  // Reject non-imperative contexts before matching draw commands
  if (IMAGE_REJECT_RE.test(trimmed)) {
    return { kind: "none" };
  }

  if (RESTYLE_RE.test(trimmed)) {
    const style = extractStyle(trimmed);
    const inline = /(?:风格|画风)的?(.+)$/u.exec(trimmed);
    const subject = inline ? extractSubject(inline[1]) : "";
    return { kind: "restyle", style, subject: subject || undefined };
  }

  if (REDRAW_RE.test(trimmed)) {
    return { kind: "redraw" };
  }

  if (GENERATE_RE.test(trimmed)) {
    return { kind: "generate", subject: extractSubject(trimmed) };
  }

  if (isImageContinuationCommand(trimmed)) {
    return { kind: "refine", delta: cleanSubject(trimmed) };
  }

  return { kind: "none" };
}

/** @deprecated Prefer resolveImageIntent(); kept for unit tests and offline fallback. */
export function classifyImageIntent(message: string): ImageIntent {
  return classifyImageIntentRegex(message);
}

/**
 * Turn a bare Chinese subject into a ComfyUI-friendly positive prompt.
 * Diffusion models weakly follow negation in Chinese — append explicit English tags.
 */
export function enrichComfyPrompt(subject: string): string {
  const base = subject.trim();
  if (!base) return base;

  const extras: string[] = [];
  if (/没有尾巴|无尾巴|没尾巴|不带尾巴/u.test(base)) {
    extras.push("tailless cat", "no tail", "without tail");
  }
  if (/没有耳朵|无耳朵|没耳朵/u.test(base)) {
    extras.push("no ears", "without ears");
  }

  return extras.length > 0 ? `${base}, ${extras.join(", ")}` : base;
}

/** Normalize bare subject from LLM/regex output or the original user message. */
export function normalizeGenerateSubject(raw: string, userMessage?: string): string {
  const fromRaw = extractSubject(raw);
  if (fromRaw) return fromRaw;
  if (userMessage) {
    const fromMessage = extractSubject(userMessage);
    if (fromMessage) return fromMessage;
  }
  return raw.trim();
}