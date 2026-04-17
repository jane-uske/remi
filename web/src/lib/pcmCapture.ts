/**
 * Capture raw PCM Int16 mono 16 kHz from the microphone.
 *
 * Uses AudioWorklet for stable off-main-thread capture, then applies
 * low-pass + linear-resample to 16 kHz and emits fixed-size PCM frames.
 */

const TARGET_RATE = 16000;
const TARGET_FRAME_SAMPLES = 320; // 20 ms @ 16 kHz
const WORKLET_URL = "/audio/pcm-capture-worklet.js";
const CONTEXT_RECOVERY_GRACE_MS = 420;

export type PcmCaptureErrorReason =
  | "context-closed"
  | "context-create-failed"
  | "context-not-running"
  | "context-resume-failed"
  | "processor-error"
  | "track-ended";

export interface PcmCaptureErrorDetail {
  reason: PcmCaptureErrorReason;
  state?: string;
  message?: string;
}

export interface PcmCapture {
  stop: () => void;
  sampleRate: number;
}

export interface PcmCaptureOptions {
  onStateChange?: (state: string) => void;
  onError?: (detail: PcmCaptureErrorDetail) => void;
}

export function isRecoverableAudioContextState(state: string): boolean {
  return state === "suspended" || state === "interrupted";
}

export async function startPcmCapture(
  stream: MediaStream,
  onChunk: (pcm16: ArrayBuffer) => void,
  options: PcmCaptureOptions = {},
): Promise<PcmCapture> {
  let ctx: AudioContext;
  try {
    ctx = new AudioContext();
  } catch (error) {
    stream.getTracks().forEach((t) => t.stop());
    options.onError?.({
      reason: "context-create-failed",
      message: error instanceof Error ? error.message : String(error),
    });
    throw error instanceof Error ? error : new Error("AudioContext creation failed");
  }
  let stopped = false;
  let recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  let recoveryInFlight = false;
  const tracks = stream.getAudioTracks();
  const clearRecoveryTimer = () => {
    if (recoveryTimer) {
      clearTimeout(recoveryTimer);
      recoveryTimer = null;
    }
  };
  const cleanupInitFailure = async () => {
    clearRecoveryTimer();
    for (const track of tracks) {
      track.removeEventListener("ended", handleTrackEnded);
    }
    stream.getTracks().forEach((t) => t.stop());
    ctx.onstatechange = null;
    if (ctx.state !== "closed") {
      try {
        await ctx.close();
      } catch {
        /* ignore */
      }
    }
  };
  const reportError = (
    reason: Exclude<PcmCaptureErrorReason, "context-create-failed">,
    message?: string,
  ) => {
    if (stopped) return;
    options.onError?.({
      reason,
      state: String(ctx.state),
      message,
    });
  };
  const handleTrackEnded = () => reportError("track-ended");
  for (const track of tracks) {
    track.addEventListener("ended", handleTrackEnded);
  }
  const tryRecoverContext = async () => {
    if (stopped || recoveryInFlight) return;
    recoveryInFlight = true;
    try {
      if (ctx.state === "running" || ctx.state === "closed") return;
      try {
        await ctx.resume();
      } catch (error) {
        reportError(
          "context-resume-failed",
          error instanceof Error ? error.message : String(error),
        );
        return;
      }
      const resumedState = String(ctx.state);
      if (resumedState !== "running" && resumedState !== "closed") {
        reportError("context-not-running", `unexpected-state:${resumedState}`);
      }
    } finally {
      recoveryInFlight = false;
    }
  };

  if (ctx.state !== "running") {
    try {
      await ctx.resume();
    } catch (error) {
      reportError(
        "context-resume-failed",
        error instanceof Error ? error.message : String(error),
      );
      await cleanupInitFailure();
      throw error instanceof Error ? error : new Error("AudioContext resume failed");
    }
  }
  if (ctx.state !== "running") {
    reportError("context-resume-failed", `unexpected-state:${ctx.state}`);
    await cleanupInitFailure();
    throw new Error(`AudioContext did not enter running state: ${ctx.state}`);
  }

  ctx.onstatechange = () => {
    if (stopped) return;
    const nextState = String(ctx.state);
    options.onStateChange?.(nextState);
    clearRecoveryTimer();
    if (nextState === "closed") {
      reportError("context-closed");
      return;
    }
    if (nextState === "running") {
      return;
    }
    if (isRecoverableAudioContextState(nextState)) {
      recoveryTimer = setTimeout(() => {
        recoveryTimer = null;
        void tryRecoverContext();
      }, CONTEXT_RECOVERY_GRACE_MS);
      return;
    }
    if (nextState !== "running") {
      reportError("context-not-running", `unexpected-state:${nextState}`);
    }
  };

  let source: MediaStreamAudioSourceNode;
  let processor: AudioWorkletNode;
  try {
    source = ctx.createMediaStreamSource(stream);
    await ctx.audioWorklet.addModule(WORKLET_URL);
    processor = new AudioWorkletNode(ctx, "remi-pcm-capture-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
      channelCountMode: "explicit",
    });
  } catch (error) {
    reportError("processor-error", error instanceof Error ? error.message : String(error));
    await cleanupInitFailure();
    throw error instanceof Error ? error : new Error("Failed to initialize PCM capture");
  }
  const nativeRate = ctx.sampleRate;
  const state = createResampleState(nativeRate, TARGET_RATE);

  processor.onprocessorerror = () => {
    reportError("processor-error");
  };

  processor.port.onmessage = (ev: MessageEvent<Float32Array>) => {
    const input = ev.data;
    if (!input || input.length === 0 || stopped) return;
    const filtered = lowPass(input, state);
    const frames = resampleToPcm16(filtered, state);
    for (const frame of frames) onChunk(frame);
  };

  source.connect(processor);
  options.onStateChange?.(String(ctx.state));

  return {
    sampleRate: TARGET_RATE,
    stop() {
      if (stopped) return;
      stopped = true;
      clearRecoveryTimer();
      processor.port.onmessage = null;
      processor.onprocessorerror = null;
      ctx.onstatechange = null;
      try {
        processor.disconnect();
      } catch {
        /* ignore */
      }
      try {
        source.disconnect();
      } catch {
        /* ignore */
      }
      for (const track of tracks) {
        track.removeEventListener("ended", handleTrackEnded);
      }
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
    },
  };
}

type ResampleState = {
  step: number;
  samplePos: number;
  sampleBuffer: Float32Array;
  pendingPcm: number[];
  lpAlpha: number;
  lpPrev: number;
};

function createResampleState(fromRate: number, toRate: number): ResampleState {
  const cutoffHz = Math.min(toRate * 0.45, fromRate * 0.45);
  const dt = 1 / fromRate;
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const lpAlpha = dt / (rc + dt);
  return {
    step: fromRate / toRate,
    samplePos: 0,
    sampleBuffer: new Float32Array(0),
    pendingPcm: [],
    lpAlpha,
    lpPrev: 0,
  };
}

function lowPass(input: Float32Array, state: ResampleState): Float32Array {
  const out = new Float32Array(input.length);
  let prev = state.lpPrev;
  for (let i = 0; i < input.length; i++) {
    prev += state.lpAlpha * (input[i] - prev);
    out[i] = prev;
  }
  state.lpPrev = prev;
  return out;
}

function appendSamples(
  prev: Float32Array,
  next: Float32Array,
): Float32Array {
  if (prev.length === 0) return next;
  const out = new Float32Array(prev.length + next.length);
  out.set(prev);
  out.set(next, prev.length);
  return out;
}

function resampleToPcm16(
  input: Float32Array,
  state: ResampleState,
): ArrayBuffer[] {
  state.sampleBuffer = appendSamples(state.sampleBuffer, input);
  const frames: ArrayBuffer[] = [];
  const src = state.sampleBuffer;
  while (state.samplePos + 1 < src.length) {
    const i0 = Math.floor(state.samplePos);
    const frac = state.samplePos - i0;
    const a = src[i0];
    const b = src[i0 + 1];
    const s = a + (b - a) * frac;
    const clamped = Math.max(-1, Math.min(1, s));
    const pcm = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    state.pendingPcm.push(pcm | 0);
    state.samplePos += state.step;

    while (state.pendingPcm.length >= TARGET_FRAME_SAMPLES) {
      const frame = state.pendingPcm.splice(0, TARGET_FRAME_SAMPLES);
      const buf = new ArrayBuffer(TARGET_FRAME_SAMPLES * 2);
      const view = new DataView(buf);
      for (let n = 0; n < TARGET_FRAME_SAMPLES; n++) {
        view.setInt16(n * 2, frame[n], true);
      }
      frames.push(buf);
    }
  }
  const drop = Math.max(0, Math.floor(state.samplePos) - 1);
  if (drop > 0) {
    state.sampleBuffer = state.sampleBuffer.slice(drop);
    state.samplePos -= drop;
  }
  return frames;
}
