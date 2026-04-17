import type { PcmCaptureErrorDetail } from "@/lib/pcmCapture";

function extractErrorName(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const value = (error as { name?: unknown }).name;
  return typeof value === "string" ? value : "";
}

export function getMicAccessErrorMessage(error: unknown): string {
  const name = extractErrorName(error);
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "麦克风权限未开启";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "未检测到可用麦克风";
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return "麦克风被占用或设备异常，请重新开启";
    case "OverconstrainedError":
      return "当前麦克风配置不可用，请切换设备后重试";
    default:
      return "无法访问麦克风";
  }
}

export function getMicCaptureFaultMessage(detail: PcmCaptureErrorDetail): string {
  switch (detail.reason) {
    case "track-ended":
      return "麦克风已断开，请重新开启";
    case "processor-error":
      return "音频采集处理异常，请重新开启麦克风";
    case "context-create-failed":
      return "音频上下文初始化失败，请重新开启麦克风";
    case "context-resume-failed":
      return "音频设备恢复失败，请重新开启麦克风";
    case "context-closed":
    case "context-not-running":
    default:
      return "音频设备异常，请重新开启麦克风";
  }
}
