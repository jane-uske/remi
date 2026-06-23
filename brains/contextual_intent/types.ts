// ── CIO-P1/P2: 上下文意图编排器 Shadow 分类器类型 ────────────────────
// 设计：docs/design/CONTEXTUAL_INTENT_ORCHESTRATOR_PLAN.md §4
// P1 scope: shadow 模式——只输出 intent 日志，不调任何工具，行为零变化。
// P2 scope: 多图注册表 + 指代消解（仍 shadow）。

/** 主轴：这一轮的主要性质 */
export type IntentPrimary =
  | "chat"            // 普通对话（默认）
  | "look_image"      // 看图
  | "generate_image"  // 生图
  | "performance"     // 进入/退出扮演
  | "voice"           // 改音色/语速
  | "disposition"     // 改长期说话倾向
  | "mixed";          // 一句里多意图

/** P2: 会话图片注册表条目 */
export interface ImageRegistryEntry {
  id: string;
  origin: "generated" | "uploaded";
  /** 生成图=subject；上传图=vision 描述 */
  descriptor: string;
  comfyPrompt?: string;
  characterStyle?: string;
  createdAt: number;
}

/** 生图轴（P1: regex 分类；P2: 加指代消解） */
export interface ShadowImageAxis {
  action: "generate" | "refine" | "redraw" | "restyle" | "none";
  subject?: string;
  /** P2: 指代消解结果 */
  reference?: {
    raw: string;
    resolvedImageId: string | null;
    confidence: number;
  } | null;
}

/** 音色轴 */
export interface ShadowVoiceAxis {
  op: "set_preset" | "tune" | "reset" | "none";
  preset?: string;
  tune?: { kind: "speed" | "pitch"; direction: "up" | "down" | "reset" };
}

/** 扮演轴 */
export interface ShadowPerformanceAxis {
  op: "enter" | "exit" | "none";
  styleDescriptor?: string;
  /** 是否请求"像图片里那个角色"——需配合 vision→style 推导 */
  wantsImageStyle?: boolean;
}

/** P3: 看图轴——区分"看图" vs "生图" vs "基于参考生图" */
export interface ShadowVisionAxis {
  /** 用户想让 Remi "看"图（评图/读图），不是要生图 */
  wantsLook: boolean;
  /** 本轮带了图片附件 */
  hasAttachment: boolean;
  /** 图是参考（"按这张画"），不是要评图 */
  referenceOnly: boolean;
}

/** P1/P2 shadow 分类结果——完整 ContextualIntent 的子集 */
export interface ShadowContextualIntent {
  schemaVersion: 1;
  primary: IntentPrimary;
  image: ShadowImageAxis | null;
  /** P3: 看图/生图消歧 */
  vision: ShadowVisionAxis | null;
  voice: ShadowVoiceAxis | null;
  performance: ShadowPerformanceAxis | null;
  meta: {
    source: "shadow";
    classifierLatencyMs: number;
    /** 哪些 regex/heuristic 命中了，debug 用 */
    signals: string[];
  };
}

/** 分类器输入 */
export interface ClassifyInput {
  userMessage: string;
  /** 本轮用户是否附了图 */
  hasImage: boolean;
  /** 会话中是否已有生成过的图（用于 refine/redraw 判断） */
  hasSessionImage: boolean;
  /** P2: 会话图片注册表（用于指代消解） */
  imageRegistry?: ImageRegistryEntry[];
}
