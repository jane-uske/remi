// ── 开场主动语 + 收场钩子 —— 「活人感」闭环的收口 ──────────────────────
//
// 北极星：用户打开 Remi 时她先说话（像推门进来对方抬头说"你回来啦"），用户告别
// 时她暗埋下次的线头（不声张，兑现才是惊喜）。两件事共用一份"素材优先级"：
//
//   a) 收场钩子兑现 —— RemiSelf.currentFocus（上次埋下的线头，见下方任务 B）
//   b) 未完线头 —— 恢复的 sharedMoments 里 unresolved 的最近一条 / proactiveTopics 首条
//   c) 离线人生 —— buildReturnNarrativeOpener 的白名单活动素材
//
// 开场（任务 A）：走 silence nudge 同款「systemTriggered 生成 + 推送」路径——
// 复用 RunPipelineOptions.silenceNudge（其语义本就是"系统触发一轮生成"，不是
// silence-nudge 专属；沿用它是为了不改动 server/pipeline/runner.ts，保持
// "同一条路径"字面成立）。触发条件、素材选择、防打扰节流都在本模块内完成，
// 会话状态机（server/session/index.ts / pool.ts）只需在 bootstrap 完成后调用一次
// scheduleGreetingOpener，其余全部 fire-and-forget、绝不阻塞 fast path。
//
// 收场（任务 B）：detectFarewellSignal 命中告别意图后，本轮正常回复不受影响，
// 异步把"下次线头"写入 RemiSelf.currentFocus（复用 saveRemiSelfFromLiveState，
// 传 overrideFocus 覆盖它默认的 deriveRemiSelfFocus）。下次开场时素材 a 就有内容
// ——这是两件事在数据层面唯一的耦合点，且完全经由已有的 RemiSelf 持久化路径。
//
// flag REMI_GREETING_OPENER_ENABLED 默认 "1"；REMI_SELF_PERSISTENCE_ENABLED off
// 时 loadAndApplyRemiSelf 根本不跑，noteRemiSelfLastSeen 不会被调用，
// lastSeenAt 表恒空，scheduleGreetingOpener 天然不触发（无需额外判它）。

import type { SessionContinuityRuntime } from "./continuity";
import type { RemiSessionContext } from "../../brains/remi_session_context";
import type { SharedMoment } from "../../brains/background_analysis_store";
import { isNsfwEnabled } from "../../brains/nsfw_mode";
import { createLogger } from "../../infra/logger";
import { runPipeline } from "../pipeline";
import { getConfig } from "../config";
import { normalizeCurrentFocus } from "../../memory/remi_self";
import { offlineLifeEnabled } from "./runtime_config";
import {
  computeReturnNarrative,
  buildReturnNarrativeOpener,
} from "../../world/return_narrative";

const logger = createLogger("greeting-opener");

// ── 配置读取 ─────────────────────────────────────────────────────────

export function greetingOpenerEnabled(): boolean {
  return getConfig().REMI_GREETING_OPENER_ENABLED;
}

/** 距上次见面 >30 分钟才构成"她该先开口"——刚切走又回来不用讲场面话。 */
const MIN_OFFLINE_MS_FOR_GREETING = 30 * 60_000;

/** bootstrap 完成后等这么久再发开场语，给前端 WS/SSE 就绪留时间。 */
const GREETING_DELAY_MS = 2500;

/** 触发前的"别抢话"窗口：最近 N 毫秒内用户已发过消息就不再开口。 */
const RECENT_USER_MESSAGE_GUARD_MS = 5 * 60_000;

// ── 每会话状态（connId 隔离，参照 continuity.ts 的 periodicSaveTurnCounts） ──

interface GreetingSessionState {
  /** RemiSelf 记录里的 lastSeenAt（epoch ms）。未加载或无记录时为 null。 */
  lastSeenAtMs: number | null;
  /** 本会话是否已经发过开场语（每会话最多一次）。 */
  sent: boolean;
}

const sessionState = new Map<string, GreetingSessionState>();

function getState(connId: string): GreetingSessionState {
  let state = sessionState.get(connId);
  if (!state) {
    state = { lastSeenAtMs: null, sent: false };
    sessionState.set(connId, state);
  }
  return state;
}

/**
 * loadAndApplyRemiSelf 在读到 saved.lastSeenAt 后调用，把它记到本会话的 greeting
 * 状态表——scheduleGreetingOpener 稍后据此算"距上次见面多久"，不需要二次读库。
 * 无记录（首次见用户）时不调用，lastSeenAtMs 保持 null（视为"不触发"）。
 */
export function noteRemiSelfLastSeen(connId: string, lastSeenAtMs: number): void {
  getState(connId).lastSeenAtMs = lastSeenAtMs;
}

// ── 跨通道去重（userId + 30 分钟窗口）───────────────────────────────────
//
// sessionState 的"每会话一次"是按 connId 隔离的——WS（桌面/iOS）和 SSE（网页）
// 是两个独立 connId，各自的 GreetingSessionState 互不相干。用户同时开着桌面和
// 网页时，两条通道各自判定"距上次见面 >30min + 有素材"都会为真，若不额外去重
// 会各发一条，观感是"她说了两遍/在两个地方分别打招呼"。
//
// 用一个按 userId 隔离的时间戳表，在真正提交发送（state.sent = true 那一刻）
// 之前再多判一次"最近 30 分钟内是否已经有其他连接替这个 userId 发过"，命中则
// 放弃——不影响 per-connId 的 sent 状态（该 connId 仍标记为"已尝试过"，防止
// 同一 connId 反复重试）。窗口长度复用 MIN_OFFLINE_MS_FOR_GREETING（同一常量，
// 语义一致："30 分钟内只该有一次她先开口"）。
//
// 无 userId（brain.userId 为空，如 DB 未就绪的匿名会话）时不参与跨通道去重
// ——退化为现状的纯 per-connId 判定，不引入新的误伞（多个匿名连接本就无法关联
// 到同一个人）。
const lastGreetingSentAtByUserId = new Map<string, number>();

/** 跨通道去重表的清理间隔——比窗口本身略长，保证条目过期后能被扫掉。 */
const CROSS_CHANNEL_SWEEP_INTERVAL_MS = 10 * 60_000;

let crossChannelSweepTimer: ReturnType<typeof setInterval> | null = null;

function ensureCrossChannelSweepScheduled(): void {
  if (crossChannelSweepTimer) return;
  crossChannelSweepTimer = setInterval(() => {
    const cutoff = Date.now() - MIN_OFFLINE_MS_FOR_GREETING;
    for (const [userId, sentAtMs] of lastGreetingSentAtByUserId) {
      if (sentAtMs < cutoff) {
        lastGreetingSentAtByUserId.delete(userId);
      }
    }
  }, CROSS_CHANNEL_SWEEP_INTERVAL_MS);
  crossChannelSweepTimer.unref();
}

/**
 * 提交发送前的最后一道跨通道校验：命中即放弃（不改变任何状态）；未命中则登记
 * 本次发送时间，供后续其他通道的判定读取。原子性说明：Node 单线程事件循环下，
 * 这个"读 + 写"之间不存在真正的并发穿插（JS 没有抢占式多线程），先到者必然先
 * 完整跑完这个函数再让出，故不会出现两个通道都读到"未命中"的竞态。
 */
function tryClaimCrossChannelGreetingSlot(userId: string): boolean {
  if (!userId) return true; // 无 userId 不参与跨通道去重，退化为现状行为。
  ensureCrossChannelSweepScheduled();
  const now = Date.now();
  const lastSentAt = lastGreetingSentAtByUserId.get(userId);
  if (lastSentAt !== undefined && now - lastSentAt < MIN_OFFLINE_MS_FOR_GREETING) {
    return false;
  }
  lastGreetingSentAtByUserId.set(userId, now);
  return true;
}

/** 测试用：清空跨通道去重表，隔离用例。 */
export function __resetCrossChannelGreetingStateForTest(): void {
  lastGreetingSentAtByUserId.clear();
}

/** 会话销毁时清理，避免 Map 无界增长（参照 clearPeriodicSaveTurnCount）。 */
export function clearGreetingOpenerState(connId: string): void {
  sessionState.delete(connId);
}

/** 测试用：整表清空，隔离用例。 */
export function __resetGreetingOpenerStateForTest(): void {
  sessionState.clear();
}

// ── 任务 B：告别检测 ───────────────────────────────────────────────────

/**
 * 告别意图检测（正则级，参照 brain/tone_policy.ts 的 detectBedtimeSignal 写法，
 * 但独立成词表——告别 ≠ 睡前信号，两者语义不同，不复用/不改那个文件）。
 */
const FAREWELL_RE =
  /(?:拜拜|再见|回见|(?:回头|下次|改天|明天)(?:再)?聊|先这样|先这样吧|我先(?:走|去忙|睡)了?|要走了|得走了|该走了|去忙了|去忙一下|去忙别的|晚安|睡了|我去睡了|该睡了|准备睡了|睡觉去了|明天见|下次见|下次再说|挂了|先挂了|先下了|下线了|要下了|不聊了|先不聊了)/u;

export function detectFarewellSignal(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return FAREWELL_RE.test(trimmed);
}

/**
 * 从当前会话慢脑快照派生"下次线头"（任务 B 的写入内容）。优先级：
 *  1) unresolved sharedMoment 里最新一条（按 turn 降序）的 summary；
 *  2) 当前话题的自然延续（topicPull / lastTopicSummary）；
 *  3) 兜底："他上次走的时候聊到 X"（X = 本轮告别消息本身的极简摘要）。
 * 纯函数、无副作用，供 noteFarewellHook 写入 RemiSelf.currentFocus。
 */
export function deriveFarewellFocus(
  brain: Pick<RemiSessionContext, "slowBrain" | "persona">,
  farewellUserMessage: string,
): string | null {
  const snapshot = brain.slowBrain.getSnapshot();
  const latestUnresolved = snapshot.sharedMoments
    .filter((m: SharedMoment) => m.unresolved && m.summary?.trim())
    .sort((a, b) => b.turn - a.turn)[0];
  if (latestUnresolved) {
    return normalizeCurrentFocus(latestUnresolved.summary);
  }

  const topicPull = brain.persona.liveState.topicPull?.trim();
  if (topicPull) {
    return normalizeCurrentFocus(topicPull);
  }
  const lastTopicSummary = brain.persona.liveState.lastTopicSummary;
  if (lastTopicSummary && lastTopicSummary !== "无最近话题") {
    return normalizeCurrentFocus(lastTopicSummary);
  }

  // 兜底：拿告别消息本身垫底（截断），至少留下"他走的时候说了这句"。
  const trimmedFarewell = farewellUserMessage.trim();
  if (trimmedFarewell) {
    return normalizeCurrentFocus(`他上次走的时候聊到：${trimmedFarewell}`);
  }
  return null;
}

// ── 任务 A：开场素材选择 + 指令文案 ────────────────────────────────────

export interface GreetingMaterials {
  /** 素材 a：收场钩子兑现（RemiSelf.currentFocus，即 brain.remiSelfFocus）。 */
  hookPayoff: string | null;
  /** 素材 b：未完线头（sharedMoments 里 unresolved 最近一条 / proactiveTopics 首条）。 */
  openThread: string | null;
  /** 素材 c：离线人生开场句（buildReturnNarrativeOpener 产出，仅引用白名单活动）。 */
  offlineOpener: string | null;
}

/**
 * 从当前 brain 状态选素材，按 a→b→c 优先级填充（有什么用什么，允许多个并存——
 * 指令文案会要求"挑一件事，别堆砌"）。全部为空时调用方应放弃触发。
 *
 * 素材 c 复用 world/return_narrative 的确定性纯函数：同一 (lastSeenAtMs, nowMs)
 * 必出同一 beats，措辞 100% 来自白名单 label 查表，不额外编造（与
 * buildReturnNarrativeAnchor 的防编造约束同源）。这里只在"两个 flag 都开 +
 * 离线 ≥30min"时算，且与 loadAndApplyRemiSelf 已经算过的 offlineReturnAnchor
 * 用的是同一个 computeReturnNarrative 输入，不会产生矛盾内容。
 */
export function selectGreetingMaterials(
  brain: RemiSessionContext,
  lastSeenAtMs: number,
  now: number,
): GreetingMaterials {
  const snapshot = brain.slowBrain.getSnapshot();

  const openThreadFromSharedMoment = snapshot.sharedMoments
    .filter((m: SharedMoment) => m.unresolved && m.summary?.trim())
    .sort((a, b) => b.turn - a.turn)[0]?.summary;
  const openThreadFromProactive = snapshot.proactiveTopics.find((t) => t?.trim());

  // REMI_OFFLINE_LIFE_ENABLED off → 素材 c 恒 null，与 loadAndApplyRemiSelf 对
  // offlineReturnAnchor 的同一 flag 门控保持一致（行为与现状逐字节一致）。
  const narrative = offlineLifeEnabled() ? computeReturnNarrative(lastSeenAtMs, now) : null;

  return {
    hookPayoff: normalizeCurrentFocus(brain.remiSelfFocus),
    openThread: normalizeCurrentFocus(openThreadFromSharedMoment ?? openThreadFromProactive ?? null),
    offlineOpener: narrative ? buildReturnNarrativeOpener(narrative) : null,
  };
}

/**
 * 组装开场语的系统指令（走同一种"括号里给 LLM 下指示"的约定，参照
 * brains/proactive_planner.ts 的 buildSilenceNudgeUserMessage）。这段文本会作为
 * runPipeline 的 userMessage，被 systemTriggered 路径当成"这一轮她要说的话"的
 * 驱动指令，而不会真的进历史（历史里落地的是占位符"［你主动开口陪对方聊天］"）。
 *
 * 素材优先级 a→b→c：有就报给 LLM 作为候选，明确要求"挑一件、别堆砌"；c 额外带
 * 白名单约束措辞，防止 LLM 借题发挥编造不在清单里的活动。全空场景理论上不会走到
 * 这里（scheduleGreetingOpener 已经在全空时放弃触发），但仍给一个安全兜底句。
 */
export function buildGreetingOpenerUserMessage(materials: GreetingMaterials): string {
  const candidates: string[] = [];
  if (materials.hookPayoff) {
    candidates.push(`（上次她自己惦记着的一件事：${materials.hookPayoff}）`);
  }
  if (materials.openThread) {
    candidates.push(`（还没聊完/一直挂心的一条线：${materials.openThread}）`);
  }
  if (materials.offlineOpener) {
    candidates.push(
      `（她这段时间在做的事，只能照这句里提到的活动讲，不要编造清单外的内容：${materials.offlineOpener}）`,
    );
  }

  const materialBlock =
    candidates.length > 0
      ? `可用素材（挑其中一件自然带出，不要堆砌、不要逐条汇报）：\n${candidates.join("\n")}`
      : "这次没有具体素材，就用一句轻松自然的问候开口即可。";

  return [
    "（系统情境：对方刚打开和你的对话，你们有一段时间没说话了，现在是你先开口。）",
    "你先开口跟他打招呼，一两句，自然随意，像他推门进来你抬头说话那样。",
    materialBlock,
    "别写成汇报式列举，别一次问超过一个问题，别用书面语开场白，就当是你正好在这时候抬头看见他。",
  ].join("\n");
}

// ── 任务 A：触发编排 ───────────────────────────────────────────────────

/**
 * bootstrap 完成后调用一次。等待 remiSelfLoaded（loadAndApplyRemiSelf 的返回
 * promise）结束后再判定条件，避免"RemiSelf 还没加载完就已经算出 lastSeenAtMs
 * 缺失"的假阴性——调用方按现状 fire-and-forget 触发 loadAndApplyRemiSelf 不变，
 * 这里只是多等它一次，不重复调用、不重复副作用。
 *
 * 判定顺序（任一不满足即放弃，不重试、不排队）：
 *  1) flag on；
 *  2) 本会话尚未发过开场语；
 *  3) NSFW 模式未开启（参照 offlineReturnAnchor 的跳过模式）；
 *  4) 有 lastSeenAtMs 记录，且距今 >30 分钟；
 *  5) 素材非全空（全空场景没有可讲的东西，宁可不说话）；
 *  6) 延迟 GREETING_DELAY_MS 后再次确认：最近 5 分钟内用户没有已发消息
 *     （给前端就绪留时间的同时，天然充当"别和用户抢话"的二次校验点）。
 *
 * 命中后走与 silence nudge 完全相同的生成+推送机制：串进 pipelineChain，
 * RunPipelineOptions.silenceNudge:true（systemTriggered 语义），trace source
 * 复用 "silence_nudge"。
 *
 * delayMs：仅供测试注入更短的延迟，覆盖默认的 GREETING_DELAY_MS；生产调用方
 * 一律不传，走真实的 2.5s。
 */
export async function scheduleGreetingOpener(
  runtime: SessionContinuityRuntime,
  remiSelfLoaded: Promise<void>,
  delayMs: number = GREETING_DELAY_MS,
): Promise<void> {
  if (!greetingOpenerEnabled()) return;

  const state = getState(runtime.connId);
  if (state.sent) return;

  try {
    await remiSelfLoaded;
  } catch {
    // loadAndApplyRemiSelf 自身已经吞掉失败并 warn，这里再等一次纯粹是时序
    // 保证，不需要重复记录。
  }

  if (isNsfwEnabled(runtime.connId)) return;

  const lastSeenAtMs = state.lastSeenAtMs;
  if (lastSeenAtMs === null) return; // 无 RemiSelf 记录 / flag off → 不触发

  const nowAtCheck = Date.now();
  if (nowAtCheck - lastSeenAtMs < MIN_OFFLINE_MS_FOR_GREETING) return;

  const materials = selectGreetingMaterials(runtime.brain, lastSeenAtMs, nowAtCheck);
  if (!materials.hookPayoff && !materials.openThread && !materials.offlineOpener) {
    logger.debug("[开场] 无可用素材，放弃触发", { connId: runtime.connId });
    return;
  }

  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));

  // 二次校验：延迟期间用户可能已经开口，或会话已经被销毁重置。
  if (state.sent) return;
  if (isNsfwEnabled(runtime.connId)) return;
  const lastInteractionAt = runtime.getLastInteractionAt();
  if (lastInteractionAt > 0 && Date.now() - lastInteractionAt < RECENT_USER_MESSAGE_GUARD_MS) {
    logger.debug("[开场] 用户近期已发消息，放弃触发", { connId: runtime.connId });
    return;
  }

  // 跨通道去重：同一用户可能同时开着 WS（桌面/iOS）和 SSE（网页），两条通道各
  // 自的 per-connId 状态互不相干，任其独立判定会各发一条。这里在真正提交发送
  // 前抢一个按 userId+30min 窗口隔离的名额，抢不到就放弃——但本 connId 仍然
  // 标记 sent，避免它反复重试（见下方注释）。
  state.sent = true; // 先占位再排队，杜绝并发窗口下重复触发（含跨通道判定本身）。
  if (!tryClaimCrossChannelGreetingSlot(runtime.brain.userId)) {
    logger.debug("[开场] 其他通道近期已代为开口，跨通道去重放弃", {
      connId: runtime.connId,
      userId: runtime.brain.userId,
    });
    return;
  }

  const userMessage = buildGreetingOpenerUserMessage(materials);
  const generationId = runtime.nextGenerationId();
  const traceId = runtime.createTraceId("silence_nudge", generationId);
  runtime.bindActiveGeneration(generationId, traceId, "silence_nudge");

  logger.info("[开场] 主动打招呼", {
    connId: runtime.connId,
    hasHookPayoff: Boolean(materials.hookPayoff),
    hasOpenThread: Boolean(materials.openThread),
    hasOfflineOpener: Boolean(materials.offlineOpener),
  });

  const nextChain = runtime
    .getPipelineChain()
    .then(() =>
      runPipeline(
        runtime.sink,
        userMessage,
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
      ),
    )
    .catch((err) => {
      logger.warn("[开场] 主动打招呼失败", {
        error: (err as Error).message,
        connId: runtime.connId,
      });
    });

  runtime.setPipelineChain(nextChain);
}
