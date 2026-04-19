export type Live2DStageFitInput = {
  containerWidth: number;
  containerHeight: number;
  boundsWidth: number;
  boundsHeight: number;
};

export type Live2DStageFit = {
  scale: number;
  x: number;
  y: number;
};

export function computeLive2DStageFit({
  containerWidth,
  containerHeight,
  boundsWidth,
  boundsHeight,
}: Live2DStageFitInput): Live2DStageFit {
  const width = containerWidth || 320;
  const height = containerHeight || 360;
  const narrowStage = width < 720;
  const widthFactor = narrowStage ? 1.52 : 0.8;
  const heightFactor = narrowStage ? 1.08 : 0.94;
  const scale = Math.min(
    (width * widthFactor) / Math.max(boundsWidth, 1),
    (height * heightFactor) / Math.max(boundsHeight, 1),
  );

  return {
    scale,
    x: width / 2,
    y: height * (narrowStage ? 1.05 : 0.98),
  };
}
