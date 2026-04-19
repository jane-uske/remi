export type PcmFrameAnalysis = {
  rms: number;
  peak: number;
  zcr: number;
  crest: number;
  activeRatio: number;
};

export type MicTxGateContext = {
  assistantSpeaking?: boolean;
};

export type MicTxGateFeedResult = {
  framesToSend: ArrayBuffer[];
  analysis: PcmFrameAnalysis;
  opened: boolean;
  closed: boolean;
  transmitting: boolean;
};

export type MicTxGateOptions = {
  preRollFrames?: number;
  minStartFrames?: number;
  stopFrames?: number;
  energyThreshold?: number;
  continueEnergyRatio?: number;
  maxZcr?: number;
  continueMaxZcr?: number;
  maxCrest?: number;
  continueMaxCrest?: number;
  minActiveRatio?: number;
  continueMinActiveRatio?: number;
  assistantStartFramesBoost?: number;
  assistantEnergyMultiplier?: number;
  assistantMinActiveRatioBoost?: number;
};

const DEFAULT_PRE_ROLL_FRAMES = 12;
const DEFAULT_MIN_START_FRAMES = 3;
const DEFAULT_STOP_FRAMES = 12;
const DEFAULT_ENERGY_THRESHOLD = 0.028;
const DEFAULT_CONTINUE_ENERGY_RATIO = 0.58;
const DEFAULT_MAX_ZCR = 0.28;
const DEFAULT_CONTINUE_MAX_ZCR = 0.48;
const DEFAULT_MAX_CREST = 16;
const DEFAULT_CONTINUE_MAX_CREST = 24;
const DEFAULT_MIN_ACTIVE_RATIO = 0.2;
const DEFAULT_CONTINUE_MIN_ACTIVE_RATIO = 0.14;
const DEFAULT_ASSISTANT_START_FRAMES_BOOST = 2;
const DEFAULT_ASSISTANT_ENERGY_MULTIPLIER = 1.28;
const DEFAULT_ASSISTANT_MIN_ACTIVE_RATIO_BOOST = 0.05;

function cloneBuffer(buf: ArrayBuffer): ArrayBuffer {
  return buf.slice(0);
}

export function analyzePcmFrame(buf: ArrayBuffer): PcmFrameAnalysis {
  const view = new DataView(buf);
  const sampleCount = Math.floor(buf.byteLength / 2);
  if (sampleCount <= 0) {
    return {
      rms: 0,
      peak: 0,
      zcr: 0,
      crest: 1,
      activeRatio: 0,
    };
  }

  let sumSq = 0;
  let peak = 0;
  let crossings = 0;
  let prevSample = view.getInt16(0, true) / 32768;
  const samples = new Float32Array(sampleCount);
  samples[0] = prevSample;
  peak = Math.abs(prevSample);
  sumSq += prevSample * prevSample;

  for (let i = 1; i < sampleCount; i++) {
    const sample = view.getInt16(i * 2, true) / 32768;
    samples[i] = sample;
    const abs = Math.abs(sample);
    if (abs > peak) peak = abs;
    sumSq += sample * sample;
    if ((prevSample >= 0 && sample < 0) || (prevSample < 0 && sample >= 0)) {
      crossings += 1;
    }
    prevSample = sample;
  }

  const rms = Math.sqrt(sumSq / sampleCount);
  const crest = rms < 1e-9 ? 1 : peak / rms;
  const activeFloor = Math.max(0.008, peak * 0.18);
  let activeSamples = 0;
  for (let i = 0; i < sampleCount; i++) {
    if (Math.abs(samples[i]) >= activeFloor) activeSamples += 1;
  }

  return {
    rms,
    peak,
    zcr: sampleCount > 1 ? crossings / (sampleCount - 1) : 0,
    crest,
    activeRatio: activeSamples / sampleCount,
  };
}

export class MicTxGate {
  private readonly preRollFrames: number;
  private readonly minStartFrames: number;
  private readonly stopFrames: number;
  private readonly energyThreshold: number;
  private readonly continueEnergyRatio: number;
  private readonly maxZcr: number;
  private readonly continueMaxZcr: number;
  private readonly maxCrest: number;
  private readonly continueMaxCrest: number;
  private readonly minActiveRatio: number;
  private readonly continueMinActiveRatio: number;
  private readonly assistantStartFramesBoost: number;
  private readonly assistantEnergyMultiplier: number;
  private readonly assistantMinActiveRatioBoost: number;

  private preRoll: ArrayBuffer[] = [];
  private transmitting = false;
  private speechCount = 0;
  private silentCount = 0;

  constructor(options: MicTxGateOptions = {}) {
    this.preRollFrames = options.preRollFrames ?? DEFAULT_PRE_ROLL_FRAMES;
    this.minStartFrames = options.minStartFrames ?? DEFAULT_MIN_START_FRAMES;
    this.stopFrames = options.stopFrames ?? DEFAULT_STOP_FRAMES;
    this.energyThreshold = options.energyThreshold ?? DEFAULT_ENERGY_THRESHOLD;
    this.continueEnergyRatio = options.continueEnergyRatio ?? DEFAULT_CONTINUE_ENERGY_RATIO;
    this.maxZcr = options.maxZcr ?? DEFAULT_MAX_ZCR;
    this.continueMaxZcr = options.continueMaxZcr ?? DEFAULT_CONTINUE_MAX_ZCR;
    this.maxCrest = options.maxCrest ?? DEFAULT_MAX_CREST;
    this.continueMaxCrest = options.continueMaxCrest ?? DEFAULT_CONTINUE_MAX_CREST;
    this.minActiveRatio = options.minActiveRatio ?? DEFAULT_MIN_ACTIVE_RATIO;
    this.continueMinActiveRatio =
      options.continueMinActiveRatio ?? DEFAULT_CONTINUE_MIN_ACTIVE_RATIO;
    this.assistantStartFramesBoost =
      options.assistantStartFramesBoost ?? DEFAULT_ASSISTANT_START_FRAMES_BOOST;
    this.assistantEnergyMultiplier =
      options.assistantEnergyMultiplier ?? DEFAULT_ASSISTANT_ENERGY_MULTIPLIER;
    this.assistantMinActiveRatioBoost =
      options.assistantMinActiveRatioBoost ?? DEFAULT_ASSISTANT_MIN_ACTIVE_RATIO_BOOST;
  }

  isTransmitting(): boolean {
    return this.transmitting;
  }

  reset(): void {
    this.preRoll = [];
    this.transmitting = false;
    this.speechCount = 0;
    this.silentCount = 0;
  }

  feed(frame: ArrayBuffer, context: MicTxGateContext = {}): MicTxGateFeedResult {
    const analysis = analyzePcmFrame(frame);
    this.preRoll.push(cloneBuffer(frame));
    if (this.preRoll.length > this.preRollFrames) {
      this.preRoll.splice(0, this.preRoll.length - this.preRollFrames);
    }

    if (!this.transmitting) {
      const assistantSpeaking = context.assistantSpeaking === true;
      const requiredStartFrames =
        this.minStartFrames + (assistantSpeaking ? this.assistantStartFramesBoost : 0);
      const startEnergyThreshold =
        this.energyThreshold * (assistantSpeaking ? this.assistantEnergyMultiplier : 1);
      const startActiveRatio =
        this.minActiveRatio + (assistantSpeaking ? this.assistantMinActiveRatioBoost : 0);
      const isSpeechStart =
        analysis.rms >= startEnergyThreshold &&
        analysis.zcr <= this.maxZcr &&
        analysis.crest <= this.maxCrest &&
        analysis.activeRatio >= startActiveRatio;

      this.speechCount = isSpeechStart ? this.speechCount + 1 : Math.max(0, this.speechCount - 1);

      if (this.speechCount >= requiredStartFrames) {
        this.transmitting = true;
        this.silentCount = 0;
        const framesToSend = this.preRoll;
        this.preRoll = [];
        return {
          framesToSend,
          analysis,
          opened: true,
          closed: false,
          transmitting: true,
        };
      }

      return {
        framesToSend: [],
        analysis,
        opened: false,
        closed: false,
        transmitting: false,
      };
    }

    const isSpeechContinue =
      analysis.rms >= this.energyThreshold * this.continueEnergyRatio &&
      analysis.zcr <= this.continueMaxZcr &&
      analysis.crest <= this.continueMaxCrest &&
      analysis.activeRatio >= this.continueMinActiveRatio;

    if (isSpeechContinue) {
      this.silentCount = 0;
    } else {
      this.silentCount += 1;
    }

    const closed = this.silentCount >= this.stopFrames;
    if (closed) {
      this.transmitting = false;
      this.speechCount = 0;
      this.silentCount = 0;
      this.preRoll = [];
    }

    return {
      framesToSend: [cloneBuffer(frame)],
      analysis,
      opened: false,
      closed,
      transmitting: this.transmitting,
    };
  }
}
