// ── CIO-P1/P2: Shadow 意图分类器 ─────────────────────────────────────
// 纯 regex / heuristic 分类，零 LLM 调用，< 1ms。
// 只写日志，不改任何运行时行为。
// P2: 加指代消解（依赖 ImageRegistry）。
//
// 设计：docs/design/CONTEXTUAL_INTENT_ORCHESTRATOR_PLAN.md §6 P1/P2

import type {
  ClassifyInput,
  ShadowContextualIntent,
  ShadowImageAxis,
  ShadowVisionAxis,
  ShadowVoiceAxis,
  ShadowPerformanceAxis,
  IntentPrimary,
} from "./types";
import { resolveImageReference } from "./image_registry";

// ── 生图 regex（复用 image_intent.ts 的判断逻辑，但不 import 避免耦合） ──

const IMAGE_GEN_RE =
  /(画|生成|出|来)(一?[张幅个]|些|几[张幅])|(帮我|给我).*(画|生成|出图)|画[一张]*.*[的了吧]$|生成?图|出[一张]*图|画个|画只|画条|画朵/u;
const IMAGE_REFINE_RE =
  /(再|重新)?(改|换|调|加|去掉|脱|穿|多|少|更).{0,10}(一?[点些下]|一下)|更.*[一点些]/u;
const IMAGE_REDRAW_RE =
  /(重新|再)(画|来|生成)(一[张幅])?/u;
const IMAGE_RESTYLE_RE =
  /(换成?|改成?|用).*(风格|画风|style)/u;

// ── 音色 regex（与 voice_style_presets.ts 保持一致的模式） ──

const VOICE_PRESET_NAMES = "御姐|萝莉|温柔|元气|冷酷|妩媚";
const PRESET_NAME_TO_ID: Record<string, string> = {
  "御姐": "yujie",
  "萝莉": "luoli",
  "温柔": "wenrou",
  "元气": "yuanqi",
  "冷酷": "lengku",
  "妩媚": "wumei",
};
const VOICE_STYLE_RE = new RegExp(
  `(?:^|\\s)(用|换成|切换?到?|来个?|换个?|来点?)\\s*(${VOICE_PRESET_NAMES})(音|音色|声音|嗓音)?(?:\\s|$|[～~。！!？?，,])`,
  "u",
);
const VOICE_RESET_RE =
  /(恢复|还原|回到|换回).*(原来|默认|正常|之前).*(声音|音色|嗓音|语音)?/u;
const SPEED_SLOW_RE =
  /(说|讲|语速|速度).*(慢|缓)|(太快了|好快|说得.*快|讲得.*快|快.*了吧)/u;
const SPEED_FAST_RE =
  /(说|讲|语速|速度).*(快|急)|(太慢了|好慢|说得.*慢|讲得.*慢|慢.*了吧)/u;
const SPEED_RESET_RE =
  /(语速|速度).*(正常|默认|恢复|适中)/u;
const PITCH_TUNE_RE =
  /(调子?|音调|声音|嗓音).*(高|尖|亮|低|沉|厚)\s*(一?[点些]|一下)|(太[高低尖沉闷]了|好[高低])/u;
const PITCH_RESET_RE =
  /(调子?|音调).*(正常|默认|恢复|适中)/u;

// ── 扮演 regex ──

const PERFORMANCE_ENTER_RE =
  /(你|remi|Remi)?\s*(扮演|变成|当|做|演|cosplay|模仿|学)\s*(一?个?)?\s*(.{1,12})(跟我|和我|给我)?(聊|说|讲)?/u;
const PERFORMANCE_EXIT_RE =
  /(别|不要|停止|不用)(扮演|演|装|模仿|cosplay)|正常[点些一]|(做|当)回?(你?自己|remi|原来)/iu;

// ── 图片风格请求："像她一点"/"像这个角色"/"学她那种感觉"（配合 vision→style 推导）──
const IMAGE_STYLE_REQUEST_RE =
  /(像|学|模仿)(她|他|这个角色|这种角色|这种风格|这种|这个)[一]?[点些下]?|像她(那样|这样|一样)|学她(那样|那样说话)|像(她|他|这个角色)的?(风格|感觉|语气|样子)/u;

// ── 看图 heuristic ──

const LOOK_IMAGE_RE =
  /(你?)(看看?|瞧瞧?|认识?|是什么|什么东西|帮我看|评价)/u;

// ── 参考生图 heuristic（"按这张画" / "照着这张" / "参考这张"）──
const REFERENCE_IMAGE_RE =
  /(按|照着?|参考|根据|按照|仿照|依据|对照)(这[张幅]|那[张幅]|这个|它|她|他)/u;

// ═════════════════════════════════════════════════════════════════════

function classifyVision(msg: string, input: ClassifyInput, imageAxis: ShadowImageAxis | null): ShadowVisionAxis | null {
  if (!input.hasImage) return null;

  const wantsLook = LOOK_IMAGE_RE.test(msg);
  const hasGenIntent = imageAxis !== null && imageAxis.action !== "none";
  const referenceOnly = REFERENCE_IMAGE_RE.test(msg) || (hasGenIntent && !wantsLook);

  return {
    wantsLook: wantsLook && !referenceOnly,
    hasAttachment: true,
    referenceOnly,
  };
}

function classifyImage(msg: string, input: ClassifyInput): ShadowImageAxis | null {
  let result: ShadowImageAxis | null = null;
  if (IMAGE_REDRAW_RE.test(msg) && input.hasSessionImage)
    result = { action: "redraw" };
  else if (IMAGE_RESTYLE_RE.test(msg))
    result = { action: "restyle", subject: msg };
  else if (IMAGE_REFINE_RE.test(msg) && input.hasSessionImage)
    result = { action: "refine", subject: msg };
  else if (IMAGE_GEN_RE.test(msg))
    result = { action: "generate", subject: msg };

  // P2: 指代消解（有 registry 时）
  if (input.imageRegistry && input.imageRegistry.length > 0) {
    const ref = resolveImageReference(msg, input.imageRegistry);
    if (ref) {
      if (!result) {
        // 有指代但没命中生图意图——可能是"那张猫再来一张"的简略说法
        result = { action: "none", reference: ref };
      } else {
        result.reference = ref;
      }
    }
  }

  return result;
}

function classifyVoice(msg: string): ShadowVoiceAxis | null {
  // 预设
  const presetMatch = VOICE_STYLE_RE.exec(msg);
  if (presetMatch) {
    const styleName = presetMatch[2];
    const id = PRESET_NAME_TO_ID[styleName];
    if (id) return { op: "set_preset", preset: id };
  }
  // 语速（比通用 reset 更具体，先检查）
  if (SPEED_SLOW_RE.test(msg))
    return { op: "tune", tune: { kind: "speed", direction: "down" } };
  if (SPEED_FAST_RE.test(msg))
    return { op: "tune", tune: { kind: "speed", direction: "up" } };
  if (SPEED_RESET_RE.test(msg))
    return { op: "tune", tune: { kind: "speed", direction: "reset" } };
  // 音调（同理，先于通用 reset）
  if (PITCH_TUNE_RE.test(msg))
    return { op: "tune", tune: { kind: "pitch", direction: msg.match(/高|尖|亮/) ? "up" : "down" } };
  if (PITCH_RESET_RE.test(msg))
    return { op: "tune", tune: { kind: "pitch", direction: "reset" } };
  // 通用音色重置（"恢复原来的声音"）
  if (VOICE_RESET_RE.test(msg))
    return { op: "reset" };
  return null;
}

function classifyPerformance(msg: string, input: ClassifyInput): ShadowPerformanceAxis | null {
  if (PERFORMANCE_EXIT_RE.test(msg))
    return { op: "exit" };

  // 图片风格请求："像她一点" → 标记 wantsImageStyle，由 wired 层走 vision→style 推导
  if (IMAGE_STYLE_REQUEST_RE.test(msg) && (input.hasImage || (input.imageRegistry && input.imageRegistry.length > 0))) {
    return { op: "enter", styleDescriptor: "参照图片角色", wantsImageStyle: true };
  }

  const enterMatch = PERFORMANCE_ENTER_RE.exec(msg);
  if (enterMatch) {
    const descriptor = (enterMatch[4] ?? "").trim();
    if (descriptor) return { op: "enter", styleDescriptor: descriptor };
  }
  return null;
}

/**
 * P1 shadow 分类器。纯 regex/heuristic，不调 LLM，<1ms。
 * 只产出 `ShadowContextualIntent`，由调用方决定怎么用（目前只写日志）。
 */
export function classifyContextualIntent(input: ClassifyInput): ShadowContextualIntent {
  const start = performance.now();
  const msg = input.userMessage.trim();
  const signals: string[] = [];

  // 逐轴判断
  const image = classifyImage(msg, input);
  if (image && image.action !== "none") signals.push(`image:${image.action}`);
  if (image?.reference?.resolvedImageId) signals.push(`image_ref:${image.reference.raw}`);

  const vision = classifyVision(msg, input, image);
  if (vision?.wantsLook) signals.push("look_image");
  if (vision?.referenceOnly) signals.push("reference_image");

  const voice = classifyVoice(msg);
  if (voice) signals.push(`voice:${voice.op}${voice.preset ? `:${voice.preset}` : ""}`);

  const perf = classifyPerformance(msg, input);
  if (perf && perf.op !== "none") signals.push(`performance:${perf.op}`);

  // 看图 vs 生图消歧（使用 vision 轴结果）
  const isLookImage = vision?.wantsLook ?? false;

  // 决定 primary
  let primary: IntentPrimary = "chat";
  const intentCount = signals.length;
  if (intentCount === 0) {
    // 纯聊天
    primary = "chat";
  } else if (intentCount >= 2) {
    primary = "mixed";
  } else if (isLookImage) {
    primary = "look_image";
  } else if (image && image.action !== "none") {
    primary = "generate_image";
  } else if (voice) {
    primary = "voice";
  } else if (perf && perf.op !== "none") {
    primary = "performance";
  }

  const latency = performance.now() - start;

  return {
    schemaVersion: 1,
    primary,
    image: image ?? null,
    vision: vision ?? null,
    voice: voice ?? null,
    performance: perf ?? null,
    meta: {
      source: "shadow",
      classifierLatencyMs: Math.round(latency * 100) / 100,
      signals,
    },
  };
}
