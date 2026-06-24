import { WebSocket } from "ws";
import { randomUUID } from "crypto";
import type { IncomingMessage } from "http";

import { SttStream } from "../../voice/stt_stream";
import type { StreamingTranscriptPartial } from "../../voice/stt_incremental_types";
import type {
  SttTranscribeMeta,
  SttTranscribeOptions,
} from "../../voice/stt_stream";
import { VadDetector } from "../../voice/vad_detector";
import { InterruptController } from "../../voice/interrupt_controller";
import { AvatarController } from "../../avatar/avatar_controller";
import { createLogger } from "../../infra/logger";
import { getLatencyTracer } from "../../infra/latency_tracer";
import type { UserMessageHistoryCursor } from "../../storage/repositories/message_repository";
import { RemiSessionContext } from "../../brains/remi_session_context";
import { runPipeline } from "../pipeline";
import { send } from "../gateway";
import { synthesize, isTtsEnabled } from "../../voice/tts_stream";
import type { TurnAnalysisBundle } from "../../brain/turn_interpreter";
import type { InterruptionType, RemiTurnState, RemiTurnStateReason } from "../../avatar/types";
import { resolveTurnDetector } from "./voice/turn_detector";
import { SpeechRuntime } from "./voice/speech_runtime";
import { resolveVoiceEngine } from "./voice/engine";
import type { VoiceEngine } from "./voice/engine";
import {
  evaluateBackchannelDecision,
  getMeaningfulTurnPreview,
  isTentativeSpeechText,
  shouldSuppressFallbackNoiseUtterance,
  shouldSuppressRecoveredFallbackUtterance,
  shouldSuppressStrictNoPreviewUtterance,
  strongFrameRatio,
  type TurnTakingState,
} from "./turn_taking";
import { buildCarryForwardHint, classifyInterruption } from "./interruption";
import { resolveRequestUserIdentity } from "../../infra/user_identity";
import { initializeSessionStorage } from "./bootstrap";
import {
  fireSessionSilenceNudge,
  isContinuousConversation,
  persistRelationshipContinuityState,
  persistRemiSelfState,
  syncSessionVadSilenceThreshold,
  touchSessionUserActivity,
} from "./continuity";
import { loadAndApplyRemiSelf } from "./remi_self";
import {
  applyDeveloperPreset,
  applyDeveloperTtsVoiceOverride,
  resetDeveloperState,
  resetDeveloperLiveSessionState,
  runSessionDevCommand,
} from "./developer";
import {
  appendChunkWithByteCap,
  isNoVadFallbackSpeechLikeFrame,
  shouldAttemptNoVadDuplexFallback,
} from "./duplex_audio";
import { parseHistoryCursor, sendSessionHistoryPage } from "./history";
import { cleanupSessionResources, attachSessionCloseHandlers } from "./lifecycle";
import {
  relationshipStateEnabled,
  savePersistentRelationshipState,
} from "../../memory/relationship_state";
import { bindNsfwNotifier, restoreNsfwForUser, sendNsfwModeState } from "../../brains/nsfw_mode";
import { attachSessionMessageHandlers } from "./message_router";
import { getConfig } from "../config";
import { isPersonaPresetId } from "../../persona/presets";
import { saveUserPersonaPreset } from "../../storage/repositories/user_persona_preset_repository";
import {
  duplexAssistantNoPreviewInterruptMinSpeechMs,
  duplexIdleGuardAfterMs,
  duplexIdleGuardMeaningfulPreviewChars,
  duplexIdleGuardMinRms,
  duplexIdleGuardMinSpeechMs,
  duplexIdleGuardMinStrongRatio,
  duplexIdleGuardNoPreviewMinRms,
  duplexIdleGuardNoPreviewMinSpeechMs,
  duplexIdleGuardNoPreviewMinStrongRatio,
  duplexInterruptMinSpeechMs,
  duplexFallbackInterruptMinPreviewChars,
  duplexFallbackInterruptMinRms,
  duplexFallbackInterruptMinSpeechMs,
  duplexFallbackInterruptMinStrongRatio,
  effectiveUtteranceGapMs,
  fallbackMinStrongFrames,
  fallbackMinStrongRatio,
  fallbackNoiseSuppressMaxMs,
  fallbackNoiseSuppressMinRms,
  fallbackNoiseShortTextMaxChars,
  fallbackNoiseTinyTextMaxChars,
  fallbackStrongFramePeak,
  fallbackStrongFrameRms,
  fallbackWeakSpeechSuppressMaxMs,
  hesitationHoldMs,
  minSpeechMs,
  pcmPeak,
  pcmRms,
  predictionBudgetConfig,
  preRollMaxBytes,
  proactivePlannerMainPathEnabled,
  randomInterruptReaction,
  silenceNudgeMs,
  sttPreviewDebounceMs,
  sttPreviewIntervalMs,
  sttPreviewMinSpeechMs,
  sttPreviewSettleMs,
  sttPreviewWindowMs,
  strictCandidateMinSpeechMs,
  strictCandidateMinStrongFrames,
  strictCandidateMinStrongRatio,
  suppressedNoiseBypassPeak,
  suppressedNoiseBypassRms,
  iosDuplexInputGain,
  suppressedNoiseCooldownMs,
  turnTakingConfirmedStableMs,
  turnTakingEnabled,
  turnTakingGrowthHoldMs,
  turnTakingLikelyStableMs,
  turnProsodyEnabled,
  type PredictionBudgetConfig,
  voiceBackchannelCooldownMs,
  voiceBackchannelEnabled,
  voiceBackchannelStableMs,
} from "./runtime_config";
import {
  getPartialShapeAggregates,
  resolvePredictionGate,
  resolveUtteranceGapMs,
  updatePartialTrackingState,
  type PartialShapeAggregates,
  type PartialShapeSample,
  type PredictionGate,
} from "./turn_runtime";
import {
  appendProsodySample,
  summarizeProsody,
  type ProsodySample,
} from "../../voice/prosody_detector";
import {
  classifyPreviewlessShortDuplexTranscript,
  classifyNonSpeechTranscript,
  heuristicTurnTakingPredictor,
  type PredictorScores,
} from "./turn_taking_predictor";
import { publishSessionTurnState } from "./turn_state_protocol";
import {
  prepareVoicePipelineTurn,
  runPreparedVoicePipelineTurn,
  submitVoicePipelineTurn,
} from "./voice_submit";
import { computeSessionPrediction } from "./prediction";
import { handleSessionTextChat } from "./text_chat";
import { handleSessionWorldEvent } from "./world_event";
import {
  normalizeClientContextTtsTransport,
  resolveSessionTransportFromRequest,
  type ClientContextTtsTransport,
  type SessionClientFamily,
  type SessionTtsTransport,
} from "./tts_transport";
import { applyPcm16Gain, normalizeDuplexPcm16Mono } from "./audio_resample";
import {
  clearSessionTtsRuntimeOverride,
  setSessionMlxVoiceStyle,
  setSessionMlxSpeedModifier,
  setSessionMlxPitchModifier,
  setSessionTtsEnabled,
} from "../../voice/tts_runtime_overrides";
import { notifySessionStart, notifySessionEnd } from "../../plugin/registry";

const logger = createLogger("session");
const HISTORY_PAGE_SIZE = 15;
const DUPLEX_RAW_FALLBACK_MAX_MS = 15_000;
const DUPLEX_SUPPRESSED_FALLBACK_MAX_MS = 4_000;
const DUPLEX_TARGET_SAMPLE_RATE = 16_000;
const DUPLEX_PENDING_COMMIT_FALLBACK_RESTART_IGNORE_MS = 320;
type DuplexInputMode = "duplex" | "push_to_talk";
type DuplexIngressTransport = "binary" | "json";
type DuplexUtteranceSource =
  | "speech_buffer"
  | "duplex_stop_buffer"
  | "duplex_stop_suppressed_fallback"
  | "duplex_stop_no_vad";
type SttJobPriority = "high" | "low";
type DuplexNoVadReason =
  | "true_silence"
  | "non_16k_normalized_still_no_vad"
  | "weak_low_energy_audio"
  | "speech_shape_not_confirmed";

interface DuplexUtteranceJob {
  utteranceSeq: number;
  sttJobSeq: number;
  traceId: string;
  source: DuplexUtteranceSource;
  enqueuedAt: number;
  sampleRate: number;
  pcm: Buffer;
  durationMs: number;
  previewText: string;
  vadMode: string | null;
  utteranceFrameCount: number;
  utteranceStrongFrames: number;
  utteranceMaxRms: number;
  utteranceMaxPeak: number;
  rawFrameCount: number;
  rawStrongFrames: number;
  rawMaxRms: number;
  ingressSampleRate: number;
  normalizedSampleRate: number;
  transport: DuplexIngressTransport;
  usedNoVadFallback: boolean;
  speechEndedAt: number;
  priority: SttJobPriority;
  idleGuardActive: boolean;
  allowCliFallback: boolean;
}

interface DeferredDuplexTranscript {
  job: DuplexUtteranceJob;
  text: string;
  deferredAt: number;
}

interface ActiveSttJob {
  utteranceSeq: number;
  sttJobSeq: number;
  traceId: string;
  priority: SttJobPriority;
  abortController: AbortController;
  preemptReason: string | null;
}

export class ConnectionSession {
  readonly connId: string;
  readonly brain: RemiSessionContext;
  readonly ws: WebSocket;
  readonly stt: SttStream;
  readonly vad: VadDetector;
  readonly interrupt: InterruptController;
  readonly avatar: AvatarController;
  readonly storageUserId: string;
  readonly authPrincipal: ReturnType<typeof resolveRequestUserIdentity>["authPrincipal"];
  readonly clientFamily: SessionClientFamily;
  private readonly resolvedTtsTransport: SessionTtsTransport;
  private readonly handshakeTtsTransportRaw: string | null;
  private clientContextTtsTransport: ClientContextTtsTransport | null = null;
  private personaPresetBootstrapReady = false;
  /** Phase 1 pluggable turn-end / barge-in classification (legacy only for now). */
  private readonly turnDetector: ReturnType<typeof resolveTurnDetector>;
  /** Phase 1 SHADOW-ONLY observer. Never sends, never mutates session state. */
  private readonly speechRuntime: SpeechRuntime;
  /**
   * Phase 1 swappable voice shell (docs/voice/VOICE_NATIVE_MODE.md). Default
   * `legacy` is a no-op pass-through (byte-identical to pre-seam). Mutable so a
   * per-session WS `set_voice_engine` override can swap it live.
   */
  private voiceEngine: VoiceEngine;

  sessionId: string | null = null;
  /**
   * Lazy DB session creator — set by bootstrap, invoked by runner on first
   * message persist. Avoids creating empty session rows for connections that
   * never send a message (98%+ of ws connections in production).
   */
  private _dbSessionPending: (() => Promise<string>) | null = null;
  setDbSessionCreator(fn: () => Promise<string>): void {
    this._dbSessionPending = fn;
  }
  async ensureDbSession(): Promise<string | null> {
    if (this.sessionId) return this.sessionId;
    const creator = this._dbSessionPending;
    if (!creator) return null;
    this._dbSessionPending = null; // one-shot
    const id = await creator();
    this.sessionId = id;
    return id;
  }
  pipelineChain: Promise<void> = Promise.resolve();
  private sttChain: Promise<void> = Promise.resolve();
  duplexActive: boolean = false;
  speechBuffer: Buffer[] = [];
  private speechBufferBytes: number = 0;
  private duplexRawChunks: Buffer[] = [];
  private duplexRawBytes = 0;
  private duplexRawStrongFrames = 0;
  private suppressedFallbackChunks: Buffer[] = [];
  private suppressedFallbackBytes = 0;
  private suppressedFallbackFrameCount = 0;
  private suppressedFallbackStrongFrames = 0;
  private suppressedFallbackMaxRms = 0;
  private suppressedFallbackMaxPeak = 0;
  private suppressedFallbackLastSpeechEndAt = 0;
  private suppressedFallbackSegments = 0;

  /** Last ~VAD_PRE_ROLL_MS of PCM before speech_start (same chunks client sends). */
  private preRollChunks: Buffer[] = [];
  private preRollBytes = 0;
  private duplexSampleRate = 16000;
  private duplexInputMode: DuplexInputMode = "duplex";
  /** After injecting pre-roll, skip one push — current chunk is already in pre-roll. */
  private suppressNextSpeechChunk = false;

  /** Deferred STT after speech_end so mid-sentence pauses can merge into one utterance. */
  private pendingUtteranceTimer: ReturnType<typeof setTimeout> | null = null;

  /** 用户无消息后触发陪伴搭话（需 REMI_SILENCE_NUDGE_MS>0） */
  private silenceNudgeTimer: ReturnType<typeof setTimeout> | null = null;
  private previewTimer: ReturnType<typeof setTimeout> | null = null;
  private previewInFlight = false;
  private lastPreviewAt = 0;
  private lastPreviewText = "";
  private lastPreviewCandidateText = "";
  private lastPartialEmitAt = 0;
  private lastPartialContent = "";
  private generationSeq = 0;
  private activeGenerationId: number | null = null;
  private traceSeq = 0;
  private pendingVoiceTraceId: string | null = null;
  private activeTraceId: string | null = null;
  private utteranceSeq = 0;
  private lastAcceptedUtteranceSeq = 0;
  private lastConfirmedInterruptAt = 0;
  private lastAcceptedSpeechAt = 0;
  private lastMeaningfulSpeechAt = 0;
  private sttJobSeq = 0;
  private pendingSttUtteranceSeqs = new Set<number>();
  private pendingSttJobPriority = new Map<number, SttJobPriority>();
  private pendingSttJobTrace = new Map<number, string>();
  private preemptedSttJobs = new Map<number, string>();
  private activeSttJob: ActiveSttJob | null = null;
  private deferredDuplexTranscripts = new Map<number, DeferredDuplexTranscript>();
  private duplexIngressSampleRate = DUPLEX_TARGET_SAMPLE_RATE;
  private duplexNormalizedSampleRate = DUPLEX_TARGET_SAMPLE_RATE;
  private duplexIngressTransport: DuplexIngressTransport = "binary";
  private lastUnexpectedSampleRateLogAt = 0;
  private pendingVadStartSignal = false;
  private activeVadStartSignal = false;
  private ignoredFallbackRestartActive = false;
  private duplexIdleGuardActive = false;
  private duplexIdleSince = 0;

  /** 连续对话相关配置 */
  private lastInteractionAt: number = 0;
  private recentInteractionCount: number = 0;
  private readonly CONTINUOUS_CONVERSATION_THRESHOLD = 3; // 近3轮交互判定为连续对话
  private readonly CONTINUOUS_CONVERSATION_TIMEOUT = 5 * 60 * 1000; // 5分钟无交互退出连续对话
  private readonly VAD_CONTINUOUS_SILENCE_FRAMES = 8; // 连续对话场景静默帧阈值
  private readonly VAD_DEFAULT_SILENCE_FRAMES = 10; // 默认静默帧阈值

  // --- 增量STT预判相关 --- 
  private readonly predictionBudget: PredictionBudgetConfig = predictionBudgetConfig();
  private predictionEnabled: boolean = this.predictionBudget.enabled;
  private predictionPushEnabled: boolean = this.predictionBudget.pushEnabled;
  private predictionDebounceMs: number = this.predictionBudget.debounceMs;
  private predictionTimer: ReturnType<typeof setTimeout> | null = null;
  private predictionAbort: AbortController | null = null;
  private currentPartialText: string = "";
  private predictedReply: string = "";
  private predictedStructuredAnalysis: TurnAnalysisBundle | null = null;
  private turnTakingState: TurnTakingState = "CONFIRMED_END";
  private lastMeaningfulPartialText = "";
  private lastMeaningfulPartialAt = 0;
  private lastMeaningfulGrowthAt = 0;
  private lastMeaningfulGrowthChars = 0;
  private recentPartialPlateauCount = 0;
  private partialShapeSamples: PartialShapeSample[] = [];
  private readonly PARTIAL_SHAPE_MAX_SAMPLES = 6;
  private prosodySamples: ProsodySample[] = [];
  private readonly PROSODY_MAX_SAMPLES = 10;
  private lastPredictionIssuedAt = 0;
  private lastPredictionIssuedText = "";
  private turnState: RemiTurnState = "confirmed_end";
  private lastPublishedTurnState: RemiTurnState | null = null;
  private lastPublishedTurnReason: RemiTurnStateReason | null = null;
  private turnStateEnteredAt = 0;
  private lastSpeechStartAt = 0;
  private lastSpeechEndAt = 0;
  private lastSttFinalAt = 0;
  /** Last vocal tone string built from SenseVoice emotion/event (consumed once by voice_submit). */
  private lastSttVocalTone: string | null = null;
  private lastAssistantEnterAt = 0;
  private lastPlaybackStartAt = 0;
  private assistantPlaybackActive = false;
  private playbackGenerationId: number | null = null;
  private lastInterruptionType: InterruptionType | null = null;
  private lastBackchannelAt = 0;
  private backchannelSentThisTurn = false;
  private pendingDuplexInterrupt = false;
  private currentSpeechMaxRms = 0;
  private duplexRxStartedAt = 0;
  private duplexRxFrames = 0;
  private duplexRxBytes = 0;
  private duplexRxLastRms = 0;
  private duplexRxLastPeak = 0;
  private duplexRxMaxRms = 0;
  private duplexRxVadStarts = 0;
  private duplexRxLastLogAt = 0;
  private lastVadStartMode: string | null = null;
  private pendingListeningPromotion = false;
  private utteranceFrameCount = 0;
  private utteranceStrongFrames = 0;
  private utteranceMaxRms = 0;
  private utteranceMaxPeak = 0;
  private suppressedNoiseCooldownUntil = 0;
  private lastSuppressedNoiseLogAt = 0;

  private duplexStopDebugMeta(extra?: Record<string, unknown>): Record<string, unknown> {
    return {
      connId: this.connId,
      clientFamily: this.clientFamily,
      duplexInputGain: this.currentDuplexInputGain(),
      ttsTransport: this.resolvedTtsTransport,
      timeZone: this.brain.getClientTimeZone(),
      locale: this.brain.getClientLocale(),
      duplexActive: this.duplexActive,
      duplexInputMode: this.duplexInputMode,
      utteranceSeq: this.utteranceSeq,
      sampleRate: this.duplexSampleRate,
      ingressSampleRate: this.duplexIngressSampleRate,
      normalizedSampleRate: this.duplexNormalizedSampleRate,
      transport: this.duplexIngressTransport,
      speechBufferChunks: this.speechBuffer.length,
      speechBufferBytes: this.speechBufferBytes,
      rawChunks: this.duplexRawChunks.length,
      rawBytes: this.duplexRawBytes,
      suppressedFallbackChunks: this.suppressedFallbackChunks.length,
      suppressedFallbackBytes: this.suppressedFallbackBytes,
      suppressedFallbackSegments: this.suppressedFallbackSegments,
      rawFrames: this.duplexRxFrames,
      rawMaxRms: Number(this.duplexRxMaxRms.toFixed(4)),
      rawLastPeak: Number(this.duplexRxLastPeak.toFixed(4)),
      vadStarts: this.duplexRxVadStarts,
      lastVadStartMode: this.lastVadStartMode,
      previewText: this.lastMeaningfulPartialText || this.lastPreviewText || "",
      ...extra,
    };
  }

  private currentDuplexInputGain(): number {
    return this.clientFamily === "ios_lite" ? iosDuplexInputGain() : 1;
  }

  constructor(ws: WebSocket, req: IncomingMessage) {
    this.connId = randomUUID();
    this.turnDetector = resolveTurnDetector(this.connId);
    this.speechRuntime = new SpeechRuntime(this.connId);
    this.voiceEngine = resolveVoiceEngine(this.connId, this.speechRuntime);
    this.brain = new RemiSessionContext(this.connId);
    notifySessionStart(this.connId);
    this.ws = ws;
    bindNsfwNotifier(this.connId, this.ws);
    // Async capabilities (video generation) finish long after tryHandle() returns
    // (~28 min). They push their result over this same long-lived WS via the
    // brain's sendServerMessage hook. Web text chat also rides this WS, so the
    // result reaches the browser's onMessage dispatch (video_ready/video_error).
    this.brain.sendServerMessage = (msg) => {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(msg));
      }
    };
    this.stt = new SttStream();
    this.vad = new VadDetector();
    this.interrupt = new InterruptController();
    this.avatar = new AvatarController();
    const requestIdentity = resolveRequestUserIdentity(req);
    this.storageUserId = requestIdentity.storageUserId;
    this.authPrincipal = requestIdentity.authPrincipal;
    const transportMeta = resolveSessionTransportFromRequest(req);
    this.clientFamily = transportMeta.clientFamily;
    this.resolvedTtsTransport = transportMeta.ttsTransport;
    this.handshakeTtsTransportRaw = transportMeta.rawTtsTransport;
    this.brain.setUserId(this.storageUserId);

    this.setupSttEvents();
    this.setupVadEvents();
    this.setupMessageHandlers();
    this.setupCloseHandlers();
  }

  private setupSttEvents(): void {
    this.stt.on("streaming_partial", (event: StreamingTranscriptPartial) => {
      this.handleStreamingSttPartial(event);
    });
    this.stt.on("error", (error: Error) => {
      logger.warn("[STT realtime]", {
        connId: this.connId,
        error: error.message,
      });
    });
  }

  private async sendHistoryPage(
    mode: "replace" | "prepend",
    cursor?: UserMessageHistoryCursor | null,
  ): Promise<void> {
    await sendSessionHistoryPage({
      sink: this.ws,
      storageUserId: this.storageUserId,
      connId: this.connId,
      pageSize: HISTORY_PAGE_SIZE,
      mode,
      cursor,
    });
  }

  async initializeAsync(): Promise<void> {
    logger.info("[Remi] 新客户端已连接", {
      connId: this.connId,
      userId: this.storageUserId,
      clientFamily: this.clientFamily,
      ttsTransport: this.resolvedTtsTransport,
    });
    try {
      await initializeSessionStorage({
        connId: this.connId,
        storageUserId: this.storageUserId,
        authPrincipal: this.authPrincipal,
        brain: this.brain,
        historyPageSize: HISTORY_PAGE_SIZE,
        setSessionId: (sessionId) => {
          this.sessionId = sessionId;
        },
        setDbSessionCreator: (fn) => {
          this.setDbSessionCreator(fn);
        },
        sendHistoryPage: (mode) => this.sendHistoryPage(mode),
      });
    } finally {
      this.personaPresetBootstrapReady = true;
    }
    // DL-P1b: 异步加载 RemiSelf + 漂移 + soft-patch（绝不阻塞握手 / fast path）。
    // 在 bootstrap 之后跑，用最终解析出的 brain.userId；flag off / 无记录 / 失败
    // 静默 no-op。fire-and-forget，不 await。
    void loadAndApplyRemiSelf(this.brain, this.brain.userId);
    this.sendPersonaPresetState();
    // Re-enable adult mode if this user dropped while in it and reconnected
    // within the restore window (crash / network blip / redeploy). New sessions
    // past the window stay off. Must run before announcing the state below.
    await restoreNsfwForUser(this.connId, this.brain.userId);
    sendNsfwModeState(this.connId);
  }

  private sendPersonaPresetState(): void {
    send(this.ws, {
      type: "persona_preset_state",
      presetId: this.brain.persona.profile.presetId,
    } as any);
  }

  private pushSpeechChunk(chunk: Buffer): void {
    this.speechBuffer.push(chunk);
    this.speechBufferBytes += chunk.length;
  }

  private clearSpeechBuffer(): void {
    this.speechBuffer = [];
    this.speechBufferBytes = 0;
  }

  private nextUtteranceSeq(): number {
    this.utteranceSeq += 1;
    return this.utteranceSeq;
  }

  private nextSttJobSeq(): number {
    this.sttJobSeq += 1;
    return this.sttJobSeq;
  }

  private classifyNoVadStopReason(): DuplexNoVadReason {
    if (this.duplexIngressSampleRate !== DUPLEX_TARGET_SAMPLE_RATE) {
      return "non_16k_normalized_still_no_vad";
    }
    if (this.duplexRxMaxRms <= 0.002 && this.duplexRawStrongFrames === 0) {
      return "true_silence";
    }
    if (
      this.duplexRxMaxRms < fallbackNoiseSuppressMinRms() ||
      this.duplexRawStrongFrames < fallbackMinStrongFrames()
    ) {
      return "weak_low_energy_audio";
    }
    return "speech_shape_not_confirmed";
  }

  private createDuplexUtteranceJob(input: {
    utteranceSeq: number;
    source: DuplexUtteranceSource;
    pcm: Buffer;
    durationMs: number;
    previewText: string;
    vadMode: string | null;
    usedNoVadFallback: boolean;
    utteranceFrameCount?: number;
    utteranceStrongFrames?: number;
    utteranceMaxRms?: number;
    utteranceMaxPeak?: number;
    rawFrameCount?: number;
    rawStrongFrames?: number;
    rawMaxRms?: number;
    speechEndedAt?: number;
  }): DuplexUtteranceJob {
    const traceId = this.takeVoiceTrace();
    const tracer = getLatencyTracer(this.connId);
    const speechEndedAt = input.speechEndedAt ?? Date.now();
    if (tracer.get("vad_speech_end", traceId) === undefined) {
      tracer.set("vad_speech_end", speechEndedAt, traceId);
    }
    const idleGuardActive = input.source === "speech_buffer" && this.duplexIdleGuardActive;
    const priority = this.resolveSttJobPriority({
      source: input.source,
      previewText: input.previewText,
      speechDurationMs: input.durationMs,
      utteranceFrameCount: input.utteranceFrameCount ?? this.utteranceFrameCount,
      utteranceStrongFrames: input.utteranceStrongFrames ?? this.utteranceStrongFrames,
      utteranceMaxRms: input.utteranceMaxRms ?? this.utteranceMaxRms,
      idleGuardActive,
    });
    const job: DuplexUtteranceJob = {
      utteranceSeq: input.utteranceSeq,
      sttJobSeq: this.nextSttJobSeq(),
      traceId,
      source: input.source,
      enqueuedAt: Date.now(),
      sampleRate: this.duplexSampleRate,
      pcm: input.pcm,
      durationMs: input.durationMs,
      previewText: input.previewText,
      vadMode: input.vadMode,
      utteranceFrameCount: input.utteranceFrameCount ?? this.utteranceFrameCount,
      utteranceStrongFrames: input.utteranceStrongFrames ?? this.utteranceStrongFrames,
      utteranceMaxRms: input.utteranceMaxRms ?? this.utteranceMaxRms,
      utteranceMaxPeak: input.utteranceMaxPeak ?? this.utteranceMaxPeak,
      rawFrameCount: input.rawFrameCount ?? this.duplexRxFrames,
      rawStrongFrames: input.rawStrongFrames ?? this.duplexRawStrongFrames,
      rawMaxRms: input.rawMaxRms ?? this.duplexRxMaxRms,
      ingressSampleRate: this.duplexIngressSampleRate,
      normalizedSampleRate: this.duplexNormalizedSampleRate,
      transport: this.duplexIngressTransport,
      usedNoVadFallback: input.usedNoVadFallback,
      speechEndedAt,
      priority,
      idleGuardActive,
      allowCliFallback: priority === "high",
    };
    this.annotateTrace(traceId, {
      utteranceSeq: job.utteranceSeq,
      sttJobSeq: job.sttJobSeq,
      ingressSampleRate: job.ingressSampleRate,
      normalizedSampleRate: job.normalizedSampleRate,
      usedNoVadFallback: job.usedNoVadFallback,
      previewText: job.previewText || null,
      idleGuardActive: job.idleGuardActive,
      sttJobPriority: job.priority,
    });
    return job;
  }

  private resolveStaleDuplexUtteranceReason(job: DuplexUtteranceJob): string | null {
    if (job.utteranceSeq < this.lastAcceptedUtteranceSeq) {
      return "older_than_last_accepted";
    }
    if (job.utteranceSeq < this.utteranceSeq) {
      if (
        this.lastConfirmedInterruptAt > 0 &&
        job.speechEndedAt <= this.lastConfirmedInterruptAt
      ) {
        return "interrupt_replaced_by_newer_utterance";
      }
      return "newer_utterance_started";
    }
    return null;
  }

  private deferStaleDuplexUtterance(job: DuplexUtteranceJob, text: string, stage: string): void {
    this.deferredDuplexTranscripts.set(job.utteranceSeq, {
      job,
      text,
      deferredAt: Date.now(),
    });
    logger.info("[STT] defer stale utterance awaiting newer resolution", {
      connId: this.connId,
      traceId: job.traceId,
      utteranceSeq: job.utteranceSeq,
      sttJobSeq: job.sttJobSeq,
      source: job.source,
      stage,
      currentUtteranceSeq: this.utteranceSeq,
      lastAcceptedUtteranceSeq: this.lastAcceptedUtteranceSeq,
    });
  }

  private dropStaleDuplexUtterance(job: DuplexUtteranceJob, droppedReason: string, stage: string): void {
    this.annotateTrace(job.traceId, {
      utteranceSeq: job.utteranceSeq,
      sttJobSeq: job.sttJobSeq,
      ingressSampleRate: job.ingressSampleRate,
      normalizedSampleRate: job.normalizedSampleRate,
      droppedReason,
    });
    logger.info("[STT] dropped_stale_utterance", {
      connId: this.connId,
      traceId: job.traceId,
      utteranceSeq: job.utteranceSeq,
      sttJobSeq: job.sttJobSeq,
      source: job.source,
      stage,
      droppedReason,
      currentUtteranceSeq: this.utteranceSeq,
      lastAcceptedUtteranceSeq: this.lastAcceptedUtteranceSeq,
      lastConfirmedInterruptAt: this.lastConfirmedInterruptAt || undefined,
    });
    getLatencyTracer(this.connId).log(job.traceId);
  }

  private discardDeferredDuplexUtterances(reason: string, upToUtteranceSeq = Number.POSITIVE_INFINITY): void {
    for (const [utteranceSeq, deferred] of [...this.deferredDuplexTranscripts.entries()]) {
      if (utteranceSeq > upToUtteranceSeq) continue;
      this.deferredDuplexTranscripts.delete(utteranceSeq);
      this.dropStaleDuplexUtterance(deferred.job, reason, "deferred_resolution");
    }
  }

  private hasPendingNewerSttJob(utteranceSeq: number, ignoreUtteranceSeq?: number): boolean {
    for (const pendingSeq of this.pendingSttUtteranceSeqs) {
      if (pendingSeq === ignoreUtteranceSeq) continue;
      if (pendingSeq > utteranceSeq) return true;
    }
    return false;
  }

  private async maybeRecoverDeferredDuplexUtterance(triggerUtteranceSeq: number): Promise<void> {
    if (this.vad.speaking || this.pendingUtteranceTimer !== null) return;

    let candidate: DeferredDuplexTranscript | null = null;
    for (const deferred of this.deferredDuplexTranscripts.values()) {
      if (deferred.job.utteranceSeq >= triggerUtteranceSeq) continue;
      if (deferred.job.utteranceSeq <= this.lastAcceptedUtteranceSeq) continue;
      if (this.hasPendingNewerSttJob(deferred.job.utteranceSeq, triggerUtteranceSeq)) continue;
      if (!candidate || deferred.job.utteranceSeq > candidate.job.utteranceSeq) {
        candidate = deferred;
      }
    }

    if (!candidate) return;
    this.deferredDuplexTranscripts.delete(candidate.job.utteranceSeq);
    logger.info("[STT] recover deferred utterance after newer rejection", {
      connId: this.connId,
      traceId: candidate.job.traceId,
      utteranceSeq: candidate.job.utteranceSeq,
      sttJobSeq: candidate.job.sttJobSeq,
      triggerUtteranceSeq,
      currentUtteranceSeq: this.utteranceSeq,
    });
    await this.handleResolvedDuplexTranscript(candidate.job, candidate.text, {
      allowDeferredStale: false,
    });
  }

  private enqueueDuplexSttJob(job: DuplexUtteranceJob): void {
    this.maybePreemptSttJob(job);
    this.pendingSttUtteranceSeqs.add(job.utteranceSeq);
    this.pendingSttJobPriority.set(job.utteranceSeq, job.priority);
    this.pendingSttJobTrace.set(job.utteranceSeq, job.traceId);
    this.sttChain = this.sttChain
      .then(async () => {
        await this.processDuplexSttJob(job);
      })
      .catch((err) => logger.error("[sttChain]", { error: err, connId: this.connId }))
      .finally(() => {
        this.pendingSttUtteranceSeqs.delete(job.utteranceSeq);
        this.pendingSttJobPriority.delete(job.utteranceSeq);
        this.pendingSttJobTrace.delete(job.utteranceSeq);
        this.preemptedSttJobs.delete(job.utteranceSeq);
      });
  }

  private async handleResolvedDuplexTranscript(
    job: DuplexUtteranceJob,
    text: string,
    options?: { allowDeferredStale?: boolean },
  ): Promise<void> {
    const allowDeferredStale = options?.allowDeferredStale !== false;

    if (!text) {
      logger.info("[Duplex] no transcript after STT", {
        ...this.duplexStopDebugMeta({
          traceId: job.traceId,
          utteranceSeq: job.utteranceSeq,
          sttJobSeq: job.sttJobSeq,
          source: job.source,
          reason: "empty_text_after_stt",
          speechMs: Math.round(job.durationMs),
        }),
      });
      await this.maybeRecoverDeferredDuplexUtterance(job.utteranceSeq);
      return;
    }

    const predictorScores = heuristicTurnTakingPredictor.score({
      previewText: job.previewText,
      recognizedText: text,
      speechDurationMs: job.durationMs,
      utteranceMaxRms: job.utteranceMaxRms,
      utteranceFrameCount: job.utteranceFrameCount,
      utteranceStrongFrames: job.utteranceStrongFrames,
      assistantSpeaking: this.turnState === "assistant_speaking",
    });
    const nonSpeechDecision = classifyNonSpeechTranscript(text);
    const previewlessShortDecision =
      this.shouldApplyDuplexNoiseSuppression() && !this.isPushToTalkCapture()
        ? classifyPreviewlessShortDuplexTranscript({
            text,
            previewText: job.previewText,
            userSpeechScore: predictorScores.pUserSpeech,
            nonSpeechMediaScore: predictorScores.pNonSpeechMedia,
          })
        : {
            reject: false,
            reason: null,
            normalizedTranscript: nonSpeechDecision.normalizedTranscript,
          };
    const predictorRejectAsNoisePhrase =
      !nonSpeechDecision.reject &&
      !previewlessShortDecision.reject &&
      !getMeaningfulTurnPreview(job.previewText) &&
      nonSpeechDecision.normalizedTranscript.length > 0 &&
      nonSpeechDecision.normalizedTranscript.length <= 6 &&
      predictorScores.pNonSpeechMedia >= 0.9 &&
      predictorScores.pUserSpeech <= 0.25;
    const rejectedReason =
      nonSpeechDecision.reason ??
      previewlessShortDecision.reason ??
      (predictorRejectAsNoisePhrase ? "noise_phrase_rejected" : null);
    if (rejectedReason) {
      const rejectLogMessage =
        rejectedReason === "previewless_short_feedback_rejected" ||
        rejectedReason === "noise_like_short_utterance"
          ? "[STT] reject previewless short duplex utterance"
          : "[STT] reject non-speech transcript";
      logger.info(rejectLogMessage, {
        ...this.duplexStopDebugMeta({
          traceId: job.traceId,
          utteranceSeq: job.utteranceSeq,
          sttJobSeq: job.sttJobSeq,
          source: job.source,
          mode: job.vadMode,
          speechMs: Math.round(job.durationMs),
          text,
          rejectedReason,
        }),
      });
      this.annotateTrace(job.traceId, {
        utteranceSeq: job.utteranceSeq,
        sttJobSeq: job.sttJobSeq,
        ingressSampleRate: job.ingressSampleRate,
        normalizedSampleRate: job.normalizedSampleRate,
        rejectedReason,
        rejectedTranscript: text,
        rejectedSource: job.source,
      });
      this.armSuppressedNoiseCooldown(
        rejectedReason === "previewless_short_feedback_rejected" ||
          rejectedReason === "noise_like_short_utterance"
          ? "stt_rejected_previewless_short"
          : "stt_rejected_non_speech",
        job.vadMode,
      );
      await this.maybeRecoverDeferredDuplexUtterance(job.utteranceSeq);
      return;
    }

    const shouldSuppressNoise =
      this.shouldApplyDuplexNoiseSuppression() &&
      (job.source === "duplex_stop_suppressed_fallback"
        ? shouldSuppressRecoveredFallbackUtterance({
            vadMode: job.vadMode,
            previewText: job.previewText,
            speechDurationMs: job.durationMs,
            suppressionMaxMs: fallbackNoiseSuppressMaxMs(),
            utteranceMaxRms: job.utteranceMaxRms,
            minUtteranceRms: fallbackNoiseSuppressMinRms(),
            utteranceFrameCount: job.utteranceFrameCount,
            utteranceStrongFrames: job.utteranceStrongFrames,
            minStrongFrames: fallbackMinStrongFrames(),
            minStrongRatio: fallbackMinStrongRatio(),
            recognizedText: text,
            tinyTextMaxChars: fallbackNoiseTinyTextMaxChars(),
            userSpeechScore: predictorScores.pUserSpeech,
            nonSpeechMediaScore: predictorScores.pNonSpeechMedia,
          })
        : shouldSuppressFallbackNoiseUtterance({
            vadMode: job.vadMode,
            previewText: job.previewText,
            speechDurationMs: job.durationMs,
            suppressionMaxMs: fallbackNoiseSuppressMaxMs(),
            utteranceMaxRms: job.utteranceMaxRms,
            minUtteranceRms: fallbackNoiseSuppressMinRms(),
            utteranceFrameCount: job.utteranceFrameCount,
            utteranceStrongFrames: job.utteranceStrongFrames,
            minStrongFrames: fallbackMinStrongFrames(),
            minStrongRatio: fallbackMinStrongRatio(),
            recognizedText: text,
            tinyTextMaxChars: fallbackNoiseTinyTextMaxChars(),
            shortTextMaxChars: fallbackNoiseShortTextMaxChars(),
          }) ||
            shouldSuppressStrictNoPreviewUtterance({
              vadMode: job.usedNoVadFallback ? "strict" : job.vadMode,
              previewText: job.previewText,
              utteranceFrameCount: job.usedNoVadFallback ? job.rawFrameCount : job.utteranceFrameCount,
              utteranceStrongFrames: job.usedNoVadFallback ? job.rawStrongFrames : job.utteranceStrongFrames,
              utteranceMaxRms: job.usedNoVadFallback ? job.rawMaxRms : job.utteranceMaxRms,
              minUtteranceRms: fallbackNoiseSuppressMinRms(),
              minStrongFrames: strictCandidateMinStrongFrames(),
              minStrongRatio: strictCandidateMinStrongRatio(),
              recognizedText: text,
            }));
    if (shouldSuppressNoise) {
      logger.info(
        job.source === "duplex_stop_suppressed_fallback"
          ? "[STT] suppress recovered fallback utterance"
          : job.usedNoVadFallback
            ? "[STT] suppress no-vad duplex fallback utterance"
            : "[STT] suppress noise utterance",
        {
          ...this.duplexStopDebugMeta({
            traceId: job.traceId,
            utteranceSeq: job.utteranceSeq,
            sttJobSeq: job.sttJobSeq,
            source: job.source,
            mode: job.vadMode,
            speechMs: Math.round(job.durationMs),
            utteranceMaxRms: Number(job.utteranceMaxRms.toFixed(4)),
            strongFrames: job.usedNoVadFallback ? job.rawStrongFrames : job.utteranceStrongFrames,
            totalFrames: job.usedNoVadFallback ? job.rawFrameCount : job.utteranceFrameCount,
            text,
          }),
        },
      );
      this.armSuppressedNoiseCooldown(
        job.source === "duplex_stop_suppressed_fallback"
          ? "duplex_stop_recovered_fallback_post_stt"
          : job.usedNoVadFallback
            ? "duplex_stop_post_stt"
            : "stt_post_buffer",
        job.vadMode,
      );
      await this.maybeRecoverDeferredDuplexUtterance(job.utteranceSeq);
      return;
    }

    if (this.duplexActive && isTentativeSpeechText(text)) {
      logger.info("[STT] suppress tentative duplex utterance", {
        ...this.duplexStopDebugMeta({
          traceId: job.traceId,
          utteranceSeq: job.utteranceSeq,
          sttJobSeq: job.sttJobSeq,
          source: job.source,
          reason: "tentative_text_suppressed",
          text,
        }),
      });
      await this.maybeRecoverDeferredDuplexUtterance(job.utteranceSeq);
      return;
    }

    const staleAfterTranscribe = this.resolveStaleDuplexUtteranceReason(job);
    if (staleAfterTranscribe) {
      if (staleAfterTranscribe === "newer_utterance_started") {
        if (allowDeferredStale) {
          this.deferStaleDuplexUtterance(job, text, "after_transcribe");
          return;
        }
      } else {
        this.dropStaleDuplexUtterance(job, staleAfterTranscribe, "after_transcribe");
        return;
      }
    }

    this.lastAcceptedUtteranceSeq = Math.max(this.lastAcceptedUtteranceSeq, job.utteranceSeq);
    this.markAcceptedSpeechActivity("accepted_stt_final");
    this.discardDeferredDuplexUtterances(
      "superseded_by_accepted_newer_turn",
      job.utteranceSeq - 1,
    );
    this.annotateTrace(job.traceId, {
      utteranceSeq: job.utteranceSeq,
      sttJobSeq: job.sttJobSeq,
      ingressSampleRate: job.ingressSampleRate,
      normalizedSampleRate: job.normalizedSampleRate,
      usedNoVadFallback: job.usedNoVadFallback,
      finalTranscript: text,
      rejectedReason: null,
      rejectedTranscript: null,
      rejectedSource: null,
      droppedReason: null,
    });
    const preparedTurn = prepareVoicePipelineTurn(this.buildVoiceSubmitRuntime(), {
      text,
      traceId: job.traceId,
      allowPredictionReuse: job.source === "speech_buffer",
      clearPredictionAfterRun: job.source === "speech_buffer",
      markSttFinalTimestamp: job.source === "speech_buffer" ? undefined : false,
      userVocalTone: this.lastSttVocalTone ?? undefined,
      logPrefix:
        job.source === "duplex_stop_no_vad"
          ? "[用户·语音 fallback/no-vad]"
          : job.source === "duplex_stop_suppressed_fallback"
            ? "[用户·语音 fallback/recovered]"
            : undefined,
      logMeta:
        job.source === "duplex_stop_no_vad"
          ? {
              speechMs: Math.round(job.durationMs),
              strongFrames: job.rawStrongFrames,
              totalFrames: job.rawFrameCount,
            }
          : job.source === "duplex_stop_suppressed_fallback"
            ? {
                speechMs: Math.round(job.durationMs),
                strongFrames: job.utteranceStrongFrames,
                totalFrames: job.utteranceFrameCount,
              }
            : undefined,
    });

    const nextPipeline = this.pipelineChain
      .then(async () => {
        await runPreparedVoicePipelineTurn(this.buildVoiceSubmitRuntime(), preparedTurn);
      })
      .catch((err) => {
        logger.error("[pipeline]", { error: err, connId: this.connId });
        send(this.ws, { type: "error", content: "语音转写失败，请重试" });
      });
    this.pipelineChain = nextPipeline;
  }

  private async processDuplexSttJob(job: DuplexUtteranceJob): Promise<void> {
    const preemptReason = this.preemptedSttJobs.get(job.utteranceSeq);
    if (preemptReason) {
      this.annotateTrace(job.traceId, {
        utteranceSeq: job.utteranceSeq,
        sttJobSeq: job.sttJobSeq,
        ingressSampleRate: job.ingressSampleRate,
        normalizedSampleRate: job.normalizedSampleRate,
        sttJobPriority: job.priority,
        sttPreemptReason: preemptReason,
      });
      logger.info("[STT] skip preempted low-value utterance", {
        connId: this.connId,
        traceId: job.traceId,
        utteranceSeq: job.utteranceSeq,
        sttJobSeq: job.sttJobSeq,
        source: job.source,
        preemptReason,
      });
      this.dropStaleDuplexUtterance(job, preemptReason, "before_transcribe");
      return;
    }
    const queueWaitMs = Date.now() - job.enqueuedAt;
    logger.info("[STT] queue separated", {
      connId: this.connId,
      traceId: job.traceId,
      utteranceSeq: job.utteranceSeq,
      sttJobSeq: job.sttJobSeq,
      source: job.source,
      queueWaitMs,
      sttJobPriority: job.priority,
      idleGuardActive: job.idleGuardActive,
      sttQueueBlockedByPriorJob: queueWaitMs > 200,
      pcmMs: Math.round(job.durationMs),
      ingressSampleRate: job.ingressSampleRate,
      normalizedSampleRate: job.normalizedSampleRate,
      transport: job.transport,
    });
    this.annotateTrace(job.traceId, {
      utteranceSeq: job.utteranceSeq,
      sttJobSeq: job.sttJobSeq,
      ingressSampleRate: job.ingressSampleRate,
      normalizedSampleRate: job.normalizedSampleRate,
      sttJobPriority: job.priority,
      sttQueueBlockedByPriorJob: queueWaitMs > 200,
      idleGuardActive: job.idleGuardActive,
    });

    const staleBeforeTranscribe = this.resolveStaleDuplexUtteranceReason(job);
    if (staleBeforeTranscribe && staleBeforeTranscribe !== "newer_utterance_started") {
      this.dropStaleDuplexUtterance(job, staleBeforeTranscribe, "before_transcribe");
      return;
    }

    const transcribeStartAt = Date.now();
    const sttAbortController = new AbortController();
    this.activeSttJob = {
      utteranceSeq: job.utteranceSeq,
      sttJobSeq: job.sttJobSeq,
      traceId: job.traceId,
      priority: job.priority,
      abortController: sttAbortController,
      preemptReason: null,
    };
    logger.info("[STT] transcribe start", {
      connId: this.connId,
      traceId: job.traceId,
      utteranceSeq: job.utteranceSeq,
      sttJobSeq: job.sttJobSeq,
      queueWaitMs,
      sttJobPriority: job.priority,
      idleGuardActive: job.idleGuardActive,
      allowCliFallback: job.allowCliFallback,
      pcmMs: Math.round(job.durationMs),
      sampleRate: job.sampleRate,
      source: job.source,
      ingressSampleRate: job.ingressSampleRate,
      normalizedSampleRate: job.normalizedSampleRate,
      transport: job.transport,
    });

    let text = "";
    let transcribeMeta: SttTranscribeMeta | null = null;
    let activePreemptReason: string | null = null;
    try {
      text = await this.stt.transcribePcmSnapshot(job.pcm, job.sampleRate, {
        signal: sttAbortController.signal,
        allowCliFallback: job.allowCliFallback,
        jobPriority: job.priority,
        traceId: job.traceId,
      } satisfies SttTranscribeOptions);
      transcribeMeta = this.stt.getLastTranscribeMeta();
      this.lastSttVocalTone = this.buildVocalToneFromMeta();
      activePreemptReason = this.activeSttJob?.preemptReason ?? null;
    } finally {
      if (this.activeSttJob?.utteranceSeq === job.utteranceSeq) {
        this.activeSttJob = null;
      }
    }
    const transcribeMs = Date.now() - transcribeStartAt;

    logger.info("[STT] transcribe end", {
      connId: this.connId,
      traceId: job.traceId,
      utteranceSeq: job.utteranceSeq,
      sttJobSeq: job.sttJobSeq,
      queueWaitMs,
      transcribeMs,
      sttJobPriority: job.priority,
      sttPath: transcribeMeta?.path ?? null,
      sttFallbackReason: transcribeMeta?.fallbackReason ?? null,
      sttRequestDegraded: transcribeMeta?.requestDegraded ?? false,
      sttPreemptReason: activePreemptReason ?? undefined,
      pcmMs: Math.round(job.durationMs),
      sampleRate: job.sampleRate,
      source: job.source,
      ingressSampleRate: job.ingressSampleRate,
      normalizedSampleRate: job.normalizedSampleRate,
      transport: job.transport,
      textChars: text.length,
      sttEmotion: transcribeMeta?.emotion ?? null,
      sttEvent: transcribeMeta?.event ?? null,
    });
    this.annotateTrace(job.traceId, {
      utteranceSeq: job.utteranceSeq,
      sttJobSeq: job.sttJobSeq,
      ingressSampleRate: job.ingressSampleRate,
      normalizedSampleRate: job.normalizedSampleRate,
      sttPath: transcribeMeta?.path ?? null,
      sttFallbackReason: transcribeMeta?.fallbackReason ?? null,
      sttJobPriority: job.priority,
      sttRequestDegraded: transcribeMeta?.requestDegraded ?? false,
      sttPreemptReason: activePreemptReason ?? null,
      idleGuardActive: job.idleGuardActive,
    });
    if (activePreemptReason) {
      logger.info("[STT] preempted low-value utterance during transcribe", {
        connId: this.connId,
        traceId: job.traceId,
        utteranceSeq: job.utteranceSeq,
        sttJobSeq: job.sttJobSeq,
        preemptReason: activePreemptReason,
      });
      this.dropStaleDuplexUtterance(job, activePreemptReason, "during_transcribe");
      return;
    }
    await this.handleResolvedDuplexTranscript(job, text);
  }

  /** Build a human-readable vocal tone string from SenseVoice emotion/event labels. */
  private buildVocalToneFromMeta(): string | null {
    const meta = this.stt.getLastTranscribeMeta();
    if (!meta) return null;
    const parts: string[] = [];
    if (meta.emotion) parts.push(meta.emotion);
    if (meta.event) parts.push(meta.event);
    return parts.length > 0 ? parts.join("/") : null;
  }

  private resetProsodyState(): void {
    this.prosodySamples = [];
  }

  private clearPendingUtteranceTimer(): void {
    if (this.pendingUtteranceTimer) {
      clearTimeout(this.pendingUtteranceTimer);
      this.pendingUtteranceTimer = null;
    }
  }

  private clearSilenceNudgeTimer(): void {
    if (this.silenceNudgeTimer) {
      clearTimeout(this.silenceNudgeTimer);
      this.silenceNudgeTimer = null;
    }
  }

  private clearPreviewTimer(): void {
    if (this.previewTimer) {
      clearTimeout(this.previewTimer);
      this.previewTimer = null;
    }
  }

  private cancelPrediction(): void {
    if (this.predictionTimer) {
      clearTimeout(this.predictionTimer);
      this.predictionTimer = null;
    }
    if (this.predictionAbort) {
      try {
        this.predictionAbort.abort();
      } catch {}
      this.predictionAbort = null;
    }
    this.currentPartialText = "";
    this.predictedReply = "";
    this.predictedStructuredAnalysis = null;
  }

  private resetPreviewState(): void {
    this.clearPreviewTimer();
    this.stt.cancelPreview();
    this.previewInFlight = false;
    this.lastPreviewAt = 0;
    this.lastPreviewText = "";
    this.lastPreviewCandidateText = "";
    this.lastPartialEmitAt = 0;
    this.lastPartialContent = "";
    this.turnTakingState = "CONFIRMED_END";
    this.lastMeaningfulPartialText = "";
    this.lastMeaningfulPartialAt = 0;
    this.lastMeaningfulGrowthAt = 0;
    this.lastMeaningfulGrowthChars = 0;
    this.recentPartialPlateauCount = 0;
    this.partialShapeSamples = [];
    this.resetProsodyState();
    this.lastPredictionIssuedAt = 0;
    this.lastPredictionIssuedText = "";
    // 同时取消正在进行的预判
    this.cancelPrediction();
    this.backchannelSentThisTurn = false;
    this.pendingDuplexInterrupt = false;
    this.pendingListeningPromotion = false;
    this.ignoredFallbackRestartActive = false;
  }

  private maybeConfirmPendingDuplexInterrupt(): void {
    if (!this.pendingDuplexInterrupt) return;
    if (!this.interrupt.active && !this.assistantPlaybackActive) {
      this.pendingDuplexInterrupt = false;
      return;
    }
    const speechDurationMs = (this.speechBufferBytes / 2 / this.duplexSampleRate) * 1000;
    if (speechDurationMs < duplexInterruptMinSpeechMs()) return;
    const hasEvidence = this.hasReliableDuplexInterruptEvidence(speechDurationMs);
    // PR5 shadow tap: run shadow barge-in evaluation for comparison logging.
    // Never affects the outcome — try/catch protected.
    try {
      const partialText = this.lastMeaningfulPartialText || this.lastPreviewText;
      this.turnDetector.evaluateBargeIn({
        assistantActive: this.interrupt.active || this.assistantPlaybackActive,
        speechDurationMs,
        minSpeechMs: duplexInterruptMinSpeechMs(),
        hasReliableEvidence: hasEvidence,
        hasPartial: getMeaningfulTurnPreview(partialText).length >= 2,
        partialText,
      });
    } catch { /* shadow must not throw */ }
    if (!hasEvidence) return;
    this.pendingDuplexInterrupt = false;
    this.lastConfirmedInterruptAt = Date.now();
    this.markMeaningfulSpeechActivity("accepted_interrupt", this.lastConfirmedInterruptAt);
    this.sendInterrupt();
    this.interrupt.interrupt();
    if (this.assistantPlaybackActive) {
      this.assistantPlaybackActive = false;
      this.playbackGenerationId = null;
    }
    logger.info("[VAD] → interrupted pipeline (confirmed duplex speech)", {
      connId: this.connId,
      speechMs: Math.round(speechDurationMs),
    });
    // Barge-in latency baseline: speech_start → stop. Observation only; does not
    // affect the trigger condition above.
    const bargeInLatencyMs =
      this.lastSpeechStartAt > 0 ? Date.now() - this.lastSpeechStartAt : null;
    logger.info("[BargeInBaseline] barge_in_speech_start_to_stop", {
      connId: this.connId,
      bargeInLatencyMs,
      speechMs: Math.round(speechDurationMs),
    });
    this.speechRuntime.observeEvent("user.barge_in", {
      bargeInLatencyMs,
      speechMs: Math.round(speechDurationMs),
    });
    this.publishTurnState("interrupted_by_user", "user_interrupt", {
      generationId: this.currentInterruptTargetGenerationId() ?? undefined,
      interruptionType: "emotional_interrupt",
      force: true,
    });
  }

  private resetDuplexRxMetrics(): void {
    this.duplexRxStartedAt = Date.now();
    this.duplexRxFrames = 0;
    this.duplexRxBytes = 0;
    this.duplexRxLastRms = 0;
    this.duplexRxLastPeak = 0;
    this.duplexRxMaxRms = 0;
    this.duplexRxVadStarts = 0;
    this.duplexRxLastLogAt = 0;
    this.pendingListeningPromotion = false;
    this.utteranceFrameCount = 0;
    this.utteranceStrongFrames = 0;
    this.utteranceMaxRms = 0;
    this.utteranceMaxPeak = 0;
    this.resetProsodyState();
    this.lastVadStartMode = null;
    this.clearDuplexRawBuffer();
    this.clearSuppressedFallbackBuffer();
    this.resetVadSignalState();
  }

  private clearDuplexRawBuffer(): void {
    this.duplexRawChunks = [];
    this.duplexRawBytes = 0;
    this.duplexRawStrongFrames = 0;
  }

  private clearSuppressedFallbackBuffer(): void {
    this.suppressedFallbackChunks = [];
    this.suppressedFallbackBytes = 0;
    this.suppressedFallbackFrameCount = 0;
    this.suppressedFallbackStrongFrames = 0;
    this.suppressedFallbackMaxRms = 0;
    this.suppressedFallbackMaxPeak = 0;
    this.suppressedFallbackLastSpeechEndAt = 0;
    this.suppressedFallbackSegments = 0;
  }

  private resetVadSignalState(): void {
    this.pendingVadStartSignal = false;
    this.activeVadStartSignal = false;
    this.ignoredFallbackRestartActive = false;
  }

  private clearIdleGuard(reason?: string): void {
    if (this.duplexIdleGuardActive || this.duplexIdleSince > 0) {
      logger.info("[Duplex] idle guard cleared", {
        connId: this.connId,
        reason: reason ?? "unspecified",
      });
    }
    this.duplexIdleGuardActive = false;
    this.duplexIdleSince = 0;
  }

  private markMeaningfulSpeechActivity(reason: string, at = Date.now()): void {
    this.lastMeaningfulSpeechAt = Math.max(this.lastMeaningfulSpeechAt, at);
    this.clearIdleGuard(reason);
  }

  private markAcceptedSpeechActivity(reason: string, at = Date.now()): void {
    this.lastAcceptedSpeechAt = Math.max(this.lastAcceptedSpeechAt, at);
    this.lastMeaningfulSpeechAt = Math.max(this.lastMeaningfulSpeechAt, at);
    this.clearIdleGuard(reason);
  }

  private updateIdleGuard(now = Date.now()): boolean {
    if (!this.duplexActive || this.isPushToTalkCapture()) {
      this.duplexIdleGuardActive = false;
      this.duplexIdleSince = 0;
      return false;
    }
    const lastActiveAt = Math.max(
      this.duplexRxStartedAt || 0,
      this.lastMeaningfulSpeechAt || 0,
      this.lastAcceptedSpeechAt || 0,
      this.lastConfirmedInterruptAt || 0,
    );
    const idleForMs = lastActiveAt > 0 ? Math.max(0, now - lastActiveAt) : 0;
    const shouldActivate = idleForMs >= duplexIdleGuardAfterMs();
    if (shouldActivate && !this.duplexIdleGuardActive) {
      this.duplexIdleGuardActive = true;
      this.duplexIdleSince = now;
      logger.info("[Duplex] idle guard active", {
        connId: this.connId,
        idleForMs: Math.round(idleForMs),
      });
    } else if (!shouldActivate && this.duplexIdleGuardActive) {
      this.clearIdleGuard("recent_meaningful_activity");
    }
    if (!shouldActivate) {
      this.duplexIdleSince = 0;
    }
    return this.duplexIdleGuardActive;
  }

  private shouldUseIdleGuard(): boolean {
    return this.shouldApplyDuplexNoiseSuppression() && this.updateIdleGuard();
  }

  private shouldReleaseIdleGuard(speechDurationMs: number): boolean {
    if (this.isPushToTalkCapture()) return true;
    const preview = getMeaningfulTurnPreview(this.lastMeaningfulPartialText || this.lastPreviewText);
    if (preview.length >= duplexIdleGuardMeaningfulPreviewChars()) return true;
    const strongRatio = strongFrameRatio(this.utteranceFrameCount, this.utteranceStrongFrames);
    const minSpeech = Math.max(duplexIdleGuardMinSpeechMs(), duplexIdleGuardNoPreviewMinSpeechMs());
    const minRms = Math.max(duplexIdleGuardMinRms(), duplexIdleGuardNoPreviewMinRms());
    const minStrongRatio = Math.max(
      duplexIdleGuardMinStrongRatio(),
      duplexIdleGuardNoPreviewMinStrongRatio(),
    );
    return (
      speechDurationMs >= minSpeech &&
      this.utteranceMaxRms >= minRms &&
      strongRatio >= minStrongRatio
    );
  }

  private resolveSttJobPriority(input: {
    source: DuplexUtteranceSource;
    previewText: string;
    speechDurationMs: number;
    utteranceFrameCount: number;
    utteranceStrongFrames: number;
    utteranceMaxRms: number;
    idleGuardActive: boolean;
  }): SttJobPriority {
    if (this.isPushToTalkCapture()) return "high";
    if (getMeaningfulTurnPreview(input.previewText)) return "high";
    if (input.source === "duplex_stop_suppressed_fallback" || input.source === "duplex_stop_no_vad") {
      return "low";
    }
    const strongRatio = strongFrameRatio(input.utteranceFrameCount, input.utteranceStrongFrames);
    if (
      input.speechDurationMs >= duplexIdleGuardMinSpeechMs() &&
      input.utteranceMaxRms >= duplexIdleGuardMinRms() &&
      strongRatio >= duplexIdleGuardMinStrongRatio()
    ) {
      return "high";
    }
    return input.idleGuardActive ? "low" : "high";
  }

  private maybePreemptSttJob(job: DuplexUtteranceJob): void {
    if (job.priority !== "high") return;
    for (const [utteranceSeq, priority] of this.pendingSttJobPriority.entries()) {
      if (utteranceSeq === job.utteranceSeq) continue;
      if (utteranceSeq >= job.utteranceSeq) continue;
      if (priority !== "low") continue;
      this.preemptedSttJobs.set(utteranceSeq, "stt_preempted_by_newer_high_value_job");
    }
    if (
      this.activeSttJob &&
      this.activeSttJob.priority === "low" &&
      this.activeSttJob.utteranceSeq < job.utteranceSeq
    ) {
      this.activeSttJob.preemptReason = "stt_preempted_by_newer_high_value_job";
      try {
        this.activeSttJob.abortController.abort();
      } catch {
        // best effort
      }
    }
  }

  private resetDeferredDuplexTranscripts(reason = "duplex_reset"): void {
    if (!this.deferredDuplexTranscripts.size) return;
    this.discardDeferredDuplexUtterances(reason);
  }

  private sendVadStartSignal(reason: string, vadMode: string | null): void {
    this.pendingVadStartSignal = false;
    if (this.activeVadStartSignal) return;
    this.activeVadStartSignal = true;
    logger.debug("[VAD] ui listening start", {
      connId: this.connId,
      reason,
      vadMode: vadMode ?? undefined,
    });
    send(this.ws, { type: "vad_start" });
  }

  private maybeEmitDeferredVadStart(reason: string): void {
    if (!this.pendingVadStartSignal) return;
    this.sendVadStartSignal(reason, this.lastVadStartMode);
  }

  private sendVadEndSignal(reason: string): void {
    this.pendingVadStartSignal = false;
    if (!this.activeVadStartSignal) return;
    this.activeVadStartSignal = false;
    logger.debug("[VAD] ui listening end", {
      connId: this.connId,
      reason,
      vadMode: this.lastVadStartMode ?? undefined,
    });
    send(this.ws, { type: "vad_end" });
  }

  private shouldDeferDuplexVadStart(
    vadMode: string | null,
    merging: boolean,
  ): boolean {
    return (
      this.shouldApplyDuplexNoiseSuppression() &&
      !merging &&
      (vadMode === "fallback_energy" ||
        this.duplexIdleGuardActive ||
        this.turnState === "assistant_speaking" ||
        this.interrupt.active)
    );
  }

  private shouldIgnoreWeakFallbackRestartDuringPendingCommit(
    vadMode: string | null,
    energy?: number,
  ): {
    ignore: boolean;
    preview: string;
    interruptionType: InterruptionType | null;
    sinceSpeechEndMs: number;
  } {
    const preview = getMeaningfulTurnPreview(this.lastMeaningfulPartialText || this.lastPreviewText);
    const interruptedReply =
      this.brain.lastInterruptedReply?.trim() ||
      this.brain.currentAssistantDraft?.trim() ||
      null;
    const interruptionType = preview
      ? classifyInterruption(preview, interruptedReply)
      : null;
    const sinceSpeechEndMs =
      this.lastSpeechEndAt > 0 ? Math.max(0, Date.now() - this.lastSpeechEndAt) : Number.POSITIVE_INFINITY;
    const weakEnergy =
      energy === undefined || !Number.isFinite(energy) || energy < fallbackNoiseSuppressMinRms();
    const ignore =
      this.shouldApplyDuplexNoiseSuppression() &&
      this.pendingUtteranceTimer !== null &&
      this.turnTakingState === "HOLD" &&
      vadMode === "fallback_energy" &&
      weakEnergy &&
      sinceSpeechEndMs <= DUPLEX_PENDING_COMMIT_FALLBACK_RESTART_IGNORE_MS &&
      !!preview &&
      (interruptionType === "correction" ||
        /不是那个意思|不对|我的意思是|我想说的是|我其实是想说/u.test(preview));
    return {
      ignore,
      preview,
      interruptionType,
      sinceSpeechEndMs,
    };
  }

  private captureSuppressedFallbackUtterance(speechEndedAt: number): void {
    if (this.isPushToTalkCapture()) return;
    if (this.lastVadStartMode !== "fallback_energy") return;
    if (this.speechBufferBytes <= 0) return;

    const pcm = Buffer.concat(this.speechBuffer);
    const maxBytes = Math.floor((this.duplexSampleRate * 2 * DUPLEX_SUPPRESSED_FALLBACK_MAX_MS) / 1000);
    if (this.suppressedFallbackBytes + pcm.length > maxBytes) {
      this.clearSuppressedFallbackBuffer();
    }

    this.suppressedFallbackChunks.push(pcm);
    this.suppressedFallbackBytes += pcm.length;
    this.suppressedFallbackFrameCount += this.utteranceFrameCount;
    this.suppressedFallbackStrongFrames += this.utteranceStrongFrames;
    this.suppressedFallbackMaxRms = Math.max(this.suppressedFallbackMaxRms, this.utteranceMaxRms);
    this.suppressedFallbackMaxPeak = Math.max(this.suppressedFallbackMaxPeak, this.utteranceMaxPeak);
    this.suppressedFallbackLastSpeechEndAt = speechEndedAt;
    this.suppressedFallbackSegments += 1;
  }

  private hasSuppressedFallbackCandidate(): boolean {
    return !this.isPushToTalkCapture() && this.suppressedFallbackBytes > 0;
  }

  private appendDuplexRawChunk(pcm: Buffer): void {
    const maxBytes = Math.floor((this.duplexSampleRate * 2 * DUPLEX_RAW_FALLBACK_MAX_MS) / 1000);
    this.duplexRawBytes = appendChunkWithByteCap(
      this.duplexRawChunks,
      this.duplexRawBytes,
      pcm,
      maxBytes,
    );
  }

  private shouldAttemptNoVadDuplexFallback(): boolean {
    const durationMs = (this.duplexRawBytes / 2 / this.duplexSampleRate) * 1000;
    return shouldAttemptNoVadDuplexFallback({
      speechBufferLength: this.speechBuffer.length,
      duplexRxFrames: this.duplexRxFrames,
      duplexRxVadStarts: this.duplexRxVadStarts,
      durationMs,
      rawStrongFrames: this.duplexRawStrongFrames,
      strongRatio: strongFrameRatio(this.duplexRxFrames, this.duplexRawStrongFrames),
      maxRms: this.duplexRxMaxRms,
      minSpeechMs: minSpeechMs(),
      minStrongFrames: strictCandidateMinStrongFrames(),
      minStrongRatio: strictCandidateMinStrongRatio(),
    });
  }

  private isPushToTalkCapture(): boolean {
    return this.duplexInputMode === "push_to_talk";
  }

  private shouldApplyDuplexNoiseSuppression(): boolean {
    return !this.isPushToTalkCapture();
  }

  private shouldAttemptStopTimeTranscriptionWithoutVad(): boolean {
    if (!this.isPushToTalkCapture()) {
      return this.shouldAttemptNoVadDuplexFallback();
    }

    const durationMs = (this.duplexRawBytes / 2 / this.duplexSampleRate) * 1000;
    return this.speechBuffer.length === 0 && this.duplexRxFrames > 0 && durationMs >= minSpeechMs();
  }

  private armSuppressedNoiseCooldown(reason: string, mode?: string | null): void {
    const cooldownMs = suppressedNoiseCooldownMs();
    if (cooldownMs <= 0) return;
    this.suppressedNoiseCooldownUntil = Date.now() + cooldownMs;
    logger.info("[Duplex] noise cooldown armed", {
      connId: this.connId,
      reason,
      mode: mode ?? undefined,
      cooldownMs,
    });
  }

  private logDuplexRxSummary(force = false): void {
    if (this.duplexRxStartedAt <= 0) return;
    const now = Date.now();
    if (!force && now - this.duplexRxLastLogAt < 1000) return;
    this.duplexRxLastLogAt = now;
    logger.info("[DuplexRx]", {
      connId: this.connId,
      utteranceSeq: this.utteranceSeq,
      ingressSampleRate: this.duplexIngressSampleRate,
      normalizedSampleRate: this.duplexNormalizedSampleRate,
      transport: this.duplexIngressTransport,
      frames: this.duplexRxFrames,
      bytes: this.duplexRxBytes,
      durationMs: now - this.duplexRxStartedAt,
      lastRms: Number(this.duplexRxLastRms.toFixed(4)),
      lastPeak: Number(this.duplexRxLastPeak.toFixed(4)),
      maxRms: Number(this.duplexRxMaxRms.toFixed(4)),
      vadStarts: this.duplexRxVadStarts,
      rawStrongFrames: this.duplexRawStrongFrames,
      speaking: this.vad.speaking,
    });
  }

  private resetSpeechConfidenceMetrics(): void {
    this.utteranceFrameCount = 0;
    this.utteranceStrongFrames = 0;
    this.utteranceMaxRms = 0;
    this.utteranceMaxPeak = 0;
  }

  private trackSpeechConfidence(rms: number, peak: number): void {
    this.utteranceFrameCount += 1;
    this.utteranceMaxRms = Math.max(this.utteranceMaxRms, rms);
    this.utteranceMaxPeak = Math.max(this.utteranceMaxPeak, peak);
    if (rms >= fallbackStrongFrameRms() || peak >= fallbackStrongFramePeak()) {
      this.utteranceStrongFrames += 1;
    }
  }

  private hasPromotableSpeechShape(): boolean {
    return (
      this.utteranceStrongFrames >= strictCandidateMinStrongFrames() &&
      strongFrameRatio(this.utteranceFrameCount, this.utteranceStrongFrames) >=
        strictCandidateMinStrongRatio()
    );
  }

  private scoreCurrentUtterance(
    previewText: string,
    speechDurationMs: number,
    recognizedText?: string,
  ): PredictorScores {
    return heuristicTurnTakingPredictor.score({
      previewText,
      recognizedText,
      speechDurationMs,
      utteranceMaxRms: this.utteranceMaxRms,
      utteranceFrameCount: this.utteranceFrameCount,
      utteranceStrongFrames: this.utteranceStrongFrames,
      assistantSpeaking: this.turnState === "assistant_speaking" || this.interrupt.active,
      prosody: turnProsodyEnabled() ? summarizeProsody(this.prosodySamples) : null,
    });
  }

  private isAssistantSpeakingForDuplexGate(): boolean {
    return this.turnState === "assistant_speaking" || this.interrupt.active || this.assistantPlaybackActive;
  }

  private currentInterruptTargetGenerationId(): number | null {
    if (typeof this.activeGenerationId === "number") return this.activeGenerationId;
    if (typeof this.playbackGenerationId === "number") return this.playbackGenerationId;
    return null;
  }

  private hasProsodySpeechEvidence(
    minVoicedRatio = 0.42,
    minPitchConfidence = 0.55,
  ): boolean {
    if (!turnProsodyEnabled()) return false;
    const prosody = summarizeProsody(this.prosodySamples);
    if (!prosody?.reliable) return false;
    if (prosody.voicedRatio < minVoicedRatio) return false;
    return prosody.sustainedVoicedTail || prosody.pitchConfidence >= minPitchConfidence;
  }

  private shouldExternalizeSttPreview(content: string, speechDurationMs: number): boolean {
    const preview = getMeaningfulTurnPreview(content);
    if (!preview) return false;
    if (classifyNonSpeechTranscript(preview).reject) return false;

    const speakingAssistant = this.isAssistantSpeakingForDuplexGate();
    const scores = this.scoreCurrentUtterance(preview, speechDurationMs, preview);
    const previewChars = preview.replace(/\s+/g, "").length;
    const strongShape = this.hasPromotableSpeechShape();
    const prosodySpeech = this.hasProsodySpeechEvidence();
    const strongRms = this.utteranceMaxRms >= duplexFallbackInterruptMinRms();

    if (speakingAssistant) {
      return (
        previewChars >= duplexFallbackInterruptMinPreviewChars() &&
        scores.pUserSpeech >= 0.58 &&
        scores.pNonSpeechMedia <= 0.3 &&
        (strongShape || strongRms || prosodySpeech)
      );
    }

    if (this.lastVadStartMode !== "fallback_energy") {
      return true;
    }

    return (
      previewChars >= 2 &&
      scores.pUserSpeech >= 0.42 &&
      scores.pNonSpeechMedia <= 0.55 &&
      (speechDurationMs >= strictCandidateMinSpeechMs() || strongShape || prosodySpeech)
    );
  }

  private hasReliableListeningPromotionEvidence(speechDurationMs: number): boolean {
    const preview = getMeaningfulTurnPreview(this.lastMeaningfulPartialText || this.lastPreviewText);
    const speakingAssistant = this.isAssistantSpeakingForDuplexGate();
    const scores = this.scoreCurrentUtterance(preview, speechDurationMs, preview || undefined);
    const strongShape = this.hasPromotableSpeechShape();
    const strongRms = this.utteranceMaxRms >= fallbackNoiseSuppressMinRms();
    const prosodySpeech = this.hasProsodySpeechEvidence();

    if (preview) {
      const previewChars = preview.replace(/\s+/g, "").length;
      if (speakingAssistant) {
        return (
          previewChars >= duplexFallbackInterruptMinPreviewChars() &&
          scores.pUserSpeech >= 0.58 &&
          scores.pInterruptValid >= 0.58 &&
          scores.pNonSpeechMedia <= 0.3 &&
          (strongShape || strongRms || prosodySpeech)
        );
      }
      if (this.lastVadStartMode !== "fallback_energy") {
        return true;
      }
      return scores.pUserSpeech >= 0.46 && scores.pNonSpeechMedia <= 0.45;
    }

    if (speakingAssistant) {
      return (
        speechDurationMs >= duplexAssistantNoPreviewInterruptMinSpeechMs() &&
        strongShape &&
        strongRms &&
        prosodySpeech &&
        scores.pUserSpeech >= 0.62 &&
        scores.pInterruptValid >= 0.62 &&
        scores.pNonSpeechMedia <= 0.18
      );
    }

    if (this.lastVadStartMode !== "fallback_energy") {
      return strongShape;
    }

    return (
      speechDurationMs >= strictCandidateMinSpeechMs() &&
      strongShape &&
      (strongRms || prosodySpeech) &&
      scores.pUserSpeech >= 0.45 &&
      scores.pNonSpeechMedia <= 0.4
    );
  }

  private hasReliableDuplexInterruptEvidence(speechDurationMs: number): boolean {
    const preview = getMeaningfulTurnPreview(this.lastMeaningfulPartialText || this.lastPreviewText);
    const speakingAssistant = this.isAssistantSpeakingForDuplexGate();
    const scores = this.scoreCurrentUtterance(preview, speechDurationMs);

    if (!speakingAssistant && this.lastVadStartMode !== "fallback_energy") {
      return true;
    }

    if (!speakingAssistant && preview) {
      return scores.pUserSpeech >= 0.42 && scores.pNonSpeechMedia <= 0.45;
    }

    const minSpeechMs = speakingAssistant
      ? preview
        ? duplexFallbackInterruptMinSpeechMs()
        : duplexAssistantNoPreviewInterruptMinSpeechMs()
      : strictCandidateMinSpeechMs();
    if (speechDurationMs < minSpeechMs) return false;

    if (!speakingAssistant) {
      return this.hasReliableListeningPromotionEvidence(speechDurationMs);
    }

    const previewValid = preview.length >= duplexFallbackInterruptMinPreviewChars();
    const strongRatio = strongFrameRatio(this.utteranceFrameCount, this.utteranceStrongFrames);
    const strongShape =
      strongRatio >=
      (this.lastVadStartMode === "fallback_energy"
        ? duplexFallbackInterruptMinStrongRatio()
        : strictCandidateMinStrongRatio());
    const strongRms = this.utteranceMaxRms >= duplexFallbackInterruptMinRms();
    const scoresApprove = scores.pInterruptValid >= (previewValid ? 0.62 : 0.68);
    const prosodySpeech = this.hasProsodySpeechEvidence();
    if (previewValid) {
      return (
        scoresApprove &&
        scores.pUserSpeech >= 0.58 &&
        scores.pNonSpeechMedia <= 0.3 &&
        (strongShape || strongRms || prosodySpeech)
      );
    }
    return (
      scoresApprove &&
      strongShape &&
      strongRms &&
      prosodySpeech &&
      scores.pUserSpeech >= 0.68 &&
      scores.pNonSpeechMedia <= 0.18
    );
  }

  private maybePromoteListeningTurn(speechDurationMs: number): void {
    if (!this.pendingListeningPromotion) return;
    if (getMeaningfulTurnPreview(this.lastMeaningfulPartialText || this.lastPreviewText)) {
      this.pendingListeningPromotion = false;
      this.markMeaningfulSpeechActivity("meaningful_preview");
      this.maybeEmitDeferredVadStart("meaningful_preview");
      return;
    }
    if (!this.hasReliableListeningPromotionEvidence(speechDurationMs)) return;

    this.pendingListeningPromotion = false;
    this.turnTakingState = "HOLD";
    this.maybeEmitDeferredVadStart("promoted_speech_shape");
    this.publishTurnState("listening_active", "speech_start", { force: true });
  }

  private publishTurnState(
    state: RemiTurnState,
    reason: RemiTurnStateReason,
    extras?: {
      generationId?: number;
      preview?: string;
      interruptionType?: InterruptionType | null;
      force?: boolean;
    },
  ): void {
    publishSessionTurnState(
      {
        connId: this.connId,
        sink: this.ws,
        turnState: this.turnState,
        lastPublishedTurnState: this.lastPublishedTurnState,
        lastPublishedTurnReason: this.lastPublishedTurnReason,
        turnStateEnteredAt: this.turnStateEnteredAt,
        lastSpeechStartAt: this.lastSpeechStartAt,
        lastSpeechEndAt: this.lastSpeechEndAt,
        lastSttFinalAt: this.lastSttFinalAt,
        lastAssistantEnterAt: this.lastAssistantEnterAt,
        lastPlaybackStartAt: this.lastPlaybackStartAt,
        lastMeaningfulGrowthAt: this.lastMeaningfulGrowthAt,
        lastMeaningfulPartialAt: this.lastMeaningfulPartialAt,
        setTurnState: (next) => {
          this.turnState = next;
        },
        setTurnStateEnteredAt: (timestamp) => {
          this.turnStateEnteredAt = timestamp;
        },
        setLastAssistantEnterAt: (timestamp) => {
          this.lastAssistantEnterAt = timestamp;
        },
        setLastPlaybackStartAt: (timestamp) => {
          this.lastPlaybackStartAt = timestamp;
        },
        setLastPublishedTurnState: (next) => {
          this.lastPublishedTurnState = next;
        },
        setLastPublishedTurnReason: (next) => {
          this.lastPublishedTurnReason = next;
        },
      },
      state,
      reason,
      extras,
    );
    const traceId =
      typeof extras?.generationId === "number" &&
      extras.generationId === this.activeGenerationId &&
      this.activeTraceId
        ? this.activeTraceId
        : this.pendingVoiceTraceId ?? this.activeTraceId;
    if (traceId) {
      getLatencyTracer(this.connId).recordTurnState(traceId, {
        state,
        reason,
        generationId: extras?.generationId,
        preview: extras?.preview,
        interruptionType: extras?.interruptionType ?? null,
      });
    }
    // SHADOW: mirror authoritative turn-state transitions into SpeechRuntime.
    this.speechRuntime.observeTurnState(state, reason, {
      generationId: extras?.generationId,
      interruptionType: extras?.interruptionType ?? null,
    });
    // SHADOW: feed the swappable voice shell (legacy = no-op; realtime_shadow = log).
    this.voiceEngine.observe({
      kind: "turn_state",
      state,
      reason,
      data: { interruptionType: extras?.interruptionType ?? null },
    });
  }

  private maybeSendBackchannel(input: {
    state: TurnTakingState;
    previewText: string;
    stableMs: number | null;
    recentGrowth: boolean;
    semanticallyComplete: boolean;
    incompleteTail: boolean;
    interruptionType: InterruptionType | null;
  }, generationId?: number): void {
    if (!voiceBackchannelEnabled()) return;
    if (input.interruptionType === "correction" || input.interruptionType === "emotional_interrupt") {
      logger.debug("[Backchannel] suppressed", {
        connId: this.connId,
        reason: "interruption_policy",
        interruptionType: input.interruptionType,
      });
      return;
    }
    const now = Date.now();
    const decision = evaluateBackchannelDecision({
      emotion: this.brain.emotion.getEmotion() as any,
      state: input.state,
      previewText: input.previewText,
      stableMs: input.stableMs,
      recentGrowth: input.recentGrowth,
      semanticallyComplete: input.semanticallyComplete,
      incompleteTail: input.incompleteTail,
      alreadySentThisTurn: this.backchannelSentThisTurn,
      cooldownActive: now - this.lastBackchannelAt < voiceBackchannelCooldownMs(),
      cooldownStableMs: voiceBackchannelStableMs(),
      minPreviewChars: 6,
    });
    if (!decision.allowed) {
      logger.debug("[Backchannel] suppressed", {
        connId: this.connId,
        reason: decision.reason,
        turnState: input.state,
        stableMs: input.stableMs ?? 0,
        preview: getMeaningfulTurnPreview(input.previewText) || undefined,
      });
      return;
    }

    this.backchannelSentThisTurn = true;
    this.lastBackchannelAt = now;
    const text = decision.text ?? "嗯";
    logger.info("[Backchannel] trigger", {
      connId: this.connId,
      reason: decision.reason,
      thinkingPause: decision.thinkingPause,
      text,
      generationId,
    });
    void synthesize(text, undefined, this.brain.emotion.getEmotion() as any, {
      connId: this.connId,
      generationId,
      usage: "backchannel",
      relationalStance: this.brain.persona.liveState.relationalStance,
      responsePolicy: this.brain.lastResponsePolicy ?? null,
    })
      .then((buf) => {
        send(this.ws, {
          type: "voice",
          audio: buf.toString("base64"),
          generationId,
        });
      })
      .catch(() => {
        this.backchannelSentThisTurn = false;
      });
  }

  private classifyCarryForward(userText: string): {
    interruptionType: InterruptionType | null;
    carryForwardHint?: string;
  } {
    const interruptedReply =
      this.brain.lastInterruptedReply?.trim() ||
      this.brain.currentAssistantDraft?.trim() ||
      null;
    if (!interruptedReply) {
      this.lastInterruptionType = null;
      return { interruptionType: null, carryForwardHint: undefined };
    }
    const interruptionType = classifyInterruption(userText, interruptedReply);
    this.lastInterruptionType = interruptionType;
    return {
      interruptionType,
      carryForwardHint: buildCarryForwardHint(
        interruptionType,
        interruptedReply,
      ),
    };
  }

  private trackTurnTakingPartial(content: string): void {
    const nextState = updatePartialTrackingState({
      content,
      lastMeaningfulPartialText: this.lastMeaningfulPartialText,
      lastMeaningfulGrowthAt: this.lastMeaningfulGrowthAt,
      recentPartialPlateauCount: this.recentPartialPlateauCount,
      partialShapeSamples: this.partialShapeSamples,
      maxSamples: this.PARTIAL_SHAPE_MAX_SAMPLES,
    });
    if (!nextState) return;

    this.lastMeaningfulPartialText = nextState.lastMeaningfulPartialText;
    this.lastMeaningfulPartialAt = nextState.lastMeaningfulPartialAt;
    this.lastMeaningfulGrowthAt = nextState.lastMeaningfulGrowthAt;
    this.lastMeaningfulGrowthChars = nextState.lastMeaningfulGrowthChars;
    this.recentPartialPlateauCount = nextState.recentPartialPlateauCount;
    this.partialShapeSamples = nextState.partialShapeSamples;
  }

  private resolvePredictionGate(text: string): PredictionGate {
    const interruptedReply =
      this.brain.lastInterruptedReply?.trim() ||
      this.brain.currentAssistantDraft?.trim() ||
      null;
    return resolvePredictionGate({
      text,
      predictionDebounceMs: this.predictionDebounceMs,
      turnTakingState: this.turnTakingState,
      aggregates: getPartialShapeAggregates(this.partialShapeSamples),
      interruptedReply,
      lastInterruptionType: this.lastInterruptionType,
    });
  }

  private async runPrediction(
    text: string,
    options?: { mode?: "full" | "short"; includeCarryForwardHint?: boolean },
  ): Promise<void> {
    if (!this.predictionEnabled || !text.trim()) return;
    if (text !== this.currentPartialText) return;
    this.cancelPrediction();
    this.currentPartialText = text;
    const abort = new AbortController();
    this.predictionAbort = abort;
    const traceId = this.pendingVoiceTraceId ?? this.activeTraceId;
    try {
      logger.debug("[预判] 开始预判", { text: text.slice(0, 30) });
      const { reply, analysis } = await computeSessionPrediction({
        connId: this.connId,
        sink: this.ws,
        brain: this.brain,
        text,
        signal: abort.signal,
        traceId,
        pushPrediction: this.predictionPushEnabled,
        options,
      });
      if (abort.signal.aborted) return;
      this.predictedReply = reply;
      this.predictedStructuredAnalysis = analysis;
      logger.debug("[预判] 完成", { preview: reply.slice(0, 30) });
    } catch (err) {
      logger.debug("[预判] 失败", { error: (err as Error).message });
    } finally {
      if (this.predictionAbort === abort) {
        this.predictionAbort = null;
      }
    }
  }

  private emitSttPartial(
    content: string,
    meta?: {
      source?: string;
      stability?: string;
      sequence?: number;
    },
  ): void {
    if (!content) return;
    const now = Date.now();
    const sameContent = content === this.lastPartialContent;
    if (sameContent && now - this.lastPartialEmitAt < 120) return;
    const traceId = this.pendingVoiceTraceId ?? this.activeTraceId;
    if (traceId) {
      getLatencyTracer(this.connId).mark("stt_partial", traceId);
    }
    const meaningfulPreview = getMeaningfulTurnPreview(content);
    if (meaningfulPreview) {
      this.maybeEmitDeferredVadStart("stt_partial");
    }
    send(this.ws, {
      type: "stt_partial",
      content,
      ...(meta?.source ? { source: meta.source } : {}),
      ...(meta?.stability ? { stability: meta.stability } : {}),
      ...(typeof meta?.sequence === "number" ? { sequence: meta.sequence } : {}),
    });
    this.lastPartialEmitAt = now;
    this.lastPartialContent = content;
    this.trackTurnTakingPartial(content);
    this.pendingListeningPromotion = false;
    this.publishTurnState("listening_active", "partial_growth", {
      preview: meaningfulPreview,
    });

    // 开启预判功能的话，防抖触发预判
    if (this.predictionEnabled && content.trim() && content !== this.currentPartialText) {
      const gate = this.resolvePredictionGate(content);
      logger.debug("[Prediction] gate", {
        connId: this.connId,
        allow: gate.allow,
        mode: gate.mode,
        reason: gate.reason,
      });
      if (!gate.allow) {
        this.currentPartialText = content;
        return;
      }
      // 取消之前的防抖定时器
      if (this.predictionTimer) {
        clearTimeout(this.predictionTimer);
      }
      this.currentPartialText = content;
      const debounceMs = gate.debounceMs;
      const mode = gate.mode;
      const includeCarryForwardHint = gate.includeCarryForwardHint;
      this.predictionTimer = setTimeout(() => {
        this.predictionTimer = null;
        const now = Date.now();
        if (
          this.lastPredictionIssuedText === content &&
          now - this.lastPredictionIssuedAt < Math.max(120, Math.floor(debounceMs * 0.7))
        ) {
          return;
        }
        this.lastPredictionIssuedText = content;
        this.lastPredictionIssuedAt = now;
        void this.runPrediction(content, { mode, includeCarryForwardHint });
      }, debounceMs);
    }
  }

  private handleStreamingSttPartial(event: StreamingTranscriptPartial): void {
    if (!this.duplexActive) return;
    const text = String(event.content ?? "").trim();
    if (!text) return;
    if (!this.vad.speaking && this.speechBufferBytes <= 0) return;

    const durMs = (this.speechBufferBytes / 2 / this.duplexSampleRate) * 1000;
    this.lastPreviewCandidateText = text;
    if (text === this.lastPreviewText) return;
    if (!this.shouldExternalizeSttPreview(text, durMs)) return;

    this.lastPreviewText = text;
    this.markMeaningfulSpeechActivity("streaming_stt_partial");
    this.speechRuntime.observeEvent("transcript.partial", { text, source: event.provider ?? null });
    this.voiceEngine.observe({ kind: "partial_user_text", text });
    // PR5d: feed the real partial to the turn detector so limited_on can compute
    // & cache an EOU off the fast path. No-op outside limited_on. Never throws.
    this.turnDetector.notePartial?.(text);
    this.emitSttPartial(text, {
      source: event.provider,
      stability: event.stability,
      sequence: event.sequence,
    });
  }

  private nextGenerationId(): number {
    this.generationSeq += 1;
    this.activeGenerationId = this.generationSeq;
    return this.generationSeq;
  }

  private sendInterrupt(
    generationId: number | null = this.currentInterruptTargetGenerationId(),
  ): void {
    if (typeof generationId === "number") {
      send(this.ws, { type: "interrupt", generationId });
      return;
    }
    send(this.ws, { type: "interrupt" });
  }

  private createTraceId(source: "voice" | "text" | "silence_nudge", generationId?: number): string {
    this.traceSeq += 1;
    const g = typeof generationId === "number" ? `-g${generationId}` : "";
    return `${source}${g}-${Date.now()}-${this.traceSeq}`;
  }

  private startTrace(traceId: string, source: "voice" | "text" | "silence_nudge", generationId?: number): void {
    getLatencyTracer(this.connId).startTrace(traceId, {
      source,
      generationId,
      sessionId: this.sessionId,
    });
  }

  private annotateTrace(traceId: string | null, context: {
    scenarioKey?: string;
    sessionId?: string | null;
    releaseReason?: string;
    releaseStableMs?: number | null;
    usedNoVadFallback?: boolean;
    utteranceSeq?: number | null;
    sttJobSeq?: number | null;
    ingressSampleRate?: number | null;
    normalizedSampleRate?: number | null;
    droppedReason?: string | null;
    rejectedReason?: string | null;
    rejectedTranscript?: string | null;
    rejectedSource?: string | null;
    prosodyApplied?: string | null;
    previewText?: string | null;
    finalTranscript?: string | null;
    interruptionType?: string | null;
    sttPath?: "server" | "cli" | "skipped" | null;
    sttFallbackReason?: string | null;
    sttJobPriority?: SttJobPriority | null;
    sttQueueBlockedByPriorJob?: boolean | null;
    idleGuardActive?: boolean | null;
    sttPreemptReason?: string | null;
    sttRequestDegraded?: boolean | null;
  }): void {
    if (!traceId) return;
    getLatencyTracer(this.connId).annotateTrace(traceId, context);
  }

  getResolvedTtsTransport(): SessionTtsTransport {
    return this.resolvedTtsTransport;
  }

  private ensureVoiceTrace(startMarkVad: boolean): string {
    if (!this.pendingVoiceTraceId) {
      this.pendingVoiceTraceId = this.createTraceId("voice");
      this.startTrace(this.pendingVoiceTraceId, "voice");
      this.annotateTrace(this.pendingVoiceTraceId, {
        utteranceSeq: this.utteranceSeq || null,
        ingressSampleRate: this.duplexIngressSampleRate,
        normalizedSampleRate: this.duplexNormalizedSampleRate,
      });
    }
    if (startMarkVad) {
      getLatencyTracer(this.connId).mark("vad_speech_start", this.pendingVoiceTraceId);
    }
    return this.pendingVoiceTraceId;
  }

  private takeVoiceTrace(): string {
    if (!this.pendingVoiceTraceId) {
      this.pendingVoiceTraceId = this.createTraceId("voice");
      this.startTrace(this.pendingVoiceTraceId, "voice");
      this.annotateTrace(this.pendingVoiceTraceId, {
        utteranceSeq: this.utteranceSeq || null,
        ingressSampleRate: this.duplexIngressSampleRate,
        normalizedSampleRate: this.duplexNormalizedSampleRate,
      });
    }
    const traceId = this.pendingVoiceTraceId;
    this.pendingVoiceTraceId = null;
    return traceId;
  }

  private bindActiveGeneration(generationId: number, traceId: string, source: "voice" | "text" | "silence_nudge"): void {
    this.activeTraceId = traceId;
    this.startTrace(traceId, source, generationId);
  }

  private resolveUtteranceGapMs(speechDurationMs: number): number {
    return resolveUtteranceGapMs({
      speechDurationMs,
      lastPreviewText: this.lastPreviewText,
      lastPreviewAt: this.lastPreviewAt,
    });
  }

  private resolveTurnTakingDecision(speechDurationMs: number): {
    state: TurnTakingState;
    gapMs: number;
    previewText: string;
    primaryReason: string;
    stableMs: number | null;
    recentGrowth: boolean;
    semanticallyComplete: boolean;
    incompleteTail: boolean;
    interruptionType: InterruptionType | null;
    prosodyApplied: string | null;
  } {
    const previewText = this.lastMeaningfulPartialText || this.lastPreviewText;
    const carryForwardPreview =
      /继续刚才|回到刚才|上次那个|还是那个|不是那个意思|我想说的是|我其实是想说/u.test(
        previewText,
      );
    const correctionPreview =
      /不是那个意思|不对|我的意思是|我想说的是|我其实是想说/u.test(previewText);
    const interruptedReply =
      this.brain.lastInterruptedReply?.trim() ||
      this.brain.currentAssistantDraft?.trim() ||
      null;
    const interruptionPreviewType =
      previewText
        ? classifyInterruption(previewText, interruptedReply)
        : this.lastInterruptionType;
    const interruptionContinuity =
      (carryForwardPreview ||
        correctionPreview ||
        interruptionPreviewType === "continuation" ||
        interruptionPreviewType === "correction") &&
      Boolean(interruptedReply || this.lastInterruptionType);
    const continuityBias =
      (carryForwardPreview || interruptionPreviewType === "continuation") &&
      (interruptionContinuity || this.isContinuousConversation());
    const correctionBias =
      correctionPreview || interruptionPreviewType === "correction";
    const emotionalInterruptBias = interruptionPreviewType === "emotional_interrupt";
    const topicSwitchBias = interruptionPreviewType === "topic_switch";
    const now = Date.now();
    const partialShape = getPartialShapeAggregates(this.partialShapeSamples);
    const prosody = turnProsodyEnabled() ? summarizeProsody(this.prosodySamples) : null;
    const growthPlateauMs =
      this.lastMeaningfulGrowthAt > 0 ? Math.max(0, now - this.lastMeaningfulGrowthAt) : null;
    const baseGap = continuityBias
      ? Math.max(60, this.resolveUtteranceGapMs(speechDurationMs) - 50)
      : this.resolveUtteranceGapMs(speechDurationMs);
    if (!turnTakingEnabled()) {
      const preview = getMeaningfulTurnPreview(previewText);
      this.publishTurnState("confirmed_end", "confirmed_end", {
        preview,
      });
      return {
        state: "CONFIRMED_END",
        gapMs: baseGap,
        previewText: preview,
        stableMs: null,
        recentGrowth: false,
        semanticallyComplete: false,
        incompleteTail: false,
        interruptionType: interruptionPreviewType,
        primaryReason: "turn_taking_disabled",
        prosodyApplied: null,
      };
    }

    const releaseMs = getConfig().VAD_UTTERANCE_GAP_PREVIEW_RELEASE_MS;
    const minGapMs = getConfig().VAD_UTTERANCE_GAP_PREVIEW_MIN_MS;
    const decision = this.turnDetector.evaluateTurnEnd({
      baseGapMs: baseGap,
      previewText,
      nowMs: now,
      lastPartialUpdateAt: this.lastMeaningfulPartialAt,
      lastGrowthAt: this.lastMeaningfulGrowthAt,
      growthPlateauMs,
      recentGrowthChars: this.lastMeaningfulGrowthChars,
      growthPlateauCount: this.recentPartialPlateauCount,
      partialGrowthTrend: partialShape.partialGrowthTrend,
      semanticCompletionStreak: partialShape.semanticCompletionStreak,
      smallDeltaStreak: partialShape.smallDeltaStreak,
      hesitationHoldMs: hesitationHoldMs(),
      growthHoldMs: turnTakingGrowthHoldMs(),
      likelyStableMs: correctionBias
        ? Math.max(240, turnTakingLikelyStableMs() - 260)
        : emotionalInterruptBias
          ? Math.max(220, turnTakingLikelyStableMs() - 280)
          : topicSwitchBias
            ? Math.max(260, turnTakingLikelyStableMs() - 160)
        : continuityBias
          ? Math.max(320, turnTakingLikelyStableMs() - 180)
          : turnTakingLikelyStableMs(),
      confirmedStableMs: correctionBias
        ? Math.max(420, turnTakingConfirmedStableMs() - 360)
        : emotionalInterruptBias
          ? Math.max(360, turnTakingConfirmedStableMs() - 420)
          : topicSwitchBias
            ? Math.max(480, turnTakingConfirmedStableMs() - 260)
        : continuityBias
          ? Math.max(620, turnTakingConfirmedStableMs() - 220)
          : turnTakingConfirmedStableMs(),
      releaseMs,
      minGapMs:
        correctionBias || emotionalInterruptBias
          ? Math.max(60, minGapMs - 20)
          : minGapMs,
      interruptionType: interruptionPreviewType,
      prosody,
    });

    this.turnTakingState = decision.state;
    const traceId = this.pendingVoiceTraceId ?? this.activeTraceId;
    this.annotateTrace(traceId, {
      releaseReason: decision.primaryReason,
      releaseStableMs: decision.stableMs,
      prosodyApplied: decision.prosodyApplied ?? null,
      previewText: decision.previewText ?? null,
      interruptionType: interruptionPreviewType ?? null,
    });
    logger.info("[TurnTaking] decision", {
      connId: this.connId,
      decision: {
        state: decision.state,
      },
      state: decision.state,
      gapMs: decision.gapMs,
      speechMs: Math.round(speechDurationMs),
      previewText: decision.previewText,
      preview: decision.previewText,
      reasons: decision.reasons,
      fallback: decision.usedFallback,
      primaryReason: decision.primaryReason,
      stableMs: decision.stableMs ?? undefined,
      lastPartialUpdateAt: this.lastMeaningfulPartialAt || undefined,
      lastGrowthAt: this.lastMeaningfulGrowthAt || undefined,
      recentGrowth: decision.recentGrowth,
      recentGrowthChars: this.lastMeaningfulGrowthChars || undefined,
      growthPlateauCount: this.recentPartialPlateauCount || undefined,
      partialGrowthTrend: partialShape.partialGrowthTrend,
      semanticCompletionStreak: partialShape.semanticCompletionStreak || undefined,
      smallDeltaStreak: partialShape.smallDeltaStreak || undefined,
      semanticallyComplete: decision.semanticallyComplete,
      sentenceClosed: decision.sentenceClosed,
      prosodyApplied: decision.prosodyApplied ?? undefined,
      prosody:
        prosody && prosody.reliable
          ? {
              voicedRatio: Number(prosody.voicedRatio.toFixed(2)),
              voicedTailFrames: prosody.voicedTailFrames,
              pitchFrames: prosody.pitchFrames,
              pitchConfidence: Number(prosody.pitchConfidence.toFixed(2)),
              pitchSlopeHz:
                prosody.pitchSlopeHz !== null ? Number(prosody.pitchSlopeHz.toFixed(1)) : undefined,
              tailEnergyDrop:
                prosody.tailEnergyDrop !== null ? Number(prosody.tailEnergyDrop.toFixed(4)) : undefined,
              risingTail: prosody.risingTail,
              fallingTail: prosody.fallingTail,
              sustainedVoicedTail: prosody.sustainedVoicedTail,
            }
          : undefined,
      continuityBias,
      correctionBias,
      emotionalInterruptBias,
      topicSwitchBias,
      carryForwardPreview,
      correctionPreview,
      interruptionContinuity,
      interruptionPreviewType,
      growthPlateauMs: growthPlateauMs ?? undefined,
    });

    this.publishTurnState(
      decision.state === "CONFIRMED_END"
        ? "confirmed_end"
        : decision.state === "LIKELY_END"
          ? "likely_end"
          : "listening_hold",
      decision.state === "CONFIRMED_END"
        ? "confirmed_end"
        : decision.state === "LIKELY_END"
          ? "likely_end"
          : "semantic_hold",
      {
        preview: decision.previewText,
      },
    );

    return {
      state: decision.state,
      gapMs: decision.gapMs,
      previewText: decision.previewText ?? "",
      primaryReason: decision.primaryReason,
      stableMs: decision.stableMs,
      recentGrowth: decision.recentGrowth,
      semanticallyComplete: decision.semanticallyComplete,
      incompleteTail: decision.incompleteTail,
      interruptionType: interruptionPreviewType,
      prosodyApplied: decision.prosodyApplied ?? null,
    };
  }

  private scheduleSttPreview(speechMs: number): void {
    if (!this.stt.canPreviewPcm()) {
      return;
    }
    if (speechMs < sttPreviewMinSpeechMs()) {
      return;
    }
    if (this.previewInFlight || this.previewTimer) return;

    const now = Date.now();
    const interval = sttPreviewIntervalMs();
    const debounce = sttPreviewDebounceMs();
    const remain = Math.max(0, interval - (now - this.lastPreviewAt));
    const delay = Math.max(debounce, remain);
    this.previewTimer = setTimeout(() => {
      this.previewTimer = null;
      void this.runSttPreview();
    }, delay);
  }

  private async runSttPreview(): Promise<void> {
    if (!this.duplexActive || !this.vad.speaking || this.previewInFlight) return;
    this.previewInFlight = true;
    this.lastPreviewAt = Date.now();
    try {
      const pcm = this.speechBufferBytes > 0 ? Buffer.concat(this.speechBuffer) : Buffer.alloc(0);
      const durMs = (this.speechBufferBytes / 2 / this.duplexSampleRate) * 1000;
      const preview = await this.stt.previewPcmBuffer(pcm, this.duplexSampleRate, sttPreviewWindowMs());
      if (!this.duplexActive || !this.vad.speaking) return;

      const text = typeof preview === "string" ? preview.trim() : "";
      if (text) {
        if (text !== this.lastPreviewCandidateText) {
          this.lastPreviewCandidateText = text;
        }
        if (text !== this.lastPreviewText && this.shouldExternalizeSttPreview(text, durMs)) {
          this.lastPreviewText = text;
          this.markMeaningfulSpeechActivity("stt_preview");
          this.emitSttPartial(text);
        } else if (text !== this.lastPreviewText) {
          logger.debug("[STT preview] suppress low-confidence preview", {
            connId: this.connId,
            mode: this.lastVadStartMode ?? undefined,
            speechMs: Math.round(durMs),
            text,
          });
        }
        return;
      }

      if (!this.lastPreviewText) {
        this.emitSttPartial(`录音中… ${(durMs / 1000).toFixed(1)}s`);
      }
    } catch (err) {
      logger.debug("[STT preview]", {
        connId: this.connId,
        error: (err as Error).message,
      });
      const durMs = (this.speechBufferBytes / 2 / this.duplexSampleRate) * 1000;
      if (!this.lastPreviewText) {
        this.emitSttPartial(`录音中… ${(durMs / 1000).toFixed(1)}s`);
      }
    } finally {
      this.previewInFlight = false;
    }
  }

  /** 判断是否处于连续对话状态（近3轮有交互且未超时） */
  private isContinuousConversation(): boolean {
    return isContinuousConversation(this.buildContinuityRuntime());
  }

  /** 同步VAD静默阈值到当前对话状态 */
  private syncVadSilenceThreshold(): void {
    syncSessionVadSilenceThreshold(this.buildContinuityRuntime());
  }

  /** 用户每次发文字或语音被识别后调用，重新计时沉默搭话和连续对话状态 */
  private touchUserActivity(userMessage?: string): void {
    touchSessionUserActivity(this.buildContinuityRuntime(), userMessage);
  }

  /**
   * 沉默超时：串进 pipelineChain，与用户消息互斥；结束后继续计时下一轮。
   */
  private fireSilenceNudge(): void {
    fireSessionSilenceNudge(this.buildContinuityRuntime());
  }

  private async persistRelationshipContinuityState(): Promise<void> {
    const runtime = { connId: this.connId, brain: this.brain };
    await persistRelationshipContinuityState(runtime);
    // DL-P1b: RemiSelf 写回，与关系连续性状态并排（flag off 时 no-op）。
    void persistRemiSelfState(runtime).catch(() => {});
  }

  /** Feed accumulated speechBuffer into STT and run pipeline (buffer cleared after feed). */
  private enqueueSttFromSpeechBuffer(): void {
    const speechDurationMs = (this.speechBufferBytes / 2 / this.duplexSampleRate) * 1000;
    const turnPreview = this.lastMeaningfulPartialText || this.lastPreviewText;
    this.stt.cancelPreview();
    const pcm = this.speechBufferBytes > 0 ? Buffer.concat(this.speechBuffer) : Buffer.alloc(0);
    this.clearSpeechBuffer();
    this.clearSuppressedFallbackBuffer();
    const job = this.createDuplexUtteranceJob({
      utteranceSeq: this.utteranceSeq,
      source: "speech_buffer",
      pcm,
      durationMs: speechDurationMs,
      previewText: turnPreview,
      vadMode: this.lastVadStartMode,
      usedNoVadFallback: false,
      speechEndedAt: this.lastSpeechEndAt || Date.now(),
    });
    this.enqueueDuplexSttJob(job);
  }

  private setupVadEvents(): void {
    this.vad.on("speech_start", (meta?: { mode?: string; energy?: number; zcr?: number; crest?: number; activeRatio?: number }) => {
      const nextVadMode = meta?.mode ?? null;
      const merging = this.pendingUtteranceTimer !== null;
      const pendingCommitFallback = this.shouldIgnoreWeakFallbackRestartDuringPendingCommit(
        nextVadMode,
        meta?.energy,
      );
      if (pendingCommitFallback.ignore) {
        this.ignoredFallbackRestartActive = true;
        logger.info("[VAD] ignore weak fallback restart during pending commit", {
          connId: this.connId,
          mode: nextVadMode ?? "unknown",
          energy: meta?.energy !== undefined ? Number(meta.energy.toFixed(4)) : undefined,
          sinceSpeechEndMs: Math.round(pendingCommitFallback.sinceSpeechEndMs),
          preview: pendingCommitFallback.preview,
          interruptionType: pendingCommitFallback.interruptionType ?? undefined,
        });
        return;
      }

      this.lastSpeechStartAt = Date.now();
      this.speechRuntime.observeEvent("vad.speech_start", { mode: nextVadMode });
      this.lastVadStartMode = nextVadMode;
      // Keep cumulative speech-shape evidence when a short internal pause resumes
      // the same utterance; otherwise stop-time suppression can misclassify the
      // merged buffer as a fresh short weak segment.
      if (!merging) {
        this.resetSpeechConfidenceMetrics();
      }
      logger.info("[VAD] speech_start", {
        connId: this.connId,
        mode: meta?.mode ?? "unknown",
        energy: meta?.energy !== undefined ? Number(meta.energy.toFixed(4)) : undefined,
        zcr: meta?.zcr !== undefined ? Number(meta.zcr.toFixed(4)) : undefined,
        crest: meta?.crest !== undefined ? Number(meta.crest.toFixed(2)) : undefined,
        activeRatio: meta?.activeRatio !== undefined ? Number(meta.activeRatio.toFixed(3)) : undefined,
      });
      this.turnTakingState = "HOLD";
      if (this.duplexActive) {
        this.duplexRxVadStarts += 1;
      }

      if (this.interrupt.active || this.assistantPlaybackActive) {
        this.pendingDuplexInterrupt = true;
        logger.info("[VAD] pending duplex interrupt", {
          connId: this.connId,
          minSpeechMs: duplexInterruptMinSpeechMs(),
          playbackActive: this.assistantPlaybackActive,
        });
      }

      this.resetPreviewState();
      this.pendingListeningPromotion = true;
      if (this.interrupt.active || this.assistantPlaybackActive) {
        this.pendingDuplexInterrupt = true;
      }
      this.stt.cancelPcm();

      this.clearPendingUtteranceTimer();
      if (!merging) {
        this.nextUtteranceSeq();
      }
      this.ensureVoiceTrace(!merging);
      this.annotateTrace(this.pendingVoiceTraceId, {
        utteranceSeq: this.utteranceSeq,
        ingressSampleRate: this.duplexIngressSampleRate,
        normalizedSampleRate: this.duplexNormalizedSampleRate,
      });

      if (merging) {
        // We are extending the same utterance after a short pause. Re-appending
        // the whole pre-roll duplicates already buffered speech and can explode
        // the final STT window length when VAD flaps multiple times in one
        // sentence. In merge mode we keep the existing speech buffer as-is and
        // resume from the current chunk onward.
      } else {
        this.clearSpeechBuffer();
        for (const c of this.preRollChunks) {
          this.pushSpeechChunk(Buffer.from(c));
        }
      }
      this.preRollChunks = [];
      this.preRollBytes = 0;
      this.suppressNextSpeechChunk = !merging;

      if (this.shouldDeferDuplexVadStart(nextVadMode, merging)) {
        this.pendingVadStartSignal = true;
      } else {
        this.sendVadStartSignal("speech_start", nextVadMode);
      }
    });

    this.vad.on("speech_end", () => {
      this.lastSpeechEndAt = Date.now();
      this.speechRuntime.observeEvent("vad.speech_end");
      logger.info("[VAD] speech_end", { connId: this.connId });
      if (this.ignoredFallbackRestartActive) {
        logger.info("[VAD] ignored fallback restart ended", {
          connId: this.connId,
          mode: this.lastVadStartMode ?? undefined,
        });
        this.ignoredFallbackRestartActive = false;
        return;
      }
      if (this.pendingVoiceTraceId) {
        getLatencyTracer(this.connId).mark("vad_speech_end", this.pendingVoiceTraceId);
      }
      this.sendVadEndSignal("speech_end");
      this.clearPreviewTimer();

      const MIN_SPEECH_MS = minSpeechMs();
      const speechDurationMs = (this.speechBufferBytes / 2 / this.duplexSampleRate) * 1000;
      const idleGuardActive = this.shouldUseIdleGuard();
      if (idleGuardActive && !this.shouldReleaseIdleGuard(speechDurationMs)) {
        logger.info("[Duplex] idle noise rejected before stt", {
          connId: this.connId,
          speechMs: Math.round(speechDurationMs),
          utteranceMaxRms: Number(this.utteranceMaxRms.toFixed(4)),
          strongFrames: this.utteranceStrongFrames,
          totalFrames: this.utteranceFrameCount,
          preview: getMeaningfulTurnPreview(this.lastMeaningfulPartialText || this.lastPreviewText) || undefined,
          idleSince: this.duplexIdleSince || undefined,
        });
        if (this.pendingVoiceTraceId) {
          this.annotateTrace(this.pendingVoiceTraceId, {
            utteranceSeq: this.utteranceSeq,
            ingressSampleRate: this.duplexIngressSampleRate,
            normalizedSampleRate: this.duplexNormalizedSampleRate,
            rejectedReason: "idle_noise_rejected",
            rejectedSource: "speech_buffer",
            idleGuardActive: true,
          });
          getLatencyTracer(this.connId).log(this.pendingVoiceTraceId);
        }
        this.pendingVoiceTraceId = null;
        this.pendingDuplexInterrupt = false;
        this.pendingListeningPromotion = false;
        this.clearSpeechBuffer();
        this.resetPreviewState();
        this.stt.cancelPcm();
        this.resetSpeechConfidenceMetrics();
        this.pendingVadStartSignal = false;
        return;
      }
      if (idleGuardActive) {
        this.markMeaningfulSpeechActivity("idle_guard_released", Date.now());
        this.maybeEmitDeferredVadStart("idle_guard_released");
      }
      const canConfirmDuplexInterrupt =
        this.pendingDuplexInterrupt &&
        speechDurationMs >= duplexInterruptMinSpeechMs() &&
        this.hasReliableDuplexInterruptEvidence(speechDurationMs);
      if (canConfirmDuplexInterrupt) {
        this.maybeConfirmPendingDuplexInterrupt();
      } else if (this.pendingDuplexInterrupt && speechDurationMs >= duplexInterruptMinSpeechMs()) {
        logger.info("[VAD] weak_noise_interrupt_rejected", {
          connId: this.connId,
          mode: this.lastVadStartMode ?? undefined,
          speechMs: Math.round(speechDurationMs),
          maxRms: Number(this.utteranceMaxRms.toFixed(4)),
          strongFrames: this.utteranceStrongFrames,
          totalFrames: this.utteranceFrameCount,
          preview: getMeaningfulTurnPreview(this.lastMeaningfulPartialText || this.lastPreviewText) || undefined,
        });
        this.pendingDuplexInterrupt = false;
      } else if (this.pendingDuplexInterrupt && speechDurationMs < duplexInterruptMinSpeechMs()) {
        logger.info("[VAD] ignore tentative duplex interrupt", {
          connId: this.connId,
          speechMs: Math.round(speechDurationMs),
          minSpeechMs: duplexInterruptMinSpeechMs(),
        });
        this.pendingDuplexInterrupt = false;
      }
      const turnPreview = this.lastMeaningfulPartialText || this.lastPreviewText;
      const shouldSuppressWeakSpeech =
        this.shouldApplyDuplexNoiseSuppression() &&
        (shouldSuppressFallbackNoiseUtterance({
          vadMode: this.lastVadStartMode,
          previewText: turnPreview,
          speechDurationMs,
          suppressionMaxMs: fallbackNoiseSuppressMaxMs(),
          utteranceMaxRms: this.utteranceMaxRms,
          minUtteranceRms: fallbackNoiseSuppressMinRms(),
          utteranceFrameCount: this.utteranceFrameCount,
          utteranceStrongFrames: this.utteranceStrongFrames,
          minStrongFrames: fallbackMinStrongFrames(),
          minStrongRatio: fallbackMinStrongRatio(),
          shortTextMaxChars: fallbackNoiseShortTextMaxChars(),
        }) || shouldSuppressStrictNoPreviewUtterance({
          vadMode: this.lastVadStartMode,
          previewText: turnPreview,
          utteranceFrameCount: this.utteranceFrameCount,
          utteranceStrongFrames: this.utteranceStrongFrames,
          utteranceMaxRms: this.utteranceMaxRms,
          minUtteranceRms: fallbackNoiseSuppressMinRms(),
          minStrongFrames: strictCandidateMinStrongFrames(),
          minStrongRatio: strictCandidateMinStrongRatio(),
        }) || (
          this.lastVadStartMode === "fallback_energy" &&
          speechDurationMs < fallbackWeakSpeechSuppressMaxMs() &&
          this.utteranceStrongFrames < fallbackMinStrongFrames()
        ));
      if (shouldSuppressWeakSpeech) {
        this.captureSuppressedFallbackUtterance(this.lastSpeechEndAt || Date.now());
        logger.info("[VAD] suppress fallback noise utterance", {
          connId: this.connId,
          duplexInputMode: this.duplexInputMode,
          mode: this.lastVadStartMode,
          speechMs: Math.round(speechDurationMs),
          suppressionMaxMs: fallbackNoiseSuppressMaxMs(),
          weakSpeechSuppressMaxMs: fallbackWeakSpeechSuppressMaxMs(),
          utteranceFrameCount: this.utteranceFrameCount,
          strongFrames: this.utteranceStrongFrames,
          maxRms: Number(this.utteranceMaxRms.toFixed(4)),
          maxPeak: Number(this.utteranceMaxPeak.toFixed(4)),
        });
        this.clearSpeechBuffer();
        this.resetPreviewState();
        this.pendingVoiceTraceId = null;
        this.stt.cancelPcm();
        this.resetSpeechConfidenceMetrics();
        this.pendingVadStartSignal = false;
        this.armSuppressedNoiseCooldown("vad_suppress", this.lastVadStartMode);
        return;
      }
      const turnDecision = this.resolveTurnTakingDecision(speechDurationMs);
      const { state, gapMs: gap } = turnDecision;
      this.maybeSendBackchannel(turnDecision);
      logger.debug("[VAD] utterance_gap", {
        connId: this.connId,
        turnState: state,
        speechMs: Math.round(speechDurationMs),
        gapMs: gap,
        adaptive: getConfig().VAD_UTTERANCE_GAP_ADAPTIVE,
        preview: getMeaningfulTurnPreview(this.lastMeaningfulPartialText || this.lastPreviewText) || undefined,
      });

      if (gap <= 0) {
        if (speechDurationMs < MIN_SPEECH_MS) {
          logger.info(`[VAD] speech too short (${speechDurationMs.toFixed(0)}ms < ${MIN_SPEECH_MS}ms), discarding`, { connId: this.connId });
          this.clearSpeechBuffer();
          this.resetPreviewState();
          this.pendingVoiceTraceId = null;
          this.stt.cancelPcm();
          this.resetSpeechConfidenceMetrics();
          return;
        }
        this.clearPreviewTimer();
        this.previewInFlight = false;
        this.enqueueSttFromSpeechBuffer();
        return;
      }

      this.clearPendingUtteranceTimer();
      this.pendingUtteranceTimer = setTimeout(() => {
        this.pendingUtteranceTimer = null;
        const durMs = (this.speechBufferBytes / 2 / this.duplexSampleRate) * 1000;
        if (durMs < MIN_SPEECH_MS) {
          logger.info(`[VAD] utterance still too short after gap (${durMs.toFixed(0)}ms), discarding`, {
            connId: this.connId,
          });
          this.clearSpeechBuffer();
          this.resetPreviewState();
          this.pendingVoiceTraceId = null;
          this.stt.cancelPcm();
          return;
        }
        this.clearPreviewTimer();
        this.previewInFlight = false;
        this.enqueueSttFromSpeechBuffer();
      }, gap);
    });
  }

  private setupMessageHandlers(): void {
    attachSessionMessageHandlers({
      ws: this.ws,
      connId: this.connId,
      storageUserId: this.storageUserId,
      parseHistoryCursor,
      sendHistoryPage: (mode, cursor) => this.sendHistoryPage(mode, cursor),
      handleAudioPcm: (pcm, sampleRate, transport) =>
        this.handleAudioPcm(pcm, sampleRate, transport),
      runDevApplyPreset: (data) => {
        this.runDevCommand(this.handleDevApplyPreset(data));
      },
      runDevSetTtsVoice: (data) => {
        this.runDevCommand(this.handleDevSetTtsVoice(data));
      },
      runDevResetState: (data) => {
        this.runDevCommand(this.handleDevResetState(data));
      },
      handleGetPersonaPreset: () => this.handleGetPersonaPreset(),
      handleSetPersonaPreset: (data) => {
        void this.handleSetPersonaPreset(data).catch((error) => {
          logger.warn("[Persona] set_persona_preset failed", {
            connId: this.connId,
            userId: this.brain.userId,
            error,
          });
          send(this.ws, { type: "error", content: "保存 persona preset 失败，请稍后重试" });
        });
      },
      handleDuplexStart: (data) => this.handleDuplexStart(data),
      handleDuplexStop: () => this.handleDuplexStop(),
      handleAudioStream: (data) => this.handleAudioStream(data),
      handleAudioChunk: (data) => this.handleAudioChunk(data),
      handleAudioEnd: () => this.handleAudioEnd(),
      handlePlaybackStart: (data) => this.handlePlaybackStart(data),
      handlePlaybackEnd: (data) => this.handlePlaybackEnd(data),
      handleClientContext: (data) => this.handleClientContext(data),
      handleChat: (data) => this.handleChat(data),
      handleWorldEvent: (data) => this.handleWorldEvent(data),
      handleSetVoiceStyle: (data) => this.handleSetVoiceStyle(data),
      handleSetVoiceEngine: (data) => this.handleSetVoiceEngine(data),
    });
  }

  /** RemiWorld 世界事件 → 长期记忆（RW-P1-4b）。异步落库，不阻塞任何路径。 */
  private handleWorldEvent(data: any): void {
    void handleSessionWorldEvent(
      { connId: this.connId, userId: this.storageUserId },
      data,
    );
  }

  /**
   * WS message `set_voice_style` — UI-driven voice style / speed / pitch control.
   * Payload: { voiceStyleId?: string | null, speedModifier?: string | null, pitchModifier?: string | null }
   */
  private handleSetVoiceStyle(data: any): void {
    const connId = this.connId;
    if (data.voiceStyleId !== undefined) {
      setSessionMlxVoiceStyle(connId, data.voiceStyleId ?? null);
    }
    if (data.speedModifier !== undefined) {
      setSessionMlxSpeedModifier(connId, data.speedModifier ?? null);
    }
    if (data.pitchModifier !== undefined) {
      setSessionMlxPitchModifier(connId, data.pitchModifier ?? null);
    }
    if (data.ttsEnabled !== undefined) {
      setSessionTtsEnabled(connId, data.ttsEnabled === false ? false : true);
    }
    send(this.ws, { type: "voice_style_ack", ...data });
  }

  /**
   * WS message `set_voice_engine` — per-session live override of the realtime
   * voice shell. Re-resolves through {@link resolveVoiceEngine}, so an unknown
   * id / a non-brain-authority engine / a construction failure all fall back to
   * legacy. The acked `engine` is the engine that actually took effect (which
   * may differ from `requested` when a fallback fired). Phase 1 never sends the
   * client anything beyond this ack, and never changes the live audio path.
   */
  private handleSetVoiceEngine(data: any): void {
    const requested = String(data?.engine ?? "").trim().toLowerCase();
    this.voiceEngine = resolveVoiceEngine(this.connId, this.speechRuntime, requested);
    logger.info("[VoiceEngine] set_voice_engine", {
      connId: this.connId,
      requested,
      resolved: this.voiceEngine.id,
    });
    send(this.ws, {
      type: "voice_engine_ack",
      engine: this.voiceEngine.id,
      requested,
      fellBack: requested !== "" && this.voiceEngine.id !== requested,
    });
  }

  private runDevCommand(task: Promise<void>): void {
    runSessionDevCommand(this.connId, this.ws, task);
  }

  private resetDeveloperLiveState(): void {
    resetDeveloperLiveSessionState({
      interrupt: this.interrupt,
      brain: this.brain,
      cancelPrediction: () => this.cancelPrediction(),
      clearPendingUtteranceTimer: () => this.clearPendingUtteranceTimer(),
      clearSilenceNudgeTimer: () => this.clearSilenceNudgeTimer(),
      resetPreviewState: () => this.resetPreviewState(),
      clearSpeechBuffer: () => this.clearSpeechBuffer(),
      resetDeferredDuplexTranscripts: () => this.resetDeferredDuplexTranscripts("dev_reset"),
      resetPreRoll: () => {
        this.preRollChunks = [];
        this.preRollBytes = 0;
      },
      setTurnTakingConfirmedEnd: () => {
        this.turnTakingState = "CONFIRMED_END";
      },
      clearPredictionDrafts: () => {
        this.predictedReply = "";
        this.currentPartialText = "";
      },
      clearActiveGeneration: () => {
        this.activeGenerationId = null;
        this.activeTraceId = null;
        this.assistantPlaybackActive = false;
        this.playbackGenerationId = null;
      },
      publishConfirmedEndTurnState: () => {
        this.publishTurnState("confirmed_end", "confirmed_end", { force: true });
      },
    });
  }

  private async handleDevApplyPreset(data: any): Promise<void> {
    await applyDeveloperPreset({
      connId: this.connId,
      sink: this.ws,
      brain: this.brain,
      resetDeveloperLiveState: () => this.resetDeveloperLiveState(),
      persistRelationshipContinuityState: () =>
        this.persistRelationshipContinuityState(),
    }, data);
  }

  private async handleDevSetTtsVoice(data: any): Promise<void> {
    await applyDeveloperTtsVoiceOverride(
      {
        connId: this.connId,
        sink: this.ws,
        brain: this.brain,
        resetDeveloperLiveState: () => this.resetDeveloperLiveState(),
        persistRelationshipContinuityState: () =>
          this.persistRelationshipContinuityState(),
      },
      data,
    );
  }

  private async handleDevResetState(data: any): Promise<void> {
    await resetDeveloperState({
      connId: this.connId,
      sink: this.ws,
      brain: this.brain,
      resetDeveloperLiveState: () => this.resetDeveloperLiveState(),
      persistRelationshipContinuityState: () =>
        this.persistRelationshipContinuityState(),
    }, data);
  }

  private buildContinuityRuntime() {
    return {
      connId: this.connId,
      sink: this.ws,
      brain: this.brain,
      interrupt: this.interrupt,
      avatar: this.avatar,
      sessionId: this.sessionId,
      getPipelineChain: () => this.pipelineChain,
      setPipelineChain: (next: Promise<void>) => {
        this.pipelineChain = next;
      },
      getSilenceNudgeTimer: () => this.silenceNudgeTimer,
      setSilenceNudgeTimer: (timer: ReturnType<typeof setTimeout> | null) => {
        this.silenceNudgeTimer = timer;
      },
      getLastInteractionAt: () => this.lastInteractionAt,
      setLastInteractionAt: (timestamp: number) => {
        this.lastInteractionAt = timestamp;
      },
      getRecentInteractionCount: () => this.recentInteractionCount,
      setRecentInteractionCount: (count: number) => {
        this.recentInteractionCount = count;
      },
      continuousConversationThreshold: this.CONTINUOUS_CONVERSATION_THRESHOLD,
      continuousConversationTimeoutMs: this.CONTINUOUS_CONVERSATION_TIMEOUT,
      continuousSilenceFrames: this.VAD_CONTINUOUS_SILENCE_FRAMES,
      defaultSilenceFrames: this.VAD_DEFAULT_SILENCE_FRAMES,
      syncVadSilenceFrames: (frames: number) =>
        this.vad.setSpeakingSilenceFrames(frames),
      nextGenerationId: () => this.nextGenerationId(),
      createTraceId: (
        source: "voice" | "text" | "silence_nudge",
        generationId?: number,
      ) => this.createTraceId(source, generationId),
      bindActiveGeneration: (
        generationId: number,
        traceId: string,
        source: "voice" | "text" | "silence_nudge",
      ) => this.bindActiveGeneration(generationId, traceId, source),
      getResolvedTtsTransport: () => this.getResolvedTtsTransport(),
    };
  }

  private buildVoiceSubmitRuntime() {
    return {
      sink: this.ws,
      connId: this.connId,
      brain: this.brain,
      interrupt: this.interrupt,
      avatar: this.avatar,
      sessionId: this.sessionId,
      ensureDbSession: () => this.ensureDbSession(),
      currentPartialText: this.currentPartialText,
      predictedReply: this.predictedReply,
      predictedStructuredAnalysis: this.predictedStructuredAnalysis,
      nextGenerationId: () => this.nextGenerationId(),
      bindActiveGeneration: (
        generationId: number,
        traceId: string,
        source: "voice" | "text" | "silence_nudge",
      ) => this.bindActiveGeneration(generationId, traceId, source),
      touchUserActivity: (userMessage?: string) => this.touchUserActivity(userMessage),
      classifyCarryForward: (userText: string) => this.classifyCarryForward(userText),
      publishTurnState: (
        state: RemiTurnState,
        reason: RemiTurnStateReason,
        extras?: {
          generationId?: number;
          preview?: string;
          interruptionType?: InterruptionType | null;
          force?: boolean;
        },
      ) => this.publishTurnState(state, reason, extras),
      setLastSttFinalAt: (timestamp: number) => {
        this.lastSttFinalAt = timestamp;
      },
      cancelPrediction: () => this.cancelPrediction(),
      getResolvedTtsTransport: () => this.getResolvedTtsTransport(),
    };
  }

  private handleDuplexStart(data: any): void {
    this.resetDeferredDuplexTranscripts("duplex_restart");
    this.duplexActive = true;
    const rate = Number(data.sampleRate) || DUPLEX_TARGET_SAMPLE_RATE;
    this.duplexInputMode = data?.mode === "push_to_talk" ? "push_to_talk" : "duplex";
    this.duplexIngressSampleRate = rate;
    this.duplexNormalizedSampleRate = DUPLEX_TARGET_SAMPLE_RATE;
    this.duplexIngressTransport = "binary";
    this.duplexSampleRate = DUPLEX_TARGET_SAMPLE_RATE;
    this.stt.setSampleRate(this.duplexSampleRate);
    this.vad.reset();
    this.stt.reset();
    this.clearSpeechBuffer();
    this.preRollChunks = [];
    this.preRollBytes = 0;
    this.suppressNextSpeechChunk = false;
    this.clearPendingUtteranceTimer();
    this.resetPreviewState();
    this.pendingVoiceTraceId = null;
    this.lastVadStartMode = null;
    this.lastUnexpectedSampleRateLogAt = 0;
    this.lastConfirmedInterruptAt = 0;
    this.lastMeaningfulSpeechAt = Date.now();
    this.lastAcceptedSpeechAt = this.lastMeaningfulSpeechAt;
    this.duplexIdleGuardActive = false;
    this.duplexIdleSince = 0;
    this.resetDuplexRxMetrics();
    this.stt.startStreamingPcmSession();
    logger.info("[IntermSTT] duplex_start", {
      connId: this.connId,
      interimSttActive: this.stt.canStreamPartials(),
    });
    // 启动双工前同步VAD阈值
    this.syncVadSilenceThreshold();
    logger.info(`[Duplex] 已启动`, {
      connId: this.connId,
      sampleRate: rate,
      normalizedSampleRate: this.duplexSampleRate,
      inputMode: this.duplexInputMode,
      inputGain: this.currentDuplexInputGain(),
    });
    this.speechRuntime.observeDuplexStart();
    this.voiceEngine.observe({ kind: "duplex_start" });
  }

  private handleDuplexStop(): void {
    this.speechRuntime.observeDuplexStop();
    this.voiceEngine.observe({ kind: "duplex_stop" });
    const turnPreview = this.lastMeaningfulPartialText || this.lastPreviewText;
    const vadMode = this.lastVadStartMode;
    const speechDurationMs = (this.speechBufferBytes / 2 / this.duplexSampleRate) * 1000;
    const suppressedFallbackDurationMs =
      (this.suppressedFallbackBytes / 2 / this.duplexSampleRate) * 1000;
    const rawDurationMs = (this.duplexRawBytes / 2 / this.duplexSampleRate) * 1000;
    const speechPcm =
      this.speechBufferBytes > 0 ? Buffer.concat(this.speechBuffer) : Buffer.alloc(0);
    const rawPcm =
      this.duplexRawBytes > 0 ? Buffer.concat(this.duplexRawChunks) : Buffer.alloc(0);
    const rawFrameCount = this.duplexRxFrames;
    const rawStrongFrames = this.duplexRawStrongFrames;
    const rawMaxRms = this.duplexRxMaxRms;
    const speechEndedAt = this.lastSpeechEndAt || Date.now();
    const shouldSuppressStopBuffer =
      this.speechBuffer.length > 0 &&
      this.shouldApplyDuplexNoiseSuppression() &&
      (shouldSuppressFallbackNoiseUtterance({
        vadMode,
        previewText: turnPreview,
        speechDurationMs,
        suppressionMaxMs: fallbackNoiseSuppressMaxMs(),
        utteranceMaxRms: this.utteranceMaxRms,
        minUtteranceRms: fallbackNoiseSuppressMinRms(),
        utteranceFrameCount: this.utteranceFrameCount,
        utteranceStrongFrames: this.utteranceStrongFrames,
        minStrongFrames: fallbackMinStrongFrames(),
        minStrongRatio: fallbackMinStrongRatio(),
        shortTextMaxChars: fallbackNoiseShortTextMaxChars(),
      }) ||
        shouldSuppressStrictNoPreviewUtterance({
          vadMode,
          previewText: turnPreview,
          utteranceFrameCount: this.utteranceFrameCount,
          utteranceStrongFrames: this.utteranceStrongFrames,
          utteranceMaxRms: this.utteranceMaxRms,
          minUtteranceRms: fallbackNoiseSuppressMinRms(),
          minStrongFrames: strictCandidateMinStrongFrames(),
          minStrongRatio: strictCandidateMinStrongRatio(),
        }));
    const shouldAttemptNoVadFallback = this.shouldAttemptStopTimeTranscriptionWithoutVad();
    const noVadReason = this.classifyNoVadStopReason();

    this.duplexActive = false;
    this.stt.stopStreamingPcmSession();
    this.vad.reset();
    this.clearPendingUtteranceTimer();
    this.resetPreviewState();
    this.stt.cancelPcm();
    this.resetVadSignalState();
    this.preRollChunks = [];
    this.preRollBytes = 0;
    this.suppressNextSpeechChunk = false;
    this.lastVadStartMode = null;
    this.clearIdleGuard("duplex_stop");
    this.logDuplexRxSummary(true);
    logger.info("[Duplex] stop requested", this.duplexStopDebugMeta());
    if (this.duplexRxFrames === 0) {
      logger.warn("[Duplex] stopped with no audio frames received", this.duplexStopDebugMeta({
        reason: "no_audio_frames",
      }));
    } else if (this.duplexRxVadStarts === 0) {
      logger.warn("[Duplex] received audio but never triggered VAD", this.duplexStopDebugMeta({
        reason: "audio_without_vad",
        diagnosis: noVadReason,
      }));
    }

    if (this.speechBuffer.length > 0) {
      if (shouldSuppressStopBuffer) {
        this.captureSuppressedFallbackUtterance(speechEndedAt);
        logger.info("[Duplex] suppress fallback noise utterance on stop", {
          ...this.duplexStopDebugMeta({
            reason: "suppressed_pre_stt",
            mode: vadMode,
            speechMs: Math.round(speechDurationMs),
            suppressionMaxMs: fallbackNoiseSuppressMaxMs(),
          }),
        });
        this.clearSpeechBuffer();
        this.clearDuplexRawBuffer();
        this.pendingVoiceTraceId = null;
        this.stt.cancelPcm();
        this.lastVadStartMode = null;
        this.resetSpeechConfidenceMetrics();
        this.armSuppressedNoiseCooldown("duplex_stop_pre_stt", vadMode);
      } else {
        this.stt.cancelPreview();
        this.clearSpeechBuffer();
        this.clearDuplexRawBuffer();
        this.clearSuppressedFallbackBuffer();
        const utteranceSeq = this.utteranceSeq > 0 ? this.utteranceSeq : this.nextUtteranceSeq();
        const job = this.createDuplexUtteranceJob({
          utteranceSeq,
          source: "duplex_stop_buffer",
          pcm: speechPcm,
          durationMs: speechDurationMs,
          previewText: turnPreview,
          vadMode,
          usedNoVadFallback: false,
          speechEndedAt,
        });
        this.lastVadStartMode = null;
        this.resetSpeechConfidenceMetrics();
        this.enqueueDuplexSttJob(job);
      }
    } else if (this.hasSuppressedFallbackCandidate()) {
      logger.info("[Duplex] attempting recovered suppressed fallback", this.duplexStopDebugMeta({
        reason: "attempt_recovered_suppressed_fallback",
        speechMs: Math.round(suppressedFallbackDurationMs),
        suppressedSegments: this.suppressedFallbackSegments,
      }));
      this.stt.cancelPreview();
      this.clearDuplexRawBuffer();
      const job = this.createDuplexUtteranceJob({
        utteranceSeq: this.nextUtteranceSeq(),
        source: "duplex_stop_suppressed_fallback",
        pcm: Buffer.concat(this.suppressedFallbackChunks),
        durationMs: suppressedFallbackDurationMs,
        previewText: "",
        vadMode: "fallback_energy",
        usedNoVadFallback: false,
        utteranceFrameCount: this.suppressedFallbackFrameCount,
        utteranceStrongFrames: this.suppressedFallbackStrongFrames,
        utteranceMaxRms: this.suppressedFallbackMaxRms,
        utteranceMaxPeak: this.suppressedFallbackMaxPeak,
        rawFrameCount: this.suppressedFallbackFrameCount,
        rawStrongFrames: this.suppressedFallbackStrongFrames,
        rawMaxRms: this.suppressedFallbackMaxRms,
        speechEndedAt: this.suppressedFallbackLastSpeechEndAt || Date.now(),
      });
      this.lastVadStartMode = null;
      this.resetSpeechConfidenceMetrics();
      this.clearSuppressedFallbackBuffer();
      this.enqueueDuplexSttJob(job);
    } else if (shouldAttemptNoVadFallback) {
      logger.info("[Duplex] attempting no-vad fallback", this.duplexStopDebugMeta({
        reason: "attempt_no_vad_fallback",
        diagnosis: noVadReason,
      }));
      this.stt.cancelPreview();
      this.clearDuplexRawBuffer();
      this.clearSuppressedFallbackBuffer();
      const job = this.createDuplexUtteranceJob({
        utteranceSeq: this.nextUtteranceSeq(),
        source: "duplex_stop_no_vad",
        pcm: rawPcm,
        durationMs: rawDurationMs,
        previewText: "",
        vadMode: "fallback_energy",
        usedNoVadFallback: true,
        utteranceFrameCount: rawFrameCount,
        utteranceStrongFrames: rawStrongFrames,
        utteranceMaxRms: rawMaxRms,
        utteranceMaxPeak: this.duplexRxLastPeak,
        rawFrameCount,
        rawStrongFrames,
        rawMaxRms,
        speechEndedAt: Date.now(),
      });
      this.lastVadStartMode = null;
      this.resetSpeechConfidenceMetrics();
      this.enqueueDuplexSttJob(job);
    } else {
      this.pendingVoiceTraceId = null;
      this.clearSpeechBuffer();
      this.clearDuplexRawBuffer();
      this.clearSuppressedFallbackBuffer();
      this.lastVadStartMode = null;
      this.resetSpeechConfidenceMetrics();
      logger.info("[Duplex] skipped no-vad fallback", this.duplexStopDebugMeta({
        reason: "skipped_no_vad_fallback",
        diagnosis: noVadReason,
      }));
    }

    logger.info("[Duplex] 已停止", { connId: this.connId });
  }

  private appendPreRoll(pcm: Buffer): void {
    const maxBytes = preRollMaxBytes(this.duplexSampleRate);
    this.preRollBytes = appendChunkWithByteCap(
      this.preRollChunks,
      this.preRollBytes,
      pcm,
      maxBytes,
    );
  }

  private handleAudioPcm(
    pcm: Buffer,
    rate: number,
    transport: DuplexIngressTransport = "binary",
  ): void {
    if (!this.duplexActive) return;
    const normalized = normalizeDuplexPcm16Mono(
      pcm,
      rate > 0 ? rate : this.duplexIngressSampleRate,
      DUPLEX_TARGET_SAMPLE_RATE,
    );
    this.duplexIngressSampleRate = normalized.ingressSampleRate;
    this.duplexNormalizedSampleRate = normalized.normalizedSampleRate;
    this.duplexIngressTransport = transport;
    const now = Date.now();
    this.updateIdleGuard(now);
    if (normalized.resampled && now - this.lastUnexpectedSampleRateLogAt > 1000) {
      this.lastUnexpectedSampleRateLogAt = now;
      logger.warn("[Duplex] unexpected_sample_rate", {
        connId: this.connId,
        utteranceSeq: this.utteranceSeq,
        transport,
        ingressSampleRate: normalized.ingressSampleRate,
        normalizedSampleRate: normalized.normalizedSampleRate,
        frameBytes: pcm.length,
      });
    }
    const inputGain = this.currentDuplexInputGain();
    const normalizedPcm =
      inputGain > 1 ? applyPcm16Gain(normalized.pcm, inputGain) : normalized.pcm;
    const sampleRate = normalized.normalizedSampleRate;
    this.duplexSampleRate = sampleRate;
    this.stt.setSampleRate(sampleRate);
    this.stt.feedStreamingPcm(normalizedPcm, sampleRate);
    const rms = pcmRms(normalizedPcm);
    const peak = pcmPeak(normalizedPcm);
    this.duplexRxFrames += 1;
    this.duplexRxBytes += normalizedPcm.length;
    this.duplexRxLastRms = rms;
    this.duplexRxLastPeak = peak;
    this.duplexRxMaxRms = Math.max(this.duplexRxMaxRms, rms);
    this.appendDuplexRawChunk(normalizedPcm);
    if (isNoVadFallbackSpeechLikeFrame(normalizedPcm, rms, peak)) {
      this.duplexRawStrongFrames += 1;
    }
    this.logDuplexRxSummary();
    this.annotateTrace(this.pendingVoiceTraceId, {
      utteranceSeq: this.utteranceSeq || null,
      ingressSampleRate: this.duplexIngressSampleRate,
      normalizedSampleRate: this.duplexNormalizedSampleRate,
    });

    this.appendPreRoll(normalizedPcm);
    if (
      !this.vad.speaking &&
      this.suppressedNoiseCooldownUntil > now &&
      !getMeaningfulTurnPreview(this.lastMeaningfulPartialText || this.lastPreviewText)
    ) {
      if (rms >= suppressedNoiseBypassRms() || peak >= suppressedNoiseBypassPeak()) {
        this.suppressedNoiseCooldownUntil = 0;
      } else {
        if (now - this.lastSuppressedNoiseLogAt > 250) {
          this.lastSuppressedNoiseLogAt = now;
          logger.debug("[Duplex] suppressing weak audio during noise cooldown", {
            connId: this.connId,
            cooldownRemainingMs: this.suppressedNoiseCooldownUntil - now,
            rms: Number(rms.toFixed(4)),
            peak: Number(peak.toFixed(4)),
          });
        }
        return;
      }
    }
    this.vad.feed(normalizedPcm);

    if (this.vad.speaking) {
      if (this.ignoredFallbackRestartActive) {
        return;
      }
      this.trackSpeechConfidence(rms, peak);
      if (turnProsodyEnabled()) {
        this.prosodySamples = appendProsodySample(
          this.prosodySamples,
          normalizedPcm,
          sampleRate,
          this.PROSODY_MAX_SAMPLES,
          now,
        );
      }
      if (this.suppressNextSpeechChunk) {
        this.suppressNextSpeechChunk = false;
      } else {
        this.pushSpeechChunk(normalizedPcm);
      }

      const durMs = (this.speechBufferBytes / 2 / sampleRate) * 1000;
      this.maybePromoteListeningTurn(durMs);
      this.maybeConfirmPendingDuplexInterrupt();
      this.scheduleSttPreview(durMs);
    }
  }

  private handleAudioStream(data: any): void {
    const pcm = Buffer.from(data.audio, "base64");
    const rate = Number(data.sampleRate) || this.duplexIngressSampleRate;
    this.handleAudioPcm(pcm, rate, "json");
  }

  private handleAudioChunk(data: any): void {
    this.stt.feed(Buffer.from(data.audio, "base64"));
  }

  private handleAudioEnd(): void {
    this.pipelineChain = this.pipelineChain
      .then(async () => {
        const traceId = this.createTraceId("voice");
        this.startTrace(traceId, "voice");
        try {
          const text = await this.stt.end();
          if (!text) return;
          if (this.duplexActive && isTentativeSpeechText(text)) {
            logger.info("[STT] suppress tentative duplex utterance", {
              connId: this.connId,
              text,
            });
            this.lastSttFinalAt = 0;
            return;
          }
          await submitVoicePipelineTurn(this.buildVoiceSubmitRuntime(), {
            text,
            traceId,
            userVocalTone: this.buildVocalToneFromMeta() ?? undefined,
          });
        } catch (err) {
          logger.warn("[STT]", { error: (err as Error).message, connId: this.connId });
          send(this.ws, { type: "error", content: "语音识别失败：" + (err as Error).message });
        }
      })
      .catch((err) => logger.error("[pipeline]", { error: err, connId: this.connId }));
  }

  private handlePlaybackStart(data?: any): void {
    const tracer = getLatencyTracer(this.connId);
    const rawGenerationId = data?.generationId;
    const generationId =
      typeof rawGenerationId === "number"
        ? rawGenerationId
        : typeof rawGenerationId === "string" && rawGenerationId.trim()
          ? Number(rawGenerationId)
          : null;
    const normalizedGenerationId =
      generationId != null && Number.isFinite(generationId)
        ? Math.floor(generationId)
        : this.activeGenerationId;

    this.assistantPlaybackActive = true;
    this.playbackGenerationId = normalizedGenerationId ?? null;

    if (generationId != null && Number.isFinite(generationId)) {
      const traceId = tracer.findActiveTraceIdByGenerationId(Math.floor(generationId));
      if (traceId) {
        this.lastPlaybackStartAt = Date.now();
        tracer.mark("playback_start", traceId);
        this.publishTurnState("assistant_speaking", "playback_start", {
          generationId: Math.floor(generationId),
        });
        return;
      }
    }

    if (this.activeTraceId) {
      this.lastPlaybackStartAt = Date.now();
      tracer.mark("playback_start", this.activeTraceId);
      this.publishTurnState("assistant_speaking", "playback_start", {
        generationId: this.activeGenerationId ?? undefined,
      });
    }
  }

  private handlePlaybackEnd(data?: any): void {
    const rawGenerationId = data?.generationId;
    const generationId =
      typeof rawGenerationId === "number"
        ? Math.floor(rawGenerationId)
        : typeof rawGenerationId === "string" && rawGenerationId.trim()
          ? Math.floor(Number(rawGenerationId))
          : null;

    if (
      generationId != null &&
      this.playbackGenerationId != null &&
      generationId !== this.playbackGenerationId
    ) {
      return;
    }

    this.assistantPlaybackActive = false;
    this.playbackGenerationId = null;

    if (!this.interrupt.active && this.turnState === "assistant_speaking") {
      this.publishTurnState("confirmed_end", "confirmed_end", { force: true });
    }
  }

  private handleChat(data: any): void {
    handleSessionTextChat(
      {
        sink: this.ws,
        connId: this.connId,
        brain: this.brain,
        interrupt: this.interrupt,
        avatar: this.avatar,
        sessionId: this.sessionId,
        ensureDbSession: () => this.ensureDbSession(),
        activeGenerationId: this.activeGenerationId,
        touchUserActivity: (userMessage?: string) => this.touchUserActivity(userMessage),
        classifyCarryForward: (userText: string) => this.classifyCarryForward(userText),
        sendInterrupt: (generationId?: number | null) => this.sendInterrupt(generationId),
        nextGenerationId: () => this.nextGenerationId(),
        createTraceId: (
          source: "voice" | "text" | "silence_nudge",
          generationId?: number,
        ) => this.createTraceId(source, generationId),
        bindActiveGeneration: (
          generationId: number,
          traceId: string,
          source: "voice" | "text" | "silence_nudge",
        ) => this.bindActiveGeneration(generationId, traceId, source),
        publishTurnState: (
          state: RemiTurnState,
          reason: RemiTurnStateReason,
          extras?: {
            generationId?: number;
            preview?: string;
            interruptionType?: InterruptionType | null;
            force?: boolean;
          },
        ) => this.publishTurnState(state, reason, extras),
        setPipelineChain: (next: Promise<void>) => {
          this.pipelineChain = next;
        },
        getPipelineChain: () => this.pipelineChain,
        getResolvedTtsTransport: () => this.getResolvedTtsTransport(),
      },
      data,
    );
  }

  private handleGetPersonaPreset(): void {
    this.sendPersonaPresetState();
  }

  private async handleSetPersonaPreset(data: any): Promise<void> {
    if (!this.personaPresetBootstrapReady) {
      send(this.ws, {
        type: "error",
        content: "persona preset unavailable until session bootstrap completes",
      });
      return;
    }

    const presetId = typeof data?.presetId === "string" ? data.presetId.trim() : "";
    if (!presetId) {
      send(this.ws, { type: "error", content: "presetId is required" });
      return;
    }
    if (!isPersonaPresetId(presetId)) {
      send(this.ws, { type: "error", content: `invalid persona preset: ${presetId}` });
      return;
    }

    const userId = typeof this.brain.userId === "string" ? this.brain.userId.trim() : "";
    const shouldPersist = Boolean(this.sessionId && userId);
    if (shouldPersist) {
      await saveUserPersonaPreset(userId, presetId);
    }

    this.brain.applyUserPersonaPreset(presetId);
    this.sendPersonaPresetState();
  }

  private handleClientContext(data: any): void {
    const rawTtsTransport =
      typeof data?.ttsTransport === "string" ? data.ttsTransport : null;
    const clientContextTtsTransport = normalizeClientContextTtsTransport(rawTtsTransport);
    this.clientContextTtsTransport = clientContextTtsTransport;
    this.brain.setClientContext({
      timeZone: typeof data?.timeZone === "string" ? data.timeZone : null,
      locale: typeof data?.locale === "string" ? data.locale : null,
    });
    if (rawTtsTransport && !clientContextTtsTransport) {
      logger.warn("[ClientContext] ignored invalid tts transport", {
        connId: this.connId,
        rawTtsTransport,
        clientFamily: this.clientFamily,
        resolvedTtsTransport: this.resolvedTtsTransport,
      });
    } else if (
      clientContextTtsTransport &&
      clientContextTtsTransport !== this.resolvedTtsTransport
    ) {
      logger.warn("[ClientContext] tts transport mismatch", {
        connId: this.connId,
        clientFamily: this.clientFamily,
        handshakeTtsTransportRaw: this.handshakeTtsTransportRaw,
        resolvedTtsTransport: this.resolvedTtsTransport,
        clientContextTtsTransport,
      });
    }
    logger.debug("[ClientContext] updated", {
      connId: this.connId,
      clientFamily: this.clientFamily,
      resolvedTtsTransport: this.resolvedTtsTransport,
      clientContextTtsTransport: this.clientContextTtsTransport,
      timeZone: this.brain.getClientTimeZone(),
      locale: this.brain.getClientLocale(),
    });
  }

  /** 全面的资源清理方法 */
  private cleanupAllResources(): void {
    notifySessionEnd(this.connId);
    cleanupSessionResources({
      connId: this.connId,
      sessionId: this.sessionId,
      setDuplexActive: (active) => {
        this.duplexActive = active;
      },
      clearDevRuntimeOverrides: () => clearSessionTtsRuntimeOverride(this.connId),
      resetVad: () => this.vad.reset(),
      clearPendingUtteranceTimer: () => this.clearPendingUtteranceTimer(),
      clearSilenceNudgeTimer: () => this.clearSilenceNudgeTimer(),
      resetPreviewState: () => this.resetPreviewState(),
      interruptPipeline: () => this.interrupt.interrupt(),
      resetStt: () => this.stt.reset(),
      clearSpeechBuffer: () => this.clearSpeechBuffer(),
      resetPreRoll: () => {
        this.preRollChunks = [];
        this.preRollBytes = 0;
      },
      saveRelationshipState: async () => {
        if (!relationshipStateEnabled()) return;
        const repo =
          this.brain.persistentRelationshipRepo ??
          this.brain.memory.getPersistentBackend() ??
          this.brain.memory;
        if (!repo) return;
        await savePersistentRelationshipState(
          repo,
          this.brain.slowBrain.exportPersistentState(),
        );
      },
    });
  }

  private setupCloseHandlers(): void {
    attachSessionCloseHandlers({
      ws: this.ws,
      connId: this.connId,
      cleanup: () => this.cleanupAllResources(),
    });
  }
}

export function createSession(ws: WebSocket, req: IncomingMessage): ConnectionSession {
  const session = new ConnectionSession(ws, req);
  session.initializeAsync().catch((err) => {
    logger.error("[Session] initializeAsync failed", { error: err, connId: session.connId });
  });
  return session;
}
