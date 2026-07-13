export type SceneId = 'rift' | 'chrome' | 'particles';
export type AspectId = '16:9' | '1:1' | '9:16';

export interface VisualParams {
  intensity: number;
  beatSensitivity: number;
  motionSpeed: number;
  depth: number;
  glow: number;
  chromatic: number;
  cameraMotion: number;
}

export const DEFAULT_PARAMS: VisualParams = {
  intensity: 0.65,
  beatSensitivity: 0.55,
  motionSpeed: 0.5,
  depth: 0.6,
  glow: 0.5,
  chromatic: 0.35,
  cameraMotion: 0.55,
};

export interface ParamDef {
  key: keyof VisualParams;
  label: string;
  hint: string;
}

export const PARAM_DEFS: ParamDef[] = [
  { key: 'intensity', label: 'Effect Intensity', hint: 'Overall strength of audio-reactive motion' },
  { key: 'beatSensitivity', label: 'Beat Sensitivity', hint: 'How easily kicks trigger impacts' },
  { key: 'motionSpeed', label: 'Motion Speed', hint: 'Tempo of ambient animation' },
  { key: 'depth', label: 'Depth', hint: 'Parallax and layer separation' },
  { key: 'glow', label: 'Glow', hint: 'Bloom around bright areas' },
  { key: 'chromatic', label: 'Chromatic Aberration', hint: 'RGB fringe on transients' },
  { key: 'cameraMotion', label: 'Camera Motion', hint: 'Slow drifting camera movement' },
];

/** Per-frame audio analysis snapshot. Mutated in place — never store references across frames. */
export interface AudioFrame {
  /** overall energy 0..1, smoothed */
  level: number;
  /** low band (kick/bass) 0..1, smoothed */
  low: number;
  /** mid band 0..1, smoothed */
  mid: number;
  /** high band 0..1, smoothed */
  high: number;
  /** beat pulse envelope: jumps to 1 on detected beat, decays exponentially */
  beat: number;
  /** monotonically increasing count of detected beats */
  beatCount: number;
  /** true only on the frame a beat was detected */
  beatHit: boolean;
  /** raw frequency spectrum (byte values) */
  spectrum: Uint8Array;
  playing: boolean;
}

export interface Preset {
  id: string;
  name: string;
  scene: SceneId;
  params: VisualParams;
  createdAt: number;
}

export type ExportStatus = 'idle' | 'recording' | 'finishing';

export interface ExportResult {
  url: string;
  sizeBytes: number;
  seconds: number;
  mimeType: string;
}

export interface Toast {
  id: number;
  kind: 'error' | 'info' | 'success';
  text: string;
}

export interface AppState {
  booted: boolean;
  webglError: string | null;
  scene: SceneId;
  aspect: AspectId;
  params: VisualParams;
  playing: boolean;
  /** true until the user has provided the first gesture that unlocks audio */
  needsGesture: boolean;
  imageName: string;
  imageDims: string;
  imageThumb: string | null;
  audioName: string;
  audioDuration: number;
  loadingImage: boolean;
  loadingAudio: boolean;
  exportStatus: ExportStatus;
  exportProgress: number;
  exportSeconds: 5 | 10;
  lastExport: ExportResult | null;
  presets: Preset[];
  toasts: Toast[];
  dragOver: boolean;
}

export const RENDER_SIZES: Record<AspectId, [number, number]> = {
  '16:9': [1280, 720],
  '1:1': [960, 960],
  '9:16': [720, 1280],
};

export const SCENE_LABELS: Record<SceneId, string> = {
  rift: 'Dimension Rift',
  chrome: 'Liquid Chrome',
  particles: 'Particle Bloom',
};
