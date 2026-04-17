const path = require("path");
const { FakeWebSocket } = require("./fake_ws");

type SoakHarnessOptions = {
  transcript?: string;
  chatStreamImpl?: (
    ctx: any,
    message: string,
    emotion: string,
    signal?: AbortSignal,
    routeOpts?: any,
  ) => AsyncGenerator<string>;
  synthesizeImpl?: (text: string, signal?: AbortSignal, emotion?: string) => Promise<Buffer>;
  autoPlaybackStart?: boolean;
  scenarioKey?: string;
};

type LatencyLog = {
  connId: string;
  traceId: string;
  scenarioKey: string | null;
  sessionId: string | null;
  generationId: number | null;
  source: string | null;
  releaseReason: string | null;
  releaseStableMs: number | null;
  prosodyApplied: string | null;
  usedNoVadFallback: boolean;
  previewText: string | null;
  finalTranscript: string | null;
  interruptionType: string | null;
  turnStateTransitions: Array<{
    state: string;
    reason: string;
    at: number;
    generationId?: number;
    preview?: string | null;
    interruptionType?: string | null;
  }>;
  metrics: Record<string, number | null>;
  timestamps: Record<string, number | undefined>;
};

const ENV_PATCHES: Record<string, string> = {
  STT_PARTIAL_PREDICTION_ENABLED: "0",
  STT_PREDICTION_PUSH_ENABLED: "0",
  VOICE_BACKCHANNEL_ENABLED: "0",
  REMI_SILENCE_NUDGE_MS: "0",
  interrupt_reaction: "0",
  REMI_SLOW_BRAIN_ENABLED: "0",
  REMI_AVATAR_INTENT_ENABLED: "0",
  LOG_LEVEL: "error",
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

async function* defaultChatStream(
  _ctx: any,
  _message: string,
  _emotion: string,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  if (signal?.aborted) return;
  yield "好的，我在这里。";
}

async function defaultSynthesize(
  _text: string,
  signal?: AbortSignal,
): Promise<Buffer> {
  if (signal?.aborted) {
    const err = new Error("aborted");
    err.name = "AbortError";
    throw err;
  }
  return Buffer.from("voice");
}

function parseOutgoingMessage(raw: unknown): any | null {
  try {
    if (typeof raw === "string") return JSON.parse(raw);
    if (Buffer.isBuffer(raw)) return JSON.parse(raw.toString("utf8"));
    if (raw instanceof Uint8Array) return JSON.parse(Buffer.from(raw).toString("utf8"));
    return null;
  } catch {
    return null;
  }
}

function patchLatencyCapture(latencyLogs: LatencyLog[], options: SoakHarnessOptions) {
  const latencyModulePath = path.resolve(__dirname, "../../infra/latency_tracer.ts");
  const latencyModule = require(latencyModulePath);
  const originalLog = latencyModule.LatencyTracer.prototype.log;

  latencyModule.LatencyTracer.prototype.log = function patchedLog(traceId = "legacy") {
    const traceStore = this.traces;
    const trace = traceStore?.get?.(traceId);
    if (trace && !trace.completed) {
      const context = this.getContext(traceId) ?? {};
      latencyLogs.push({
        connId: this.connId,
        traceId,
        scenarioKey: context.scenarioKey ?? options.scenarioKey ?? null,
        sessionId: context.sessionId ?? null,
        generationId: context.generationId ?? null,
        source: context.source ?? null,
        releaseReason: context.releaseReason ?? null,
        releaseStableMs: context.releaseStableMs ?? null,
        prosodyApplied: context.prosodyApplied ?? null,
        usedNoVadFallback: context.usedNoVadFallback ?? false,
        previewText: context.previewText ?? null,
        finalTranscript: context.finalTranscript ?? null,
        interruptionType: context.interruptionType ?? null,
        turnStateTransitions: context.turnStateTransitions ?? [],
        metrics: latencyModule.LatencyTracer.normalizeMetrics(this.computeMetrics(traceId)),
        timestamps: this.getAllTimestamps(traceId),
      });
    }
    return originalLog.call(this, traceId);
  };

  return () => {
    latencyModule.LatencyTracer.prototype.log = originalLog;
  };
}

function loadSoakSessionHarness(options: SoakHarnessOptions = {}) {
  const previousEnv = applyEnvPatches();
  const appStatePath = path.resolve(__dirname, "../../infra/app_state.ts");
  const conversationAgentPath = path.resolve(__dirname, "../../agents/conversation_agent.ts");
  const avatarIntentPath = path.resolve(__dirname, "../../agents/avatar_intent_agent.ts");
  const ttsPath = path.resolve(__dirname, "../../voice/tts.ts");
  const ttsStreamPath = path.resolve(__dirname, "../../voice/tts_stream.ts");
  const pipelineIndexPath = path.resolve(__dirname, "../../server/pipeline/index.ts");
  const runnerPath = path.resolve(__dirname, "../../server/pipeline/runner.ts");
  const sessionPath = path.resolve(__dirname, "../../server/session/index.ts");

  const appState = require(appStatePath);
  const previousDbReady = appState.isDbReady();
  const previousRedisReady = appState.isRedisReady();
  const previousMemoryMode = appState.getMemoryMode();
  appState.setDbReady(false);
  appState.setRedisReady(false);
  appState.setMemoryMode("in-memory");

  const previousConversationAgent = require.cache[conversationAgentPath];
  const previousAvatarIntent = require.cache[avatarIntentPath];
  const previousTts = require.cache[ttsPath];
  const previousTtsStream = require.cache[ttsStreamPath];

  require.cache[conversationAgentPath] = {
    id: conversationAgentPath,
    filename: conversationAgentPath,
    loaded: true,
    exports: {
      chatStream: options.chatStreamImpl ?? defaultChatStream,
    },
  };
  require.cache[avatarIntentPath] = {
    id: avatarIntentPath,
    filename: avatarIntentPath,
    loaded: true,
    exports: {
      inferAvatarIntentFromReply: async () => null,
    },
  };
  require.cache[ttsPath] = {
    id: ttsPath,
    filename: ttsPath,
    loaded: true,
    exports: {
      canStreamTextToSpeech: () => false,
      streamTextToSpeech: async () => {},
    },
  };
  require.cache[ttsStreamPath] = {
    id: ttsStreamPath,
    filename: ttsStreamPath,
    loaded: true,
    exports: {
      isTtsEnabled: () => true,
      synthesize: options.synthesizeImpl ?? defaultSynthesize,
    },
  };

  delete require.cache[pipelineIndexPath];
  delete require.cache[runnerPath];
  delete require.cache[sessionPath];

  const latencyLogs: LatencyLog[] = [];
  const restoreLatencyCapture = patchLatencyCapture(latencyLogs, options);

  const { createSession } = require(sessionPath);
  const { getLatencyTracer } = require(path.resolve(__dirname, "../../infra/latency_tracer.ts"));
  const ws = new FakeWebSocket();
  const playbackSeen = new Set<number>();
  const originalEmitMessage = ws.emitMessage.bind(ws);
  const originalSend = ws.send.bind(ws);
  let session: any = null;

  ws.emitMessage = (payload: unknown) => {
    try {
      if (typeof payload === "string") {
        const parsed = JSON.parse(payload);
        if (
          parsed?.type === "duplex_stop" &&
          session?.pendingVoiceTraceId
        ) {
          getLatencyTracer(session.connId).mark("vad_speech_end", session.pendingVoiceTraceId);
        }
      }
    } catch {}
    return originalEmitMessage(payload);
  };

  ws.send = (raw: unknown) => {
    const result = originalSend(raw);
    const parsed = parseOutgoingMessage(raw);
    const generationId =
      parsed && typeof parsed.generationId === "number"
        ? parsed.generationId
        : null;
    const isVoice =
      parsed?.type === "voice" || parsed?.type === "voice_pcm_chunk";

    if (
      options.autoPlaybackStart !== false &&
      isVoice &&
      generationId !== null &&
      !playbackSeen.has(generationId)
    ) {
      playbackSeen.add(generationId);
      ws.emitMessage(
        JSON.stringify({
          type: "playback_start",
          generationId,
        }),
      );
    }
    return result;
  };

  session = createSession(ws, {} as any);
  const transcript = options.transcript ?? "你好，我在这里。";

  session.stt.canPreviewPcm = () => false;
  session.stt.previewPcmBuffer = async () => null;
  session.stt.endPcm = async () => transcript;
  session.stt.transcribePcmSnapshot = async () => transcript;
  session.stt.reset = () => {};
  session.stt.cancelPcm = () => {};
  session.stt.cancelPreview = () => {};
  session.stt.setSampleRate = () => {};

  return {
    ws,
    session,
    latencyLogs,
    restore() {
      restoreLatencyCapture();
      if (previousConversationAgent) {
        require.cache[conversationAgentPath] = previousConversationAgent;
      } else {
        delete require.cache[conversationAgentPath];
      }
      if (previousAvatarIntent) {
        require.cache[avatarIntentPath] = previousAvatarIntent;
      } else {
        delete require.cache[avatarIntentPath];
      }
      if (previousTts) {
        require.cache[ttsPath] = previousTts;
      } else {
        delete require.cache[ttsPath];
      }
      if (previousTtsStream) {
        require.cache[ttsStreamPath] = previousTtsStream;
      } else {
        delete require.cache[ttsStreamPath];
      }
      delete require.cache[pipelineIndexPath];
      delete require.cache[runnerPath];
      delete require.cache[sessionPath];
      appState.setDbReady(previousDbReady);
      appState.setRedisReady(previousRedisReady);
      appState.setMemoryMode(previousMemoryMode);
      restoreEnvPatches(previousEnv);
      ws.close();
    },
  };
}

function emitDuplexStart(ws: any, sampleRate = 16_000) {
  ws.emitMessage(JSON.stringify({ type: "duplex_start", sampleRate }));
}

function emitDuplexStop(ws: any) {
  ws.emitMessage(JSON.stringify({ type: "duplex_stop" }));
}

function emitFrames(ws: any, frames: Buffer[], sampleRate = 16_000) {
  const { makeRaudFrame } = require("./pcm");
  for (const frame of frames) {
    ws.emitMessage(makeRaudFrame(frame, sampleRate));
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 800): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timeout after ${timeoutMs}ms`);
}

module.exports = {
  loadSoakSessionHarness,
  emitDuplexStart,
  emitDuplexStop,
  emitFrames,
  waitFor,
};
