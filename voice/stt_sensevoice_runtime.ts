import fs from "fs";
import path from "path";

import { createLogger } from "../infra/logger";
import { resamplePcm16MonoLinear } from "../server/session/audio_resample";

/**
 * In-process SenseVoice (offline / non-streaming) STT via sherpa-onnx-node.
 *
 * Unlike the whisper-server path, this:
 *   - runs in-process (no separate HTTP server, no ffmpeg, no temp WAV files)
 *   - loads a tiny ~228MB int8 model that does NOT get killed/reloaded on a
 *     single request timeout (the whisper-server failure cascade root cause)
 *   - natively returns emotion (happy/sad/angry/…) and audio-event
 *     (laughter/cry/applause/…) labels alongside the transcript, which we feed
 *     into the LLM so Remi can react to the user's vocal tone.
 *
 * Decode runs on the libuv threadpool via `decodeAsync`, so the Node event loop
 * is never blocked while transcribing.
 */

const SENSEVOICE_TARGET_RATE = 16_000;

export type SenseVoiceSttConfig = {
  enabled: boolean;
  modelDir: string;
  model: string;
  tokens: string;
  language: string;
  useInverseTextNormalization: boolean;
  numThreads: number;
  debug: boolean;
};

export type SenseVoiceTranscript = {
  text: string;
  /** Normalized emotion token, e.g. "happy" | "sad" | "angry" | "neutral" | null. */
  emotion: string | null;
  /** Normalized audio-event token, e.g. "laughter" | "cry" | "applause" | null. */
  event: string | null;
  /** Detected language token from SenseVoice LID, e.g. "zh" | "en" | null. */
  lang: string | null;
};

type SenseVoiceResultLike = {
  text?: string;
  emotion?: string;
  event?: string;
  lang?: string;
};

type SenseVoiceStreamLike = {
  acceptWaveform(waveform: { samples: Float32Array; sampleRate: number }): void;
};

type SenseVoiceRecognizerLike = {
  createStream(): SenseVoiceStreamLike;
  decode(stream: SenseVoiceStreamLike): void;
  decodeAsync?(stream: SenseVoiceStreamLike): Promise<SenseVoiceResultLike>;
  getResult(stream: SenseVoiceStreamLike): SenseVoiceResultLike;
};

type SenseVoiceRecognizerConfig = {
  featConfig: { sampleRate: number; featureDim: number };
  modelConfig: {
    senseVoice: {
      model: string;
      language: string;
      useInverseTextNormalization: number;
    };
    tokens: string;
    numThreads: number;
    provider: "cpu";
    debug: number;
  };
};

type SenseVoiceRuntimeDeps = {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  existsSync?: (filePath: string) => boolean;
  createRecognizerAsync?: (
    config: SenseVoiceRecognizerConfig,
  ) => Promise<SenseVoiceRecognizerLike>;
  logger?: ReturnType<typeof createLogger>;
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

function defaultSenseVoiceModelDir(cwd: string): string {
  return path.resolve(
    cwd,
    "models",
    "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17",
  );
}

export function readSenseVoiceSttConfig(
  env: NodeJS.ProcessEnv = process.env,
  deps: Pick<SenseVoiceRuntimeDeps, "cwd"> = {},
): SenseVoiceSttConfig {
  const cwd = deps.cwd ?? process.cwd();
  const provider = (env.REMI_STT_PROVIDER ?? env.stt_provider ?? "")
    .trim()
    .toLowerCase();
  const enabled = provider === "sense-voice" || provider === "sensevoice";

  const modelDir = (
    env.STT_SENSEVOICE_MODEL_DIR ?? defaultSenseVoiceModelDir(cwd)
  ).trim();
  const model = (
    env.STT_SENSEVOICE_MODEL ?? path.join(modelDir, "model.int8.onnx")
  ).trim();
  const tokens = (
    env.STT_SENSEVOICE_TOKENS ?? path.join(modelDir, "tokens.txt")
  ).trim();
  // "auto" lets SenseVoice run language ID; force "zh" for snappier/cleaner
  // Mandarin via STT_SENSEVOICE_LANGUAGE=zh.
  const language = (env.STT_SENSEVOICE_LANGUAGE ?? "auto").trim() || "auto";

  return {
    enabled,
    modelDir,
    model,
    tokens,
    language,
    useInverseTextNormalization: parseBoolean(
      env.STT_SENSEVOICE_USE_ITN,
      true,
    ),
    numThreads: Math.max(
      1,
      Math.floor(parseFinite(env.STT_SENSEVOICE_NUM_THREADS, 2)),
    ),
    debug: parseBoolean(env.STT_SENSEVOICE_DEBUG, false),
  };
}

async function defaultCreateRecognizerAsync(
  config: SenseVoiceRecognizerConfig,
): Promise<SenseVoiceRecognizerLike> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { OfflineRecognizer } = require("sherpa-onnx-node");
  return OfflineRecognizer.createAsync(config);
}

function pcm16ToFloat32(pcm: Buffer): Float32Array {
  const sampleCount = Math.floor(pcm.length / 2);
  const samples = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    samples[i] = pcm.readInt16LE(i * 2) / 32768;
  }
  return samples;
}

/** Strip SenseVoice rich-tag wrappers like "<|HAPPY|>" → "happy"; drop unknown/neutral. */
function normalizeEmotion(raw: string | undefined): string | null {
  const token = stripRichTag(raw);
  if (!token) return null;
  if (token === "emo_unknown" || token === "unknown" || token === "neutral") {
    return null;
  }
  return token;
}

function normalizeEvent(raw: string | undefined): string | null {
  const token = stripRichTag(raw);
  if (!token) return null;
  // "speech" is the default/uninformative event; surfacing it adds noise.
  if (token === "speech" || token === "event_unknown" || token === "withitn") {
    return null;
  }
  return token;
}

function stripRichTag(raw: string | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[<|>]/g, "").trim().toLowerCase();
  return cleaned || null;
}

class SenseVoiceSttRuntime {
  private readonly env: NodeJS.ProcessEnv;
  private readonly cwd: string;
  private readonly existsSync: (filePath: string) => boolean;
  private readonly createRecognizerAsyncImpl: (
    config: SenseVoiceRecognizerConfig,
  ) => Promise<SenseVoiceRecognizerLike>;
  private readonly logger: ReturnType<typeof createLogger>;

  private recognizer: SenseVoiceRecognizerLike | null = null;
  private recognizerPromise: Promise<SenseVoiceRecognizerLike> | null = null;

  constructor(deps: SenseVoiceRuntimeDeps = {}) {
    this.env = deps.env ?? process.env;
    this.cwd = deps.cwd ?? process.cwd();
    this.existsSync = deps.existsSync ?? fs.existsSync;
    this.createRecognizerAsyncImpl =
      deps.createRecognizerAsync ?? defaultCreateRecognizerAsync;
    this.logger = deps.logger ?? createLogger("stt:sensevoice");
  }

  private config(): SenseVoiceSttConfig {
    return readSenseVoiceSttConfig(this.env, { cwd: this.cwd });
  }

  /** True when provider=sense-voice and the model + tokens files are present. */
  canUse(): boolean {
    const config = this.config();
    if (!config.enabled) return false;
    return this.existsSync(config.model) && this.existsSync(config.tokens);
  }

  /** Warm the recognizer (load the model) ahead of the first utterance. */
  async warm(): Promise<boolean> {
    if (!this.canUse()) return false;
    try {
      await this.ensureRecognizer();
      return true;
    } catch (error) {
      this.logger.warn("SenseVoice warm failed", {
        error: (error as Error).message,
      });
      return false;
    }
  }

  private async ensureRecognizer(): Promise<SenseVoiceRecognizerLike> {
    if (this.recognizer) return this.recognizer;
    if (this.recognizerPromise) return this.recognizerPromise;

    const config = this.config();
    const missing = [config.model, config.tokens].find(
      (filePath) => !this.existsSync(filePath),
    );
    if (missing) {
      throw new Error(`STT 未配置：缺少 SenseVoice 模型文件 ${missing}`);
    }

    this.logger.info("[SenseVoice] loading model", {
      model: config.model,
      language: config.language,
      numThreads: config.numThreads,
    });

    this.recognizerPromise = this.createRecognizerAsyncImpl({
      featConfig: { sampleRate: SENSEVOICE_TARGET_RATE, featureDim: 80 },
      modelConfig: {
        senseVoice: {
          model: config.model,
          language: config.language,
          useInverseTextNormalization: config.useInverseTextNormalization
            ? 1
            : 0,
        },
        tokens: config.tokens,
        numThreads: config.numThreads,
        provider: "cpu",
        debug: config.debug ? 1 : 0,
      },
    })
      .then((recognizer) => {
        this.recognizer = recognizer;
        this.logger.info("[SenseVoice] model ready");
        return recognizer;
      })
      .catch((error) => {
        this.recognizerPromise = null;
        throw error;
      });

    return this.recognizerPromise;
  }

  /**
   * Transcribe a PCM16 mono snapshot. Resamples to 16k if needed.
   * Returns text plus normalized emotion / event / lang labels.
   */
  async transcribe(
    pcm: Buffer,
    sampleRate: number,
  ): Promise<SenseVoiceTranscript> {
    if (pcm.length === 0) {
      return { text: "", emotion: null, event: null, lang: null };
    }
    const recognizer = await this.ensureRecognizer();

    const safeRate =
      Number.isFinite(sampleRate) && sampleRate > 0
        ? Math.floor(sampleRate)
        : SENSEVOICE_TARGET_RATE;
    const normalizedPcm =
      safeRate === SENSEVOICE_TARGET_RATE
        ? pcm
        : resamplePcm16MonoLinear(pcm, safeRate, SENSEVOICE_TARGET_RATE);
    const samples = pcm16ToFloat32(normalizedPcm);
    if (samples.length === 0) {
      return { text: "", emotion: null, event: null, lang: null };
    }

    const stream = recognizer.createStream();
    stream.acceptWaveform({ samples, sampleRate: SENSEVOICE_TARGET_RATE });

    let result: SenseVoiceResultLike;
    if (typeof recognizer.decodeAsync === "function") {
      result = await recognizer.decodeAsync(stream);
    } else {
      recognizer.decode(stream);
      result = recognizer.getResult(stream);
    }

    return {
      text: String(result?.text ?? "").trim(),
      emotion: normalizeEmotion(result?.emotion),
      event: normalizeEvent(result?.event),
      lang: stripRichTag(result?.lang),
    };
  }
}

export function createSenseVoiceSttRuntime(
  deps: SenseVoiceRuntimeDeps = {},
): SenseVoiceSttRuntime {
  return new SenseVoiceSttRuntime(deps);
}

export type { SenseVoiceSttRuntime };

export const senseVoiceSttRuntime = createSenseVoiceSttRuntime();
