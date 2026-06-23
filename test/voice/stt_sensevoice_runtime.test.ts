import { expect } from "chai";
import {
  readSenseVoiceSttConfig,
  createSenseVoiceSttRuntime,
} from "../../voice/stt_sensevoice_runtime";
import type { SenseVoiceSttConfig } from "../../voice/stt_sensevoice_runtime";
import path from "path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal no-op logger satisfying the Logger interface. */
function silentLogger() {
  const noop = () => {};
  return { info: noop, warn: noop, error: noop, debug: noop } as ReturnType<
    typeof import("../../infra/logger").createLogger
  >;
}

/** Build a fake recognizer whose decode returns a canned result. */
function fakeRecognizer(result: {
  text?: string;
  emotion?: string;
  event?: string;
  lang?: string;
}) {
  return {
    createStream() {
      const accepted: Array<{ samples: Float32Array; sampleRate: number }> = [];
      return {
        acceptWaveform(waveform: {
          samples: Float32Array;
          sampleRate: number;
        }) {
          accepted.push(waveform);
        },
        _accepted: accepted,
      };
    },
    decode(_stream: unknown) {
      /* sync decode - no-op, result comes from getResult */
    },
    getResult(_stream: unknown) {
      return result;
    },
  };
}

/** Build a fake recognizer that only provides decodeAsync (no sync decode). */
function fakeAsyncRecognizer(result: {
  text?: string;
  emotion?: string;
  event?: string;
  lang?: string;
}) {
  return {
    createStream() {
      const accepted: Array<{ samples: Float32Array; sampleRate: number }> = [];
      return {
        acceptWaveform(waveform: {
          samples: Float32Array;
          sampleRate: number;
        }) {
          accepted.push(waveform);
        },
        _accepted: accepted,
      };
    },
    decode(_stream: unknown) {
      throw new Error("should not be called when decodeAsync is available");
    },
    async decodeAsync(_stream: unknown) {
      return result;
    },
    getResult(_stream: unknown) {
      throw new Error("should not be called when decodeAsync is available");
    },
  };
}

/** Create a short PCM16 mono buffer of silence at given sample rate. */
function silentPcm16(sampleCount: number): Buffer {
  return Buffer.alloc(sampleCount * 2); // 2 bytes per sample, all zeros
}

/** Create a PCM16 mono buffer with a simple sine wave pattern (non-silent). */
function tonePcm16(sampleCount: number): Buffer {
  const buf = Buffer.alloc(sampleCount * 2);
  for (let i = 0; i < sampleCount; i++) {
    const value = Math.round(16000 * Math.sin((2 * Math.PI * 440 * i) / 16000));
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, value)), i * 2);
  }
  return buf;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("stt_sensevoice_runtime", () => {
  // =========================================================================
  // readSenseVoiceSttConfig
  // =========================================================================
  describe("readSenseVoiceSttConfig", () => {
    it("returns enabled=false when STT provider does not match", () => {
      const config = readSenseVoiceSttConfig(
        { REMI_STT_PROVIDER: "openai" },
        { cwd: "/tmp" },
      );
      expect(config.enabled).to.equal(false);
    });

    it("returns enabled=false when STT provider is empty", () => {
      const config = readSenseVoiceSttConfig({}, { cwd: "/tmp" });
      expect(config.enabled).to.equal(false);
    });

    it('returns enabled=true when provider is "sense-voice"', () => {
      const config = readSenseVoiceSttConfig(
        { REMI_STT_PROVIDER: "sense-voice" },
        { cwd: "/tmp" },
      );
      expect(config.enabled).to.equal(true);
    });

    it('returns enabled=true when provider is "sensevoice"', () => {
      const config = readSenseVoiceSttConfig(
        { REMI_STT_PROVIDER: "sensevoice" },
        { cwd: "/tmp" },
      );
      expect(config.enabled).to.equal(true);
    });

    it("is case-insensitive for provider matching", () => {
      const config = readSenseVoiceSttConfig(
        { REMI_STT_PROVIDER: "SenseVoice" },
        { cwd: "/tmp" },
      );
      expect(config.enabled).to.equal(true);
    });

    it("falls back to legacy stt_provider env var", () => {
      const config = readSenseVoiceSttConfig(
        { stt_provider: "sense-voice" },
        { cwd: "/tmp" },
      );
      expect(config.enabled).to.equal(true);
    });

    it("derives default model paths from cwd", () => {
      const config = readSenseVoiceSttConfig(
        { REMI_STT_PROVIDER: "sensevoice" },
        { cwd: "/my/project" },
      );
      const expectedDir = path.resolve(
        "/my/project",
        "models",
        "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17",
      );
      expect(config.modelDir).to.equal(expectedDir);
      expect(config.model).to.equal(path.join(expectedDir, "model.int8.onnx"));
      expect(config.tokens).to.equal(path.join(expectedDir, "tokens.txt"));
    });

    it("respects custom env overrides for modelDir, model, tokens", () => {
      const config = readSenseVoiceSttConfig(
        {
          REMI_STT_PROVIDER: "sensevoice",
          STT_SENSEVOICE_MODEL_DIR: "/custom/dir",
          STT_SENSEVOICE_MODEL: "/custom/model.onnx",
          STT_SENSEVOICE_TOKENS: "/custom/tokens.txt",
        },
        { cwd: "/tmp" },
      );
      expect(config.modelDir).to.equal("/custom/dir");
      expect(config.model).to.equal("/custom/model.onnx");
      expect(config.tokens).to.equal("/custom/tokens.txt");
    });

    it("defaults language to 'auto'", () => {
      const config = readSenseVoiceSttConfig(
        { REMI_STT_PROVIDER: "sensevoice" },
        { cwd: "/tmp" },
      );
      expect(config.language).to.equal("auto");
    });

    it("allows overriding language", () => {
      const config = readSenseVoiceSttConfig(
        {
          REMI_STT_PROVIDER: "sensevoice",
          STT_SENSEVOICE_LANGUAGE: "zh",
        },
        { cwd: "/tmp" },
      );
      expect(config.language).to.equal("zh");
    });

    it("falls back to 'auto' when language is empty string", () => {
      const config = readSenseVoiceSttConfig(
        {
          REMI_STT_PROVIDER: "sensevoice",
          STT_SENSEVOICE_LANGUAGE: "",
        },
        { cwd: "/tmp" },
      );
      expect(config.language).to.equal("auto");
    });

    it("defaults numThreads to 2", () => {
      const config = readSenseVoiceSttConfig(
        { REMI_STT_PROVIDER: "sensevoice" },
        { cwd: "/tmp" },
      );
      expect(config.numThreads).to.equal(2);
    });

    it("respects custom numThreads", () => {
      const config = readSenseVoiceSttConfig(
        {
          REMI_STT_PROVIDER: "sensevoice",
          STT_SENSEVOICE_NUM_THREADS: "4",
        },
        { cwd: "/tmp" },
      );
      expect(config.numThreads).to.equal(4);
    });

    it("clamps numThreads to minimum 1", () => {
      const config = readSenseVoiceSttConfig(
        {
          REMI_STT_PROVIDER: "sensevoice",
          STT_SENSEVOICE_NUM_THREADS: "0",
        },
        { cwd: "/tmp" },
      );
      expect(config.numThreads).to.equal(1);
    });

    it("falls back numThreads on NaN input", () => {
      const config = readSenseVoiceSttConfig(
        {
          REMI_STT_PROVIDER: "sensevoice",
          STT_SENSEVOICE_NUM_THREADS: "not-a-number",
        },
        { cwd: "/tmp" },
      );
      expect(config.numThreads).to.equal(2);
    });

    it("defaults useInverseTextNormalization to true", () => {
      const config = readSenseVoiceSttConfig(
        { REMI_STT_PROVIDER: "sensevoice" },
        { cwd: "/tmp" },
      );
      expect(config.useInverseTextNormalization).to.equal(true);
    });

    it('parseBoolean: "0" disables ITN', () => {
      const config = readSenseVoiceSttConfig(
        {
          REMI_STT_PROVIDER: "sensevoice",
          STT_SENSEVOICE_USE_ITN: "0",
        },
        { cwd: "/tmp" },
      );
      expect(config.useInverseTextNormalization).to.equal(false);
    });

    it('parseBoolean: "false" disables ITN', () => {
      const config = readSenseVoiceSttConfig(
        {
          REMI_STT_PROVIDER: "sensevoice",
          STT_SENSEVOICE_USE_ITN: "false",
        },
        { cwd: "/tmp" },
      );
      expect(config.useInverseTextNormalization).to.equal(false);
    });

    it('parseBoolean: empty string falls back to default (true for ITN)', () => {
      const config = readSenseVoiceSttConfig(
        {
          REMI_STT_PROVIDER: "sensevoice",
          STT_SENSEVOICE_USE_ITN: "",
        },
        { cwd: "/tmp" },
      );
      expect(config.useInverseTextNormalization).to.equal(true);
    });

    it("defaults debug to false", () => {
      const config = readSenseVoiceSttConfig(
        { REMI_STT_PROVIDER: "sensevoice" },
        { cwd: "/tmp" },
      );
      expect(config.debug).to.equal(false);
    });

    it('parseBoolean: "1" enables debug', () => {
      const config = readSenseVoiceSttConfig(
        {
          REMI_STT_PROVIDER: "sensevoice",
          STT_SENSEVOICE_DEBUG: "1",
        },
        { cwd: "/tmp" },
      );
      expect(config.debug).to.equal(true);
    });
  });

  // =========================================================================
  // createSenseVoiceSttRuntime — canUse()
  // =========================================================================
  describe("canUse()", () => {
    it("returns false when enabled=false (provider mismatch)", () => {
      const runtime = createSenseVoiceSttRuntime({
        env: { REMI_STT_PROVIDER: "openai" },
        cwd: "/tmp",
        existsSync: () => true,
        logger: silentLogger(),
      });
      expect(runtime.canUse()).to.equal(false);
    });

    it("returns false when enabled=true but model file does not exist", () => {
      const runtime = createSenseVoiceSttRuntime({
        env: { REMI_STT_PROVIDER: "sensevoice" },
        cwd: "/tmp",
        existsSync: (p: string) => !p.endsWith(".onnx"),
        logger: silentLogger(),
      });
      expect(runtime.canUse()).to.equal(false);
    });

    it("returns false when enabled=true but tokens file does not exist", () => {
      const runtime = createSenseVoiceSttRuntime({
        env: { REMI_STT_PROVIDER: "sensevoice" },
        cwd: "/tmp",
        existsSync: (p: string) => !p.endsWith("tokens.txt"),
        logger: silentLogger(),
      });
      expect(runtime.canUse()).to.equal(false);
    });

    it("returns true when enabled=true and both files exist", () => {
      const runtime = createSenseVoiceSttRuntime({
        env: { REMI_STT_PROVIDER: "sensevoice" },
        cwd: "/tmp",
        existsSync: () => true,
        logger: silentLogger(),
      });
      expect(runtime.canUse()).to.equal(true);
    });
  });

  // =========================================================================
  // warm()
  // =========================================================================
  describe("warm()", () => {
    it("returns false when canUse() is false", async () => {
      const runtime = createSenseVoiceSttRuntime({
        env: { REMI_STT_PROVIDER: "openai" },
        cwd: "/tmp",
        existsSync: () => true,
        logger: silentLogger(),
      });
      const result = await runtime.warm();
      expect(result).to.equal(false);
    });

    it("returns true when recognizer loads successfully", async () => {
      const runtime = createSenseVoiceSttRuntime({
        env: { REMI_STT_PROVIDER: "sensevoice" },
        cwd: "/tmp",
        existsSync: () => true,
        createRecognizerAsync: async () => fakeRecognizer({ text: "" }),
        logger: silentLogger(),
      });
      const result = await runtime.warm();
      expect(result).to.equal(true);
    });

    it("returns false (does not throw) when recognizer creation fails", async () => {
      const runtime = createSenseVoiceSttRuntime({
        env: { REMI_STT_PROVIDER: "sensevoice" },
        cwd: "/tmp",
        existsSync: () => true,
        createRecognizerAsync: async () => {
          throw new Error("model load failed");
        },
        logger: silentLogger(),
      });
      const result = await runtime.warm();
      expect(result).to.equal(false);
    });
  });

  // =========================================================================
  // transcribe()
  // =========================================================================
  describe("transcribe()", () => {
    it("returns empty result for empty buffer", async () => {
      const runtime = createSenseVoiceSttRuntime({
        env: { REMI_STT_PROVIDER: "sensevoice" },
        cwd: "/tmp",
        existsSync: () => true,
        createRecognizerAsync: async () =>
          fakeRecognizer({ text: "should not reach" }),
        logger: silentLogger(),
      });
      const result = await runtime.transcribe(Buffer.alloc(0), 16000);
      expect(result.text).to.equal("");
      expect(result.emotion).to.equal(null);
      expect(result.event).to.equal(null);
      expect(result.lang).to.equal(null);
    });

    it("transcribes normal PCM and returns text", async () => {
      const runtime = createSenseVoiceSttRuntime({
        env: { REMI_STT_PROVIDER: "sensevoice" },
        cwd: "/tmp",
        existsSync: () => true,
        createRecognizerAsync: async () =>
          fakeRecognizer({
            text: "  你好世界  ",
            emotion: "<|HAPPY|>",
            event: "<|SPEECH|>",
            lang: "<|zh|>",
          }),
        logger: silentLogger(),
      });
      const pcm = tonePcm16(1600); // 100ms at 16kHz
      const result = await runtime.transcribe(pcm, 16000);
      expect(result.text).to.equal("你好世界");
      expect(result.emotion).to.equal("happy");
      // SPEECH is uninformative and normalized to null
      expect(result.event).to.equal(null);
      expect(result.lang).to.equal("zh");
    });

    it("normalizes emotion: <|HAPPY|> → 'happy'", async () => {
      const runtime = createSenseVoiceSttRuntime({
        env: { REMI_STT_PROVIDER: "sensevoice" },
        cwd: "/tmp",
        existsSync: () => true,
        createRecognizerAsync: async () =>
          fakeRecognizer({ text: "hi", emotion: "<|HAPPY|>" }),
        logger: silentLogger(),
      });
      const result = await runtime.transcribe(tonePcm16(1600), 16000);
      expect(result.emotion).to.equal("happy");
    });

    it("normalizes emotion: <|SAD|> → 'sad'", async () => {
      const runtime = createSenseVoiceSttRuntime({
        env: { REMI_STT_PROVIDER: "sensevoice" },
        cwd: "/tmp",
        existsSync: () => true,
        createRecognizerAsync: async () =>
          fakeRecognizer({ text: "hi", emotion: "<|SAD|>" }),
        logger: silentLogger(),
      });
      const result = await runtime.transcribe(tonePcm16(1600), 16000);
      expect(result.emotion).to.equal("sad");
    });

    it("normalizes emotion: 'neutral' → null", async () => {
      const runtime = createSenseVoiceSttRuntime({
        env: { REMI_STT_PROVIDER: "sensevoice" },
        cwd: "/tmp",
        existsSync: () => true,
        createRecognizerAsync: async () =>
          fakeRecognizer({ text: "hi", emotion: "neutral" }),
        logger: silentLogger(),
      });
      const result = await runtime.transcribe(tonePcm16(1600), 16000);
      expect(result.emotion).to.equal(null);
    });

    it("normalizes emotion: 'emo_unknown' → null", async () => {
      const runtime = createSenseVoiceSttRuntime({
        env: { REMI_STT_PROVIDER: "sensevoice" },
        cwd: "/tmp",
        existsSync: () => true,
        createRecognizerAsync: async () =>
          fakeRecognizer({ text: "hi", emotion: "emo_unknown" }),
        logger: silentLogger(),
      });
      const result = await runtime.transcribe(tonePcm16(1600), 16000);
      expect(result.emotion).to.equal(null);
    });

    it("normalizes emotion: undefined → null", async () => {
      const runtime = createSenseVoiceSttRuntime({
        env: { REMI_STT_PROVIDER: "sensevoice" },
        cwd: "/tmp",
        existsSync: () => true,
        createRecognizerAsync: async () =>
          fakeRecognizer({ text: "hi" }),
        logger: silentLogger(),
      });
      const result = await runtime.transcribe(tonePcm16(1600), 16000);
      expect(result.emotion).to.equal(null);
    });

    it("normalizes event: <|SPEECH|> → null (uninformative)", async () => {
      const runtime = createSenseVoiceSttRuntime({
        env: { REMI_STT_PROVIDER: "sensevoice" },
        cwd: "/tmp",
        existsSync: () => true,
        createRecognizerAsync: async () =>
          fakeRecognizer({ text: "hi", event: "<|SPEECH|>" }),
        logger: silentLogger(),
      });
      const result = await runtime.transcribe(tonePcm16(1600), 16000);
      expect(result.event).to.equal(null);
    });

    it("normalizes event: <|LAUGHTER|> → 'laughter'", async () => {
      const runtime = createSenseVoiceSttRuntime({
        env: { REMI_STT_PROVIDER: "sensevoice" },
        cwd: "/tmp",
        existsSync: () => true,
        createRecognizerAsync: async () =>
          fakeRecognizer({ text: "haha", event: "<|LAUGHTER|>" }),
        logger: silentLogger(),
      });
      const result = await runtime.transcribe(tonePcm16(1600), 16000);
      expect(result.event).to.equal("laughter");
    });

    it("normalizes event: 'event_unknown' → null", async () => {
      const runtime = createSenseVoiceSttRuntime({
        env: { REMI_STT_PROVIDER: "sensevoice" },
        cwd: "/tmp",
        existsSync: () => true,
        createRecognizerAsync: async () =>
          fakeRecognizer({ text: "hi", event: "event_unknown" }),
        logger: silentLogger(),
      });
      const result = await runtime.transcribe(tonePcm16(1600), 16000);
      expect(result.event).to.equal(null);
    });

    it("normalizes event: 'withitn' → null (SenseVoice typo token)", async () => {
      const runtime = createSenseVoiceSttRuntime({
        env: { REMI_STT_PROVIDER: "sensevoice" },
        cwd: "/tmp",
        existsSync: () => true,
        createRecognizerAsync: async () =>
          fakeRecognizer({ text: "hi", event: "withitn" }),
        logger: silentLogger(),
      });
      const result = await runtime.transcribe(tonePcm16(1600), 16000);
      expect(result.event).to.equal(null);
    });

    it("normalizes lang: <|zh|> → 'zh'", async () => {
      const runtime = createSenseVoiceSttRuntime({
        env: { REMI_STT_PROVIDER: "sensevoice" },
        cwd: "/tmp",
        existsSync: () => true,
        createRecognizerAsync: async () =>
          fakeRecognizer({ text: "hi", lang: "<|zh|>" }),
        logger: silentLogger(),
      });
      const result = await runtime.transcribe(tonePcm16(1600), 16000);
      expect(result.lang).to.equal("zh");
    });

    it("normalizes lang: <|en|> → 'en'", async () => {
      const runtime = createSenseVoiceSttRuntime({
        env: { REMI_STT_PROVIDER: "sensevoice" },
        cwd: "/tmp",
        existsSync: () => true,
        createRecognizerAsync: async () =>
          fakeRecognizer({ text: "hi", lang: "<|en|>" }),
        logger: silentLogger(),
      });
      const result = await runtime.transcribe(tonePcm16(1600), 16000);
      expect(result.lang).to.equal("en");
    });

    it("triggers resampling when sampleRate != 16000", async () => {
      let receivedConfig: unknown = null;
      const runtime = createSenseVoiceSttRuntime({
        env: { REMI_STT_PROVIDER: "sensevoice" },
        cwd: "/tmp",
        existsSync: () => true,
        createRecognizerAsync: async (_config) => {
          receivedConfig = _config;
          return fakeRecognizer({ text: "resampled" });
        },
        logger: silentLogger(),
      });
      // 48kHz, 4800 samples = 100ms
      const pcm48k = tonePcm16(4800);
      const result = await runtime.transcribe(pcm48k, 48000);
      expect(result.text).to.equal("resampled");
      // The recognizer should have been configured with 16kHz
      expect(receivedConfig).to.have.nested.property(
        "featConfig.sampleRate",
        16000,
      );
    });

    it("does not resample when sampleRate is already 16000", async () => {
      // We track whether the recognizer gets the same number of samples
      // as the input (no resampling stretches/shrinks).
      let streamSamples = 0;
      const recognizer = {
        createStream() {
          return {
            acceptWaveform(waveform: {
              samples: Float32Array;
              sampleRate: number;
            }) {
              streamSamples = waveform.samples.length;
            },
          };
        },
        decode() {},
        getResult() {
          return { text: "ok" };
        },
      };
      const runtime = createSenseVoiceSttRuntime({
        env: { REMI_STT_PROVIDER: "sensevoice" },
        cwd: "/tmp",
        existsSync: () => true,
        createRecognizerAsync: async () => recognizer,
        logger: silentLogger(),
      });
      const sampleCount = 1600;
      const pcm = tonePcm16(sampleCount);
      await runtime.transcribe(pcm, 16000);
      // Without resampling, sample count should match
      expect(streamSamples).to.equal(sampleCount);
    });

    it("uses decodeAsync when available", async () => {
      const runtime = createSenseVoiceSttRuntime({
        env: { REMI_STT_PROVIDER: "sensevoice" },
        cwd: "/tmp",
        existsSync: () => true,
        createRecognizerAsync: async () =>
          fakeAsyncRecognizer({
            text: "async result",
            emotion: "<|ANGRY|>",
          }),
        logger: silentLogger(),
      });
      const result = await runtime.transcribe(tonePcm16(1600), 16000);
      expect(result.text).to.equal("async result");
      expect(result.emotion).to.equal("angry");
    });

    it("falls back to sync decode + getResult when decodeAsync is absent", async () => {
      const runtime = createSenseVoiceSttRuntime({
        env: { REMI_STT_PROVIDER: "sensevoice" },
        cwd: "/tmp",
        existsSync: () => true,
        createRecognizerAsync: async () =>
          fakeRecognizer({
            text: "sync result",
            emotion: "<|SAD|>",
            event: "<|CRY|>",
            lang: "<|ja|>",
          }),
        logger: silentLogger(),
      });
      const result = await runtime.transcribe(tonePcm16(1600), 16000);
      expect(result.text).to.equal("sync result");
      expect(result.emotion).to.equal("sad");
      expect(result.event).to.equal("cry");
      expect(result.lang).to.equal("ja");
    });

    it("handles non-finite sampleRate gracefully (defaults to 16000)", async () => {
      let streamSamples = 0;
      const recognizer = {
        createStream() {
          return {
            acceptWaveform(waveform: {
              samples: Float32Array;
              sampleRate: number;
            }) {
              streamSamples = waveform.samples.length;
            },
          };
        },
        decode() {},
        getResult() {
          return { text: "ok" };
        },
      };
      const runtime = createSenseVoiceSttRuntime({
        env: { REMI_STT_PROVIDER: "sensevoice" },
        cwd: "/tmp",
        existsSync: () => true,
        createRecognizerAsync: async () => recognizer,
        logger: silentLogger(),
      });
      const sampleCount = 1600;
      const pcm = tonePcm16(sampleCount);
      // NaN sampleRate should fall back to 16000 → no resampling
      await runtime.transcribe(pcm, NaN);
      expect(streamSamples).to.equal(sampleCount);
    });

    it("handles result with undefined text gracefully", async () => {
      const runtime = createSenseVoiceSttRuntime({
        env: { REMI_STT_PROVIDER: "sensevoice" },
        cwd: "/tmp",
        existsSync: () => true,
        createRecognizerAsync: async () =>
          fakeRecognizer({}), // no text property
        logger: silentLogger(),
      });
      const result = await runtime.transcribe(tonePcm16(1600), 16000);
      expect(result.text).to.equal("");
    });

    it("reuses recognizer across multiple transcribe calls", async () => {
      let createCount = 0;
      const runtime = createSenseVoiceSttRuntime({
        env: { REMI_STT_PROVIDER: "sensevoice" },
        cwd: "/tmp",
        existsSync: () => true,
        createRecognizerAsync: async () => {
          createCount++;
          return fakeRecognizer({ text: `call-${createCount}` });
        },
        logger: silentLogger(),
      });
      const pcm = tonePcm16(1600);
      await runtime.transcribe(pcm, 16000);
      await runtime.transcribe(pcm, 16000);
      await runtime.transcribe(pcm, 16000);
      // Recognizer should only be created once
      expect(createCount).to.equal(1);
    });
  });
});
