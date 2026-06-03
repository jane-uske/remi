import type {
  RemiState,
  RemiTurnState,
  AvatarActionCommand,
  AvatarEngine,
  AvatarModelPreset,
  LipSignal,
  AvatarFrameState,
  AvatarIntent,
  AvatarRuntimeLoadState,
} from "@/types/avatar";
import type { ConversationPerformanceModel } from "@/lib/presence/conversationPerformanceModel";
import type { AvatarRenderModel } from "@/runtime/avatarRenderModel";
import { RemVrmViewer } from "./vrmViewer";
import { RemLive2DViewer } from "./live2dViewer";

export type CreateAvatarRuntimeOptions = {
  engine?: AvatarEngine;
  modelPreset?: AvatarModelPreset;
  modelId?: string;
  modelUrl?: string;
  onStateChange?: (state: AvatarRuntimeLoadState, error?: string) => void;
};

export interface AvatarRuntimeAdapter {
  setEmotion(emotion: string): void;
  setState(state: RemiState): void;
  setTurnState(state: RemiTurnState): void;
  setIntent(intent: AvatarIntent | null): void;
  setFrame(frame: AvatarFrameState | null): void;
  setRenderModel(renderModel: AvatarRenderModel | null): void;
  setPerformanceModel(model: ConversationPerformanceModel | null): void;
  playAction(action: AvatarActionCommand): void;
  setLipSignal(signal: LipSignal): void;
  load(): void;
  resize(): void;
  dispose(): void;
}

type AvatarRuntimeViewer = {
  setEmotion(emotion: string): void;
  setState(state: RemiState): void;
  setTurnState(state: RemiTurnState): void;
  setIntent(intent: AvatarIntent | null): void;
  setFrame(frame: AvatarFrameState | null): void;
  setRenderModel?(renderModel: AvatarRenderModel | null): void;
  setPerformanceModel?(model: ConversationPerformanceModel | null): void;
  playAction(action: AvatarActionCommand): void;
  setLipSignal?(signal: LipSignal): void;
  load(): void;
  resize(): void;
  dispose(): void;
};

type AvatarRuntimeFactoryMap = {
  [K in AvatarEngine]: (
    container: HTMLElement,
    options?: CreateAvatarRuntimeOptions,
  ) => AvatarRuntimeViewer;
};

export function createAvatarRuntime(
  container: HTMLElement,
  options?: CreateAvatarRuntimeOptions
): AvatarRuntimeAdapter {
  let lipSignalRef: LipSignal = { envelope: 0, active: false, viseme: null };
  const runtime = createAvatarRuntimeWithFactories(container, options, {
    vrm: (host, runtimeOptions) => {
      const viewer = new RemVrmViewer(host, {
        modelUrl: runtimeOptions?.modelUrl,
        onStateChange: runtimeOptions?.onStateChange,
        getLipEnvelope: () => lipSignalRef.envelope,
        getVoiceActive: () => lipSignalRef.active,
        getLipViseme: () => lipSignalRef.viseme ?? null,
      });
      return {
        setEmotion: (emotion) => viewer.setEmotion(emotion),
        setState: (state) => viewer.setState(state),
        setTurnState: (state) => viewer.setTurnState(state),
        setIntent: (intent) => viewer.setIntent(intent),
        setFrame: (frame) => viewer.setFrame(frame),
        setRenderModel: () => {},
        setPerformanceModel: () => {},
        playAction: (action) =>
          viewer.playAction(
            action.action,
            action.intensity || 0.6,
            action.duration || 700,
          ),
        load: () => viewer.startLoop(),
        resize: () => viewer.resize(),
        dispose: () => viewer.dispose(),
      };
    },
    live2d: (host, runtimeOptions) => {
      return new RemLive2DViewer(host, {
        modelId: runtimeOptions?.modelId,
        modelUrl: runtimeOptions?.modelUrl,
        onStateChange: runtimeOptions?.onStateChange,
        getLipEnvelope: () => lipSignalRef.envelope,
        getVoiceActive: () => lipSignalRef.active,
        getLipViseme: () => lipSignalRef.viseme ?? null,
      });
    },
  });

  return {
    ...runtime,
    setLipSignal(signal: LipSignal): void {
      lipSignalRef = signal;
      runtime.setLipSignal(signal);
    },
  };
}

export function createAvatarRuntimeWithFactories(
  container: HTMLElement,
  options: CreateAvatarRuntimeOptions | undefined,
  factories: AvatarRuntimeFactoryMap,
): AvatarRuntimeAdapter {
  const engine = options?.engine ?? "vrm";
  const viewer = factories[engine](container, options);

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

    setRenderModel(renderModel: AvatarRenderModel | null): void {
      viewer.setRenderModel?.(renderModel);
    },

    setPerformanceModel(model: ConversationPerformanceModel | null): void {
      viewer.setPerformanceModel?.(model);
    },

    playAction(action: AvatarActionCommand): void {
      viewer.playAction(action);
    },

    setLipSignal(signal: LipSignal): void {
      viewer.setLipSignal?.(signal);
    },

    load(): void {
      viewer.load();
    },

    resize(): void {
      viewer.resize();
    },

    dispose(): void {
      viewer.dispose();
    },
  };
}
