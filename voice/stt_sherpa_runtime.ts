import fs from "fs";
import path from "path";

import { createLogger } from "../infra/logger";
import { resamplePcm16MonoLinear } from "../server/session/audio_resample";
import type {
  ActiveStreamingSttSession,
  StreamingSttProvider,
  StreamingTranscriptFinal,
  StreamingTranscriptHandlers,
  StreamingTranscriptPartial,
} from "./stt_incremental_types";

export type SherpaSttProvider = "sherpa-onnx";

export type SherpaSttConfig = {
  enabled: boolean;
  provider: SherpaSttProvider;
  modelDir: string;
  tokens: string;
  encoder: string;
  decoder: string;
  joiner: string;
  sampleRate: number;
  featureDim: number;
  numThreads: number;
  providerName: "cpu";
  decodingMethod: "greedy_search" | "modified_beam_search";
  maxActivePaths: number;
  enableEndpoint: boolean;
  rule1MinTrailingSilence: number;
  rule2MinTrailingSilence: number;
  rule3MinUtteranceLength: number;
};

type SherpaWaveform = {
  samples: Float32Array;
  sampleRate: number;
};

type SherpaStreamLike = {
  acceptWaveform(waveform: SherpaWaveform): void;
  inputFinished(): void;
};

type SherpaResultLike = {
  text?: string;
};

type SherpaRecognizerLike = {
  createStream(): SherpaStreamLike;
  isReady(stream: SherpaStreamLike): boolean;
  decode(stream: SherpaStreamLike): void;
  isEndpoint(stream: SherpaStreamLike): boolean;
  reset(stream: SherpaStreamLike): void;
  getResult(stream: SherpaStreamLike): SherpaResultLike;
};

type SherpaRecognizerConfig = {
  featConfig: {
    sampleRate: number;
    featureDim: number;
  };
  modelConfig: {
    transducer: {
      encoder: string;
      decoder: string;
      joiner: string;
    };
    tokens: string;
    numThreads: number;
    provider: "cpu";
  };
  decodingMethod: "greedy_search" | "modified_beam_search";
  maxActivePaths: number;
  enableEndpoint: boolean | number;
  rule1MinTrailingSilence: number;
  rule2MinTrailingSilence: number;
  rule3MinUtteranceLength: number;
};

type SherpaRuntimeDeps = {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  existsSync?: (filePath: string) => boolean;
  createRecognizer?: (config: SherpaRecognizerConfig) => SherpaRecognizerLike;
  logger?: ReturnType<typeof createLogger>;
  scheduleDecode?: (fn: () => void) => void;
};

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;
  return normalized !== "0" && normalized !== "false";
}

function parseFinite(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getIncrementalProvider(env: NodeJS.ProcessEnv): string {
  return (
    env.stt_incremental_provider ??
    env.STT_INCREMENTAL_PROVIDER ??
    env.stt_provider ??
    ""
  )
    .trim()
    .toLowerCase();
}

function defaultSherpaModelDir(cwd: string): string {
  return path.resolve(
    cwd,
    "models",
    "sherpa-onnx-streaming-zipformer-small-bilingual-zh-en-2023-02-16",
  );
}

function pickExisting(candidates: string[], existsSync: (filePath: string) => boolean): string {
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

export function readSherpaSttConfig(
  env: NodeJS.ProcessEnv = process.env,
  deps: Pick<SherpaRuntimeDeps, "cwd" | "existsSync"> = {},
): SherpaSttConfig {
  const existsSync = deps.existsSync ?? fs.existsSync;
  const cwd = deps.cwd ?? process.cwd();
  const providerRaw = getIncrementalProvider(env);
  const provider: SherpaSttProvider = "sherpa-onnx";
  const enabled =
    providerRaw === provider &&
    parseBoolean(env.REMI_STREAMING_STT_ENABLED ?? env.STT_STREAMING_ENABLED, false);
  const modelDir = (
    env.STT_SHERPA_MODEL_DIR ??
    env.stt_sherpa_model_dir ??
    defaultSherpaModelDir(cwd)
  ).trim();
  const tokens = (
    env.STT_SHERPA_TOKENS ??
    env.stt_sherpa_tokens ??
    path.join(modelDir, "tokens.txt")
  ).trim();
  const encoder = pickExisting(
    [
      (env.STT_SHERPA_ENCODER ??
        env.stt_sherpa_encoder ??
        path.join(modelDir, "encoder-epoch-99-avg-1.int8.onnx")).trim(),
      path.join(modelDir, "encoder-epoch-99-avg-1.onnx"),
    ],
    existsSync,
  );
  const decoder = pickExisting(
    [
      (env.STT_SHERPA_DECODER ??
        env.stt_sherpa_decoder ??
        path.join(modelDir, "decoder-epoch-99-avg-1.onnx")).trim(),
      path.join(modelDir, "decoder-epoch-99-avg-1.int8.onnx"),
    ],
    existsSync,
  );
  const joiner = pickExisting(
    [
      (env.STT_SHERPA_JOINER ??
        env.stt_sherpa_joiner ??
        path.join(modelDir, "joiner-epoch-99-avg-1.int8.onnx")).trim(),
      path.join(modelDir, "joiner-epoch-99-avg-1.onnx"),
    ],
    existsSync,
  );

  return {
    enabled,
    provider,
    modelDir,
    tokens,
    encoder,
    decoder,
    joiner,
    sampleRate: Math.max(8_000, Math.floor(parseFinite(env.STT_SHERPA_SAMPLE_RATE, 16_000))),
    featureDim: Math.max(32, Math.floor(parseFinite(env.STT_SHERPA_FEATURE_DIM, 80))),
    numThreads: Math.max(1, Math.floor(parseFinite(env.STT_SHERPA_NUM_THREADS, 2))),
    providerName: "cpu",
    decodingMethod:
      ((env.STT_SHERPA_DECODING_METHOD ?? "greedy_search").trim().toLowerCase() ===
      "modified_beam_search"
        ? "modified_beam_search"
        : "greedy_search"),
    maxActivePaths: Math.max(1, Math.floor(parseFinite(env.STT_SHERPA_MAX_ACTIVE_PATHS, 4))),
    enableEndpoint: parseBoolean(env.STT_SHERPA_ENABLE_ENDPOINT, true),
    rule1MinTrailingSilence: Math.max(
      0,
      parseFinite(env.STT_SHERPA_RULE1_MIN_TRAILING_SILENCE, 1.2),
    ),
    rule2MinTrailingSilence: Math.max(
      0,
      parseFinite(env.STT_SHERPA_RULE2_MIN_TRAILING_SILENCE, 0.6),
    ),
    rule3MinUtteranceLength: Math.max(
      0,
      parseFinite(env.STT_SHERPA_RULE3_MIN_UTTERANCE_LENGTH, 12),
    ),
  };
}

function defaultCreateRecognizer(config: SherpaRecognizerConfig): SherpaRecognizerLike {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { OnlineRecognizer } = require("sherpa-onnx-node");
  return new OnlineRecognizer(config);
}

function pcm16ToFloat32(pcm: Buffer): Float32Array {
  const sampleCount = Math.floor(pcm.length / 2);
  const samples = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    samples[i] = pcm.readInt16LE(i * 2) / 32768;
  }
  return samples;
}

class LiveSherpaSession implements ActiveStreamingSttSession {
  private readonly provider: StreamingSttProvider = "sherpa-onnx";
  private readonly recognizer: SherpaRecognizerLike;
  private readonly stream: SherpaStreamLike;
  private readonly handlers: StreamingTranscriptHandlers;
  private readonly config: SherpaSttConfig;
  private readonly scheduleDecode: (fn: () => void) => void;
  private closed = false;
  private decodeScheduled = false;
  private sequence = 0;
  private utteranceIndex = 1;
  private currentItemId = this.nextItemId();
  private lastText = "";

  constructor(
    recognizer: SherpaRecognizerLike,
    config: SherpaSttConfig,
    handlers: StreamingTranscriptHandlers,
    scheduleDecode: (fn: () => void) => void,
  ) {
    this.recognizer = recognizer;
    this.stream = recognizer.createStream();
    this.handlers = handlers;
    this.config = config;
    this.scheduleDecode = scheduleDecode;
  }

  appendPcm(pcm: Buffer, sampleRate: number): void {
    if (this.closed || pcm.length === 0) return;
    const safeRate =
      Number.isFinite(sampleRate) && sampleRate > 0
        ? Math.floor(sampleRate)
        : this.config.sampleRate;
    const nextPcm =
      safeRate === this.config.sampleRate
        ? pcm
        : resamplePcm16MonoLinear(pcm, safeRate, this.config.sampleRate);
    const samples = pcm16ToFloat32(nextPcm);
    if (samples.length === 0) return;
    this.stream.acceptWaveform({
      samples,
      sampleRate: this.config.sampleRate,
    });
    this.maybeScheduleDecode();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      this.stream.inputFinished();
      this.flushDecode();
      this.finalizeCurrentResult();
    } catch (error) {
      this.handlers.onError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private maybeScheduleDecode(): void {
    if (this.decodeScheduled || this.closed) return;
    this.decodeScheduled = true;
    this.scheduleDecode(() => {
      this.decodeScheduled = false;
      if (this.closed) return;
      try {
        this.flushDecode();
      } catch (error) {
        this.handlers.onError(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private flushDecode(): void {
    while (this.recognizer.isReady(this.stream)) {
      this.recognizer.decode(this.stream);
      this.publishPartialIfNeeded();
      if (this.recognizer.isEndpoint(this.stream)) {
        this.finalizeCurrentResult();
      }
    }
  }

  private publishPartialIfNeeded(): void {
    const nextText = String(this.recognizer.getResult(this.stream)?.text ?? "").trim();
    if (!nextText || nextText === this.lastText) return;
    this.lastText = nextText;
    this.sequence += 1;
    const event: StreamingTranscriptPartial = {
      content: nextText,
      itemId: this.currentItemId,
      provider: this.provider,
      sequence: this.sequence,
      stability: "interim",
    };
    this.handlers.onPartial(event);
  }

  private finalizeCurrentResult(): void {
    const finalText =
      this.lastText || String(this.recognizer.getResult(this.stream)?.text ?? "").trim();
    if (finalText) {
      this.sequence += 1;
      const event: StreamingTranscriptFinal = {
        content: finalText,
        itemId: this.currentItemId,
        provider: this.provider,
        sequence: this.sequence,
        stability: "final",
      };
      this.handlers.onFinal(event);
    }
    this.lastText = "";
    this.recognizer.reset(this.stream);
    this.currentItemId = this.nextItemId();
  }

  private nextItemId(): string {
    const itemId = `sherpa_utt_${this.utteranceIndex}`;
    this.utteranceIndex += 1;
    return itemId;
  }
}

class SherpaSttRuntime {
  private readonly env: NodeJS.ProcessEnv;
  private readonly cwd: string;
  private readonly existsSync: (filePath: string) => boolean;
  private readonly createRecognizerImpl: (config: SherpaRecognizerConfig) => SherpaRecognizerLike;
  private readonly logger: ReturnType<typeof createLogger>;
  private readonly scheduleDecode: (fn: () => void) => void;

  constructor(deps: SherpaRuntimeDeps = {}) {
    this.env = deps.env ?? process.env;
    this.cwd = deps.cwd ?? process.cwd();
    this.existsSync = deps.existsSync ?? fs.existsSync;
    this.createRecognizerImpl = deps.createRecognizer ?? defaultCreateRecognizer;
    this.logger = deps.logger ?? createLogger("stt:sherpa");
    this.scheduleDecode = deps.scheduleDecode ?? ((fn) => setImmediate(fn));
  }

  canUseSherpa(): boolean {
    const config = readSherpaSttConfig(this.env, {
      cwd: this.cwd,
      existsSync: this.existsSync,
    });
    return (
      config.enabled &&
      [config.tokens, config.encoder, config.decoder, config.joiner].every((filePath) =>
        this.existsSync(filePath),
      )
    );
  }

  async createSession(handlers: StreamingTranscriptHandlers): Promise<ActiveStreamingSttSession> {
    const config = readSherpaSttConfig(this.env, {
      cwd: this.cwd,
      existsSync: this.existsSync,
    });
    if (!config.enabled) {
      throw new Error("sherpa-onnx streaming stt is disabled");
    }
    const missingFile = [config.tokens, config.encoder, config.decoder, config.joiner].find(
      (filePath) => !this.existsSync(filePath),
    );
    if (missingFile) {
      throw new Error(`STT 未配置：缺少 sherpa-onnx 模型文件 ${missingFile}`);
    }

    this.logger.info("[SherpaStt] create session", {
      modelDir: config.modelDir,
      sampleRate: config.sampleRate,
      numThreads: config.numThreads,
    });

    const recognizer = this.createRecognizerImpl({
      featConfig: {
        sampleRate: config.sampleRate,
        featureDim: config.featureDim,
      },
      modelConfig: {
        transducer: {
          encoder: config.encoder,
          decoder: config.decoder,
          joiner: config.joiner,
        },
        tokens: config.tokens,
        numThreads: config.numThreads,
        provider: config.providerName,
      },
      decodingMethod: config.decodingMethod,
      maxActivePaths: config.maxActivePaths,
      enableEndpoint: config.enableEndpoint,
      rule1MinTrailingSilence: config.rule1MinTrailingSilence,
      rule2MinTrailingSilence: config.rule2MinTrailingSilence,
      rule3MinUtteranceLength: config.rule3MinUtteranceLength,
    });

    return new LiveSherpaSession(recognizer, config, handlers, this.scheduleDecode);
  }
}

export function createSherpaSttRuntime(deps: SherpaRuntimeDeps = {}): SherpaSttRuntime {
  return new SherpaSttRuntime(deps);
}

export const sherpaSttRuntime = createSherpaSttRuntime();
