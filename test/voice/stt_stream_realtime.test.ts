const assert = require("assert").strict;

const runtimeModule = require("../../voice/stt_realtime_runtime");
const sherpaRuntimeModule = require("../../voice/stt_sherpa_runtime");
const { SttStream } = require("../../voice/stt_stream");

describe("stt stream incremental session lifecycle", () => {
  const previousEnv = {
    stt_provider: process.env.stt_provider,
    stt_incremental_provider: process.env.stt_incremental_provider,
    whisper_model: process.env.whisper_model,
    REMI_STREAMING_STT_ENABLED: process.env.REMI_STREAMING_STT_ENABLED,
    stt_key: process.env.stt_key,
  };

  afterEach(() => {
    runtimeModule.realtimeSttRuntime.canUseRealtime = originalCanUseRealtime;
    runtimeModule.realtimeSttRuntime.createSession = originalCreateSession;
    sherpaRuntimeModule.sherpaSttRuntime.canUseSherpa = originalCanUseSherpa;
    sherpaRuntimeModule.sherpaSttRuntime.createSession = originalSherpaCreateSession;
    process.env.stt_provider = previousEnv.stt_provider;
    process.env.stt_incremental_provider = previousEnv.stt_incremental_provider;
    process.env.whisper_model = previousEnv.whisper_model;
    process.env.REMI_STREAMING_STT_ENABLED = previousEnv.REMI_STREAMING_STT_ENABLED;
    process.env.stt_key = previousEnv.stt_key;
    if (process.env.stt_provider === undefined) delete process.env.stt_provider;
    if (process.env.stt_incremental_provider === undefined) {
      delete process.env.stt_incremental_provider;
    }
    if (process.env.whisper_model === undefined) delete process.env.whisper_model;
    if (process.env.REMI_STREAMING_STT_ENABLED === undefined) {
      delete process.env.REMI_STREAMING_STT_ENABLED;
    }
    if (process.env.stt_key === undefined) delete process.env.stt_key;
  });

  const originalCanUseRealtime = runtimeModule.realtimeSttRuntime.canUseRealtime;
  const originalCreateSession = runtimeModule.realtimeSttRuntime.createSession;
  const originalCanUseSherpa = sherpaRuntimeModule.sherpaSttRuntime.canUseSherpa;
  const originalSherpaCreateSession = sherpaRuntimeModule.sherpaSttRuntime.createSession;

  [
    {
      label: "openai-realtime",
      provider: "openai-realtime",
      prepare() {
        runtimeModule.realtimeSttRuntime.canUseRealtime = () => true;
        return installDeferredSessionFactory(runtimeModule.realtimeSttRuntime);
      },
    },
    {
      label: "sherpa-onnx",
      provider: "sherpa-onnx",
      prepare() {
        sherpaRuntimeModule.sherpaSttRuntime.canUseSherpa = () => true;
        return installDeferredSessionFactory(sherpaRuntimeModule.sherpaSttRuntime);
      },
    },
  ].forEach(({ label, provider, prepare }) => {
    it(`closes a late ${label} streaming session if reset wins the race`, async () => {
      process.env.stt_provider = "whisper-cpp";
      process.env.stt_incremental_provider = provider;
      process.env.whisper_model = "/tmp/whisper.bin";
      process.env.REMI_STREAMING_STT_ENABLED = "1";
      process.env.stt_key = "sk-test";

      let closeCalls = 0;
      const deferred = prepare();

      const stt = new SttStream();
      stt.startStreamingPcmSession();
      stt.reset();

      deferred.resolve({
        appendPcm() {},
        close: async () => {
          closeCalls += 1;
        },
      });
      await new Promise((resolve) => setImmediate(resolve));

      assert.equal(closeCalls, 1);
      assert.equal(stt.streamingSession, null);
    });
  });
});

function installDeferredSessionFactory(runtime) {
  const deferred = { resolve: null };
  runtime.createSession = () =>
    new Promise((resolve) => {
      deferred.resolve = resolve;
    });
  return deferred;
}
