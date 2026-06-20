import type { ImageIntent } from "./image_intent";
import {
  enrichComfyPrompt,
  normalizeGenerateSubject,
} from "./image_intent";
import {
  applyCharacterStyle,
  resolveEffectiveCharacterStyle,
  stripFreestyleStyleTags,
  styleTagsFromName,
  type CharacterStyleTags,
} from "./image_character_style";

/** Step 2 output — ready for ComfyUI `/prompt`. */
export interface AssembledImagePrompt {
  /** User-facing label in chat (Chinese subject). */
  label: string;
  /** Session memory for redraw / restyle (bare subject). */
  subject: string;
  /** Positive prompt submitted to ComfyUI. */
  comfyPrompt: string;
  /** Locked character style tags for this session. */
  characterStyle: CharacterStyleTags;
}

export type AssembleImagePromptResult =
  | { ok: true; assembled: AssembledImagePrompt }
  | { ok: false; clarify: string };

export interface AssembleImagePromptInput {
  intent: ImageIntent;
  userMessage: string;
  lastImage?: { subject: string; prompt: string; characterStyle?: CharacterStyleTags };
  characterStyle?: CharacterStyleTags | null;
}

/**
 * Step 2: turn resolved intent into a ComfyUI-ready positive prompt.
 * Intent recognition (step 1) must already be done.
 */
export function assembleImagePrompt(
  input: AssembleImagePromptInput,
): AssembleImagePromptResult {
  const { intent, userMessage, lastImage } = input;
  const sessionStyle = input.characterStyle ?? lastImage?.characterStyle ?? null;

  if (intent.kind === "refine") {
    if (!lastImage) {
      return {
        ok: false,
        clarify: "我还没画过图呢，先告诉我想画什么吧～",
      };
    }
    const delta = intent.delta.trim();
    if (!delta) {
      return {
        ok: false,
        clarify: "想怎么改上一张图呀？比如「更骚点」「丝袜脱掉」「屁股翘过来」～",
      };
    }
    const characterStyle =
      lastImage.characterStyle ??
      resolveEffectiveCharacterStyle({ sessionStyle, userMessage });
    const scenePrompt =
      intent.comfyPrompt?.trim() || enrichComfyPrompt(delta);
    const comfyPrompt = applyCharacterStyle(scenePrompt, characterStyle);
    return {
      ok: true,
      assembled: {
        label: `${lastImage.subject}·改版`,
        subject: lastImage.subject,
        comfyPrompt,
        characterStyle,
      },
    };
  }

  if (intent.kind === "generate") {
    const subject = normalizeGenerateSubject(intent.subject, userMessage);
    if (!subject) {
      return {
        ok: false,
        clarify: "你想让我画点什么呀？比如「画一只戴帽子的橘猫」～",
      };
    }
    const characterStyle = resolveEffectiveCharacterStyle({
      sessionStyle,
      userMessage,
    });
    const scenePrompt =
      intent.comfyPrompt?.trim() || enrichComfyPrompt(subject);
    const comfyPrompt = applyCharacterStyle(scenePrompt, characterStyle);
    return {
      ok: true,
      assembled: {
        label: subject,
        subject,
        comfyPrompt,
        characterStyle,
      },
    };
  }

  if (intent.kind === "redraw") {
    if (!lastImage) {
      return {
        ok: false,
        clarify: "我还没画过图呢，先告诉我想画什么吧～比如「画一片星空」。",
      };
    }
    return {
      ok: true,
      assembled: {
        label: lastImage.subject,
        subject: lastImage.subject,
        comfyPrompt: lastImage.prompt,
        characterStyle:
          lastImage.characterStyle ??
          resolveEffectiveCharacterStyle({ sessionStyle, userMessage }),
      },
    };
  }

  if (intent.kind === "restyle") {
    const subject =
      (intent.subject ? normalizeGenerateSubject(intent.subject, userMessage) : "") ||
      lastImage?.subject ||
      "";
    if (!subject) {
      return {
        ok: false,
        clarify:
          "想画成什么风格呀？先告诉我画什么，比如「画一只猫」，再说「换成水彩风格」就好啦～",
      };
    }
    if (!intent.style?.trim()) {
      return {
        ok: false,
        clarify: "想换成什么风格呢？比如水彩、油画、赛博朋克、吉卜力～",
      };
    }
    const style = intent.style.trim();
    const characterStyle = styleTagsFromName(style);
    const scenePrompt = stripFreestyleStyleTags(
      intent.comfyPrompt?.trim() ||
        enrichComfyPrompt(subject),
    );
    const comfyPrompt = applyCharacterStyle(scenePrompt, characterStyle);
    return {
      ok: true,
      assembled: {
        label: `${subject}·${style}风格`,
        subject,
        comfyPrompt,
        characterStyle,
      },
    };
  }

  return { ok: false, clarify: "你想让我画点什么呀？比如「画一只戴帽子的橘猫」～" };
}