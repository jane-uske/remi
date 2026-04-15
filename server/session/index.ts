import { WebSocket } from "ws";
import { randomUUID } from "crypto";
import type { IncomingMessage } from "http";

import { SttStream } from "../../voice/stt_stream";
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
import { fastBrainPredictOnly } from "../../brains/fast_brain";
import { analyzeTurn, type TurnAnalysisBundle } from "../../brain/turn_interpreter";
import { retrievePromptMemory } from "../../memory/memory_agent";
import { trimHistoryToTokenBudget } from "../../brains/history_budget";
import type { InterruptionType, RemiTurnState, RemiTurnStateReason } from "../../avatar/types";
import {
  decideTurnTaking,
  evaluateBackchannelDecision,
  getMeaningfulTurnPreview,
  isTentativeSpeechText,
  shouldSuppressFallbackNoiseUtterance,
  shouldSuppressStrictNoPreviewUtterance,
  strongFrameRatio,
  type TurnTakingState,
} from "./turn_taking";
import { buildCarryForwardHint, classifyInterruption } from "./interruption";
import { resolveRequestUserId } from "../../infra/user_identity";
import { initializeSessionStorage } from "./bootstrap";
import {
  fireSessionSilenceNudge,
  isContinuousConversation,
  persistRelationshipContinuityState,
  syncSessionVadSilenceThreshold,
  touchSessionUserActivity,
} from "./continuity";
import {
  applyDeveloperPreset,
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
import { attachSessionMessageHandlers } from "./message_router";
import {
  duplexInterruptMinSpeechMs,
  effectiveUtteranceGapMs,
  fallbackMinStrongFrames,
  fallbackMinStrongRatio,
  fallbackNoiseSuppressMaxMs,
  fallbackNoiseSuppressMinRms,
  fallbackNoiseTinyTextMaxChars,
  fallbackStrongFramePeak,
  fallbackStrongFrameRms,
  fallbackWeakSpeechSuppressMaxMs,
  hesitationHoldMs,
  minSpeechMs,
  parseNonNegativeMs,
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
  suppressedNoiseCooldownMs,
  turnTakingConfirmedStableMs,
  turnTakingEnabled,
  turnTakingGrowthHoldMs,
  turnTakingLikelyStableMs,
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
import { publishSessionTurnState } from "./turn_state_protocol";
import { submitVoicePipelineTurn } from "./voice_submit";

const logger = createLogger("session");
const HISTORY_PAGE_SIZE = 15;
const DUPLEX_RAW_FALLBACK_MAX_MS = 15_000;

export class ConnectionSession {
  readonly connId: string;
  readonly brain: RemiSessionContext;
  readonly ws: WebSocket;
  readonly stt: SttStream;
  readonly vad: VadDetector;
  readonly interrupt: InterruptController;
  readonly avatar: AvatarController;
  readonly storageUserId: string;

  sessionId: string | null = null;
  pipelineChain: Promise<void> = Promise.resolve();
  duplexActive: boolean = false;
  speechBuffer: Buffer[] = [];
  private speechBufferBytes: number = 0;
  private duplexRawChunks: Buffer[] = [];
  private duplexRawBytes = 0;
  private duplexRawStrongFrames = 0;

  /** Last ~VAD_PRE_ROLL_MS of PCM before speech_start (same chunks client sends). */
  private preRollChunks: Buffer[] = [];
  private preRollBytes = 0;
  private duplexSampleRate = 16000;
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
  private lastPartialEmitAt = 0;
  private lastPartialContent = "";
  private generationSeq = 0;
  private activeGenerationId: number | null = null;
  private traceSeq = 0;
  private pendingVoiceTraceId: string | null = null;
  private activeTraceId: string | null = null;

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
  private lastPredictionIssuedAt = 0;
  private lastPredictionIssuedText = "";
  private turnState: RemiTurnState = "confirmed_end";
  private lastPublishedTurnState: RemiTurnState | null = null;
  private lastPublishedTurnReason: RemiTurnStateReason | null = null;
  private turnStateEnteredAt = 0;
  private lastSpeechStartAt = 0;
  private lastSpeechEndAt = 0;
  private lastSttFinalAt = 0;
  private lastAssistantEnterAt = 0;
  private lastPlaybackStartAt = 0;
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

  constructor(ws: WebSocket, req: IncomingMessage) {
    this.connId = randomUUID();
    this.brain = new RemiSessionContext(this.connId);
    this.ws = ws;
    this.stt = new SttStream();
    this.vad = new VadDetector();
    this.interrupt = new InterruptController();
    this.avatar = new AvatarController();
    this.storageUserId = resolveRequestUserId(req);
    this.brain.setUserId(this.storageUserId);

    this.setupVadEvents();
    this.setupMessageHandlers();
    this.setupCloseHandlers();
  }

  private async sendHistoryPage(
    mode: "replace" | "prepend",
    cursor?: UserMessageHistoryCursor | null,
  ): Promise<void> {
    await sendSessionHistoryPage({
      ws: this.ws,
      storageUserId: this.storageUserId,
      connId: this.connId,
      pageSize: HISTORY_PAGE_SIZE,
      mode,
      cursor,
    });
  }

  async initializeAsync(): Promise<void> {
    logger.info("[Remi] 新客户端已连接", { connId: this.connId, userId: this.storageUserId });
    await initializeSessionStorage({
      connId: this.connId,
      storageUserId: this.storageUserId,
      brain: this.brain,
      historyPageSize: HISTORY_PAGE_SIZE,
      setSessionId: (sessionId) => {
        this.sessionId = sessionId;
      },
      sendHistoryPage: (mode) => this.sendHistoryPage(mode),
    });
  }

  private pushSpeechChunk(chunk: Buffer): void {
    this.speechBuffer.push(chunk);
    this.speechBufferBytes += chunk.length;
  }

  private clearSpeechBuffer(): void {
    this.speechBuffer = [];
    this.speechBufferBytes = 0;
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
    this.lastPartialEmitAt = 0;
    this.lastPartialContent = "";
    this.turnTakingState = "CONFIRMED_END";
    this.lastMeaningfulPartialText = "";
    this.lastMeaningfulPartialAt = 0;
    this.lastMeaningfulGrowthAt = 0;
    this.lastMeaningfulGrowthChars = 0;
    this.recentPartialPlateauCount = 0;
    this.partialShapeSamples = [];
    this.lastPredictionIssuedAt = 0;
    this.lastPredictionIssuedText = "";
    // 同时取消正在进行的预判
    this.cancelPrediction();
    this.backchannelSentThisTurn = false;
    this.pendingDuplexInterrupt = false;
    this.pendingListeningPromotion = false;
  }

  private maybeConfirmPendingDuplexInterrupt(): void {
    if (!this.pendingDuplexInterrupt) return;
    if (!this.interrupt.active) {
      this.pendingDuplexInterrupt = false;
      return;
    }
    const speechDurationMs = (this.speechBufferBytes / 2 / this.duplexSampleRate) * 1000;
    if (speechDurationMs < duplexInterruptMinSpeechMs()) return;
    this.pendingDuplexInterrupt = false;
    this.sendInterrupt();
    this.interrupt.interrupt();
    logger.info("[VAD] → interrupted pipeline (confirmed duplex speech)", {
      connId: this.connId,
      speechMs: Math.round(speechDurationMs),
    });
    this.publishTurnState("interrupted_by_user", "user_interrupt", {
      generationId: this.activeGenerationId ?? undefined,
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
    this.lastVadStartMode = null;
    this.clearDuplexRawBuffer();
  }

  private clearDuplexRawBuffer(): void {
    this.duplexRawChunks = [];
    this.duplexRawBytes = 0;
    this.duplexRawStrongFrames = 0;
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

  private maybePromoteListeningTurn(speechDurationMs: number): void {
    if (!this.pendingListeningPromotion) return;
    if (getMeaningfulTurnPreview(this.lastMeaningfulPartialText || this.lastPreviewText)) {
      this.pendingListeningPromotion = false;
      return;
    }
    if (speechDurationMs < strictCandidateMinSpeechMs()) return;
    if (!this.hasPromotableSpeechShape()) return;

    this.pendingListeningPromotion = false;
    this.turnTakingState = "HOLD";
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
        ws: this.ws,
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
    void synthesize(text, undefined, this.brain.emotion.getEmotion() as any)
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
    // 文本和当前partial不一致，已经过时了，跳过
    if (text !== this.currentPartialText) return;
    // 取消之前的预判
    this.cancelPrediction();
    this.currentPartialText = text;
    const abort = new AbortController();
    this.predictionAbort = abort;
    const traceId = this.pendingVoiceTraceId ?? this.activeTraceId;
    const latencyTracer = traceId ? getLatencyTracer(this.connId) : null;
    try {
      logger.debug("[预判] 开始预判", { text: text.slice(0, 30) });
      // 和正常回复一样组装输入，但是不更新状态
      if (latencyTracer && traceId) {
        latencyTracer.mark("memory_recall_start", traceId);
      }
      const memory = await retrievePromptMemory(this.brain.memory, {
        userId: this.brain.userId,
        userMessage: text,
        slowBrainSnapshot: this.brain.slowBrain.getSnapshot(),
        maxEntries: options?.mode === "short" ? 4 : 5,
      }).finally(() => {
        if (latencyTracer && traceId) {
          latencyTracer.mark("memory_recall_end", traceId);
        }
      });
      const slowBrainContext = this.brain.slowBrain.synthesizeContext();
      const historyForPrompt = trimHistoryToTokenBudget(
        [...this.brain.history],
        options?.mode === "short" ? 1000 : 1200,
      );
      const predictionHistory =
        options?.mode === "short" ? historyForPrompt.slice(-4) : historyForPrompt;
      if (latencyTracer && traceId) {
        latencyTracer.mark("turn_analysis_start", traceId);
      }
      const analysis = await analyzeTurn({
        userMessage: text,
        history: predictionHistory,
        slowBrainSnapshot: this.brain.slowBrain.getSnapshot(),
        inputSource: "voice",
        signal: abort.signal,
      }).finally(() => {
        if (latencyTracer && traceId) {
          latencyTracer.mark("turn_analysis_end", traceId);
        }
      });
      const interruptedReply =
        this.brain.lastInterruptedReply?.trim() ||
        this.brain.currentAssistantDraft?.trim() ||
        null;
      const carryForwardHint =
        options?.includeCarryForwardHint !== false && interruptedReply
        ? buildCarryForwardHint(classifyInterruption(text, interruptedReply), interruptedReply)
        : undefined;
      const guidance = this.brain.slowBrain.buildConversationGuidance(
        text,
        analysis?.used ? analysis : null,
      );
      const reply = await fastBrainPredictOnly({
        userMessage: text,
        emotion: this.brain.emotion.getEmotion(),
        memory,
        history: predictionHistory,
        strategyHints: [
          guidance.hints,
          carryForwardHint,
          options?.mode === "short" ? "【实时策略】当前是打断/修正语境，请优先用一句短承接。" : "",
        ]
          .filter((part): part is string => Boolean(part?.trim()))
          .join("\n\n"),
        slowBrainContext,
        signal: abort.signal,
        persona: this.brain.persona,
      });
      if (abort.signal.aborted) return;
      this.predictedReply = reply;
      this.predictedStructuredAnalysis = analysis?.used ? analysis : null;
      logger.debug("[预判] 完成", { preview: reply.slice(0, 30) });
      // 如果开启推送，把预判结果推到前端（调试用）
      if (this.predictionPushEnabled && reply) {
        send(this.ws, { type: "stt_prediction", status: "finished", preview: reply.slice(0, 50) });
      }
    } catch (err) {
      logger.debug("[预判] 失败", { error: (err as Error).message });
    } finally {
      if (this.predictionAbort === abort) {
        this.predictionAbort = null;
      }
    }
  }

  private emitSttPartial(content: string): void {
    if (!content) return;
    const now = Date.now();
    const sameContent = content === this.lastPartialContent;
    if (sameContent && now - this.lastPartialEmitAt < 120) return;
    const traceId = this.pendingVoiceTraceId ?? this.activeTraceId;
    if (traceId) {
      getLatencyTracer(this.connId).mark("stt_partial", traceId);
    }
    send(this.ws, { type: "stt_partial", content });
    this.lastPartialEmitAt = now;
    this.lastPartialContent = content;
    this.trackTurnTakingPartial(content);
    this.pendingListeningPromotion = false;
    this.publishTurnState("listening_active", "partial_growth", {
      preview: getMeaningfulTurnPreview(content),
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

  private nextGenerationId(): number {
    this.generationSeq += 1;
    this.activeGenerationId = this.generationSeq;
    return this.generationSeq;
  }

  private sendInterrupt(generationId: number | null = this.activeGenerationId): void {
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
    getLatencyTracer(this.connId).startTrace(traceId, { source, generationId });
  }

  private ensureVoiceTrace(startMarkVad: boolean): string {
    if (!this.pendingVoiceTraceId) {
      this.pendingVoiceTraceId = this.createTraceId("voice");
      this.startTrace(this.pendingVoiceTraceId, "voice");
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
    stableMs: number | null;
    recentGrowth: boolean;
    semanticallyComplete: boolean;
    incompleteTail: boolean;
    interruptionType: InterruptionType | null;
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
      };
    }

    const releaseMs = parseNonNegativeMs(process.env.VAD_UTTERANCE_GAP_PREVIEW_RELEASE_MS, 60);
    const minGapMs = parseNonNegativeMs(process.env.VAD_UTTERANCE_GAP_PREVIEW_MIN_MS, 80);
    const decision = decideTurnTaking({
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
    });

    this.turnTakingState = decision.state;
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
      stableMs: decision.stableMs,
      recentGrowth: decision.recentGrowth,
      semanticallyComplete: decision.semanticallyComplete,
      incompleteTail: decision.incompleteTail,
      interruptionType: interruptionPreviewType,
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
      const preview = await this.stt.previewPcmBuffer(pcm, this.duplexSampleRate, sttPreviewWindowMs());
      if (!this.duplexActive || !this.vad.speaking) return;

      const text = typeof preview === "string" ? preview.trim() : "";
      if (text) {
        if (text !== this.lastPreviewText) {
          this.lastPreviewText = text;
          this.emitSttPartial(text);
        }
        return;
      }

      const durMs = (this.speechBufferBytes / 2 / this.duplexSampleRate) * 1000;
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
    await persistRelationshipContinuityState({
      connId: this.connId,
      brain: this.brain,
    });
  }

  /** Feed accumulated speechBuffer into STT and run pipeline (buffer cleared after feed). */
  private enqueueSttFromSpeechBuffer(): void {
    const speechDurationMs = (this.speechBufferBytes / 2 / this.duplexSampleRate) * 1000;
    const turnPreview = this.lastMeaningfulPartialText || this.lastPreviewText;
    const utteranceMaxRms = this.utteranceMaxRms;
    const utteranceFrameCount = this.utteranceFrameCount;
    const utteranceStrongFrames = this.utteranceStrongFrames;
    this.stt.cancelPreview();
    for (const chunk of this.speechBuffer) {
      this.stt.feedPcm(chunk);
    }
    this.clearSpeechBuffer();

    this.pipelineChain = this.pipelineChain
      .then(async () => {
        const traceId = this.takeVoiceTrace();
        try {
          const text = await this.stt.endPcm();
          if (!text) return;
          if (shouldSuppressFallbackNoiseUtterance({
            vadMode: this.lastVadStartMode,
            previewText: turnPreview,
            speechDurationMs,
            suppressionMaxMs: fallbackNoiseSuppressMaxMs(),
            utteranceMaxRms,
            minUtteranceRms: fallbackNoiseSuppressMinRms(),
            utteranceFrameCount,
            utteranceStrongFrames,
            minStrongFrames: fallbackMinStrongFrames(),
            minStrongRatio: fallbackMinStrongRatio(),
            recognizedText: text,
            tinyTextMaxChars: fallbackNoiseTinyTextMaxChars(),
          }) || shouldSuppressStrictNoPreviewUtterance({
            vadMode: this.lastVadStartMode,
            previewText: turnPreview,
            utteranceFrameCount,
            utteranceStrongFrames,
            minStrongFrames: strictCandidateMinStrongFrames(),
            minStrongRatio: strictCandidateMinStrongRatio(),
            recognizedText: text,
          })) {
            logger.info("[STT] suppress noise utterance", {
              connId: this.connId,
              mode: this.lastVadStartMode,
              speechMs: Math.round(speechDurationMs),
              utteranceMaxRms: Number(utteranceMaxRms.toFixed(4)),
              utteranceFrameCount,
              utteranceStrongFrames,
              text,
            });
            this.pendingVoiceTraceId = null;
            this.resetPreviewState();
            this.resetSpeechConfidenceMetrics();
            this.armSuppressedNoiseCooldown("stt_post_buffer", this.lastVadStartMode);
            return;
          }
          if (this.duplexActive && isTentativeSpeechText(text)) {
            logger.info("[STT] suppress tentative duplex utterance", {
              connId: this.connId,
              text,
            });
            this.pendingVoiceTraceId = null;
            this.resetPreviewState();
            return;
          }
          await submitVoicePipelineTurn(this.buildVoiceSubmitRuntime(), {
            text,
            traceId,
            allowPredictionReuse: true,
            clearPredictionAfterRun: true,
          });
        } catch (err) {
          logger.warn("[STT]", { error: (err as Error).message, connId: this.connId });
          send(this.ws, { type: "error", content: "语音识别失败：" + (err as Error).message });
        }
      })
      .catch((err) => logger.error("[pipeline]", { error: err, connId: this.connId }));
  }

  private setupVadEvents(): void {
    this.vad.on("speech_start", (meta?: { mode?: string; energy?: number; zcr?: number; crest?: number; activeRatio?: number }) => {
      this.lastSpeechStartAt = Date.now();
      this.lastVadStartMode = meta?.mode ?? null;
      this.resetSpeechConfidenceMetrics();
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

      if (this.interrupt.active) {
        this.pendingDuplexInterrupt = true;
        logger.info("[VAD] pending duplex interrupt", {
          connId: this.connId,
          minSpeechMs: duplexInterruptMinSpeechMs(),
        });
      }

      this.resetPreviewState();
      this.pendingListeningPromotion = true;
      if (this.interrupt.active) {
        this.pendingDuplexInterrupt = true;
      }
      this.stt.cancelPcm();

      const merging = this.pendingUtteranceTimer !== null;
      this.clearPendingUtteranceTimer();
      this.ensureVoiceTrace(!merging);

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

      send(this.ws, { type: "vad_start" });
    });

    this.vad.on("speech_end", () => {
      this.lastSpeechEndAt = Date.now();
      logger.info("[VAD] speech_end", { connId: this.connId });
      if (this.pendingVoiceTraceId) {
        getLatencyTracer(this.connId).mark("vad_speech_end", this.pendingVoiceTraceId);
      }
      send(this.ws, { type: "vad_end" });
      this.clearPreviewTimer();

      const MIN_SPEECH_MS = minSpeechMs();
      const speechDurationMs = (this.speechBufferBytes / 2 / this.duplexSampleRate) * 1000;
      if (this.pendingDuplexInterrupt && speechDurationMs >= duplexInterruptMinSpeechMs()) {
        this.maybeConfirmPendingDuplexInterrupt();
      } else if (this.pendingDuplexInterrupt && speechDurationMs < duplexInterruptMinSpeechMs()) {
        logger.info("[VAD] ignore tentative duplex interrupt", {
          connId: this.connId,
          speechMs: Math.round(speechDurationMs),
          minSpeechMs: duplexInterruptMinSpeechMs(),
        });
        this.pendingDuplexInterrupt = false;
      }
      const turnPreview = this.lastMeaningfulPartialText || this.lastPreviewText;
      if (shouldSuppressFallbackNoiseUtterance({
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
      }) || shouldSuppressStrictNoPreviewUtterance({
        vadMode: this.lastVadStartMode,
        previewText: turnPreview,
        utteranceFrameCount: this.utteranceFrameCount,
        utteranceStrongFrames: this.utteranceStrongFrames,
        minStrongFrames: strictCandidateMinStrongFrames(),
        minStrongRatio: strictCandidateMinStrongRatio(),
      }) || (
        this.lastVadStartMode === "fallback_energy" &&
        speechDurationMs < fallbackWeakSpeechSuppressMaxMs() &&
        this.utteranceStrongFrames < fallbackMinStrongFrames()
      )) {
        logger.info("[VAD] suppress fallback noise utterance", {
          connId: this.connId,
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
        adaptive: process.env.VAD_UTTERANCE_GAP_ADAPTIVE !== "0",
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
      handleAudioPcm: (pcm, sampleRate) => this.handleAudioPcm(pcm, sampleRate),
      runDevApplyPreset: (data) => {
        this.runDevCommand(this.handleDevApplyPreset(data));
      },
      runDevResetState: (data) => {
        this.runDevCommand(this.handleDevResetState(data));
      },
      handleDuplexStart: (data) => this.handleDuplexStart(data),
      handleDuplexStop: () => this.handleDuplexStop(),
      handleAudioStream: (data) => this.handleAudioStream(data),
      handleAudioChunk: (data) => this.handleAudioChunk(data),
      handleAudioEnd: () => this.handleAudioEnd(),
      handlePlaybackStart: (data) => this.handlePlaybackStart(data),
      handleChat: (data) => this.handleChat(data),
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
      },
      publishConfirmedEndTurnState: () => {
        this.publishTurnState("confirmed_end", "confirmed_end", { force: true });
      },
    });
  }

  private async handleDevApplyPreset(data: any): Promise<void> {
    await applyDeveloperPreset({
      ws: this.ws,
      brain: this.brain,
      resetDeveloperLiveState: () => this.resetDeveloperLiveState(),
      persistRelationshipContinuityState: () =>
        this.persistRelationshipContinuityState(),
    }, data);
  }

  private async handleDevResetState(data: any): Promise<void> {
    await resetDeveloperState({
      ws: this.ws,
      brain: this.brain,
      resetDeveloperLiveState: () => this.resetDeveloperLiveState(),
      persistRelationshipContinuityState: () =>
        this.persistRelationshipContinuityState(),
    }, data);
  }

  private buildContinuityRuntime() {
    return {
      connId: this.connId,
      ws: this.ws,
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
    };
  }

  private buildVoiceSubmitRuntime() {
    return {
      ws: this.ws,
      connId: this.connId,
      brain: this.brain,
      interrupt: this.interrupt,
      avatar: this.avatar,
      sessionId: this.sessionId,
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
    };
  }

  private handleDuplexStart(data: any): void {
    this.duplexActive = true;
    const rate = Number(data.sampleRate) || 16000;
    this.duplexSampleRate = rate;
    this.stt.setSampleRate(rate);
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
    this.resetDuplexRxMetrics();
    // 启动双工前同步VAD阈值
    this.syncVadSilenceThreshold();
    logger.info(`[Duplex] 已启动`, { connId: this.connId, sampleRate: rate });
  }

  private handleDuplexStop(): void {
    this.duplexActive = false;
    this.vad.reset();
    this.clearPendingUtteranceTimer();
    this.resetPreviewState();
    this.preRollChunks = [];
    this.preRollBytes = 0;
    this.suppressNextSpeechChunk = false;
    this.lastVadStartMode = null;
    this.logDuplexRxSummary(true);
    if (this.duplexRxFrames === 0) {
      logger.warn("[Duplex] stopped with no audio frames received", {
        connId: this.connId,
      });
    } else if (this.duplexRxVadStarts === 0) {
      logger.warn("[Duplex] received audio but never triggered VAD", {
        connId: this.connId,
        frames: this.duplexRxFrames,
        bytes: this.duplexRxBytes,
        maxRms: Number(this.duplexRxMaxRms.toFixed(4)),
        lastPeak: Number(this.duplexRxLastPeak.toFixed(4)),
      });
    }

    if (this.speechBuffer.length > 0) {
      const speechDurationMs = (this.speechBufferBytes / 2 / this.duplexSampleRate) * 1000;
      const turnPreview = this.lastMeaningfulPartialText || this.lastPreviewText;
      if (shouldSuppressFallbackNoiseUtterance({
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
      }) || shouldSuppressStrictNoPreviewUtterance({
        vadMode: this.lastVadStartMode,
        previewText: turnPreview,
        utteranceFrameCount: this.utteranceFrameCount,
        utteranceStrongFrames: this.utteranceStrongFrames,
        minStrongFrames: strictCandidateMinStrongFrames(),
        minStrongRatio: strictCandidateMinStrongRatio(),
      })) {
        logger.info("[Duplex] suppress fallback noise utterance on stop", {
          connId: this.connId,
          mode: this.lastVadStartMode,
          speechMs: Math.round(speechDurationMs),
          suppressionMaxMs: fallbackNoiseSuppressMaxMs(),
        });
        this.clearSpeechBuffer();
        this.clearDuplexRawBuffer();
        this.pendingVoiceTraceId = null;
        this.stt.cancelPcm();
        this.armSuppressedNoiseCooldown("duplex_stop_pre_stt", this.lastVadStartMode);
        return;
      }
      this.stt.cancelPreview();
      for (const chunk of this.speechBuffer) this.stt.feedPcm(chunk);
      this.clearSpeechBuffer();
      this.clearDuplexRawBuffer();

      this.pipelineChain = this.pipelineChain
        .then(async () => {
          const traceId = this.takeVoiceTrace();
          try {
            const text = await this.stt.endPcm();
            if (!text) return;
            if (shouldSuppressFallbackNoiseUtterance({
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
              recognizedText: text,
              tinyTextMaxChars: fallbackNoiseTinyTextMaxChars(),
            }) || shouldSuppressStrictNoPreviewUtterance({
              vadMode: this.lastVadStartMode,
              previewText: turnPreview,
              utteranceFrameCount: this.utteranceFrameCount,
              utteranceStrongFrames: this.utteranceStrongFrames,
              minStrongFrames: strictCandidateMinStrongFrames(),
              minStrongRatio: strictCandidateMinStrongRatio(),
              recognizedText: text,
            })) {
              logger.info("[STT] suppress fallback noise utterance on duplex stop", {
                connId: this.connId,
                mode: this.lastVadStartMode,
                speechMs: Math.round(speechDurationMs),
                utteranceMaxRms: Number(this.utteranceMaxRms.toFixed(4)),
                text,
              });
              this.pendingVoiceTraceId = null;
              this.resetPreviewState();
              this.resetSpeechConfidenceMetrics();
              this.armSuppressedNoiseCooldown("duplex_stop_post_stt", this.lastVadStartMode);
              return;
            }
            if (this.duplexActive && isTentativeSpeechText(text)) {
              logger.info("[STT] suppress tentative duplex utterance", {
                connId: this.connId,
                text,
              });
              this.pendingVoiceTraceId = null;
              this.resetPreviewState();
              return;
            }
            await submitVoicePipelineTurn(this.buildVoiceSubmitRuntime(), {
              text,
              traceId,
              markSttFinalTimestamp: false,
            });
          } catch (err) {
            logger.warn("[STT]", { error: (err as Error).message, connId: this.connId });
            send(this.ws, { type: "error", content: "语音转写失败，请重试" });
          }
        })
        .catch((err) => logger.error("[pipeline]", { error: err, connId: this.connId }));
    } else if (this.shouldAttemptNoVadDuplexFallback()) {
      const rawChunks = [...this.duplexRawChunks];
      const rawDurationMs = (this.duplexRawBytes / 2 / this.duplexSampleRate) * 1000;
      const rawFrameCount = this.duplexRxFrames;
      const rawStrongFrames = this.duplexRawStrongFrames;
      const rawMaxRms = this.duplexRxMaxRms;
      this.stt.cancelPreview();
      for (const chunk of rawChunks) this.stt.feedPcm(chunk);
      this.clearDuplexRawBuffer();

      this.pipelineChain = this.pipelineChain
        .then(async () => {
          const traceId = this.takeVoiceTrace();
          try {
            const text = await this.stt.endPcm();
            if (!text) return;
            if (
              shouldSuppressStrictNoPreviewUtterance({
                vadMode: "strict",
                previewText: "",
                utteranceFrameCount: rawFrameCount,
                utteranceStrongFrames: rawStrongFrames,
                minStrongFrames: strictCandidateMinStrongFrames(),
                minStrongRatio: strictCandidateMinStrongRatio(),
                recognizedText: text,
              }) ||
              shouldSuppressFallbackNoiseUtterance({
                vadMode: "fallback_energy",
                previewText: "",
                speechDurationMs: rawDurationMs,
                suppressionMaxMs: fallbackNoiseSuppressMaxMs(),
                utteranceMaxRms: rawMaxRms,
                minUtteranceRms: fallbackNoiseSuppressMinRms(),
                utteranceFrameCount: rawFrameCount,
                utteranceStrongFrames: rawStrongFrames,
                minStrongFrames: fallbackMinStrongFrames(),
                minStrongRatio: fallbackMinStrongRatio(),
                recognizedText: text,
                tinyTextMaxChars: fallbackNoiseTinyTextMaxChars(),
              })
            ) {
              logger.info("[STT] suppress no-vad duplex fallback utterance", {
                connId: this.connId,
                speechMs: Math.round(rawDurationMs),
                utteranceMaxRms: Number(rawMaxRms.toFixed(4)),
                strongFrames: rawStrongFrames,
                totalFrames: rawFrameCount,
                text,
              });
              this.pendingVoiceTraceId = null;
              this.resetPreviewState();
              return;
            }
            await submitVoicePipelineTurn(this.buildVoiceSubmitRuntime(), {
              text,
              traceId,
              logPrefix: "[用户·语音 fallback/no-vad]",
              logMeta: {
                speechMs: Math.round(rawDurationMs),
                strongFrames: rawStrongFrames,
                totalFrames: rawFrameCount,
              },
              markSttFinalTimestamp: false,
            });
          } catch (err) {
            logger.warn("[STT fallback/no-vad]", {
              error: (err as Error).message,
              connId: this.connId,
            });
            send(this.ws, { type: "error", content: "语音转写失败，请重试" });
          }
        })
        .catch((err) => logger.error("[pipeline]", { error: err, connId: this.connId }));
    } else {
      this.pendingVoiceTraceId = null;
      this.clearDuplexRawBuffer();
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

  private handleAudioPcm(pcm: Buffer, rate: number): void {
    if (!this.duplexActive) return;
    const sampleRate = rate > 0 ? rate : this.duplexSampleRate;
    this.duplexSampleRate = sampleRate;
    this.stt.setSampleRate(sampleRate);
    const rms = pcmRms(pcm);
    const peak = pcmPeak(pcm);
    this.duplexRxFrames += 1;
    this.duplexRxBytes += pcm.length;
    this.duplexRxLastRms = rms;
    this.duplexRxLastPeak = peak;
    this.duplexRxMaxRms = Math.max(this.duplexRxMaxRms, rms);
    this.appendDuplexRawChunk(pcm);
    if (isNoVadFallbackSpeechLikeFrame(pcm, rms, peak)) {
      this.duplexRawStrongFrames += 1;
    }
    this.logDuplexRxSummary();

    this.appendPreRoll(pcm);
    const now = Date.now();
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
    this.vad.feed(pcm);

    if (this.vad.speaking) {
      this.trackSpeechConfidence(rms, peak);
      if (this.suppressNextSpeechChunk) {
        this.suppressNextSpeechChunk = false;
      } else {
        this.pushSpeechChunk(pcm);
      }

      const durMs = (this.speechBufferBytes / 2 / sampleRate) * 1000;
      this.maybePromoteListeningTurn(durMs);
      this.maybeConfirmPendingDuplexInterrupt();
      this.scheduleSttPreview(durMs);
    }
  }

  private handleAudioStream(data: any): void {
    const pcm = Buffer.from(data.audio, "base64");
    const rate = Number(data.sampleRate) || this.duplexSampleRate;
    this.handleAudioPcm(pcm, rate);
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

  private handleChat(data: any): void {
    const content = data.content ?? "";
    if (!content?.trim()) {
      send(this.ws, { type: "error", content: "消息内容为空" });
      return;
    }
    logger.info(`[用户] ${content}`, { connId: this.connId });
    this.touchUserActivity(content);
    if (this.interrupt.active && this.brain.currentAssistantDraft?.trim()) {
      this.brain.lastInterruptedReply = this.brain.currentAssistantDraft.trim();
    }
    const { interruptionType, carryForwardHint } = this.classifyCarryForward(content);

    const interruptedGenerationId = this.activeGenerationId;
    const interruptReactionEnabled = process.env.interrupt_reaction !== "0" && isTtsEnabled();
    if (this.interrupt.active && interruptReactionEnabled) {
      // 先播放打断反应音，再停止当前播放
      void synthesize(randomInterruptReaction(), undefined, this.brain.emotion.getEmotion() as any)
        .then((buf) => {
          send(this.ws, {
            type: "voice",
            audio: buf.toString("base64"),
            generationId: interruptedGenerationId ?? 0,
          });
          // 发送反应音后再通知客户端停止之前的播放
          this.sendInterrupt(interruptedGenerationId ?? null);
        })
        .catch(() => {
          // 合成失败直接发中断
          this.sendInterrupt(interruptedGenerationId ?? null);
        });
      this.interrupt.interrupt();
      logger.info("[Chat] → interrupted pipeline with reaction", { connId: this.connId });
      this.publishTurnState("interrupted_by_user", "user_interrupt", {
        generationId: interruptedGenerationId ?? undefined,
        interruptionType: interruptionType ?? "unknown",
        force: true,
      });
    } else {
      if (this.interrupt.active) {
        // 仅在确有在途 generation 时发送 interrupt，避免把正常 text send 伪装成真实打断。
        this.sendInterrupt(interruptedGenerationId ?? null);
        this.interrupt.interrupt();
        this.publishTurnState("interrupted_by_user", "user_interrupt", {
          generationId: interruptedGenerationId ?? undefined,
          interruptionType: interruptionType ?? "unknown",
          force: true,
        });
      }
    }

    const generationId = this.nextGenerationId();
    const traceId = this.createTraceId("text", generationId);
    this.bindActiveGeneration(generationId, traceId, "text");
    getLatencyTracer(this.connId).mark("input_received", traceId);
    this.publishTurnState("assistant_entering", "tts_prepare", {
      generationId,
      interruptionType,
      force: true,
    });

    this.pipelineChain = this.pipelineChain
      .then(() =>
        runPipeline(
          this.ws,
          content,
          this.interrupt,
          this.avatar,
          this.sessionId,
          this.brain,
          generationId,
          traceId,
          {
            carryForwardHint,
            interruptionType: interruptionType ?? undefined,
            inputSource: "text",
          },
        ),
      )
      .catch((err) => logger.error("[pipeline]", { error: err, connId: this.connId }));
  }

  /** 全面的资源清理方法 */
  private cleanupAllResources(): void {
    cleanupSessionResources({
      connId: this.connId,
      sessionId: this.sessionId,
      setDuplexActive: (active) => {
        this.duplexActive = active;
      },
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
