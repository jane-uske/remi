const assert = require("assert").strict;
const path = require("path");

const { FakeWebSocket } = require("../../helpers/fake_ws");

const pipelinePath = path.resolve(__dirname, "../../../server/pipeline/index.ts");
const disambiguatorPath = path.resolve(__dirname, "../../../voice/stt_final_disambiguator.ts");
const voiceSubmitPath = path.resolve(__dirname, "../../../server/session/voice_submit.ts");

function buildRuntime(overrides = {}) {
  const ws = new FakeWebSocket();
  const turnStates = [];
  const createSignal = () => new AbortController().signal;
  return {
    ws,
    runtime: {
      ws,
      connId: "test-conn",
      brain: {},
      interrupt: {
        active: false,
        beginRun: () => ({ signal: createSignal(), token: 1 }),
        begin: () => createSignal(),
        finish: () => {},
        interrupt: () => false,
        markSpeaking: () => {},
      },
      avatar: {},
      sessionId: null,
      currentPartialText: "",
      predictedReply: "",
      predictedStructuredAnalysis: null,
      nextGenerationId: () => 1,
      bindActiveGeneration: () => {},
      touchUserActivity: () => {},
      classifyCarryForward: () => ({ interruptionType: null }),
      publishTurnState: (state, reason, extras) => {
        turnStates.push({ state, reason, extras });
      },
      setLastSttFinalAt: () => {},
      cancelPrediction: () => {},
      getResolvedTtsTransport: () => "auto",
      ...overrides,
    },
    turnStates,
  };
}

describe("voice submit disambiguation", () => {
  const previousEnv = {
    REMI_STT_FINAL_DISAMBIG_ENABLED: process.env.REMI_STT_FINAL_DISAMBIG_ENABLED,
    REMI_STT_FINAL_DISAMBIG_DICT_PATH: process.env.REMI_STT_FINAL_DISAMBIG_DICT_PATH,
    REMI_STT_FINAL_DISAMBIG_LOG_DIFF: process.env.REMI_STT_FINAL_DISAMBIG_LOG_DIFF,
  };

  let runnerModule;
  let originalRunPipelineDescriptor;

  beforeEach(() => {
    runnerModule = require(pipelinePath);
    originalRunPipelineDescriptor = Object.getOwnPropertyDescriptor(
      runnerModule,
      "runPipeline",
    );
  });

  afterEach(() => {
    if (originalRunPipelineDescriptor) {
      Object.defineProperty(runnerModule, "runPipeline", originalRunPipelineDescriptor);
    }
    process.env.REMI_STT_FINAL_DISAMBIG_ENABLED = previousEnv.REMI_STT_FINAL_DISAMBIG_ENABLED;
    process.env.REMI_STT_FINAL_DISAMBIG_DICT_PATH = previousEnv.REMI_STT_FINAL_DISAMBIG_DICT_PATH;
    process.env.REMI_STT_FINAL_DISAMBIG_LOG_DIFF = previousEnv.REMI_STT_FINAL_DISAMBIG_LOG_DIFF;
    if (process.env.REMI_STT_FINAL_DISAMBIG_ENABLED === undefined) {
      delete process.env.REMI_STT_FINAL_DISAMBIG_ENABLED;
    }
    if (process.env.REMI_STT_FINAL_DISAMBIG_DICT_PATH === undefined) {
      delete process.env.REMI_STT_FINAL_DISAMBIG_DICT_PATH;
    }
    if (process.env.REMI_STT_FINAL_DISAMBIG_LOG_DIFF === undefined) {
      delete process.env.REMI_STT_FINAL_DISAMBIG_LOG_DIFF;
    }
    delete require.cache[require.resolve(disambiguatorPath)];
    const disambiguator = require(disambiguatorPath);
    disambiguator.__resetSttFinalDisambiguatorForTests();
    delete require.cache[require.resolve(voiceSubmitPath)];
  });

  it("emits corrected stt_final and sends corrected text to pipeline", async () => {
    process.env.REMI_STT_FINAL_DISAMBIG_ENABLED = "1";
    process.env.REMI_STT_FINAL_DISAMBIG_DICT_PATH = path.resolve(
      __dirname,
      "../../fixtures/stt_final_disamb_valid.json",
    );
    process.env.REMI_STT_FINAL_DISAMBIG_LOG_DIFF = "0";

    const pipelineCalls = [];
    Object.defineProperty(runnerModule, "runPipeline", {
      configurable: true,
      value: async (
        _ws,
        text,
        _interrupt,
        _avatar,
        _sessionId,
        _brain,
        _generationId,
        _traceId,
        options,
      ) => {
        pipelineCalls.push({ text, options });
      },
    });

    delete require.cache[require.resolve(voiceSubmitPath)];
    const { submitVoicePipelineTurn } = require(voiceSubmitPath);
    const { runtime, ws } = buildRuntime({
      currentPartialText: "雷米你好",
      predictedReply: "你好呀",
      predictedStructuredAnalysis: { used: true },
    });

    await submitVoicePipelineTurn(runtime, {
      text: "雷米你好",
      traceId: "trace-1",
      allowPredictionReuse: true,
      clearPredictionAfterRun: false,
    });

    const sttFinal = ws.parsedMessages().find((msg) => msg && msg.type === "stt_final");
    assert.ok(sttFinal);
    assert.equal(sttFinal.content, "Remi你好");
    assert.equal(pipelineCalls.length, 1);
    assert.equal(pipelineCalls[0].text, "Remi你好");
    assert.equal(pipelineCalls[0].options?.pregeneratedReply, undefined);
  });

  it("keeps existing prediction reuse behavior when transcript is unchanged", async () => {
    process.env.REMI_STT_FINAL_DISAMBIG_ENABLED = "1";
    process.env.REMI_STT_FINAL_DISAMBIG_DICT_PATH = path.resolve(
      __dirname,
      "../../fixtures/stt_final_disamb_valid.json",
    );
    process.env.REMI_STT_FINAL_DISAMBIG_LOG_DIFF = "0";

    const pipelineCalls = [];
    Object.defineProperty(runnerModule, "runPipeline", {
      configurable: true,
      value: async (
        _ws,
        text,
        _interrupt,
        _avatar,
        _sessionId,
        _brain,
        _generationId,
        _traceId,
        options,
      ) => {
        pipelineCalls.push({ text, options });
      },
    });

    delete require.cache[require.resolve(voiceSubmitPath)];
    const { submitVoicePipelineTurn } = require(voiceSubmitPath);
    const { runtime, ws } = buildRuntime({
      currentPartialText: "你好Remi",
      predictedReply: "我在呢",
      predictedStructuredAnalysis: { used: true },
    });

    await submitVoicePipelineTurn(runtime, {
      text: "你好Remi",
      traceId: "trace-2",
      allowPredictionReuse: true,
      clearPredictionAfterRun: false,
    });

    const sttFinals = ws.parsedMessages().filter((msg) => msg && msg.type === "stt_final");
    assert.equal(sttFinals.length, 1);
    assert.equal(sttFinals[0].content, "你好Remi");
    assert.equal(pipelineCalls.length, 1);
    assert.equal(pipelineCalls[0].text, "你好Remi");
    assert.equal(pipelineCalls[0].options?.pregeneratedReply, "我在呢");
  });

  it("cancels pending prediction before final pipeline while preserving reusable snapshot", async () => {
    process.env.REMI_STT_FINAL_DISAMBIG_ENABLED = "0";

    const events = [];
    Object.defineProperty(runnerModule, "runPipeline", {
      configurable: true,
      value: async (
        _ws,
        text,
        _interrupt,
        _avatar,
        _sessionId,
        runtimeBrain,
        _generationId,
        _traceId,
        options,
      ) => {
        events.push({
          step: "runPipeline",
          text,
          options,
          predictedReplyOnRuntime: runtimeBrain?.predictedReply,
        });
      },
    });

    delete require.cache[require.resolve(voiceSubmitPath)];
    const { submitVoicePipelineTurn } = require(voiceSubmitPath);
    const { runtime } = buildRuntime({
      currentPartialText: "你好Remi",
      predictedReply: "我在呢",
      predictedStructuredAnalysis: { used: true },
    });
    runtime.cancelPrediction = () => {
      events.push({ step: "cancelPrediction" });
      runtime.currentPartialText = "";
      runtime.predictedReply = "";
      runtime.predictedStructuredAnalysis = null;
    };

    await submitVoicePipelineTurn(runtime, {
      text: "你好Remi",
      traceId: "trace-3",
      allowPredictionReuse: true,
      clearPredictionAfterRun: true,
    });

    assert.deepEqual(
      events.map((entry) => entry.step),
      ["cancelPrediction", "runPipeline"],
    );
    assert.equal(events[1].text, "你好Remi");
    assert.equal(events[1].options?.pregeneratedReply, "我在呢");
    assert.equal(runtime.predictedReply, "");
    assert.equal(runtime.currentPartialText, "");
  });
});
