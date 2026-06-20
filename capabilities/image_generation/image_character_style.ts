import { getConfig } from "../../server/config";

/** Locked per-session character render style (English ComfyUI tags). */
export type CharacterStyleTags = string;

const QUALITY_PREFIX = "masterpiece, best quality, ultra-detailed";

const STYLE_STRIP_RE =
  /\b(?:anime\s*style|manga\s*style|illustration\s*style|cartoon\s*style|cel\s*shading|2d\s*art|photorealistic|photo\s*realistic|hyperrealistic|raw\s*photo|8k\s*raw\s*photo|8k\s*photo|cinematic\s*photo|realistic\s*photo|studio\s*photo)\b/gi;

const DANBOORU_PREFIX_RE = /^(?:\s*(?:1girl|1boy|solo)\s*,\s*)+/i;

const STYLE_ALIASES: Readonly<Record<string, CharacterStyleTags>> = {
  真人: "photorealistic, cinematic lighting, 8k raw photo, detailed skin texture",
  写实: "photorealistic, cinematic lighting, 8k raw photo",
  摄影: "photorealistic, 8k raw photo, studio lighting",
  照片: "photorealistic, 8k raw photo, natural lighting",
  动漫: "anime illustration, soft cel shading, detailed anime art",
  二次元: "anime illustration, soft cel shading, detailed anime art",
  插画: "digital illustration, painterly, detailed artwork",
  水彩: "watercolor painting, soft washes, paper texture",
  油画: "oil painting, brush strokes, canvas texture",
  赛博朋克: "cyberpunk style, neon lighting, futuristic",
  吉卜力: "studio ghibli style, soft colors, hand-drawn animation",
  像素: "pixel art, retro game style",
  anime: "anime illustration, soft cel shading, detailed anime art",
  photorealistic: "photorealistic, cinematic lighting, 8k raw photo",
  realistic: "photorealistic, cinematic lighting, 8k raw photo",
  illustration: "digital illustration, painterly, detailed artwork",
};

const PLAY_STYLE_RE =
  /扮演\s*(.+?)\s*(?:风格|画风)|用\s*(.+?)\s*(?:风格|画风)\s*(?:画|生成|出图|来)|(?:换成?|改成|画成)\s*(.+?)\s*(?:风格|画风)/u;

export function getDefaultCharacterStyle(): CharacterStyleTags {
  const configured = getConfig().REMI_IMAGE_CHARACTER_STYLE?.trim();
  if (configured) return configured;
  return "photorealistic, cinematic lighting, 8k raw photo, detailed skin texture";
}

function normalizeStyleKey(raw: string): string {
  return raw
    .trim()
    .replace(/[「」"'“”‘’]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

/** Map a user-facing style name (中文/英文) to ComfyUI style tags. */
export function styleTagsFromName(styleName: string): CharacterStyleTags {
  const trimmed = styleName.trim();
  if (!trimmed) return getDefaultCharacterStyle();

  const key = normalizeStyleKey(trimmed);
  for (const [alias, tags] of Object.entries(STYLE_ALIASES)) {
    if (normalizeStyleKey(alias) === key) return tags;
  }

  // Unknown style: pass through as explicit style hint.
  return `${trimmed} style, ${trimmed}风格`;
}

/**
 * Detect explicit style override in a generate message
 * (扮演/用XX风格画/换成XX风格) when intent is still `generate`.
 */
export function detectExplicitStyleOverride(userMessage: string): string | null {
  const match = PLAY_STYLE_RE.exec(userMessage.trim());
  if (!match) return null;
  const raw = (match[1] || match[2] || match[3] || "").trim();
  return raw || null;
}

/** Remove freestyle aesthetic tags the fast-brain LLM may inject. */
/** Pull scene-only text out of a stored ComfyUI prompt (drop quality + locked style). */
export function extractSceneBaseline(
  fullPrompt: string,
  characterStyle?: string,
): string {
  let out = fullPrompt.trim();
  out = out.replace(/^masterpiece,\s*best quality,\s*ultra-detailed,\s*/i, "");
  if (characterStyle?.trim()) {
    const parts = characterStyle
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    for (const part of parts) {
      const escaped = part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      out = out.replace(new RegExp(`\\b${escaped}\\b,?\\s*`, "gi"), "");
    }
  }
  return stripFreestyleStyleTags(out).trim();
}

export function stripFreestyleStyleTags(prompt: string): string {
  let out = prompt
    .replace(STYLE_STRIP_RE, "")
    .replace(DANBOORU_PREFIX_RE, "")
    .replace(/\s*,\s*,/g, ", ")
    .replace(/^\s*,\s*/, "")
    .replace(/\s*,\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return out;
}

/**
 * Apply locked character style to a scene-only prompt.
 * Quality prefix is added once; duplicate quality tags in scene are kept minimal.
 */
export function applyCharacterStyle(
  scenePrompt: string,
  styleTags: CharacterStyleTags,
): string {
  const scene = stripFreestyleStyleTags(scenePrompt.trim());
  if (!scene) return `${QUALITY_PREFIX}, ${styleTags}`;
  return `${QUALITY_PREFIX}, ${styleTags}, ${scene}`;
}

export function resolveEffectiveCharacterStyle(args: {
  sessionStyle?: CharacterStyleTags | null;
  userMessage: string;
  explicitStyleName?: string | null;
}): CharacterStyleTags {
  if (args.explicitStyleName?.trim()) {
    return styleTagsFromName(args.explicitStyleName);
  }
  const override = detectExplicitStyleOverride(args.userMessage);
  if (override) return styleTagsFromName(override);
  if (args.sessionStyle?.trim()) return args.sessionStyle.trim();
  return getDefaultCharacterStyle();
}