import {
  getDefaultLive2DModelId,
  getDefaultLive2DModelSource,
  getDefaultLive2DModelUrl,
  getDefaultVrmUrl,
} from "@/lib/avatar/modelUrls";
import type { AvatarCharacterSpec, AvatarEngine } from "@/types/avatar";

export type AvatarRuntimeEntry = {
  engine: AvatarEngine;
  modelId?: string;
  modelUrl: string;
};

export function getDefaultCharacterSpec(): AvatarCharacterSpec {
  return {
    id: "remi-default",
    engine: "live2d",
    displayName: "Remi",
    modelId: getDefaultLive2DModelId(),
    modelUrl: getDefaultLive2DModelUrl(),
    modelSource: getDefaultLive2DModelSource(),
    fallbackEngine: "vrm",
    fallbackModelUrl: getDefaultVrmUrl(),
    supportsVoiceMotion: true,
    supportsLookAt: true,
  };
}

export function buildCharacterFallbackChain(
  spec: AvatarCharacterSpec,
): AvatarRuntimeEntry[] {
  const chain: AvatarRuntimeEntry[] = [
    {
      engine: spec.engine,
      modelId: spec.modelId,
      modelUrl: spec.modelUrl,
    },
  ];

  if (
    spec.fallbackEngine &&
    spec.fallbackModelUrl &&
    !chain.some(
      (entry) =>
        entry.engine === spec.fallbackEngine &&
        entry.modelUrl === spec.fallbackModelUrl,
    )
  ) {
    chain.push({
      engine: spec.fallbackEngine,
      modelUrl: spec.fallbackModelUrl,
    });
  }

  return chain;
}

export function getAvatarEngineLabel(engine: AvatarEngine): string {
  return engine === "live2d" ? "Live2D" : "VRM";
}
