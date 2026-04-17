const path = require("path");
const { FakeWebSocket } = require("./fake_ws");

type HarnessOptions = {
  transcript?: string;
  reqUrl?: string;
  sttEndPcmImpl?: (...args: any[]) => Promise<string> | string;
  runPipelineImpl?: (...args: any[]) => Promise<void> | void;
  captureLogs?: Array<{
    module: string;
    level: string;
    message: string;
    data?: Record<string, unknown>;
  }>;
};

const ENV_PATCHES: Record<string, string> = {
  STT_PARTIAL_PREDICTION_ENABLED: "0",
  STT_PREDICTION_PUSH_ENABLED: "0",
  VOICE_BACKCHANNEL_ENABLED: "0",
  REMI_SILENCE_NUDGE_MS: "0",
  interrupt_reaction: "0",
};

function applyEnvPatches(): Record<string, string | undefined> {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(ENV_PATCHES)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  return previous;
}

function restoreEnvPatches(previous: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function loadSessionHarness(options: HarnessOptions = {}) {
  const previousEnv = applyEnvPatches();
  const appState = require(path.resolve(__dirname, "../../infra/app_state.ts"));
  const loggerPath = path.resolve(__dirname, "../../infra/logger.ts");
  const previousDbReady = appState.isDbReady();
  const previousRedisReady = appState.isRedisReady();
  const previousMemoryMode = appState.getMemoryMode();
  appState.setDbReady(false);
  appState.setRedisReady(false);
  appState.setMemoryMode("in-memory");

  const previousLogger = require.cache[loggerPath];
  if (options.captureLogs) {
    require.cache[loggerPath] = {
      id: loggerPath,
      filename: loggerPath,
      loaded: true,
      exports: {
        createLogger: (module: string) => ({
          info(message: string, data?: Record<string, unknown>) {
            options.captureLogs?.push({ module, level: "info", message, data });
          },
          warn(message: string, data?: Record<string, unknown>) {
            options.captureLogs?.push({ module, level: "warn", message, data });
          },
          error(message: string, data?: Record<string, unknown>) {
            options.captureLogs?.push({ module, level: "error", message, data });
          },
          debug(message: string, data?: Record<string, unknown>) {
            options.captureLogs?.push({ module, level: "debug", message, data });
          },
        }),
        logger: {
          info() {},
          warn() {},
          error() {},
          debug() {},
        },
      },
    };
  }

  const runner = require(path.resolve(__dirname, "../../server/pipeline/runner.ts"));
  const pipelineIndexPath = path.resolve(__dirname, "../../server/pipeline/index.ts");
  const originalRunPipeline = runner.runPipeline;
  const pipelineCalls: Array<{ text: string; options: any }> = [];
  const patchedRunPipeline = async (
    _ws: any,
    text: string,
    _ic: any,
    _avatar: any,
    _sessionId: any,
    _ctx: any,
    _generationId: any,
    _traceId: any,
    runOptions?: any,
  ) => {
    pipelineCalls.push({ text, options: runOptions });
    if (options.runPipelineImpl) {
      return options.runPipelineImpl(
        _ws,
        text,
        _ic,
        _avatar,
        _sessionId,
        _ctx,
        _generationId,
        _traceId,
        runOptions,
      );
    }
  };
  runner.runPipeline = patchedRunPipeline;

  const sessionPath = path.resolve(__dirname, "../../server/session/index.ts");
  const textChatPath = path.resolve(__dirname, "../../server/session/text_chat.ts");
  const voiceSubmitPath = path.resolve(
    __dirname,
    "../../server/session/voice_submit.ts",
  );
  delete require.cache[require.resolve(pipelineIndexPath)];
  delete require.cache[require.resolve(sessionPath)];
  delete require.cache[require.resolve(textChatPath)];
  delete require.cache[require.resolve(voiceSubmitPath)];
  const { createSession } = require(sessionPath);

  const ws = new FakeWebSocket();
  const session = createSession(
    ws,
    {
      url: options.reqUrl ?? "/ws",
      headers: {},
    } as any,
  );
  const transcript = options.transcript ?? "今天天气不错";

  session.stt.canPreviewPcm = () => false;
  session.stt.previewPcmBuffer = async () => null;
  const transcribePcmSnapshot =
    options.sttEndPcmImpl ?? (async () => transcript);
  session.stt.endPcm = async () => transcribePcmSnapshot();
  session.stt.transcribePcmSnapshot = async (...args: any[]) =>
    transcribePcmSnapshot(...args);
  session.stt.reset = () => {};
  session.stt.cancelPcm = () => {};
  session.stt.cancelPreview = () => {};
  session.stt.setSampleRate = () => {};

  const restore = () => {
    runner.runPipeline = originalRunPipeline;
    appState.setDbReady(previousDbReady);
    appState.setRedisReady(previousRedisReady);
    appState.setMemoryMode(previousMemoryMode);
    restoreEnvPatches(previousEnv);
    if (previousLogger) {
      require.cache[loggerPath] = previousLogger;
    } else {
      delete require.cache[loggerPath];
    }
    ws.close();
  };

  return { ws, session, restore, pipelineCalls };
}

async function waitFor(predicate: () => boolean, timeoutMs = 500): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timeout after ${timeoutMs}ms`);
}

module.exports = {
  loadSessionHarness,
  waitFor,
};
