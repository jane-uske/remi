import type { VRM } from "@pixiv/three-vrm";
import { VRMExpressionPresetName } from "@pixiv/three-vrm";

/** 与后端 `Emotion` 对齐的字符串 */
export type RemUiEmotion =
  | "neutral"
  | "happy"
  | "curious"
  | "shy"
  | "sad";

export type VrmExpressionWeights = Partial<Record<string, number>>;

function clampWeight(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function mergeExpressionWeights(
  ...maps: Array<VrmExpressionWeights | null | undefined>
): VrmExpressionWeights {
  const merged: VrmExpressionWeights = {};
  for (const map of maps) {
    if (!map) continue;
    for (const [name, weight] of Object.entries(map)) {
      const safeWeight = typeof weight === "number" ? weight : 0;
      if (!Number.isFinite(safeWeight) || safeWeight <= 0) continue;
      merged[name] = clampWeight((merged[name] ?? 0) + safeWeight);
    }
  }
  return merged;
}

export function applyExpressionWeights(vrm: VRM, weights: VrmExpressionWeights): void {
  const em = vrm.expressionManager;
  if (!em) return;
  em.resetValues();
  for (const [name, weight] of Object.entries(weights)) {
    const w = clampWeight(typeof weight === "number" ? weight : 0);
    if (w <= 0) continue;
    try {
      em.setValue(name, w);
    } catch {
      /* 模型无该预设 */
    }
  }
}

export function getEmotionExpressionWeights(emotion: string): VrmExpressionWeights {
  const e = String(emotion || "neutral").toLowerCase() as RemUiEmotion;

  switch (e) {
    case "happy":
      return {
        [VRMExpressionPresetName.Happy]: 1,
        [VRMExpressionPresetName.Relaxed]: 0.25,
        [VRMExpressionPresetName.Surprised]: 0.08,
      };
    case "curious":
      return {
        [VRMExpressionPresetName.Surprised]: 0.55,
        [VRMExpressionPresetName.LookUp]: 0.35,
        [VRMExpressionPresetName.Relaxed]: 0.2,
      };
    case "shy":
      return {
        [VRMExpressionPresetName.Relaxed]: 0.75,
        [VRMExpressionPresetName.LookDown]: 0.35,
        [VRMExpressionPresetName.Happy]: 0.15,
      };
    case "sad":
      return {
        [VRMExpressionPresetName.Sad]: 1,
        [VRMExpressionPresetName.Angry]: 0.22,
        [VRMExpressionPresetName.LookDown]: 0.25,
      };
    case "neutral":
    default:
      return {
        [VRMExpressionPresetName.Neutral]: 0.85,
        [VRMExpressionPresetName.Relaxed]: 0.15,
      };
  }
}

/**
 * 将 Remi 情绪映射到 VRM 1.0 预设表情权重（组合）。
 * 不同模型若缺少某预设，setValue 会无害跳过。
 */
export function applyEmotionToVrm(vrm: VRM, emotion: string): void {
  applyExpressionWeights(vrm, getEmotionExpressionWeights(emotion));
}
