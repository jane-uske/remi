import { WebSocket } from "ws";
import { randomUUID } from "crypto";
import type { IncomingMessage } from "http";

import { SttStream } from "../../voice/stt_stream";
import { VadDetector } from "../../voice/vad_detector";
import { InterruptController } from "../../voice/interrupt_controller";
import { AvatarController } from "../../avatar/avatar_controller";
import { createLogger } from "../../infra/logger";
import { isDbReady } from "../../infra/app_state";
import { getLatencyTracer, removeLatencyTracer } from "../../infra/latency_tracer";
import { ensureStorageUser } from "../../storage/repositories/dev_identity";
import { getPgMemoryRepository } from "../../storage/repositories/pg_memory_repository";
import { createSession as createDbSession, endSession } from "../../storage/repositories/session_repository";
import {
  getUserMessagesPage,
  type UserMessageHistoryCursor,
} from "../../storage/repositories/message_repository";
import { RemiSessionContext } from "../../brains/remi_session_context";
import { runPipeline } from "../pipeline";
import { send, getWsRateLimiter } from "../gateway";
import { synthesize, isTtsEnabled } from "../../voice/tts_stream";
import { fastBrainPredictOnly } from "../../brains/fast_brain";
import { retrievePromptMemory } from "../../memory/memory_agent";
import { trimHistoryToTokenBudget } from "../../brains/history_budget";
import type { InterruptionType, RemiTurnState, RemiTurnStateReason } from "../../avatar/types";
import {
  persistentMemoryOverlayEnabled,
  persistentMemoryPreloadLimit,
} from "../../memory/session_memory_overlay";
import {
  loadPersistentRelationshipState,
  RELATIONSHIP_STATE_KEY,
  relationshipStateEnabled,
  savePersistentRelationshipState,
} from "../../memory/relationship_state";
import {
  buildEmptyRelationshipState,
  buildRelationshipPresetState,
  isPersonaPresetId,
  isRelationshipPresetId,
} from "../../brains/dev_presets";
import {
  buildSilenceNudgeUserMessage,
  planProactiveNudge,
} from "../../brains/proactive_planner";
import {
  decideTurnTaking,
  endsWithSentencePunctuation,
  evaluateBackchannelDecision,
  getMeaningfulTurnPreview,
  isTentativeSpeechText,
  normalizeSpeechText,
  shouldSuppressFallbackNoiseUtterance,
  shouldSuppressStrictNoPreviewUtterance,
  strongFrameRatio,
  type PartialGrowthTrend,
  type TurnTakingState,
} from "./turn_taking";
import { buildTurnTimingSnapshot } from "./turn_timing";
import { buildCarryForwardHint, classifyInterruption } from "./interruption";
import { resolveRequestUserId } from "../../infra/user_identity";

const logger = createLogger("session");
const AUDIO_BIN_MAGIC_V1 = Buffer.from([0x52, 0x41]); // "RA" (legacy)
const AUDIO_BIN_MAGIC_V2 = Buffer.from([0x52, 0x41, 0x55, 0x44]); // "RAUD"
const AUDIO_BIN_VERSION = 1;
const AUDIO_BIN_HEADER_BYTES_V1 = 8;
const AUDIO_BIN_HEADER_BYTES_V2 = 16;
const AUDIO_BIN_CODEC_PCM16_MONO = 1;
const HISTORY_PAGE_SIZE = 15;

/** Ring buffer duration (ms) kept before speech_start — inject into STT so minSpeech ramp-up does not clip sentence beginnings. */
function preRollMaxBytes(sampleRate: number): number {
  const raw = process.env.VAD_PRE_ROLL_MS;
  const ms = raw !== undefined && raw !== "" ? Number(raw) : 480;
  const dur = Number.isFinite(ms) && ms > 0 ? ms : 480;
  return Math.floor((sampleRate * 2 * dur) / 1000);
}

/**
 * After speech_end, wait this long before running STT. If speech_start fires again
 * (user continued after a short pause), the same PCM buffer is extended — one sentence
 * is not split into multiple stt_final messages. Set to 0 to disable (immediate STT).
 */
function utteranceGapMs(): number {
  const raw = process.env.VAD_UTTERANCE_GAP_MS;
  if (raw === undefined || raw === "") return 180;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 180;
  return n;
}

function parseNonNegativeMs(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function parseBooleanFlag(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === "") return fallback;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "1" || normalized === "true") return true;
  if (normalized === "0" || normalized === "false") return false;
  return fallback;
}

function devPresetCommandsEnabled(): boolean {
  return parseBooleanFlag(process.env.REMI_DEV_PRESETS_ENABLED, process.env.NODE_ENV !== "production");
}

function proactivePlannerMainPathEnabled(): boolean {
  return parseBooleanFlag(process.env.REMI_PROACTIVE_PLANNER_MAIN_PATH_ENABLED, true);
}

function isSemanticallyCompletePreview(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return endsWithSentencePunctuation(trimmed) || SEMANTIC_END_RE.test(trimmed);
}

type PredictionBudgetConfig = {
  enabled: boolean;
  pushEnabled: boolean;
  debounceMs: number;
};

type PartialShapeSample = {
  at: number;
  normalizedLength: number;
  deltaChars: number;
  semanticallyComplete: boolean;
};

type PartialShapeAggregates = {
  partialGrowthTrend: PartialGrowthTrend;
  semanticCompletionStreak: number;
  smallDeltaStreak: number;
};

type HistoryCursorPayload = {
  id: string;
  createdAt: string;
};

type PredictionGate = {
  allow: boolean;
  mode: "full" | "short";
  debounceMs: number;
  includeCarryForwardHint: boolean;
  reason: string;
};

const SEMANTIC_END_RE = /(吗|呢|吧|了|啦|呀|啊|嘛|么|对吧|是吧|行吗|好吗|可以吗|是不是)\s*[。！？.!?]*$/u;
const CARRY_FORWARD_CUE_RE =
  /(继续刚才|继续那个|刚才那个|上次那个|回到刚才|还是那个|接着说|不是那个意思|我想说的是|我其实是想说)/u;

function predictionBudgetConfig(): PredictionBudgetConfig {
  const enabled = parseBooleanFlag(process.env.STT_PARTIAL_PREDICTION_ENABLED, false);
  const pushRequested = parseBooleanFlag(process.env.STT_PREDICTION_PUSH_ENABLED, false);
  return {
    enabled,
    // Push 是 prediction 的附属能力，不能单独开启。
    pushEnabled: enabled && pushRequested,
    debounceMs: parseNonNegativeMs(process.env.STT_PREDICTION_DEBOUNCE_MS, 300),
  };
}

function sttPreviewIntervalMs(): number {
  return parseNonNegativeMs(process.env.STT_PREVIEW_INTERVAL_MS, 650);
}

function sttPreviewDebounceMs(): number {
  return parseNonNegativeMs(process.env.STT_PREVIEW_DEBOUNCE_MS, 180);
}

function sttPreviewMinSpeechMs(): number {
  return parseNonNegativeMs(process.env.STT_PREVIEW_MIN_SPEECH_MS, 550);
}

function sttPreviewWindowMs(): number {
  return parseNonNegativeMs(process.env.STT_PREVIEW_WINDOW_MS, 4200);
}

function sttPreviewSettleMs(): number {
  return parseNonNegativeMs(process.env.STT_PREVIEW_SETTLE_MS, 260);
}

/** Minimum utterance duration to run STT after VAD speech_end. */
function minSpeechMs(): number {
  return parseNonNegativeMs(process.env.VAD_MIN_UTTERANCE_MS, 220);
}

/**
 * After speech_end, delay before STT. Longer spoken segments get a longer merge window
 * (mid-sentence pause); short phrases use a shorter delay (snappier end).
 * Set VAD_UTTERANCE_GAP_ADAPTIVE=0 for a fixed VAD_UTTERANCE_GAP_MS (legacy behavior).
 */
function effectiveUtteranceGapMs(speechDurationMs: number): number {
  const base = utteranceGapMs();
  if (base <= 0) return 0;

  if (process.env.VAD_UTTERANCE_GAP_ADAPTIVE === "0") {
    return base;
  }

  const minG = parseNonNegativeMs(process.env.VAD_UTTERANCE_GAP_MIN_MS, 120);
  const maxG = parseNonNegativeMs(process.env.VAD_UTTERANCE_GAP_MAX_MS, 320);
  const lo = parseNonNegativeMs(process.env.VAD_UTTERANCE_GAP_ADAPTIVE_LO_MS, 400);
  const hi = parseNonNegativeMs(process.env.VAD_UTTERANCE_GAP_ADAPTIVE_HI_MS, 4400);
  if (maxG <= minG) return base;

  const t = Math.min(1, Math.max(0, (speechDurationMs - lo) / Math.max(1, hi - lo)));
  return Math.round(minG + t * (maxG - minG));
}

/** 用户多久没发消息后触发 Remi 主动搭话（ms）；未设置或 0 表示关闭 */
function silenceNudgeMs(): number {
  const raw = process.env.REMI_SILENCE_NUDGE_MS;
  if (raw === undefined || raw === "") return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function hesitationHoldMs(): number {
  return parseNonNegativeMs(process.env.VAD_UTTERANCE_GAP_HESITATION_MS, 980);
}

function turnTakingEnabled(): boolean {
  const raw = (process.env.TURN_TAKING_STAGE2_ENABLED ?? "1").trim().toLowerCase();
  return raw !== "0" && raw !== "false";
}

function turnTakingGrowthHoldMs(): number {
  return parseNonNegativeMs(process.env.TURN_TAKING_GROWTH_HOLD_MS, 720);
}

function turnTakingLikelyStableMs(): number {
  return parseNonNegativeMs(process.env.TURN_TAKING_LIKELY_STABLE_MS, 680);
}

function turnTakingConfirmedStableMs(): number {
  return parseNonNegativeMs(process.env.TURN_TAKING_CONFIRMED_STABLE_MS, 1100);
}

function voiceBackchannelEnabled(): boolean {
  const raw = (process.env.VOICE_BACKCHANNEL_ENABLED ?? "1").trim().toLowerCase();
  return raw !== "0" && raw !== "false";
}

function voiceBackchannelCooldownMs(): number {
  return parseNonNegativeMs(process.env.VOICE_BACKCHANNEL_COOLDOWN_MS, 6000);
}

function voiceBackchannelStableMs(): number {
  return parseNonNegativeMs(process.env.VOICE_BACKCHANNEL_STABLE_MS, 1100);
}

function duplexInterruptMinSpeechMs(): number {
  return parseNonNegativeMs(process.env.DUPLEX_INTERRUPT_MIN_SPEECH_MS, 260);
}

function fallbackNoiseSuppressMaxMs(): number {
  return parseNonNegativeMs(process.env.VAD_FALLBACK_NO_PREVIEW_SUPPRESS_MS, 900);
}

function fallbackNoiseSuppressMinRms(): number {
  return parseNonNegativeMs(process.env.VAD_FALLBACK_NO_PREVIEW_MIN_RMS, 0.035);
}

function fallbackNoiseTinyTextMaxChars(): number {
  return Math.max(
    1,
    Math.floor(parseNonNegativeMs(process.env.VAD_FALLBACK_NO_PREVIEW_TINY_TEXT_MAX_CHARS, 1)),
  );
}

function fallbackStrongFrameRms(): number {
  return parseNonNegativeMs(process.env.VAD_FALLBACK_STRONG_FRAME_RMS, 35) / 1000;
}

function fallbackStrongFramePeak(): number {
  return parseNonNegativeMs(process.env.VAD_FALLBACK_STRONG_FRAME_PEAK, 120) / 1000;
}

function fallbackMinStrongFrames(): number {
  return Math.max(1, Math.floor(parseNonNegativeMs(process.env.VAD_FALLBACK_MIN_STRONG_FRAMES, 2)));
}

function fallbackMinStrongRatio(): number {
  const raw = process.env.VAD_FALLBACK_MIN_STRONG_RATIO;
  if (raw === undefined || raw === "") return 0.08;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0.08;
  return Math.max(0, Math.min(1, n));
}

function fallbackWeakSpeechSuppressMaxMs(): number {
  return parseNonNegativeMs(process.env.VAD_FALLBACK_WEAK_SPEECH_SUPPRESS_MS, 1600);
}

function strictCandidateMinSpeechMs(): number {
  return parseNonNegativeMs(process.env.VAD_STRICT_CANDIDATE_MIN_SPEECH_MS, 520);
}

function strictCandidateMinStrongFrames(): number {
  return Math.max(1, Math.floor(parseNonNegativeMs(process.env.VAD_STRICT_CANDIDATE_MIN_STRONG_FRAMES, 8)));
}

function strictCandidateMinStrongRatio(): number {
  const raw = process.env.VAD_STRICT_CANDIDATE_MIN_STRONG_RATIO;
  if (raw === undefined || raw === "") return 0.22;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0.22;
  return Math.max(0, Math.min(1, n));
}

function suppressedNoiseCooldownMs(): number {
  return parseNonNegativeMs(process.env.VAD_SUPPRESSED_NOISE_COOLDOWN_MS, 420);
}

function suppressedNoiseBypassRms(): number {
  return parseNonNegativeMs(process.env.VAD_SUPPRESSED_NOISE_BYPASS_RMS, 40) / 1000;
}

function suppressedNoiseBypassPeak(): number {
  return parseNonNegativeMs(process.env.VAD_SUPPRESSED_NOISE_BYPASS_PEAK, 90) / 1000;
}

/** 随机选择打断反应音文本 */
function randomInterruptReaction(): string {
  const reactions = ["啊？", "嗯？", "怎么啦？"];
  return reactions[Math.floor(Math.random() * reactions.length)];
}

function pcmRms(pcm: Buffer): number {
  const samples = Math.floor(pcm.length / 2);
  if (samples <= 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    const sample = pcm.readInt16LE(i * 2) / 32768;
    sum += sample * sample;
  }
  return Math.sqrt(sum / samples);
}

function pcmPeak(pcm: Buffer): number {
  const samples = Math.floor(pcm.length / 2);
  if (samples <= 0) return 0;
  let peak = 0;
  for (let i = 0; i < samples; i++) {
    const abs = Math.abs(pcm.readInt16LE(i * 2) / 32768);
    if (abs > peak) peak = abs;
  }
  return peak;
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

  sessionId: string | null = null;
  pipelineChain: Promise<void> = Promise.resolve();
  duplexActive: boolean = false;
  speechBuffer: Buffer[] = [];
  private speechBufferBytes: number = 0;

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

    this.setupVadEvents();
    this.setupMessageHandlers();
    this.setupCloseHandlers();
  }

  private serializeHistoryCursor(cursor: UserMessageHistoryCursor | null): HistoryCursorPayload | null {
    if (!cursor) return null;
    return {
      id: cursor.id,
      createdAt: cursor.created_at.toISOString(),
    };
  }

  private parseHistoryCursor(raw: unknown): UserMessageHistoryCursor | null {
    if (!raw || typeof raw !== "object") return null;
    const id = typeof (raw as HistoryCursorPayload).id === "string" ? (raw as HistoryCursorPayload).id.trim() : "";
    const createdAtRaw =
      typeof (raw as HistoryCursorPayload).createdAt === "string"
        ? (raw as HistoryCursorPayload).createdAt.trim()
        : "";
    if (!id || !createdAtRaw) return null;
    const createdAt = new Date(createdAtRaw);
    if (Number.isNaN(createdAt.getTime())) return null;
    return {
      id,
      created_at: createdAt,
    };
  }

  private async sendHistoryPage(
    mode: "replace" | "prepend",
    cursor?: UserMessageHistoryCursor | null,
  ): Promise<void> {
    if (!isDbReady()) return;
    const page = await getUserMessagesPage(this.storageUserId, HISTORY_PAGE_SIZE, cursor);
    send(this.ws, {
      type: "history_page",
      mode,
      messages: page.messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.created_at.toISOString(),
      })),
      hasMore: page.hasMore,
      nextCursor: this.serializeHistoryCursor(page.nextCursor),
    });
    if (page.messages.length > 0) {
      logger.debug("[Memory] history page sent", {
        connId: this.connId,
        userId: this.storageUserId,
        mode,
        messageCount: page.messages.length,
        hasMore: page.hasMore,
      });
    }
  }

  async initializeAsync(): Promise<void> {
    logger.info("[Remi] 新客户端已连接", { connId: this.connId, userId: this.storageUserId });

    if (isDbReady()) {
      try {
        const userId = await ensureStorageUser(this.storageUserId);
        this.brain.setUserId(userId);
        const sess = await createDbSession(userId);
        this.sessionId = sess.id;
        logger.info("[Storage] Session created", { sessionId: this.sessionId, userId });

        const persistentRepo = getPgMemoryRepository(userId);
        if (relationshipStateEnabled()) {
          this.brain.attachPersistentRelationshipRepo(persistentRepo);
          const persistedState = await loadPersistentRelationshipState(persistentRepo);
          if (persistedState) {
            this.brain.hydratePersistentRelationshipState(persistedState);
            logger.debug("[Memory] relationship state restored", {
              connId: this.connId,
              sessionId: this.sessionId,
              turns: persistedState.relationship.turnCount,
            });
          }
        }

        if (persistentMemoryOverlayEnabled()) {
          this.brain.memory.attachPersistent(persistentRepo);
          void this.brain.memory
            .hydrateFromPersistent(persistentMemoryPreloadLimit())
            .then(() => {
              logger.debug("[Memory] persistent facts hydrated into session overlay", {
                connId: this.connId,
                sessionId: this.sessionId,
              });
            });
        }

        try {
          const recentPage = await getUserMessagesPage(userId, HISTORY_PAGE_SIZE);
          if (recentPage.messages.length > 0) {
            this.brain.hydrateHistoryFromDb(recentPage.messages);
            logger.debug("[Memory] conversation history restored", {
              connId: this.connId,
              userId,
              messageCount: recentPage.messages.length,
            });
          }
          await this.sendHistoryPage("replace");
        } catch (err) {
          logger.warn("[Storage] Failed to restore conversation history", { error: err });
        }
      } catch (err) {
        logger.warn("[Storage] Failed to create session", { error: err });
      }
    }
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
    const now = Date.now();
    const preview = extras?.preview?.trim();
    if (!extras?.force && this.lastPublishedTurnState === state && this.lastPublishedTurnReason === reason) {
      if (!preview && !extras?.interruptionType) {
        return;
      }
    }
    const previousState = this.turnState;
    const previousReason = this.lastPublishedTurnReason;
    const stateEnteredAt = this.turnStateEnteredAt || now;
    const timing = buildTurnTimingSnapshot({
      previousState,
      nextState: state,
      reason,
      nowMs: now,
      stateEnteredAtMs: stateEnteredAt,
      speechStartAtMs: this.lastSpeechStartAt || null,
      speechEndAtMs: this.lastSpeechEndAt || null,
      sttFinalAtMs: this.lastSttFinalAt || null,
      assistantEnterAtMs: this.lastAssistantEnterAt || null,
      playbackStartAtMs: this.lastPlaybackStartAt || null,
      partialGrowthAtMs: this.lastMeaningfulGrowthAt || null,
      partialUpdateAtMs: this.lastMeaningfulPartialAt || null,
    });
    this.turnState = state;
    if (previousState !== state || this.turnStateEnteredAt === 0) {
      this.turnStateEnteredAt = now;
    }
    if (state === "assistant_entering") {
      this.lastAssistantEnterAt = now;
    } else if (state === "assistant_speaking") {
      this.lastPlaybackStartAt = now;
    }
    this.lastPublishedTurnState = state;
    this.lastPublishedTurnReason = reason;
    logger.info("[TurnState]", {
      connId: this.connId,
      state,
      reason,
      generationId: extras?.generationId,
      preview: preview || undefined,
      interruptionType: extras?.interruptionType ?? undefined,
    });
    const shouldLogTiming =
      previousState !== state || previousReason !== reason || extras?.force;
    if (shouldLogTiming) {
      logger.info("[TurnTiming]", {
        connId: this.connId,
        state,
        reason,
        generationId: extras?.generationId,
        metrics: timing,
      });
    }
    send(this.ws, {
      type: "turn_state",
      state,
      reason,
      generationId: extras?.generationId,
      preview: preview || undefined,
      interruptionType: extras?.interruptionType ?? undefined,
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
    const preview = getMeaningfulTurnPreview(content);
    if (!preview) return;

    const normalized = normalizeSpeechText(preview);
    if (!normalized) return;

    const now = Date.now();
    const prevNormalized = normalizeSpeechText(this.lastMeaningfulPartialText);
    let deltaChars = normalized.length;
    if (!this.lastMeaningfulPartialText || normalized !== prevNormalized) {
      this.lastMeaningfulGrowthAt = now;
      if (prevNormalized && normalized.startsWith(prevNormalized)) {
        deltaChars = Math.max(0, normalized.length - prevNormalized.length);
        this.lastMeaningfulGrowthChars = deltaChars;
        this.recentPartialPlateauCount =
          deltaChars > 0 && deltaChars <= 2 ? this.recentPartialPlateauCount + 1 : 0;
      } else {
        this.lastMeaningfulGrowthChars = normalized.length;
        deltaChars = normalized.length;
        this.recentPartialPlateauCount = 0;
      }
    }
    this.lastMeaningfulPartialText = preview;
    this.lastMeaningfulPartialAt = now;
    this.partialShapeSamples.push({
      at: now,
      normalizedLength: normalized.length,
      deltaChars,
      semanticallyComplete: isSemanticallyCompletePreview(preview),
    });
    if (this.partialShapeSamples.length > this.PARTIAL_SHAPE_MAX_SAMPLES) {
      this.partialShapeSamples.splice(0, this.partialShapeSamples.length - this.PARTIAL_SHAPE_MAX_SAMPLES);
    }
  }

  private getPartialShapeAggregates(): PartialShapeAggregates {
    const samples = this.partialShapeSamples;
    if (samples.length === 0) {
      return {
        partialGrowthTrend: "oscillating",
        semanticCompletionStreak: 0,
        smallDeltaStreak: 0,
      };
    }

    let smallDeltaStreak = 0;
    for (let i = samples.length - 1; i >= 0; i -= 1) {
      if (samples[i].deltaChars > 0 && samples[i].deltaChars <= 2) {
        smallDeltaStreak += 1;
      } else {
        break;
      }
    }

    let semanticCompletionStreak = 0;
    for (let i = samples.length - 1; i >= 0; i -= 1) {
      if (samples[i].semanticallyComplete) {
        semanticCompletionStreak += 1;
      } else {
        break;
      }
    }

    let positiveSteps = 0;
    let negativeSteps = 0;
    for (let i = 1; i < samples.length; i += 1) {
      const delta = samples[i].normalizedLength - samples[i - 1].normalizedLength;
      if (delta > 0) positiveSteps += 1;
      if (delta < 0) negativeSteps += 1;
    }

    const trailing = samples.slice(-3);
    const trailingTinyDelta = trailing.every((entry) => entry.deltaChars <= 2);
    let partialGrowthTrend: PartialGrowthTrend = "oscillating";
    if (smallDeltaStreak >= 2 || trailingTinyDelta) {
      partialGrowthTrend = "plateau";
    } else if (positiveSteps > 0 && negativeSteps === 0) {
      partialGrowthTrend = "expanding";
    }

    return { partialGrowthTrend, semanticCompletionStreak, smallDeltaStreak };
  }

  private classifyPredictionInterruptionType(text: string): InterruptionType | null {
    const interruptedReply =
      this.brain.lastInterruptedReply?.trim() ||
      this.brain.currentAssistantDraft?.trim() ||
      null;
    if (text.trim()) {
      return classifyInterruption(text, interruptedReply);
    }
    return this.lastInterruptionType;
  }

  private resolvePredictionGate(text: string): PredictionGate {
    const trimmed = text.trim();
    if (!trimmed) {
      return { allow: false, mode: "full", debounceMs: this.predictionDebounceMs, includeCarryForwardHint: true, reason: "empty_partial" };
    }
    const aggregates = this.getPartialShapeAggregates();
    const interruptionType = this.classifyPredictionInterruptionType(trimmed);
    const explicitCarryForward = CARRY_FORWARD_CUE_RE.test(trimmed);
    const isHold = this.turnTakingState === "HOLD";

    if (
      isHold &&
      !explicitCarryForward &&
      aggregates.partialGrowthTrend === "expanding" &&
      aggregates.semanticCompletionStreak === 0
    ) {
      return { allow: false, mode: "full", debounceMs: this.predictionDebounceMs, includeCarryForwardHint: true, reason: "hold_expanding_partial" };
    }
    if (
      isHold &&
      aggregates.partialGrowthTrend === "oscillating" &&
      aggregates.semanticCompletionStreak === 0 &&
      aggregates.smallDeltaStreak < 2
    ) {
      return { allow: false, mode: "full", debounceMs: this.predictionDebounceMs, includeCarryForwardHint: true, reason: "hold_oscillating_partial" };
    }

    if (interruptionType === "topic_switch") {
      if (isHold && aggregates.semanticCompletionStreak === 0) {
        return { allow: false, mode: "short", debounceMs: Math.max(120, Math.floor(this.predictionDebounceMs * 0.8)), includeCarryForwardHint: false, reason: "topic_switch_not_stable" };
      }
      return { allow: true, mode: "short", debounceMs: Math.max(120, Math.floor(this.predictionDebounceMs * 0.8)), includeCarryForwardHint: false, reason: "topic_switch" };
    }
    if (interruptionType === "correction" || interruptionType === "emotional_interrupt") {
      return {
        allow: true,
        mode: "short",
        debounceMs: Math.max(100, Math.floor(this.predictionDebounceMs * 0.65)),
        includeCarryForwardHint: interruptionType === "correction",
        reason: interruptionType,
      };
    }

    if (isHold && aggregates.partialGrowthTrend !== "plateau" && this.turnTakingState !== "LIKELY_END") {
      return { allow: false, mode: "full", debounceMs: this.predictionDebounceMs, includeCarryForwardHint: true, reason: "hold_without_plateau" };
    }

    return {
      allow: true,
      mode: "full",
      debounceMs: this.predictionDebounceMs,
      includeCarryForwardHint: true,
      reason: "stable_enough",
    };
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
    try {
      logger.debug("[预判] 开始预判", { text: text.slice(0, 30) });
      // 和正常回复一样组装输入，但是不更新状态
      const memory = await retrievePromptMemory(this.brain.memory, {
        userId: this.brain.userId,
        userMessage: text,
        slowBrainSnapshot: this.brain.slowBrain.getSnapshot(),
        maxEntries: options?.mode === "short" ? 4 : undefined,
      });
      const slowBrainContext = this.brain.slowBrain.synthesizeContext();
      const historyForPrompt = trimHistoryToTokenBudget([...this.brain.history]);
      const predictionHistory =
        options?.mode === "short" ? historyForPrompt.slice(-4) : historyForPrompt;
      const interruptedReply =
        this.brain.lastInterruptedReply?.trim() ||
        this.brain.currentAssistantDraft?.trim() ||
        null;
      const carryForwardHint =
        options?.includeCarryForwardHint !== false && interruptedReply
        ? buildCarryForwardHint(classifyInterruption(text, interruptedReply), interruptedReply)
        : undefined;
      const guidance = this.brain.slowBrain.buildConversationGuidance(text);
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
    const base = effectiveUtteranceGapMs(speechDurationMs);
    if (base <= 0) return 0;

    const preview = this.lastPreviewText.trim();
    if (!preview) return base;

    const holdMs = parseNonNegativeMs(process.env.VAD_UTTERANCE_GAP_PREVIEW_HOLD_MS, 140);
    const releaseMs = parseNonNegativeMs(process.env.VAD_UTTERANCE_GAP_PREVIEW_RELEASE_MS, 60);
    const minMs = parseNonNegativeMs(process.env.VAD_UTTERANCE_GAP_PREVIEW_MIN_MS, 80);
    const maxMs = parseNonNegativeMs(process.env.VAD_UTTERANCE_GAP_PREVIEW_MAX_MS, 520);
    const tentative = isTentativeSpeechText(preview);
    const sentenceClosed = endsWithSentencePunctuation(preview);
    let gap = base;

    if (tentative) {
      gap = Math.max(gap, hesitationHoldMs());
    } else if (sentenceClosed) {
      gap = Math.max(minMs, base - releaseMs);
    } else if (preview.length >= 8) {
      gap = Math.min(maxMs, base + holdMs);
    }

    const settleMs = sttPreviewSettleMs();
    if (settleMs > 0 && !sentenceClosed && this.lastPreviewAt > 0) {
      const age = Date.now() - this.lastPreviewAt;
      if (age < settleMs) {
        gap = Math.max(gap, settleMs - age);
      }
    }
    return gap;
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
    const partialShape = this.getPartialShapeAggregates();
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
    const now = Date.now();
    return this.recentInteractionCount >= this.CONTINUOUS_CONVERSATION_THRESHOLD && 
           (now - this.lastInteractionAt) < this.CONTINUOUS_CONVERSATION_TIMEOUT;
  }

  /** 同步VAD静默阈值到当前对话状态 */
  private syncVadSilenceThreshold(): void {
    const threshold = this.isContinuousConversation() 
      ? this.VAD_CONTINUOUS_SILENCE_FRAMES 
      : this.VAD_DEFAULT_SILENCE_FRAMES;
    this.vad.setSpeakingSilenceFrames(threshold);
  }

  /** 用户每次发文字或语音被识别后调用，重新计时沉默搭话和连续对话状态 */
  private touchUserActivity(userMessage?: string): void {
    this.clearSilenceNudgeTimer();
    const ms = silenceNudgeMs();
    this.brain.slowBrain.recordUserTurnActivity(userMessage);
    if (ms <= 0) return;
    this.silenceNudgeTimer = setTimeout(() => this.fireSilenceNudge(), ms);

    // 更新连续对话状态
    this.lastInteractionAt = Date.now();
    this.recentInteractionCount = Math.min(this.recentInteractionCount + 1, this.CONTINUOUS_CONVERSATION_THRESHOLD);
    this.syncVadSilenceThreshold();
  }

  /**
   * 沉默超时：串进 pipelineChain，与用户消息互斥；结束后继续计时下一轮。
   */
  private fireSilenceNudge(): void {
    this.silenceNudgeTimer = null;
    const ms = silenceNudgeMs();
    if (ms <= 0) return;

    if (this.interrupt.active) {
      this.silenceNudgeTimer = setTimeout(() => this.fireSilenceNudge(), 8000);
      return;
    }

    const legacyGatePlan = this.brain.slowBrain.buildSilenceNudgePlan();
    if (!legacyGatePlan) {
      this.silenceNudgeTimer = setTimeout(() => this.fireSilenceNudge(), ms);
      return;
    }

    logger.info("[陪伴] 沉默搭话", { connId: this.connId });
    this.pipelineChain = this.pipelineChain
      .then(async () => {
        const legacyPlan = this.brain.slowBrain.buildSilenceNudgePlan();
        if (!legacyPlan) {
          return;
        }

        let nudgePlan = legacyPlan;
        if (proactivePlannerMainPathEnabled()) {
          try {
            const proactivePlan = await planProactiveNudge(
              this.brain.userId,
              this.brain.slowBrain.getSnapshot(),
            );
            if (proactivePlan) {
              nudgePlan = {
                userMessage: buildSilenceNudgeUserMessage(proactivePlan),
                proactiveCandidate:
                  proactivePlan.mode === "presence" ? undefined : proactivePlan.text,
                proactiveCandidateKey: proactivePlan.ledgerKey,
                sharedMomentCandidate: undefined,
                strategyMode: proactivePlan.mode,
              };
            }
          } catch (err) {
            logger.warn("[陪伴] proactive planner failed, fallback to legacy nudge plan", {
              error: (err as Error).message,
              connId: this.connId,
            });
          }
        }

        const generationId = this.nextGenerationId();
        const traceId = this.createTraceId("silence_nudge", generationId);
        this.bindActiveGeneration(generationId, traceId, "silence_nudge");
        await runPipeline(
          this.ws,
          nudgePlan.userMessage,
          this.interrupt,
          this.avatar,
          this.sessionId,
          this.brain,
          generationId,
          traceId,
          { silenceNudge: true },
        );

        const completedWithoutInterrupt =
          !this.interrupt.active &&
          this.brain.lastInterruptedReply === null;
        if (completedWithoutInterrupt) {
          this.brain.slowBrain.recordProactiveOutreach(
            nudgePlan.strategyMode,
            nudgePlan.proactiveCandidateKey,
          );
          this.brain.slowBrain.markContinuityCueUsed({
            proactiveCandidate: nudgePlan.proactiveCandidate,
            sharedMomentCandidate: nudgePlan.sharedMomentCandidate,
          });
          await this.persistRelationshipContinuityState();
        }
      })
      .catch((err) => {
        logger.warn("[陪伴] 沉默搭话失败", {
          error: (err as Error).message,
          connId: this.connId,
        });
      })
      .finally(() => {
        if (silenceNudgeMs() > 0) {
          this.silenceNudgeTimer = setTimeout(() => this.fireSilenceNudge(), ms);
        }
      });
  }

  private async persistRelationshipContinuityState(): Promise<void> {
    if (!relationshipStateEnabled()) return;
    const relationshipRepo =
      this.brain.persistentRelationshipRepo ??
      this.brain.memory.getPersistentBackend() ??
      this.brain.memory;

    try {
      await savePersistentRelationshipState(
        relationshipRepo,
        this.brain.slowBrain.exportPersistentState(),
      );
    } catch (err) {
      logger.warn("[陪伴] 连续性状态持久化失败", {
        error: (err as Error).message,
        connId: this.connId,
      });
    }
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
          const generationId = this.nextGenerationId();
          this.bindActiveGeneration(generationId, traceId, "voice");
          this.lastSttFinalAt = Date.now();
          getLatencyTracer(this.connId).mark("stt_final", traceId);
          send(this.ws, { type: "stt_final", content: text });
          logger.info(`[用户·语音] ${text}`, { connId: this.connId });
          this.touchUserActivity(text);
          const { interruptionType, carryForwardHint } = this.classifyCarryForward(text);
          this.publishTurnState("assistant_entering", "tts_prepare", {
            generationId,
            interruptionType,
            force: true,
          });

          // 优先使用预判结果，如果存在且匹配
          const hasValidPrediction = this.predictedReply && 
            text.startsWith(this.currentPartialText) && 
            this.currentPartialText.length > 3;
          if (hasValidPrediction) {
            logger.info("[预判] 命中，复用提前生成的回复", { 
              partial: this.currentPartialText.slice(0, 30),
              final: text.slice(0, 30),
              replyPreview: this.predictedReply.slice(0, 30)
            });
            // 直接把预判结果传给管线，跳过LLM调用
            await runPipeline(
              this.ws,
              text,
              this.interrupt,
              this.avatar,
              this.sessionId,
              this.brain,
              generationId,
              traceId,
              {
                pregeneratedReply: this.predictedReply,
                carryForwardHint,
                interruptionType: interruptionType ?? undefined,
              }
            );
          } else {
            logger.debug("[预判] 未命中，走正常生成流程", {
              hasPrediction: !!this.predictedReply,
              partialLength: this.currentPartialText.length
            });
            // 没有预判结果，走正常流程
            await runPipeline(
              this.ws,
              text,
              this.interrupt,
              this.avatar,
              this.sessionId,
              this.brain,
              generationId,
              traceId,
              {
                carryForwardHint,
                interruptionType: interruptionType ?? undefined,
              },
            );
          }
          // 用完清空预判状态
          this.cancelPrediction();
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
    this.ws.on("message", (raw) => {
      const binary = this.parseBinaryAudioFrame(raw);
      if (binary) {
        this.handleAudioPcm(binary.pcm, binary.sampleRate);
        return;
      }

      let data: any;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        data = { type: "chat", content: raw.toString() };
      }

      const bypassRateLimit =
        data.type === "audio_stream" ||
        data.type === "audio_chunk" ||
        data.type === "playback_start";
      if (!bypassRateLimit) {
        const limiter = getWsRateLimiter();
        if (limiter && !limiter.check(this.connId)) {
          send(this.ws, { type: "error", content: "消息频率过高，请稍后再试" });
          return;
        }
      }

      switch (data.type) {
        case "history_more":
          void this.sendHistoryPage("prepend", this.parseHistoryCursor(data.cursor)).catch((err) => {
            logger.warn("[Storage] Failed to load older history", {
              error: err,
              connId: this.connId,
              userId: this.storageUserId,
            });
            send(this.ws, { type: "error", content: "加载历史记录失败，请稍后重试" });
          });
          break;
        case "dev_apply_preset":
          if (!devPresetCommandsEnabled()) {
            send(this.ws, { type: "error", content: "开发预设命令已禁用" });
            break;
          }
          this.runDevCommand(this.handleDevApplyPreset(data));
          break;
        case "dev_reset_state":
          if (!devPresetCommandsEnabled()) {
            send(this.ws, { type: "error", content: "开发预设命令已禁用" });
            break;
          }
          this.runDevCommand(this.handleDevResetState(data));
          break;
        case "duplex_start":
          this.handleDuplexStart(data);
          break;
        case "duplex_stop":
          this.handleDuplexStop();
          break;
        case "audio_stream":
          this.handleAudioStream(data);
          break;
        case "audio_chunk":
          this.handleAudioChunk(data);
          break;
        case "audio_end":
          this.handleAudioEnd();
          break;
        case "playback_start":
          this.handlePlaybackStart(data);
          break;
        default:
          this.handleChat(data);
          break;
      }
    });
  }

  private runDevCommand(task: Promise<void>): void {
    void task.catch((err) => {
      logger.warn("[DevPreset] command failed", {
        error: (err as Error).message,
        connId: this.connId,
      });
      send(this.ws, { type: "error", content: "开发预设操作失败，请稍后重试" });
    });
  }

  private resetDeveloperLiveState(): void {
    this.cancelPrediction();
    this.clearPendingUtteranceTimer();
    this.clearSilenceNudgeTimer();
    this.resetPreviewState();
    this.clearSpeechBuffer();
    this.preRollChunks = [];
    this.preRollBytes = 0;
    this.turnTakingState = "CONFIRMED_END";
    this.predictedReply = "";
    this.currentPartialText = "";
    this.interrupt.interrupt();
    this.brain.resetSessionArtifacts();
    this.activeGenerationId = null;
    this.activeTraceId = null;
    this.publishTurnState("confirmed_end", "confirmed_end", { force: true });
  }

  private async clearPersistentRelationshipState(): Promise<void> {
    const repo =
      this.brain.persistentRelationshipRepo ??
      this.brain.memory.getPersistentBackend();
    if (!repo) return;
    await repo.delete(RELATIONSHIP_STATE_KEY);
  }

  private async handleDevApplyPreset(data: any): Promise<void> {
    const personaPreset =
      typeof data.personaPreset === "string" ? data.personaPreset.trim() : "";
    const relationshipPreset =
      typeof data.relationshipPreset === "string" ? data.relationshipPreset.trim() : "";
    const resetScope =
      data.resetScope === "all" || data.resetScope === "relationship" || data.resetScope === "session"
        ? data.resetScope
        : "session";

    if (personaPreset) {
      if (!isPersonaPresetId(personaPreset)) {
        send(this.ws, { type: "error", content: `未知 personaPreset：${personaPreset}` });
        return;
      }
    }

    if (relationshipPreset) {
      if (!isRelationshipPresetId(relationshipPreset)) {
        send(this.ws, { type: "error", content: `未知 relationshipPreset：${relationshipPreset}` });
        return;
      }
    }

    this.resetDeveloperLiveState();

    if (resetScope === "all") {
      await this.brain.memory.clearLocal();
      await this.clearPersistentRelationshipState();
      this.brain.slowBrain.hydratePersistentState(buildEmptyRelationshipState());
    } else if (resetScope === "relationship") {
      await this.clearPersistentRelationshipState();
      this.brain.slowBrain.hydratePersistentState(buildEmptyRelationshipState());
    }

    if (personaPreset) {
      this.brain.applyPersonaPreset(personaPreset);
    }

    if (relationshipPreset) {
      const state = buildRelationshipPresetState(relationshipPreset);
      this.brain.hydratePersistentRelationshipState(state);
      if (relationshipStateEnabled()) {
        await this.persistRelationshipContinuityState();
      }
    }

    send(this.ws, {
      type: "dev_preset_applied",
      personaPreset: personaPreset || null,
      relationshipPreset: relationshipPreset || null,
      resetScope,
    });
  }

  private async handleDevResetState(data: any): Promise<void> {
    const scope =
      data.scope === "all" || data.scope === "relationship" || data.scope === "session"
        ? data.scope
        : "session";

    this.resetDeveloperLiveState();

    if (scope === "all") {
      await this.brain.memory.clearLocal();
      await this.clearPersistentRelationshipState();
      this.brain.slowBrain.hydratePersistentState(buildEmptyRelationshipState());
    } else if (scope === "relationship") {
      await this.clearPersistentRelationshipState();
      this.brain.slowBrain.hydratePersistentState(buildEmptyRelationshipState());
    }

    send(this.ws, { type: "dev_state_reset", scope });
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
        this.pendingVoiceTraceId = null;
        this.stt.cancelPcm();
        this.armSuppressedNoiseCooldown("duplex_stop_pre_stt", this.lastVadStartMode);
        return;
      }
      this.stt.cancelPreview();
      for (const chunk of this.speechBuffer) this.stt.feedPcm(chunk);
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
            const generationId = this.nextGenerationId();
            this.bindActiveGeneration(generationId, traceId, "voice");
            getLatencyTracer(this.connId).mark("stt_final", traceId);
            send(this.ws, { type: "stt_final", content: text });
            logger.info(`[用户·语音] ${text}`, { connId: this.connId });
            this.touchUserActivity(text);
            const { interruptionType, carryForwardHint } = this.classifyCarryForward(text);
            this.publishTurnState("assistant_entering", "tts_prepare", {
              generationId,
              interruptionType,
              force: true,
            });
            await runPipeline(
              this.ws,
              text,
              this.interrupt,
              this.avatar,
              this.sessionId,
              this.brain,
              generationId,
              traceId,
              {
                carryForwardHint,
                interruptionType: interruptionType ?? undefined,
              },
            );
          } catch (err) {
            logger.warn("[STT]", { error: (err as Error).message, connId: this.connId });
          }
        })
        .catch((err) => logger.error("[pipeline]", { error: err, connId: this.connId }));
    } else {
      this.pendingVoiceTraceId = null;
    }

    logger.info("[Duplex] 已停止", { connId: this.connId });
  }

  private appendPreRoll(pcm: Buffer): void {
    this.preRollChunks.push(pcm);
    this.preRollBytes += pcm.length;
    const maxBytes = preRollMaxBytes(this.duplexSampleRate);
    while (this.preRollBytes > maxBytes && this.preRollChunks.length > 0) {
      const first = this.preRollChunks.shift()!;
      this.preRollBytes -= first.length;
    }
  }

  /**
   * Binary audio frame formats (little-endian):
   *
   * V2 (current)
   * [0..3]   magic "RAUD"
   * [4]      version (1)
   * [5]      codec (1 = pcm16le mono)
   * [6..7]   reserved
   * [8..11]  sampleRate uint32
   * [12..15] payload byteLength uint32
   * [16..N]  PCM16LE mono payload
   *
   * V1 (legacy compatibility)
   * [0..1]   magic "RA"
   * [2]      version (1)
   * [3]      flags (reserved)
   * [4..7]   sampleRate uint32
   * [8..N]   PCM16LE mono payload
   */
  private parseBinaryAudioFrame(raw: unknown): { sampleRate: number; pcm: Buffer } | null {
    const asBuffer = (value: unknown): Buffer | null => {
      if (Buffer.isBuffer(value)) return value;
      if (value instanceof ArrayBuffer) return Buffer.from(value);
      if (Array.isArray(value) && value.every((v) => Buffer.isBuffer(v))) {
        return Buffer.concat(value as Buffer[]);
      }
      return null;
    };

    const buf = asBuffer(raw);
    if (!buf) return null;

    if (buf.length >= AUDIO_BIN_HEADER_BYTES_V2 + 2 && buf.subarray(0, 4).equals(AUDIO_BIN_MAGIC_V2)) {
      if (buf[4] !== AUDIO_BIN_VERSION) return null;
      if (buf[5] !== AUDIO_BIN_CODEC_PCM16_MONO) return null;

      const sampleRate = buf.readUInt32LE(8);
      const payloadBytes = buf.readUInt32LE(12);
      if (!Number.isFinite(sampleRate) || sampleRate <= 0) return null;
      if (payloadBytes <= 0 || buf.length < AUDIO_BIN_HEADER_BYTES_V2 + payloadBytes) return null;

      const pcm = buf.subarray(AUDIO_BIN_HEADER_BYTES_V2, AUDIO_BIN_HEADER_BYTES_V2 + payloadBytes);
      return { sampleRate, pcm: Buffer.from(pcm) };
    }

    if (buf.length >= AUDIO_BIN_HEADER_BYTES_V1 + 2 && buf.subarray(0, 2).equals(AUDIO_BIN_MAGIC_V1)) {
      if (buf[2] !== AUDIO_BIN_VERSION) return null;

      const sampleRate = buf.readUInt32LE(4);
      if (!Number.isFinite(sampleRate) || sampleRate <= 0) return null;

      const pcm = buf.subarray(AUDIO_BIN_HEADER_BYTES_V1);
      if (pcm.length === 0) return null;
      return { sampleRate, pcm: Buffer.from(pcm) };
    }

    return null;
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
          const generationId = this.nextGenerationId();
          this.bindActiveGeneration(generationId, traceId, "voice");
          this.lastSttFinalAt = Date.now();
          getLatencyTracer(this.connId).mark("stt_final", traceId);
          send(this.ws, { type: "stt_final", content: text });
          logger.info(`[用户·语音] ${text}`, { connId: this.connId });
          this.touchUserActivity(text);
          const { interruptionType, carryForwardHint } = this.classifyCarryForward(text);
          this.publishTurnState("assistant_entering", "tts_prepare", {
            generationId,
            interruptionType,
            force: true,
          });
          await runPipeline(
            this.ws,
            text,
            this.interrupt,
            this.avatar,
            this.sessionId,
            this.brain,
            generationId,
            traceId,
            {
              carryForwardHint,
              interruptionType: interruptionType ?? undefined,
            },
          );
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
          },
        ),
      )
      .catch((err) => logger.error("[pipeline]", { error: err, connId: this.connId }));
  }

  /** 全面的资源清理方法 */
  private cleanupAllResources(): void {
    try {
      this.duplexActive = false;

      // 清理 VAD 检测器
      try {
        this.vad.reset();
      } catch (e) {
        logger.warn("[Cleanup] VAD reset failed", { error: e, connId: this.connId });
      }

      // 清理所有定时器
      this.clearPendingUtteranceTimer();
      this.clearSilenceNudgeTimer();
      this.resetPreviewState();

      // 发送中断信号给正在运行的 pipeline
      try {
        this.interrupt.interrupt();
      } catch (e) {
        logger.warn("[Cleanup] Interrupt failed", { error: e, connId: this.connId });
      }

      // 清理 STT 流
      try {
        this.stt.reset();
      } catch (e) {
        logger.warn("[Cleanup] STT reset failed", { error: e, connId: this.connId });
      }

      // 清理语音缓冲区
      this.clearSpeechBuffer();
      this.preRollChunks = [];
      this.preRollBytes = 0;

      // 清理数据库会话
      if (isDbReady() && this.sessionId) {
        void endSession(this.sessionId).catch((err) => {
          logger.warn("[Storage] Failed to end session", { error: err, sessionId: this.sessionId });
        });
      }

      // 清理延迟追踪器
      removeLatencyTracer(this.connId);

      logger.debug("[Cleanup] All resources released", { connId: this.connId });
    } catch (e) {
      logger.error("[Cleanup] Unexpected error during cleanup", {
        error: e,
        connId: this.connId,
      });
    }
  }

  private setupCloseHandlers(): void {
    this.ws.on("close", () => {
      logger.info("[Remi] 客户端已断开", { connId: this.connId });
      this.cleanupAllResources();
    });

    this.ws.on("error", (err) => {
      logger.error("[WebSocket 错误]", { error: err, connId: this.connId });
      // WebSocket 错误后也清理资源
      this.cleanupAllResources();
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
