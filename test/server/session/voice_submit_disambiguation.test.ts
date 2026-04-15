const assert = require("assert").strict;
const path = require("path");

const { FakeWebSocket } = require("../../helpers/fake_ws");

const runnerPath = path.resolve(__dirname, "../../../server/pipeline/runner.ts");
const disambiguatorPath = path.resolve(__dirname, "../../../voice/stt_final_disambiguator.ts");
const voiceSubmitPath = path.resolve(__dirname, "../../../server/session/voice_submit.ts");

function buildRuntime(overrides = {}) {
  const ws = new FakeWebSocket();
  const turnStates = [];
  return {
    ws,
    runtime: {
      ws,
      connId: "test-conn",
      brain: {},
      interrupt: {},
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
  let originalRunPipeline;

  beforeEach(() => {
    runnerModule = require(runnerPath);
    originalRunPipeline = runnerModule.runPipeline;
  });

  afterEach(() => {
    runnerModule.runPipeline = originalRunPipeline;
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
    runnerModule.runPipeline = async (
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
    };

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
    runnerModule.runPipeline = async (
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
    };

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
});
