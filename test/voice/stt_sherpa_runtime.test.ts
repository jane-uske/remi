const assert = require("assert").strict;

const {
  createSherpaSttRuntime,
  readSherpaSttConfig,
} = require("../../voice/stt_sherpa_runtime");

class FakeStream {
  accepted = [];
  finished = 0;

  acceptWaveform(waveform) {
    this.accepted.push(waveform);
  }

  inputFinished() {
    this.finished += 1;
  }
}

class FakeRecognizer {
  constructor(config) {
    this.config = config;
    this.stream = new FakeStream();
    this.pendingText = "";
    this.endpoint = false;
    this.ready = false;
    this.resetCalls = 0;
    this.decodeCalls = 0;
  }

  createStream() {
    return this.stream;
  }

  isReady() {
    return this.ready;
  }

  decode() {
    this.decodeCalls += 1;
    this.ready = false;
  }

  getResult() {
    return { text: this.pendingText };
  }

  isEndpoint() {
    return this.endpoint;
  }

  reset() {
    this.resetCalls += 1;
    this.endpoint = false;
    this.pendingText = "";
  }
}

describe("sherpa streaming stt runtime", () => {
  it("parses config from a model dir and prefers int8 encoder and joiner", () => {
    const config = readSherpaSttConfig(
      {
        stt_provider: "whisper-cpp",
        stt_incremental_provider: "sherpa-onnx",
        STT_SHERPA_MODEL_DIR: "/tmp/sherpa-small-zh-en",
        STT_SHERPA_NUM_THREADS: "3",
        REMI_STREAMING_STT_ENABLED: "1",
      },
      {
        existsSync(filePath) {
          return filePath.endsWith("encoder-epoch-99-avg-1.int8.onnx") ||
            filePath.endsWith("joiner-epoch-99-avg-1.int8.onnx") ||
            filePath.endsWith("decoder-epoch-99-avg-1.onnx") ||
            filePath.endsWith("tokens.txt");
        },
      },
    );

    assert.deepEqual(config, {
      enabled: true,
      provider: "sherpa-onnx",
      modelDir: "/tmp/sherpa-small-zh-en",
      tokens: "/tmp/sherpa-small-zh-en/tokens.txt",
      encoder: "/tmp/sherpa-small-zh-en/encoder-epoch-99-avg-1.int8.onnx",
      decoder: "/tmp/sherpa-small-zh-en/decoder-epoch-99-avg-1.onnx",
      joiner: "/tmp/sherpa-small-zh-en/joiner-epoch-99-avg-1.int8.onnx",
      sampleRate: 16_000,
      featureDim: 80,
      numThreads: 3,
      providerName: "cpu",
      decodingMethod: "greedy_search",
      maxActivePaths: 4,
      enableEndpoint: true,
      rule1MinTrailingSilence: 1.2,
      rule2MinTrailingSilence: 0.6,
      rule3MinUtteranceLength: 12,
    });
  });

  it("emits interim and final transcripts from the online recognizer", async () => {
    const partials = [];
    const finals = [];
    let recognizer;
    const runtime = createSherpaSttRuntime({
      env: {
        stt_provider: "whisper-cpp",
        stt_incremental_provider: "sherpa-onnx",
        STT_SHERPA_MODEL_DIR: "/tmp/sherpa-small-zh-en",
        REMI_STREAMING_STT_ENABLED: "1",
      },
      existsSync() {
        return true;
      },
      createRecognizer(config) {
        recognizer = new FakeRecognizer(config);
        return recognizer;
      },
    });

    const session = await runtime.createSession({
      onPartial(event) {
        partials.push(event);
      },
      onFinal(event) {
        finals.push(event);
      },
      onError(error) {
        throw error;
      },
    });

    recognizer.pendingText = "你好";
    recognizer.ready = true;
    session.appendPcm(Buffer.from([0x00, 0x10, 0xff, 0x7f]), 16_000);
    await new Promise((resolve) => setImmediate(resolve));

    recognizer.pendingText = "你好Remi";
    recognizer.endpoint = true;
    recognizer.ready = true;
    session.appendPcm(Buffer.from([0x00, 0x10, 0xff, 0x7f]), 16_000);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(recognizer.stream.accepted.length, 2);
    assert.equal(recognizer.stream.accepted[0].sampleRate, 16_000);
    assert.ok(recognizer.stream.accepted[0].samples instanceof Float32Array);
    assert.deepEqual(
      partials.map((entry) => entry.content),
      ["你好", "你好Remi"],
    );
    assert.deepEqual(
      finals.map((entry) => entry.content),
      ["你好Remi"],
    );
    assert.equal(partials[0].provider, "sherpa-onnx");
    assert.equal(finals[0].provider, "sherpa-onnx");
    assert.equal(finals[0].itemId, partials[1].itemId);
    assert.equal(recognizer.resetCalls, 1);

    await session.close();
    assert.equal(recognizer.stream.finished, 1);
  });
});
