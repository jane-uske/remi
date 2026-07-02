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
  clearPeriodicSaveTurnCount,
  persistRelationshipContinuityState,
  persistRemiSelfState,
  type SessionContinuityRuntime,
} from "./continuity";
import { loadAndApplyRemiSelf } from "./remi_self";
import { clearGreetingOpenerState, scheduleGreetingOpener } from "./greeting_opener";
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
  /**
   * 持久 push 通道（GET /api/chat/events 的 EventSource 连接）。POST /api/chat
   * 的 sink 只在单次请求-响应生命周期内存在（handleChat 里 pipelineDone 后即
   * sink.end()），无法承载"用户还没开口"时的推送（开场语）；这个字段是唯一
   * 跨请求存活、能在 bootstrap 完成后立刻推送的 sink。events 连接断开时置回
   * null（见 detachEventsSink），不随 entry 生命周期强绑定——entry 存活期间
   * events 允许多次连接/断开（如浏览器标签页刷新）。
   */
  eventsSink: MessageSink | null;
  /** loadAndApplyRemiSelf 的 promise，供 events 迟到时复用同一次 bootstrap 等待
   *  （而非重新触发一次加载）。createEntry 内 fire-and-forget 发起，这里只留存
   *  引用给 attachEventsSink 用。 */
  remiSelfLoaded: Promise<void>;
  /** 本 entry 是否已经因为拿到 eventsSink 而调度过开场语判定，防止同一 entry
   *  多次 events (re)connect 时重复调用 scheduleGreetingOpener（其内部虽然有
   *  per-connId 的 sent 状态兜底，这里额外短路避免无意义的重复判定开销）。 */
  greetingScheduledForEvents: boolean;
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
      eventsSink: null,
      remiSelfLoaded: Promise.resolve(),
      greetingScheduledForEvents: false,
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

    // DL-P1b: 异步加载 RemiSelf + 漂移 + soft-patch（用 bootstrap 解析出的
    // brain.userId；flag off / 无记录 / 失败静默 no-op）。fire-and-forget，但
    // promise 留存在 entry 上——attachEventsSink 迟到时需要等它，不能重新触发
    // 一次加载（loadAndApplyRemiSelf 非幂等地写 brain.persona.liveState）。
    entry.remiSelfLoaded = loadAndApplyRemiSelf(brain, brain.userId);

    // 开场主动语（server/session/greeting_opener.ts）：接线在 attachEventsSink
    // （见文件底部），由 GET /api/chat/events 连接时调用——那才是 SSE 文本会话
    // 唯一跨请求存活、能在用户开口前推送的 sink（POST /api/chat 的 sink 只活在
    // 单次请求-响应生命周期内，见 handleChat 的 sink.end()）。这里处理"entry 先
    // 创建、events 后连接"的顺序；"events 先连接"不存在——handleEvents 要求
    // token 已存在（textSessionPool.get 未命中即 404），token 只能来自本函数。
    // loadAndApplyRemiSelf 仍会为这个 entry 记录 lastSeenAt，销毁时随
    // clearGreetingOpenerState 一并清理，不会无界增长。
    //
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

    // DL-P1b: RemiSelf 写回，与关系连续性状态并排（flag off 时 no-op）。
    void persistRemiSelfState({
      connId: entry.connId,
      brain: entry.brain,
    }).catch(() => {});

    // 周期性保存计数器随会话销毁一并清理，避免 Map 无界增长。
    clearPeriodicSaveTurnCount(entry.connId);

    // 开场主动语的 lastSeenAt / 每会话 sent 状态同理清理，避免 Map 无界增长。
    clearGreetingOpenerState(entry.connId);

    // events 长连接随 entry 销毁一并关闭，客户端 EventSource 收到干净的 close
    // 而不是被服务端悄悄遗弃（TTL 回收 30min 空闲 entry 时尤其需要）。MessageSink
    // 接口本身不声明 end()（WS 场景没有这个概念），SseResponseSink 才有——用
    // unknown 中转的结构化探测，不引入对具体实现类的编译期依赖。
    const eventsSinkWithEnd = entry.eventsSink as unknown as { end?: () => void } | null;
    if (eventsSinkWithEnd && typeof eventsSinkWithEnd.end === "function") {
      eventsSinkWithEnd.end();
    }
    entry.eventsSink = null;

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

// ── GET /api/chat/events sink 接线（开场主动语 SSE 落地点）──────────────
//
// buildContinuityRuntime 需要调用方传一个 sink——POST /api/chat 场景下那是
// request-scoped 的 SseResponseSink，响应结束就没了。events 连接是唯一跨请求
// 存活的 sink 来源，所以单独用 entry.eventsSink 构造一份 runtime，而不是复用
// buildContinuityRuntime（其签名要求调用方已经有一个 sink 实例）。

/**
 * events 连接场景专用的 SessionContinuityRuntime：sink 固定读 entry.eventsSink
 * （由 attachEventsSink 写入）。仅供 attachEventsSink 内部调用 scheduleGreetingOpener
 * 使用——调用前必须已确认 entry.eventsSink 非空。
 */
function buildEventsContinuityRuntime(entry: PoolEntry): SessionContinuityRuntime {
  const sink = entry.eventsSink;
  if (!sink) {
    throw new Error("buildEventsContinuityRuntime called before eventsSink attached");
  }
  return buildContinuityRuntime(entry, sink);
}

/**
 * GET /api/chat/events 连接建立时调用（server/gateway/sse_chat.ts 的
 * handleEvents）。把这条长连接注册为 entry 的持久推送通道，并在 bootstrap
 * （含 RemiSelf 恢复）就绪后触发一次开场语判定——这是"她先开口"在 SSE/文本
 * 路径下唯一可行的落地点，行为对齐 WS 路径 initializeAsync 里对
 * scheduleGreetingOpener 的调用（同一份 greeting_opener.ts 判定逻辑，零改动）。
 *
 * 时序处理：
 *  - entry 早于 events 连接创建（唯一可能顺序，见 createEntry 内注释）：
 *    remiSelfLoaded 此时可能已 resolve 也可能仍在途中，两种情况
 *    scheduleGreetingOpener 内部的 `await remiSelfLoaded` 都能正确处理。
 *  - 同一 entry 多次 events (re)connect（如标签页刷新）：
 *    greetingScheduledForEvents 短路重复调度；即便未短路，
 *    scheduleGreetingOpener 自身的 per-connId sent 状态也会再兜底一层。
 */
export function attachEventsSink(entry: PoolEntry, sink: MessageSink): void {
  entry.eventsSink = sink;
  if (entry.greetingScheduledForEvents) return;
  entry.greetingScheduledForEvents = true;
  void scheduleGreetingOpener(buildEventsContinuityRuntime(entry), entry.remiSelfLoaded);
}

/**
 * events 连接断开时调用。只有当前 sink 就是要断开的那个才清空——避免"旧连接
 * 迟到的 close 事件"误清掉一个更新的 events 连接（如标签页快速刷新，旧连接的
 * close 事件在新连接的 open 之后才到达）。
 */
export function detachEventsSink(entry: PoolEntry, sink: MessageSink): void {
  if (entry.eventsSink === sink) {
    entry.eventsSink = null;
  }
}
