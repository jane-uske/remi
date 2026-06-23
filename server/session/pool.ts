import { randomUUID } from "crypto";

import { RemiSessionContext } from "../../brains/remi_session_context";
import { InterruptController } from "../../voice/interrupt_controller";
import { AvatarController } from "../../avatar/avatar_controller";
import { createLogger } from "../../infra/logger";
import { getLatencyTracer } from "../../infra/latency_tracer";
import { removeLatencyTracer } from "../../infra/latency_tracer";
import type { AuthPrincipal } from "../../infra/auth";
import { initializeSessionStorage } from "./bootstrap";
import { sendSessionHistoryPage } from "./history";
import {
  touchSessionUserActivity,
  fireSessionSilenceNudge,
  persistRelationshipContinuityState,
  type SessionContinuityRuntime,
} from "./continuity";
import { cleanupSessionResources } from "./lifecycle";
import { handleSessionTextChat, type SessionTextChatRuntime } from "./text_chat";
import type { MessageSink } from "../gateway/types";
import { send } from "../gateway";
import type { InterruptionType, RemiTurnState, RemiTurnStateReason } from "../../avatar/types";
import {
  buildCarryForwardHint,
  classifyInterruption,
  hasExplicitCarryForwardCue,
} from "./interruption";
import type { SessionTtsTransport } from "./tts_transport";
import { clearNsfw, restoreNsfwForUser, unbindNsfwNotifier } from "../../brains/nsfw_mode";
import { endSession } from "../../storage/repositories/session_repository";
import { isDbReady } from "../../infra/app_state";

const logger = createLogger("session-pool");

const POOL_ENTRY_TTL_MS = 30 * 60 * 1000;
const POOL_SWEEP_INTERVAL_MS = 60 * 1000;

export interface PoolEntry {
  token: string;
  connId: string;
  brain: RemiSessionContext;
  interrupt: InterruptController;
  avatar: AvatarController;
  storageUserId: string;
  authPrincipal: AuthPrincipal | null;
  sessionId: string | null;
  pipelineChain: Promise<void>;
  generationSeq: number;
  traceSeq: number;
  activeGenerationId: number | null;
  silenceNudgeTimer: ReturnType<typeof setTimeout> | null;
  lastInteractionAt: number;
  recentInteractionCount: number;
  lastTouchedAt: number;
  bootstrapReady: boolean;
  _dbSessionPending: (() => Promise<string>) | null;
}

class TextSessionPool {
  private entries = new Map<string, PoolEntry>();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  start(): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => this.sweep(), POOL_SWEEP_INTERVAL_MS);
    this.sweepTimer.unref();
  }

  stop(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    for (const entry of this.entries.values()) {
      this.destroyEntry(entry);
    }
    this.entries.clear();
  }

  async acquire(
    storageUserId: string,
    authPrincipal: AuthPrincipal | null,
  ): Promise<PoolEntry> {
    for (const entry of this.entries.values()) {
      if (entry.storageUserId === storageUserId) {
        entry.lastTouchedAt = Date.now();
        return entry;
      }
    }
    return this.createEntry(storageUserId, authPrincipal);
  }

  get(token: string): PoolEntry | undefined {
    const entry = this.entries.get(token);
    if (entry) entry.lastTouchedAt = Date.now();
    return entry;
  }

  touch(token: string): void {
    const entry = this.entries.get(token);
    if (entry) entry.lastTouchedAt = Date.now();
  }

  private async createEntry(
    storageUserId: string,
    authPrincipal: AuthPrincipal | null,
  ): Promise<PoolEntry> {
    const token = randomUUID();
    const connId = `sse-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const brain = new RemiSessionContext(connId);

    const entry: PoolEntry = {
      token,
      connId,
      brain,
      interrupt: new InterruptController(),
      avatar: new AvatarController(),
      storageUserId,
      authPrincipal,
      sessionId: null,
      pipelineChain: Promise.resolve(),
      generationSeq: 0,
      traceSeq: 0,
      activeGenerationId: null,
      silenceNudgeTimer: null,
      lastInteractionAt: 0,
      recentInteractionCount: 0,
      lastTouchedAt: Date.now(),
      bootstrapReady: false,
      _dbSessionPending: null,
    };

    this.entries.set(token, entry);

    try {
      await initializeSessionStorage({
        connId,
        storageUserId,
        authPrincipal,
        brain,
        historyPageSize: 15,
        setSessionId: (id: string) => { entry.sessionId = id; },
        setDbSessionCreator: (fn) => { entry._dbSessionPending = fn; },
        sendHistoryPage: async () => {},
      });
      entry.bootstrapReady = true;
    } catch (err) {
      logger.warn("[Pool] bootstrap failed, session still usable", {
        connId,
        error: (err as Error).message,
      });
      entry.bootstrapReady = true;
    }

    // Restore adult mode if this user dropped while in it and came back within
    // the window (keyed by the bootstrap-resolved user id, matching setNsfw).
    await restoreNsfwForUser(connId, brain.userId);

    logger.info("[Pool] session created", { connId, token: token.slice(0, 8) });
    return entry;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [token, entry] of this.entries) {
      if (now - entry.lastTouchedAt > POOL_ENTRY_TTL_MS) {
        logger.info("[Pool] evicting idle session", {
          connId: entry.connId,
          idleMinutes: Math.round((now - entry.lastTouchedAt) / 60_000),
        });
        this.destroyEntry(entry);
        this.entries.delete(token);
      }
    }
  }

  private destroyEntry(entry: PoolEntry): void {
    if (entry.silenceNudgeTimer) {
      clearTimeout(entry.silenceNudgeTimer);
      entry.silenceNudgeTimer = null;
    }

    entry.interrupt.interrupt();
    clearNsfw(entry.connId);
    unbindNsfwNotifier(entry.connId);

    void persistRelationshipContinuityState({
      connId: entry.connId,
      brain: entry.brain,
    }).catch(() => {});

    if (isDbReady() && entry.sessionId) {
      void endSession(entry.sessionId).catch(() => {});
    }

    removeLatencyTracer(entry.connId);
  }

  get size(): number {
    return this.entries.size;
  }
}

export const textSessionPool = new TextSessionPool();

export function ensureDbSession(entry: PoolEntry): Promise<string | null> {
  if (entry.sessionId) return Promise.resolve(entry.sessionId);
  const creator = entry._dbSessionPending;
  if (!creator) return Promise.resolve(null);
  entry._dbSessionPending = null;
  return creator().then((id) => {
    entry.sessionId = id;
    return id;
  });
}

export function nextGenerationId(entry: PoolEntry): number {
  entry.generationSeq += 1;
  entry.activeGenerationId = entry.generationSeq;
  return entry.generationSeq;
}

export function createTraceId(
  entry: PoolEntry,
  source: "voice" | "text" | "silence_nudge",
  generationId?: number,
): string {
  entry.traceSeq += 1;
  const g = typeof generationId === "number" ? `-g${generationId}` : "";
  return `${source}${g}-${Date.now()}-${entry.traceSeq}`;
}

export function bindActiveGeneration(
  entry: PoolEntry,
  generationId: number,
  traceId: string,
  source: "voice" | "text" | "silence_nudge",
): void {
  getLatencyTracer(entry.connId).startTrace(traceId, {
    source,
    generationId,
    sessionId: entry.sessionId,
  });
}

export function buildTextChatRuntime(
  entry: PoolEntry,
  sink: MessageSink,
): SessionTextChatRuntime {
  return {
    sink,
    connId: entry.connId,
    brain: entry.brain,
    interrupt: entry.interrupt,
    avatar: entry.avatar,
    sessionId: entry.sessionId,
    ensureDbSession: () => ensureDbSession(entry),
    activeGenerationId: entry.activeGenerationId,
    touchUserActivity: (userMessage?: string) => {
      touchSessionUserActivity(buildContinuityRuntime(entry, sink), userMessage);
    },
    classifyCarryForward: (userText: string) => {
      const interruptionType = entry.interrupt.active
        ? classifyInterruption(userText, entry.brain.currentAssistantDraft ?? "")
        : null;
      // 复读机修复：只有用户**显式**承接/修正上一句（"接着说"/"不对我是说"）时，
      // 才把上一条草稿 carry-forward 进 prompt。否则——哪怕上一条仍在生成
      // (interrupt.active)、或被 sharesKeywords 误判为 continuation——都当作全新问题，
      // 不复读上一条。这是线上文本聊天"复读机"的根因（unknown 也会走 default 分支
      // 注入上一条全文）。interruptionType 保持原值不变，不影响日志/turn_state。
      const carryForwardHint =
        interruptionType && hasExplicitCarryForwardCue(userText)
          ? buildCarryForwardHint(interruptionType, entry.brain.currentAssistantDraft ?? "")
          : undefined;
      return { interruptionType, carryForwardHint };
    },
    sendInterrupt: (generationId?: number | null) => {
      if (typeof generationId === "number") {
        send(sink, { type: "interrupt", generationId });
      } else {
        send(sink, { type: "interrupt" });
      }
    },
    nextGenerationId: () => nextGenerationId(entry),
    createTraceId: (source, gen?) => createTraceId(entry, source, gen),
    bindActiveGeneration: (gen, traceId, source) =>
      bindActiveGeneration(entry, gen, traceId, source),
    publishTurnState: (state, reason, extras?) => {
      send(sink, {
        type: "turn_state",
        state,
        reason,
        ...(extras?.generationId != null ? { generationId: extras.generationId } : {}),
        ...(extras?.preview ? { preview: extras.preview } : {}),
        ...(extras?.interruptionType ? { interruptionType: extras.interruptionType } : {}),
      });
    },
    setPipelineChain: (next: Promise<void>) => { entry.pipelineChain = next; },
    getPipelineChain: () => entry.pipelineChain,
    getResolvedTtsTransport: () => "buffered_voice" as SessionTtsTransport,
  };
}

export function buildContinuityRuntime(
  entry: PoolEntry,
  sink: MessageSink,
): SessionContinuityRuntime {
  return {
    connId: entry.connId,
    sink,
    brain: entry.brain,
    interrupt: entry.interrupt,
    avatar: entry.avatar,
    sessionId: entry.sessionId,
    getPipelineChain: () => entry.pipelineChain,
    setPipelineChain: (next) => { entry.pipelineChain = next; },
    getSilenceNudgeTimer: () => entry.silenceNudgeTimer,
    setSilenceNudgeTimer: (timer) => { entry.silenceNudgeTimer = timer; },
    getLastInteractionAt: () => entry.lastInteractionAt,
    setLastInteractionAt: (ts) => { entry.lastInteractionAt = ts; },
    getRecentInteractionCount: () => entry.recentInteractionCount,
    setRecentInteractionCount: (count) => { entry.recentInteractionCount = count; },
    continuousConversationThreshold: 3,
    continuousConversationTimeoutMs: 5 * 60 * 1000,
    continuousSilenceFrames: 8,
    defaultSilenceFrames: 10,
    syncVadSilenceFrames: () => {},
    nextGenerationId: () => nextGenerationId(entry),
    createTraceId: (source, gen?) => createTraceId(entry, source, gen),
    bindActiveGeneration: (gen, traceId, source) =>
      bindActiveGeneration(entry, gen, traceId, source),
    getResolvedTtsTransport: () => "buffered_voice" as SessionTtsTransport,
  };
}
