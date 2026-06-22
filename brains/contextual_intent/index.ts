// ── CIO-P1/P2: 模块入口 ──────────────────────────────────────────────
export { classifyContextualIntent } from "./classifier";
export type { ShadowContextualIntent, ClassifyInput, ImageRegistryEntry } from "./types";
export { registerImage, getRegistry, clearRegistry, resolveImageReference } from "./image_registry";
export { deriveStyleFromImageDescription } from "./vision_to_style";
