import type { AvatarModelSource } from "@/types/avatar";

export type RegisteredLive2DModel = {
  id: string;
  label: string;
  modelUrl: string;
  modelSource: AvatarModelSource;
};

export const DEFAULT_LIVE2D_MODEL_ID = "hiyori-pro";

const LIVE2D_MODEL_REGISTRY: Record<string, RegisteredLive2DModel> = {
  "hiyori-pro": {
    id: "hiyori-pro",
    label: "Hiyori Momose (Pro)",
    modelUrl: "/live2d/hiyori-pro/hiyori_pro_t11.model3.json",
    modelSource: "public_asset",
  },
  haru: {
    id: "haru",
    label: "Haru Sample",
    modelUrl:
      "https://raw.githubusercontent.com/guansss/pixi-live2d-display/master/test/assets/haru/haru_greeter_t03.model3.json",
    modelSource: "remote_url",
  },
};

export function listRegisteredLive2DModels(): RegisteredLive2DModel[] {
  return Object.values(LIVE2D_MODEL_REGISTRY);
}

export function getRegisteredLive2DModel(
  modelId: string,
): RegisteredLive2DModel | null {
  return LIVE2D_MODEL_REGISTRY[modelId] ?? null;
}

export function resolveRegisteredLive2DModel(
  modelId: string | null | undefined,
): RegisteredLive2DModel {
  if (typeof modelId === "string" && modelId.trim() !== "") {
    const normalized = modelId.trim();
    const resolved = getRegisteredLive2DModel(normalized);
    if (resolved) return resolved;
  }

  return LIVE2D_MODEL_REGISTRY[DEFAULT_LIVE2D_MODEL_ID];
}
