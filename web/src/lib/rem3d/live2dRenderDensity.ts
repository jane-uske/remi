export function resolveLive2DRendererResolution(
  devicePixelRatio: number | undefined,
): number {
  if (!Number.isFinite(devicePixelRatio) || !devicePixelRatio || devicePixelRatio <= 0) {
    return 1;
  }
  return Math.min(Math.max(devicePixelRatio, 1), 2);
}
