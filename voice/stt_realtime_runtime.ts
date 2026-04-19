import OpenAI from "openai";
import { OpenAIRealtimeWS } from "openai/realtime/ws";

import { createLogger } from "../infra/logger";
import { resamplePcm16MonoLinear } from "../server/session/audio_resample";
import type {
  ActiveStreamingSttSession,
  StreamingTranscriptFinal,
  StreamingTranscriptHandlers,
  StreamingTranscriptPartial,
} from "./stt_incremental_types";

export type RealtimeSttProvider = "openai-realtime";

export type RealtimeSttConfig = {
  enabled: boolean;
  provider: RealtimeSttProvider;
  apiKey: string | null;
  baseURL: string | null;
  model: string;
  language: string | null;
  prompt: string | null;
  inputSampleRate: number;
  vadThreshold: number;
  vadPrefixPaddingMs: number;
  vadSilenceDurationMs: number;
  noiseReduction: "near_field" | "far_field" | null;
};

type RealtimeSocketLike = {
  socket?: {
    readyState?: number;
    on?(event: string, listener: (...args: any[]) => void): void;
    off?(event: string, listener: (...args: any[]) => void): void;
  };
  on(event: string, listener: (...args: any[]) => void): void;
  off?(event: string, listener: (...args: any[]) => void): void;
  send(event: any): void;
  close(props?: { code: number; reason: string }): void;
};

type RealtimeSttRuntimeDeps = {
  env?: NodeJS.ProcessEnv;
  connect?: (config: RealtimeSttConfig) => Promise<RealtimeSocketLike>;
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

function getIncrementalProvider(env: NodeJS.ProcessEnv): string {
  return (
    env.stt_incremental_provider ??
    env.STT_INCREMENTAL_PROVIDER ??
    env.stt_provider ??
    "openai"
  )
    .trim()
    .toLowerCase();
}

export function readRealtimeSttConfig(env: NodeJS.ProcessEnv = process.env): RealtimeSttConfig {
  const providerRaw = getIncrementalProvider(env);
  const provider: RealtimeSttProvider = "openai-realtime";
  const enabled =
    providerRaw === provider &&
    parseBoolean(env.REMI_STREAMING_STT_ENABLED ?? env.STT_STREAMING_ENABLED, false);
  const apiKey = (env.stt_key ?? env.OPENAI_API_KEY ?? "").trim() || null;
  const baseURL = (env.stt_base_url ?? env.OPENAI_BASE_URL ?? "").trim() || "https://api.openai.com/v1";
  const model = (env.STT_REALTIME_MODEL ?? env.stt_model ?? "gpt-4o-mini-transcribe").trim();
  const language = (env.stt_language ?? env.STT_REALTIME_LANGUAGE ?? "").trim() || null;
  const prompt = (env.stt_prompt ?? env.whisper_prompt ?? "").trim() || null;
  const inputSampleRate = 24_000;
  const vadThreshold = parseFinite(env.STT_REALTIME_VAD_THRESHOLD, 0.5);
  const vadPrefixPaddingMs = Math.max(0, Math.floor(parseFinite(env.STT_REALTIME_VAD_PREFIX_PADDING_MS, 300)));
  const vadSilenceDurationMs = Math.max(0, Math.floor(parseFinite(env.STT_REALTIME_VAD_SILENCE_MS, 500)));
  const noiseReductionRaw = (env.STT_REALTIME_NOISE_REDUCTION ?? "").trim().toLowerCase();
  const noiseReduction =
    noiseReductionRaw === "near_field" || noiseReductionRaw === "far_field"
      ? (noiseReductionRaw as "near_field" | "far_field")
      : null;

  return {
    enabled,
    provider,
    apiKey,
    baseURL,
    model,
    language,
    prompt,
    inputSampleRate,
    vadThreshold,
    vadPrefixPaddingMs,
    vadSilenceDurationMs,
    noiseReduction,
  };
}

class LiveRealtimeSession implements ActiveStreamingSttSession {
  private readonly partialByItemId = new Map<string, string>();
  private readonly queuedEvents: Array<Record<string, unknown>> = [];
  private readonly provider: RealtimeSttProvider = "openai-realtime";
  private sequence = 0;
  private opened = false;
  private closed = false;
  private sessionConfigured = false;

  private readonly handleSocketOpen = () => {
    this.opened = true;
    this.flushQueuedEvents();
  };

  private readonly handleDelta = (event: {
    item_id: string;
    delta?: string;
  }) => {
    const itemId = String(event.item_id || "").trim();
    const delta = String(event.delta ?? "");
    if (!itemId || !delta) return;
    const content = `${this.partialByItemId.get(itemId) ?? ""}${delta}`;
    this.partialByItemId.set(itemId, content);
    this.sequence += 1;
    this.handlers.onPartial({
      content,
      itemId,
      provider: this.provider,
      sequence: this.sequence,
      stability: "interim",
    });
  };

  private readonly handleCompleted = (event: {
    item_id: string;
    transcript?: string;
  }) => {
    const itemId = String(event.item_id || "").trim();
    const content = String(event.transcript ?? "").trim();
    if (!itemId || !content) return;
    this.partialByItemId.delete(itemId);
    this.sequence += 1;
    this.handlers.onFinal({
      content,
      itemId,
      provider: this.provider,
      sequence: this.sequence,
      stability: "final",
    });
  };

  private readonly handleFailure = (event: { error?: { message?: string } }) => {
    const message = event?.error?.message?.trim() || "realtime transcription failed";
    this.handlers.onError(new Error(message));
  };

  private readonly handleSocketError = (error: Error) => {
    this.handlers.onError(error);
  };

  private readonly socket: RealtimeSocketLike;
  private readonly config: RealtimeSttConfig;
  private readonly handlers: StreamingTranscriptHandlers;

  constructor(
    socket: RealtimeSocketLike,
    config: RealtimeSttConfig,
    handlers: StreamingTranscriptHandlers,
  ) {
    this.socket = socket;
    this.config = config;
    this.handlers = handlers;
    this.socket.on("conversation.item.input_audio_transcription.delta", this.handleDelta);
    this.socket.on("conversation.item.input_audio_transcription.completed", this.handleCompleted);
    this.socket.on("conversation.item.input_audio_transcription.failed", this.handleFailure);
    this.socket.on("error", this.handleSocketError);
    this.socket.socket?.on?.("open", this.handleSocketOpen);

    if (this.isSocketOpen()) {
      this.handleSocketOpen();
    }
  }

  appendPcm(pcm: Buffer, sampleRate: number): void {
    if (this.closed || pcm.length === 0) return;
    const safeRate =
      Number.isFinite(sampleRate) && sampleRate > 0
        ? Math.floor(sampleRate)
        : this.config.inputSampleRate;
    const nextPcm =
      safeRate === this.config.inputSampleRate
        ? pcm
        : resamplePcm16MonoLinear(pcm, safeRate, this.config.inputSampleRate);
    this.queueOrSend({
      type: "input_audio_buffer.append",
      audio: nextPcm.toString("base64"),
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.queuedEvents.length = 0;
    this.socket.socket?.off?.("open", this.handleSocketOpen);
    this.socket.off?.("conversation.item.input_audio_transcription.delta", this.handleDelta);
    this.socket.off?.("conversation.item.input_audio_transcription.completed", this.handleCompleted);
    this.socket.off?.("conversation.item.input_audio_transcription.failed", this.handleFailure);
    this.socket.off?.("error", this.handleSocketError);
    this.socket.close({ code: 1000, reason: "streaming_stt_closed" });
  }

  private isSocketOpen(): boolean {
    return this.socket.socket?.readyState === 1;
  }

  private queueOrSend(event: Record<string, unknown>): void {
    if (this.opened && this.sessionConfigured) {
      this.socket.send(event);
      return;
    }
    this.queuedEvents.push(event);
    if (this.opened) {
      this.flushQueuedEvents();
    }
  }

  private flushQueuedEvents(): void {
    if (!this.opened || this.closed) return;
    if (!this.sessionConfigured) {
      this.socket.send(this.buildSessionUpdateEvent());
      this.sessionConfigured = true;
    }
    while (this.queuedEvents.length > 0) {
      const next = this.queuedEvents.shift();
      if (next) {
        this.socket.send(next);
      }
    }
  }

  private buildSessionUpdateEvent(): Record<string, unknown> {
    const inputAudioTranscription: Record<string, unknown> = {
      model: this.config.model,
    };
    if (this.config.language) {
      inputAudioTranscription.language = this.config.language;
    }
    if (this.config.prompt) {
      inputAudioTranscription.prompt = this.config.prompt;
    }

    const session: Record<string, unknown> = {
      input_audio_format: "pcm16",
      input_audio_transcription: inputAudioTranscription,
      turn_detection: {
        type: "server_vad",
        threshold: this.config.vadThreshold,
        prefix_padding_ms: this.config.vadPrefixPaddingMs,
        silence_duration_ms: this.config.vadSilenceDurationMs,
      },
    };

    if (this.config.noiseReduction) {
      session.input_audio_noise_reduction = { type: this.config.noiseReduction };
    }

    return {
      type: "transcription_session.update",
      session,
    };
  }
}

export function createRealtimeSttRuntime(deps: RealtimeSttRuntimeDeps = {}) {
  const env = deps.env ?? process.env;
  const logger = deps.logger ?? createLogger("stt");
  const connect =
    deps.connect ??
    (async (config: RealtimeSttConfig): Promise<RealtimeSocketLike> => {
      if (!config.apiKey) {
        throw new Error("STT 未配置：请设置 stt_key 用于 openai-realtime provider");
      }
      const client = new OpenAI({
        apiKey: config.apiKey,
        ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      });
      return await OpenAIRealtimeWS.create(client, {
        model: config.model,
      });
    });

  function readConfig(): RealtimeSttConfig {
    return readRealtimeSttConfig(env);
  }

  function canUseRealtime(): boolean {
    const config = readConfig();
    return config.enabled && Boolean(config.apiKey);
  }

  async function createSession(handlers: StreamingTranscriptHandlers): Promise<ActiveStreamingSttSession> {
    const config = readConfig();
    if (!config.enabled) {
      throw new Error("openai-realtime streaming stt is disabled");
    }
    if (!config.apiKey) {
      throw new Error("STT 未配置：请设置 stt_key 用于 openai-realtime provider");
    }
    logger.info("realtime stt session start", {
      provider: config.provider,
      model: config.model,
      baseURL: config.baseURL ?? undefined,
    });
    const socket = await connect(config);
    return new LiveRealtimeSession(socket, config, handlers);
  }

  return {
    readConfig,
    canUseRealtime,
    createSession,
  };
}

export const realtimeSttRuntime = createRealtimeSttRuntime();
export type RealtimeTranscriptPartial = StreamingTranscriptPartial;
export type RealtimeTranscriptFinal = StreamingTranscriptFinal;
export type RealtimeTranscriptHandlers = StreamingTranscriptHandlers;
