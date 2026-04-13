import { RemVrmViewer } from "./vrmViewer";
import type { VrmViewerState } from "./vrmViewer";
import type {
  RemiState,
  RemiTurnState,
  AvatarActionCommand,
  AvatarEngine,
  AvatarModelPreset,
  LipSignal,
  AvatarFrameState,
  AvatarIntent,
} from "@/types/avatar";

export type CreateAvatarRuntimeOptions = {
  engine?: AvatarEngine;
  modelPreset?: AvatarModelPreset;
  modelUrl?: string;
  onStateChange?: (state: VrmViewerState, error?: string) => void;
};

export interface AvatarRuntimeAdapter {
  setEmotion(emotion: string): void;
  setState(state: RemiState): void;
  setTurnState(state: RemiTurnState): void;
  setIntent(intent: AvatarIntent | null): void;
  setFrame(frame: AvatarFrameState | null): void;
  playAction(action: AvatarActionCommand): void;
  setLipSignal(signal: LipSignal): void;
  load(): void;
  resize(): void;
  dispose(): void;
}

export function createAvatarRuntime(
  container: HTMLElement,
  options?: CreateAvatarRuntimeOptions
): AvatarRuntimeAdapter {
  let lipSignalRef: LipSignal = { envelope: 0, active: false, viseme: null };

  const viewer = new RemVrmViewer(container, {
    modelUrl: options?.modelUrl,
    onStateChange: options?.onStateChange,
    getLipEnvelope: () => lipSignalRef.envelope,
    getVoiceActive: () => lipSignalRef.active,
    getLipViseme: () => lipSignalRef.viseme ?? null,
  });

  return {
    setEmotion(emotion: string): void {
      viewer.setEmotion(emotion);
    },

    setState(state: RemiState): void {
      viewer.setState(state);
    },

    setTurnState(state: RemiTurnState): void {
      viewer.setTurnState(state);
    },

    setIntent(intent: AvatarIntent | null): void {
      viewer.setIntent(intent);
    },

    setFrame(frame: AvatarFrameState | null): void {
      viewer.setFrame(frame);
    },

    playAction(action: AvatarActionCommand): void {
      viewer.playAction(action.action, action.intensity || 0.6, action.duration || 700);
    },

    setLipSignal(signal: LipSignal): void {
      lipSignalRef = signal;
    },

    load(): void {
      viewer.startLoop();
    },

    resize(): void {
      viewer.resize();
    },

    dispose(): void {
      viewer.dispose();
    },
  };
}
