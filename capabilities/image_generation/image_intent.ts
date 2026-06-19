/**
 * Lightweight regex intent layer for image generation. No LLM, no agent — just
 * three explicit branches: generate / redraw / restyle, plus subject extraction.
 */

export type ImageIntent =
  | { kind: "generate"; prompt: string }
  | { kind: "redraw" }
  | { kind: "restyle"; style: string; subject?: string }
  | { kind: "none" };

// Explicit "draw this" triggers. Kept conservative so casual mentions of 画
// (e.g. 画面, 计划, 动画) do NOT hijack normal conversation.
// The (?:…图|…画|…照) arms allow compound nouns like 色图, 裸照, 插画.
const GENERATE_RE =
  /(帮我画|给我画|帮忙画|替我画|请画|画一[张幅个副只条头朵颗座群]|画个|画张|画幅|绘制|画图|(?:帮我|给我|帮忙|替我|请|麻烦)?(?:来|做|出|生)(?:一|几)?[张幅个]\S{0,4}(?:图|画|照)|生成(?:一[张幅])?\S{0,6}(?:图片?|图像|插画|画|照片?|图)|(?:给我|帮我)?生图|生成图)/u;

// "redraw / try again" — reuses the last subject with a fresh seed.
const REDRAW_RE =
  /(重画|重新画|再画一?[张幅个]?|换一[张幅个]|再来一?[张幅个]?|重新生成|再生成一?[张幅]?|换张图|再画张|重新来一?[张幅])/u;

// "change style" — reuses the last subject (or an inline subject) with a style.
// Group 1: style from 换成/改成/画成/用…风格.  Group 2: style from …风格再画.
const RESTYLE_RE =
  /(?:换成?|改成|画成|用)(.+?)(?:风格|画风)|换[个一种]?(?:风格|画风)|换个?画风|(.+?)(?:风格|画风)(?:重?画|再画|生成|出图)/u;

// Leading command phrase: (politeness?)(verb)(quantifier?)(measure?)(object noun?).
// Stripped off a generate message to recover the bare subject.
const LEADING_COMMAND_RE =
  /^[\s,，。!！~～]*(?:别\S+了[，,]?\s*)?(?:帮我|给我|帮忙|替我|请|麻烦)?(?:画|绘制|生成|做|来|出|生)(?:一|两|三|四|五|几)?[张幅个副只条头朵颗座群]?(?:图片?|图像|插画|画|图|照片)?[:：,，、的\s]*/u;

// Trailing command phrase: e.g. "边牧画一个" → strip "画一个".
const TRAILING_COMMAND_RE =
  /[\s,，]*(?:帮我|给我|帮忙|替我|请|麻烦)?(?:画|绘制|生成|做|来|出|生)(?:一|两|三|四|五|几)?[张幅个副只条头朵颗座群]?(?:图片?|图像|插画|画|图|照片)?[\s,，。!！?？~～]*$/u;

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

export function classifyImageIntent(message: string): ImageIntent {
  const trimmed = message.trim();
  if (!trimmed) return { kind: "none" };

  // Restyle is checked before generate because "画成赛博朋克风格" contains 画.
  if (RESTYLE_RE.test(trimmed)) {
    const style = extractStyle(trimmed);
    // Try to recover an inline subject like "画成水彩风格的猫" → subject "猫".
    const inline = /(?:风格|画风)的?(.+)$/u.exec(trimmed);
    const subject = inline ? extractSubject(inline[1]) : "";
    return { kind: "restyle", style, subject: subject || undefined };
  }

  if (REDRAW_RE.test(trimmed)) {
    return { kind: "redraw" };
  }

  if (GENERATE_RE.test(trimmed)) {
    return { kind: "generate", prompt: extractSubject(trimmed) };
  }

  return { kind: "none" };
}
