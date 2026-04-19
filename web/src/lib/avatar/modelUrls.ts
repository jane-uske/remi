import type { AvatarModelSource } from "@/types/avatar";
import {
  DEFAULT_LIVE2D_MODEL_ID,
  resolveRegisteredLive2DModel,
} from "@/lib/avatar/live2dModelRegistry";

const DEFAULT_VRM_MODEL_URL = "/vrm/1497262518610234440.vrm";
const DEBUG_LIVE2D_URL_OVERRIDE_ID = "url-override";

function normalizeModelUrl(url: string): string {
  const trimmed = url.trim();
  if (/^[\w.-]+:\d+\//i.test(trimmed)) return `http://${trimmed}`;
  return trimmed;
}

export function getDefaultVrmUrl(): string {
  const raw = process.env.NEXT_PUBLIC_VRM_URL;
  if (typeof raw === "string" && raw.trim() !== "") {
    return normalizeModelUrl(raw);
  }
  return DEFAULT_VRM_MODEL_URL;
}

export function getDefaultLive2DModelId(): string {
  const rawUrl = process.env.NEXT_PUBLIC_LIVE2D_MODEL_URL;
  if (typeof rawUrl === "string" && rawUrl.trim() !== "") {
    return DEBUG_LIVE2D_URL_OVERRIDE_ID;
  }

  const rawModelId = process.env.NEXT_PUBLIC_LIVE2D_MODEL_ID;
  if (typeof rawModelId === "string" && rawModelId.trim() !== "") {
    return resolveRegisteredLive2DModel(rawModelId).id;
  }

  return DEFAULT_LIVE2D_MODEL_ID;
}

export function getDefaultLive2DModelUrl(): string {
  const raw = process.env.NEXT_PUBLIC_LIVE2D_MODEL_URL;
  if (typeof raw === "string" && raw.trim() !== "") {
    return normalizeModelUrl(raw);
  }

  return resolveRegisteredLive2DModel(
    process.env.NEXT_PUBLIC_LIVE2D_MODEL_ID,
  ).modelUrl;
}

export function getDefaultLive2DModelSource(): AvatarModelSource {
  const raw = process.env.NEXT_PUBLIC_LIVE2D_MODEL_URL;
  if (typeof raw === "string" && raw.trim() !== "") return "env";

  return resolveRegisteredLive2DModel(
    process.env.NEXT_PUBLIC_LIVE2D_MODEL_ID,
  ).modelSource;
}
