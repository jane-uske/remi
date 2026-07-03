import type { MessageSink } from "../gateway/types";

import type { AvatarController } from "../../avatar/avatar_controller";
import type { RemiSessionContext } from "../../brains/remi_session_context";
import {
  buildSilenceNudgeUserMessage,
  planProactiveNudge,
} from "../../brains/proactive_planner";
import { createLogger } from "../../infra/logger";
import {
  relationshipStateEnabled,
  savePersistentRelationshipState,
} from "../../memory/relationship_state";
import { markReferenced as markReferencedEpisode } from "../../memory/episode_store";
import type { InterruptController } from "../../voice/interrupt_controller";
import { getLatencyTracer } from "../../infra/latency_tracer";
import { runPipeline } from "../pipeline";
import {
  proactivePlannerMainPathEnabled,
  relationshipPeriodicSaveEnabled,
  relationshipPeriodicSaveTurns,
  silenceNudgeMs,
} from "./runtime_config";
import {
  remiSelfPersistenceEnabled,
  saveRemiSelfFromLiveState,
} from "./remi_self";
import { detectFarewellSignal, deriveFarewellFocus } from "./greeting_opener";
import type { SessionTtsTransport } from "./tts_transport";

const logger = createLogger("session");

// ── 主动搭话时间锚（2026-07 生产实锤止血）───────────────────────────────
//
// 生产案例②：凌晨 01:42 的主动搭话说"这会儿已经黄昏了"。system prompt 里
// 已经有 buildTimeContextBlock() 产出的【此刻】时间块（见 brain/time_context.ts /
// brains/context_orchestrator.ts），但模型（指令遵循偏弱）会无视——这正是
// 本任务"回复出口时间守卫"要构造性防御的问题本身。这里再加一层便宜的
// 前置补丁：主动搭话的 user turn 文本（brains/proactive_planner.ts 的
// buildSilenceNudgeUserMessage() 输出、以及旧版 legacy plan 的 userMessage）
// 直接摆在模型即将回应的那一轮里，比系统层的通用时间块更"贴脸"，双重锚点
// 对指令遵循偏弱的模型更保险。只在文本里检测不到时间/星期/时段词时才追加，
// 已经带了就不重复处理——不改 brains/ 目录一行代码，只在这里对其输出做
// 只读的后处理包装。
const WEEKDAY_OR_PERIOD_HINT_RE =
  /(周[一二三四五六日]|星期[一二三四五六日]|礼拜[一二三四五六日]|凌晨|清晨|早上|上午|中午|下午|傍晚|黄昏|深夜|半夜|晚上|现在是|此刻是)/;

function safeGuardTimeZone(timeZone: string | null): string {
  const candidate = timeZone?.trim() || "Asia/Shanghai";
  try {
    new Intl.DateTimeFormat("zh-CN", { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return "Asia/Shanghai";
  }
}

function periodWordForHour(hour: number): string {
  if (hour < 5) return "凌晨";
  if (hour < 9) return "早上";
  if (hour < 11) return "上午";
  if (hour < 13) return "中午";
  if (hour < 17) return "下午";
  if (hour < 19) return "傍晚";
  return "晚上";
}

/** 组装一行"现在是 X 星期 Y 时段，HH:mm"的时间锚提示。 */
function buildNudgeTimeAnchorLine(now: Date, timeZone: string | null): string {
  const tz = safeGuardTimeZone(timeZone);
  const weekday = new Intl.DateTimeFormat("zh-CN", { timeZone: tz, weekday: "long" }).format(now);
  const hourStr = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    hourCycle: "h23",
  }).format(now);
  const hour = Number(hourStr);
  const period = Number.isFinite(hour) ? periodWordForHour(hour) : "";
  const clock = new Intl.DateTimeFormat("zh-CN", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
  return `（现在是${weekday}${period}，${clock}——请以此为准开口，不要用记忆里的旧星期/旧时段说话。）`;
}

/**
 * 检查一段主动搭话的 user turn 文本是否已经带时间/星期/时段线索；没有就在
 * 末尾补一行时间锚，已有则原样返回（"有就不动"）。
 */
export function ensureNudgeMessageHasTimeAnchor(
  userMessage: string,
  timeZone: string | null,
  now: Date = new Date(),
): string {
  if (WEEKDAY_OR_PERIOD_HINT_RE.test(userMessage)) {
    return userMessage;
  }
  return `${userMessage}${buildNudgeTimeAnchorLine(now, timeZone)}`;
}

type TraceSource = "voice" | "text" | "silence_nudge";

export interface SessionContinuityRuntime {
  connId: string;
  sink: MessageSink;
  brain: RemiSessionContext;
  interrupt: InterruptController;
  avatar: AvatarController;
  sessionId: string | null;
  getPipelineChain(): Promise<void>;
  setPipelineChain(next: Promise<void>): void;
  getSilenceNudgeTimer(): ReturnType<typeof setTimeout> | null;
  setSilenceNudgeTimer(timer: ReturnType<typeof setTimeout> | null): void;
  getLastInteractionAt(): number;
  setLastInteractionAt(timestamp: number): void;
  getRecentInteractionCount(): number;
  setRecentInteractionCount(count: number): void;
  continuousConversationThreshold: number;
  continuousConversationTimeoutMs: number;
  continuousSilenceFrames: number;
  defaultSilenceFrames: number;
  syncVadSilenceFrames(frames: number): void;
  nextGenerationId(): number;
  createTraceId(source: TraceSource, generationId?: number): string;
  bindActiveGeneration(generationId: number, traceId: string, source: TraceSource): void;
  getResolvedTtsTransport(): SessionTtsTransport;
}

// ── 关系状态周期性保存 ────────────────────────────────────────────────
//
// persistRelationshipContinuityState 原先只在会话优雅销毁时调用（WS 正常断连
// /error → cleanupSessionResources；SSE pool 30min TTL 回收 → destroyEntry）。
// docker restart / 进程被杀会跳过这两条路径，导致最近一段对话积累的关系演进
// （familiarity/emotionalBond/topicHistory 等）整段丢失。
//
// 这里在原有保存点之外，按用户消息轮次计数，每
// relationshipPeriodicSaveTurns() 轮额外异步写回一次——复用同一个
// persistRelationshipContinuityState，不新增持久化机制。计数器按 connId 隔离，
// 在 touchSessionUserActivity（WS 语音 + SSE 文本共用的每轮入口）里递增，写回
// 本身 fire-and-forget、不 await，绝不阻塞 fast path。flag off 时整段短路，
// 行为与现状逐字节一致。
const periodicSaveTurnCounts = new Map<string, number>();

function notePeriodicSaveTurn(
  runtime: Pick<SessionContinuityRuntime, "brain" | "connId">,
): void {
  if (!relationshipPeriodicSaveEnabled()) return;
  const threshold = relationshipPeriodicSaveTurns();
  if (!(threshold > 0)) return;

  const nextCount = (periodicSaveTurnCounts.get(runtime.connId) ?? 0) + 1;
  if (nextCount < threshold) {
    periodicSaveTurnCounts.set(runtime.connId, nextCount);
    return;
  }

  periodicSaveTurnCounts.set(runtime.connId, 0);
  void persistRelationshipContinuityState(runtime).catch((err) => {
    logger.warn("[陪伴] 周期性关系状态保存失败", {
      error: (err as Error).message,
      connId: runtime.connId,
    });
  });
}

/** 会话结束时清理该 connId 的周期性保存计数器，避免 Map 无界增长。 */
export function clearPeriodicSaveTurnCount(connId: string): void {
  periodicSaveTurnCounts.delete(connId);
}

// ── 收场钩子（活人感闭环，任务 B）────────────────────────────────────────
//
// 用户告别时（"拜拜/晚安/回头聊"…）本轮正常回复不受影响——这里只是在
// touchSessionUserActivity 的每轮入口旁路一个 fire-and-forget 写回，把"下次线头"
// 存进 RemiSelf.currentFocus。不需要她本轮说"我会记住的"：钩子是暗埋的，下次开场
// （server/session/greeting_opener.ts 的素材 a）兑现才是惊喜。
//
// 复用 saveRemiSelfFromLiveState 的持久化路径 + overrideFocus 顶替它默认派生的
// currentFocus；gate 条件对齐 persistRemiSelfState（remiSelfPersistenceEnabled()
// off 时这里也不写，避免在 flag off 时产生现状没有的额外 DB/内存写入）。
function noteFarewellHook(
  runtime: Pick<SessionContinuityRuntime, "brain" | "connId">,
  userMessage: string,
): void {
  if (!remiSelfPersistenceEnabled()) return;
  if (!detectFarewellSignal(userMessage)) return;

  const focus = deriveFarewellFocus(runtime.brain, userMessage);
  void saveRemiSelfFromLiveState(runtime.brain, new Date(), focus).catch((err) => {
    logger.warn("[开场] 收场钩子写入失败", {
      error: (err as Error).message,
      connId: runtime.connId,
    });
  });
}

export function isContinuousConversation(runtime: SessionContinuityRuntime): boolean {
  const now = Date.now();
  return (
    runtime.getRecentInteractionCount() >= runtime.continuousConversationThreshold &&
    now - runtime.getLastInteractionAt() < runtime.continuousConversationTimeoutMs
  );
}

export function syncSessionVadSilenceThreshold(runtime: SessionContinuityRuntime): void {
  runtime.syncVadSilenceFrames(
    isContinuousConversation(runtime)
      ? runtime.continuousSilenceFrames
      : runtime.defaultSilenceFrames,
  );
}

export function touchSessionUserActivity(
  runtime: SessionContinuityRuntime,
  userMessage?: string,
): void {
  const timer = runtime.getSilenceNudgeTimer();
  if (timer) {
    clearTimeout(timer);
    runtime.setSilenceNudgeTimer(null);
  }

  const ms = silenceNudgeMs();
  runtime.brain.slowBrain.recordUserTurnActivity(userMessage);
  if (ms > 0) {
    runtime.setSilenceNudgeTimer(setTimeout(() => fireSessionSilenceNudge(runtime), ms));
  }

  runtime.setLastInteractionAt(Date.now());
  runtime.setRecentInteractionCount(
    Math.min(
      runtime.getRecentInteractionCount() + 1,
      runtime.continuousConversationThreshold,
    ),
  );
  syncSessionVadSilenceThreshold(runtime);

  // 周期性关系状态保存：计数 + 达阈值即 fire-and-forget 写回，不 await、不
  // 影响本轮任何 fast path 时序（详见上方注释）。
  notePeriodicSaveTurn(runtime);

  // 收场钩子：命中告别意图即 fire-and-forget 暗埋下次线头，不影响本轮回复
  // （详见上方注释）。userMessage 可能是 undefined（如打断反应等无文本触发），
  // 此时直接跳过检测。
  if (userMessage) {
    noteFarewellHook(runtime, userMessage);
  }
}

export async function persistRelationshipContinuityState(
  runtime: Pick<SessionContinuityRuntime, "brain" | "connId">,
): Promise<void> {
  if (!relationshipStateEnabled()) return;
  const relationshipRepo =
    runtime.brain.persistentRelationshipRepo ??
    runtime.brain.memory.getPersistentBackend() ??
    runtime.brain.memory;

  try {
    await savePersistentRelationshipState(
      relationshipRepo,
      runtime.brain.slowBrain.exportPersistentState(),
    );
  } catch (err) {
    logger.warn("[陪伴] 连续性状态持久化失败", {
      error: (err as Error).message,
      connId: runtime.connId,
    });
  }
}

/**
 * DL-P1b: RemiSelf 断连写回 —— persistRelationshipContinuityState 的兄弟函数。
 * 在所有调用 persistRelationshipContinuityState 的地方并排 fire-and-forget 调用。
 * flag off（默认）/ 无 userId → no-op；失败只 warn，绝不抛。设计见
 * docs/design/DIGITAL_LIFE_NORTH_STAR.md §1。
 */
export async function persistRemiSelfState(
  runtime: Pick<SessionContinuityRuntime, "brain" | "connId">,
): Promise<void> {
  if (!remiSelfPersistenceEnabled()) return;
  try {
    await saveRemiSelfFromLiveState(runtime.brain);
  } catch (err) {
    logger.warn("[RemiSelf] 自我状态持久化失败", {
      error: (err as Error).message,
      connId: runtime.connId,
    });
  }
}

export function fireSessionSilenceNudge(runtime: SessionContinuityRuntime): void {
  runtime.setSilenceNudgeTimer(null);
  const ms = silenceNudgeMs();
  if (ms <= 0) return;

  if (runtime.interrupt.active) {
    runtime.setSilenceNudgeTimer(
      setTimeout(() => fireSessionSilenceNudge(runtime), 8000),
    );
    return;
  }

  const legacyGatePlan = runtime.brain.slowBrain.buildSilenceNudgePlan();
  if (!legacyGatePlan) {
    runtime.setSilenceNudgeTimer(
      setTimeout(() => fireSessionSilenceNudge(runtime), ms),
    );
    return;
  }

  logger.info("[陪伴] 沉默搭话", { connId: runtime.connId });
  const nextChain = runtime.getPipelineChain()
    .then(async () => {
      const legacyPlan = runtime.brain.slowBrain.buildSilenceNudgePlan();
      if (!legacyPlan) {
        return;
      }

      let nudgePlan = legacyPlan;
      if (proactivePlannerMainPathEnabled()) {
        try {
          const proactivePlan = await planProactiveNudge(
            runtime.brain.userId,
            runtime.brain.slowBrain.getSnapshot(),
          );
          if (proactivePlan) {
            nudgePlan = {
              userMessage: buildSilenceNudgeUserMessage(proactivePlan),
              proactiveCandidate:
                proactivePlan.mode === "presence" ? undefined : proactivePlan.text,
              proactiveCandidateKey: proactivePlan.ledgerKey,
              sharedMomentCandidate: undefined,
              strategyMode: proactivePlan.mode,
              episodeId: proactivePlan.episodeId,
            };
          }
        } catch (err) {
          logger.warn(
            "[陪伴] proactive planner failed, fallback to legacy nudge plan",
            {
              error: (err as Error).message,
              connId: runtime.connId,
            },
          );
        }
      }

      const generationId = runtime.nextGenerationId();
      const traceId = runtime.createTraceId("silence_nudge", generationId);
      const latencyTracer = getLatencyTracer(runtime.connId);
      if (nudgePlan.episodeId) {
        latencyTracer.annotateTrace(traceId, {
          episodeRecallSource: "episode_store",
          episodeRecallIds: [nudgePlan.episodeId],
          episodeReferenceApplied: false,
          episodeRecallFallback: false,
        });
      }
      runtime.bindActiveGeneration(generationId, traceId, "silence_nudge");
      // 主动搭话时间锚补丁（见文件头注释）：不论 nudgePlan.userMessage 来自
      // proactive planner 还是 legacy plan，发进 pipeline 前统一检查/补上
      // 一行时间锚——覆盖生产案例②同类问题，且不改 brains/ 一行代码。
      // 防御性调用 getClientTimeZone()：万一 runtime.brain 是简化 mock/未来
      // 精简实现、不带这个方法，也绝不能让整条沉默搭话链路因此中断。
      const nudgeTimeZone =
        typeof runtime.brain.getClientTimeZone === "function"
          ? runtime.brain.getClientTimeZone()
          : null;
      const nudgeUserMessage = ensureNudgeMessageHasTimeAnchor(
        nudgePlan.userMessage,
        nudgeTimeZone,
      );
      await runPipeline(
        runtime.sink,
        nudgeUserMessage,
        runtime.interrupt,
        runtime.avatar,
        runtime.sessionId,
        runtime.brain,
        generationId,
        traceId,
        {
          silenceNudge: true,
          ttsTransport: runtime.getResolvedTtsTransport(),
        },
      );

      const completedWithoutInterrupt =
        !runtime.interrupt.active &&
        runtime.brain.lastInterruptedReply === null;
      if (completedWithoutInterrupt) {
        runtime.brain.slowBrain.recordProactiveOutreach(
          nudgePlan.strategyMode,
          nudgePlan.proactiveCandidateKey,
        );
        if (nudgePlan.episodeId) {
          try {
            await markReferencedEpisode(nudgePlan.episodeId);
            latencyTracer.annotateTrace(traceId, {
              episodeRecallSource: "episode_store",
              episodeRecallIds: [nudgePlan.episodeId],
              episodeReferenceApplied: true,
              episodeRecallFallback: false,
            });
          } catch (err) {
            logger.warn("[陪伴] proactive episode reference update failed", {
              error: (err as Error).message,
              connId: runtime.connId,
              episodeId: nudgePlan.episodeId,
            });
          }
        }
        runtime.brain.slowBrain.markContinuityCueUsed({
          proactiveCandidate: nudgePlan.proactiveCandidate,
          sharedMomentCandidate: nudgePlan.sharedMomentCandidate,
        });
        await persistRelationshipContinuityState(runtime);
      }
    })
    .catch((err) => {
      logger.warn("[陪伴] 沉默搭话失败", {
        error: (err as Error).message,
        connId: runtime.connId,
      });
    })
    .finally(() => {
      if (silenceNudgeMs() > 0) {
        runtime.setSilenceNudgeTimer(
          setTimeout(() => fireSessionSilenceNudge(runtime), ms),
        );
      }
    });

  runtime.setPipelineChain(nextChain);
}
