import type {
  AvatarActionCommand,
  AvatarFrameState,
  AvatarIntent,
  AvatarRuntimeLoadState,
  LipSignal,
  RemiState,
  RemiTurnState,
} from "@/types/avatar";
import type { ConversationPerformanceModel } from "@/lib/presence/conversationPerformanceModel";
import {
  getDefaultLive2DModelId,
  getDefaultLive2DModelUrl,
} from "@/lib/avatar/modelUrls";
import type { AvatarRenderModel } from "@/runtime/avatarRenderModel";
import { sampleLive2DMotionFrame } from "./live2dMotion";
import {
  resolveLive2DModelProfile,
  type Live2DModelProfile,
} from "./live2dModelProfile";
import {
  sampleLive2DLipCalibration,
  type Live2DLipCalibrationState,
} from "./live2dLipCalibration";
import { resolveLive2DRendererResolution } from "./live2dRenderDensity";
import { computeLive2DStageFit } from "./live2dStageFit";

const LIVE2D_CUBISM_CORE_SCRIPT_URL =
  process.env.NEXT_PUBLIC_LIVE2D_CUBISM_CORE_URL?.trim() ||
  "https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js";

let live2dBootstrapChain: Promise<void> = Promise.resolve();

type Live2DModelLike = {
  anchor: { set(x: number, y?: number): void };
  scale: { set(x: number, y?: number): void };
  x: number;
  y: number;
  rotation: number;
  width: number;
  height: number;
  interactive: boolean;
  buttonMode: boolean;
  internalModel?: {
    coreModel?: unknown;
  };
  focus(x: number, y: number, instant?: boolean): void;
  getLocalBounds?: () => { width: number; height: number };
  motion?(group: string, index?: number, priority?: number): Promise<boolean>;
  destroy(options?: { children?: boolean }): void;
};

type PixiApplicationLike = {
  view: HTMLCanvasElement;
  stage: {
    addChild(child: unknown): void;
    removeChild(child: unknown): void;
  };
  ticker: {
    add(fn: () => void): void;
    remove(fn: () => void): void;
  };
  renderer: {
    resolution?: number;
    resize(width: number, height: number): void;
  };
  destroy(removeView?: boolean, stageOptions?: { children?: boolean }): void;
};

type Live2DCubismCoreLike = {
  Memory?: {
    initializeAmountOfMemory?: (size?: number) => void;
  };
};

async function ensureScriptLoaded(
  src: string,
  checkLoaded: () => boolean,
  marker: string,
): Promise<void> {
  if (checkLoaded()) return;

  const existing = document.querySelector<HTMLScriptElement>(
    `script[data-remi-runtime="${marker}"]`,
  );
  if (existing) {
    if (existing.src && existing.src !== src) {
      existing.remove();
    } else {
    await new Promise<void>((resolve, reject) => {
      const onLoad = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error(`Failed to load ${marker}`));
      };
      const cleanup = () => {
        existing.removeEventListener("load", onLoad);
        existing.removeEventListener("error", onError);
      };
      existing.addEventListener("load", onLoad);
      existing.addEventListener("error", onError);
    });
    if (!checkLoaded()) {
      throw new Error(`${marker} script loaded without expected global`);
    }
    return;
    }
  }

  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.dataset.remiRuntime = marker;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${marker}`));
    document.head.appendChild(script);
  });

  if (!checkLoaded()) {
    throw new Error(`${marker} script loaded without expected global`);
  }
}

async function runWithLive2DBootstrapLock<T>(
  task: () => Promise<T>,
): Promise<T> {
  const previous = live2dBootstrapChain;
  let release!: () => void;
  live2dBootstrapChain = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    return await task();
  } finally {
    release();
  }
}

export class RemLive2DViewer {
  private readonly container: HTMLElement;
  private readonly onStateChange?: (s: AvatarRuntimeLoadState, err?: string) => void;
  private readonly getLipEnvelope?: () => number;
  private readonly getVoiceActive?: () => boolean;
  private readonly getLipViseme?: () => LipSignal["viseme"] | null;
  private runtimeState: AvatarRuntimeLoadState = "loading";
  private disposed = false;
  private loadStarted = false;
  private currentEmotion = "neutral";
  private remState: RemiState = "idle";
  private turnState: RemiTurnState = "confirmed_end";
  private currentIntent: AvatarIntent | null = null;
  private currentFrame: AvatarFrameState | null = null;
  private currentRenderModel: AvatarRenderModel | null = null;
  private currentPerformanceModel: ConversationPerformanceModel | null = null;
  private lipState: Live2DLipCalibrationState = {
    mouthOpen: 0,
    mouthForm: 0,
    lastUpdatedAtMs: 0,
  };
  private app: PixiApplicationLike | null = null;
  private model: Live2DModelLike | null = null;
  private readonly onTick = () => this.updateModelFrame();

  constructor(
    container: HTMLElement,
    options?: {
      modelId?: string;
      modelUrl?: string;
      onStateChange?: (s: AvatarRuntimeLoadState, err?: string) => void;
      getLipEnvelope?: () => number;
      getVoiceActive?: () => boolean;
      getLipViseme?: () => LipSignal["viseme"] | null;
    },
  ) {
    this.container = container;
    this.modelId = options?.modelId ?? getDefaultLive2DModelId();
    this.modelUrl = options?.modelUrl ?? getDefaultLive2DModelUrl();
    this.modelProfile = resolveLive2DModelProfile(options?.modelId);
    this.onStateChange = options?.onStateChange;
    this.getLipEnvelope = options?.getLipEnvelope;
    this.getVoiceActive = options?.getVoiceActive;
    this.getLipViseme = options?.getLipViseme;
  }

  private readonly modelId: string;
  private readonly modelUrl: string;
  private readonly modelProfile: Live2DModelProfile;

  private getRendererResolution(): number {
    if (typeof window === "undefined") return 1;
    return resolveLive2DRendererResolution(window.devicePixelRatio);
  }

  private syncCanvasDiagnostics(): void {
    const view = this.app?.view;
    if (!view) return;
    const resolution = this.app?.renderer.resolution ?? this.getRendererResolution();
    view.dataset.live2dResolution = String(resolution);
    view.dataset.live2dDpr = String(
      typeof window === "undefined" ? 1 : window.devicePixelRatio || 1,
    );
    view.style.width = "100%";
    view.style.height = "100%";
    view.style.imageRendering = "auto";
  }

  private setRuntimeState(next: AvatarRuntimeLoadState, error?: string): void {
    if (this.runtimeState === next && !error) return;
    this.runtimeState = next;
    this.onStateChange?.(next, error);
  }

  setEmotion(emotion: string): void {
    this.currentEmotion = emotion;
  }

  setState(state: RemiState): void {
    this.remState = state;
  }

  setTurnState(state: RemiTurnState): void {
    this.turnState = state;
  }

  setIntent(intent: AvatarIntent | null): void {
    this.currentIntent = intent;
  }

  setFrame(frame: AvatarFrameState | null): void {
    this.currentFrame = frame;
  }

  setRenderModel(renderModel: AvatarRenderModel | null): void {
    this.currentRenderModel = renderModel;
  }

  setPerformanceModel(model: ConversationPerformanceModel | null): void {
    this.currentPerformanceModel = model;
  }

  playAction(action: AvatarActionCommand): void {
    if (!this.model?.motion) return;
    const group =
      action.action === "wave" ? "TapBody" : action.action === "nod" ? "Idle" : null;
    if (!group) return;
    void this.model.motion(group).catch(() => {
      /* ignore unsupported motion group */
    });
  }

  setLipSignal(): void {
    // Pulled on demand from the getter so the viewer can sample it continuously.
  }

  load(): void {
    if (this.loadStarted || this.disposed) return;
    this.loadStarted = true;
    void this.bootstrap();
  }

  resize(): void {
    if (!this.app || !this.model) return;
    const resolution = this.getRendererResolution();
    if (typeof this.app.renderer.resolution === "number") {
      this.app.renderer.resolution = resolution;
    }
    this.app.renderer.resize(
      this.container.clientWidth || 320,
      this.container.clientHeight || 360,
    );
    this.syncCanvasDiagnostics();
    this.fitModel();
  }

  dispose(): void {
    this.disposed = true;
    if (this.app) {
      this.app.ticker.remove(this.onTick);
    }
    if (this.model && this.app) {
      this.app.stage.removeChild(this.model);
      this.model.destroy({ children: true });
    }
    this.model = null;
    if (this.app) {
      this.app.destroy(true, { children: true });
    }
    this.app = null;
  }

  private async bootstrap(): Promise<void> {
    if (typeof window === "undefined") {
      this.setRuntimeState("error", "Live2D only runs in the browser");
      return;
    }

    try {
      const PIXI = await import("pixi.js");
      (window as typeof window & { PIXI?: typeof PIXI }).PIXI = PIXI;
      await ensureScriptLoaded(
        LIVE2D_CUBISM_CORE_SCRIPT_URL,
        () =>
          Boolean(
            (
              window as typeof window & {
                Live2DCubismCore?: unknown;
              }
            ).Live2DCubismCore,
          ),
        "live2d-cubism-core",
      );
      const live2dCore = (
        window as typeof window & {
          Live2DCubismCore?: Live2DCubismCoreLike;
        }
      ).Live2DCubismCore;
      if (live2dCore && !live2dCore.Memory?.initializeAmountOfMemory) {
        live2dCore.Memory = {
          initializeAmountOfMemory: () => {
            /* Some redistributed Cubism core builds omit this optional memory hook. */
          },
        };
      }
      const { Live2DModel } = await import("pixi-live2d-display/cubism4");
      await runWithLive2DBootstrapLock(async () => {
        if (this.disposed) return;

        const application = new PIXI.Application({
          backgroundAlpha: 0,
          antialias: true,
          autoDensity: true,
          resolution: this.getRendererResolution(),
          resizeTo: this.container,
        }) as unknown as PixiApplicationLike;

        this.container.innerHTML = "";
        this.container.appendChild(application.view);
        this.syncCanvasDiagnostics();
        const model = (await Live2DModel.from(this.modelUrl, {
          autoHitTest: false,
          autoFocus: false,
          ticker: application.ticker,
        } as Record<string, unknown>)) as unknown as Live2DModelLike;

        if (this.disposed) {
          model.destroy({ children: true });
          application.destroy(true, { children: true });
          return;
        }

        model.anchor.set(0.5, 1);
        model.interactive = false;
        model.buttonMode = false;
        application.stage.addChild(model);
        application.ticker.add(this.onTick);

        this.app = application;
        this.model = model;
        this.fitModel();
        this.updateModelFrame();
        this.setRuntimeState("ready");
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to load Live2D model";
      console.error("[Live2D] bootstrap failed", error);
      if (error && typeof error === "object" && "cause" in error) {
        console.error("[Live2D] bootstrap failed cause", (error as { cause?: unknown }).cause);
      }
      this.setRuntimeState("error", message);
    }
  }

  private fitModel(): void {
    if (!this.model) return;
    const bounds =
      typeof this.model.getLocalBounds === "function"
        ? this.model.getLocalBounds()
        : { width: this.model.width || 1, height: this.model.height || 1 };
    const fit = computeLive2DStageFit({
      containerWidth: this.container.clientWidth || 320,
      containerHeight: this.container.clientHeight || 360,
      boundsWidth: bounds.width || 1,
      boundsHeight: bounds.height || 1,
    });
    this.model.scale.set(fit.scale, fit.scale);
    this.model.x = fit.x;
    this.model.y = fit.y;
  }

  private updateModelFrame(): void {
    if (!this.model || this.disposed) return;

    const nowMs = Date.now();
    const lipWeight = this.resolveLipWeight(nowMs);
    const motion = sampleLive2DMotionFrame({
      nowMs,
      lipWeight,
      emotion: this.currentEmotion,
      remState: this.remState,
      turnState: this.turnState,
      renderModel: this.currentRenderModel,
      avatarFrame: this.currentFrame,
      performanceModel: this.currentPerformanceModel,
    });
    const calibratedLip = sampleLive2DLipCalibration({
      nowMs,
      previous: this.lipState,
      profile: this.modelProfile,
      baseMouthOpen: motion.mouthOpen,
      baseMouthForm: motion.mouthForm,
      frameLipSync: this.currentFrame?.lipSync ?? null,
      frameLipAtMs:
        this.currentFrame?.lipSyncAtMs ?? this.currentFrame?.lipSync?.time ?? 0,
      envelope: this.getLipEnvelope?.() ?? 0,
      voiceActive: this.getVoiceActive?.() ?? false,
      viseme: this.getLipViseme?.() ?? null,
      performanceModel: this.currentPerformanceModel,
    });
    this.lipState = calibratedLip.state;

    this.model.focus(motion.focus.x, motion.focus.y, false);
    this.setCoreParameter(this.modelProfile.parameterIds.mouthOpen, calibratedLip.mouthOpen);
    this.setCoreParameter(this.modelProfile.parameterIds.mouthForm, calibratedLip.mouthForm);
    this.setCoreParameter(this.modelProfile.parameterIds.angleX, motion.angleX);
    this.setCoreParameter(this.modelProfile.parameterIds.angleY, motion.angleY);
    this.setCoreParameter(this.modelProfile.parameterIds.bodyAngleX, motion.bodyAngleX);
    this.setCoreParameter(this.modelProfile.parameterIds.eyeBallX, motion.focus.x * 22);
    this.setCoreParameter(this.modelProfile.parameterIds.eyeBallY, motion.focus.y * 22);
    this.setCoreParameter(this.modelProfile.parameterIds.eyeLOpen, motion.eyeOpen);
    this.setCoreParameter(this.modelProfile.parameterIds.eyeROpen, motion.eyeOpen);
  }

  private resolveLipWeight(nowMs: number): number {
    const frameLipSync = this.currentFrame?.lipSync;
    const frameLipAtMs = this.currentFrame?.lipSyncAtMs ?? frameLipSync?.time ?? 0;
    if (frameLipSync && nowMs - frameLipAtMs <= 220) {
      return Math.max(0, Math.min(1, frameLipSync.weight));
    }
    const envelope = this.getLipEnvelope?.() ?? 0;
    if (envelope > 0.02) return Math.max(0, Math.min(1, envelope * 1.1));
    const speaking = this.getVoiceActive?.() ?? false;
    if (speaking) return 0.14;
    const visemeWeight = this.getLipViseme?.()?.weight ?? 0;
    return Math.max(0, Math.min(1, visemeWeight));
  }

  private setCoreParameter(ids: string[], value: number): void {
    const coreModel = this.model?.internalModel?.coreModel as
      | {
          setParameterValueById?: (id: string, value: number, weight?: number) => void;
        }
      | undefined;
    if (!coreModel?.setParameterValueById) return;
    for (const id of ids) {
      try {
        coreModel.setParameterValueById(id, value, 1);
      } catch {
        // Some models simply won't expose every standard parameter; ignore that.
      }
    }
  }
}
