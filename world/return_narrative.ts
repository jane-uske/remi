// ── 离线居家人生 P0 —— 归来叙事纯函数（零 LLM、确定性、可测）────────────
//
// 北极星：Remi 是持续存在的主体。她离线时在过自己的日子（RemiWorld 的确定性居家
// 日程：看书/看海/打理花/听音乐/发呆），回来时像真人打电话一样讲这两小时干了啥。
//
// 防编造是本特性的核心：项目刚踩过 BC-002（编造"视频快跑完了"）。这里的洞察是
// ——居家行为日程是【纯确定性函数】（scheduledBehaviorAt(t, weatherAt(t)) 同一时刻
// 必出同一行为）。所以"她离线这两小时干了啥"可以在归来时用 [lastSeen, now] 窗口
// 确定性算出来——LLM 只负责"讲"，不负责"编"，前后永不矛盾。beat 措辞 100% 来自
// BEHAVIOR_SPOTS.label 查表，anchor 是封闭白名单。
//
// 纯函数、零 IO、零 LLM、µs 级；安全塞进 fire-and-forget 的 loadAndApplyRemiSelf。

import {
  scheduledBehaviorAt,
  spotOf,
  type BehaviorId,
} from "./schedule";
import { weatherAt } from "./weather";
import { worldTimeProfileAt, type WorldTimePhase } from "./worldTime";

/** 不到这个时长不构成"她过了一段日子"——避免刚切走又回来就硬讲。 */
const MIN_ELAPSED_MS = 30 * 60_000;

/** 采样点上限（不含强制纳入的首尾两点）。2h≈68 个 105s slot，12 点足够覆盖换行为。 */
const MAX_INTERIOR_SAMPLES = 12;

/** 最终保留的 beat 数上限——克制优先，别像念清单。 */
const MAX_BEATS = 3;

/** 一段连续做同一件事的经历。措辞（label）100% 来自确定性查表。 */
export interface ReturnBeat {
  behaviorId: BehaviorId;
  /** 中文措辞，如"在窗边看海"——直接来自 BEHAVIOR_SPOTS.label。 */
  label: string;
  /** 这段大约持续多少分钟（四舍五入，至少 1）。 */
  approxMinutes: number;
}

export interface ReturnNarrative {
  /** 离线总时长（分钟，向下取整）。 */
  elapsedMinutes: number;
  /** 归来时刻所处的世界时段（不是离线期间——别讲成时间旅行）。 */
  phase: WorldTimePhase;
  /** 归来时刻世界时段的短标签（清晨/午后/黄昏/深夜）。 */
  phaseLabel: string;
  /** 归来时刻的天气短标签（晴/多云/小雨/雪）。 */
  weatherLabel: string;
  /** 按时长降序的 ≤3 段经历。 */
  beats: ReturnBeat[];
}

interface BehaviorRun {
  behaviorId: BehaviorId;
  startMs: number;
  endMs: number;
}

/**
 * 在 [lastSeen, now] 窗口里确定性复算 Remi 离线期间的居家经历。
 *
 * - elapsed < 30min 或 now < lastSeen（时钟回拨）→ null（不构成一段日子 / 数据异常）。
 * - 否则：在窗口内均匀采样（cap ~12）+ 强制纳入首尾两点，每点算
 *   scheduledBehaviorAt(t, weatherAt(t))；连续相同 behaviorId 合并成 run；
 *   按时长降序取 ≤3 个 beat。
 * - phase / weather 取【now】（归来时刻），不取离线期间——她讲的是"现在这里是黄昏了"。
 *
 * 同一 (lastSeenAtMs, nowMs) 必出同一结果（确定性、可复现）。
 */
export function computeReturnNarrative(
  lastSeenAtMs: number,
  nowMs: number,
): ReturnNarrative | null {
  if (!Number.isFinite(lastSeenAtMs) || !Number.isFinite(nowMs)) return null;
  const elapsedMs = nowMs - lastSeenAtMs;
  if (elapsedMs < MIN_ELAPSED_MS) return null; // <30min 或时钟回拨（含 elapsed<0）

  // 采样时间点：首尾强制纳入 + 内部均匀采样（去重排序）。
  const sampleTimes = buildSampleTimes(lastSeenAtMs, nowMs);

  // 每点确定性查行为，合并连续相同 behaviorId 为 run。
  const runs: BehaviorRun[] = [];
  for (let i = 0; i < sampleTimes.length; i++) {
    const t = sampleTimes[i];
    const behaviorId = scheduledBehaviorAt(t, weatherAt(t));
    const last = runs[runs.length - 1];
    if (last && last.behaviorId === behaviorId) {
      last.endMs = t;
    } else {
      runs.push({ behaviorId, startMs: t, endMs: t });
    }
  }

  // run → beat：时长 = endMs-startMs（单点 run 用相邻采样间隔兜底，保证 ≥1 分钟）。
  const sampleGapMs =
    sampleTimes.length > 1
      ? (nowMs - lastSeenAtMs) / (sampleTimes.length - 1)
      : elapsedMs;
  const beats: ReturnBeat[] = runs.map((run) => {
    const spanMs = Math.max(run.endMs - run.startMs, sampleGapMs);
    return {
      behaviorId: run.behaviorId,
      label: spotOf(run.behaviorId).label,
      approxMinutes: Math.max(1, Math.round(spanMs / 60_000)),
    };
  });

  // 按时长降序，取前 MAX_BEATS（同时长按原始出现顺序稳定保留）。
  beats.sort((a, b) => b.approxMinutes - a.approxMinutes);
  const topBeats = beats.slice(0, MAX_BEATS);

  const nowProfile = worldTimeProfileAt(nowMs);

  return {
    elapsedMinutes: Math.floor(elapsedMs / 60_000),
    phase: nowProfile.phase,
    phaseLabel: nowProfile.label,
    weatherLabel: weatherAt(nowMs).label,
    beats: topBeats,
  };
}

/** 首尾强制纳入 + 内部均匀采样，去重升序。 */
function buildSampleTimes(lastSeenAtMs: number, nowMs: number): number[] {
  const set = new Set<number>([lastSeenAtMs, nowMs]);
  const span = nowMs - lastSeenAtMs;
  for (let i = 1; i <= MAX_INTERIOR_SAMPLES; i++) {
    const t = lastSeenAtMs + Math.round((span * i) / (MAX_INTERIOR_SAMPLES + 1));
    set.add(t);
  }
  return Array.from(set).sort((a, b) => a - b);
}

/** 人话化离线时长（用于 anchor / opener 的"离开了多久"）。 */
function describeElapsed(elapsedMinutes: number): string {
  if (elapsedMinutes < 60) return `大约 ${elapsedMinutes} 分钟`;
  const hours = Math.floor(elapsedMinutes / 60);
  if (hours < 24) return `大约 ${hours} 个小时`;
  const days = Math.max(1, Math.floor(hours / 24));
  return `大约 ${days} 天`;
}

/**
 * 被动注入的【事实锚】。reply brain 不持有这段经历的真相，过去只能脑补，于是会编
 * 造"出门见了人/做了日志里没有的事"。这里照 describeActiveVideoTask 的语气，给它一
 * 段确定的事实 + 封闭白名单，堵住凭空捏造。
 *
 * P1→主动许可（2026-07）：原措辞要求"用户先开口提到"才允许讲，等于把主动权完全
 * 交给用户——用户不问，这段离线经历永远不会出现，白建了一套确定性日程也是摆设。
 * 现在改成主动许可：开场或话题自然停顿时可以主动提，像人放下手里的事抬头说话，
 * 不需要用户先问。白名单 / 时间天气一致性 / 防编造反例这几条硬约束原样保留——
 * 变的只是"要不要等用户开口"，不是"能讲什么"。
 *
 * 文案要点（与 describeActiveVideoTask 同构）：
 * ① 明示"这是确定性日程算出的真实经历，不是让你发挥"；
 * ② 白名单：只给 ≤3 个中文 label + "只能讲这些"；
 * ③ 主动许可：开场/停顿时可主动提一句，用户追问再多讲一点；
 * ④ 黑名单反例："别说出门了/见了别人/做了日志里没有的事/别说前后矛盾的时间"；
 * ⑤ 风格："自然讲，别像念清单"。
 */
export function buildReturnNarrativeAnchor(n: ReturnNarrative): string {
  const elapsed = describeElapsed(n.elapsedMinutes);
  // 白名单是【去重后】的 label 集合（她可能在窗口里多次回到同一件事，但清单只需列
  // 一次该活动）。保序去重，保证白名单干净、不重复念同一个。
  const labels = Array.from(new Set(n.beats.map((b) => b.label)));
  const labelList = labels.map((l) => `「${l}」`).join("、");
  return [
    "【离线经历·事实锚】",
    `这段你不在的时间（${elapsed}），是按你们小世界的确定性居家日程算出来的真实经历，不是让你发挥编造。`,
    `期间你只做过这些事：${labelList}。开场或话题自然停顿时，你可以主动随口提一句这段时间里的其中一件事（比如刚才在做什么），像人放下手里的事抬头说话那样，不必等用户先问；用户追问就多讲一点——但只能讲这些，不要添加任何不在清单里的活动。`,
    "这些活动涉及的物件细节（比如具体在看哪本书、打理的是哪些花），以你人设里的 canon 事实为准，不要另外编。",
    "现在这里已经是" + n.phaseLabel + "了，天气是" + n.weatherLabel + "。讲的时候按现在的时间/天气说，别讲成你穿越回了离线那会儿。",
    "绝不要说你出门了 / 见了别人 / 做了上面清单里没有的事 / 说出前后矛盾的时间。自然地讲，像随口提一句，别像念清单。",
  ].join("\n");
}

/**
 * P2 主动开口的开场白（本次只写函数，不接线）。她回来后主动起的一句话，自然带出
 * 离线经历的第一个 beat。措辞同样只来自确定性查表。
 */
export function buildReturnNarrativeOpener(n: ReturnNarrative): string {
  const elapsed = describeElapsed(n.elapsedMinutes);
  if (n.beats.length === 0) {
    return `你回来啦～你不在的${elapsed}里，这边已经到${n.phaseLabel}了。`;
  }
  const lead = n.beats[0].label;
  return `你回来啦～你不在的${elapsed}里我${lead}，这会儿已经${n.phaseLabel}了。`;
}
