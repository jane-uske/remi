// ── DL-P1b RemiSelf 最小持久化 + 离线演进 ────────────────────────────
// RemiSelf 是 Remi 的持续性自我主体：跨所有会话 / 设备保持同一规范状态，无客户
// 端连接时按已离线时长以确定性时间推断继续演进（零 LLM token）。设计契约见
// docs/design/DIGITAL_LIFE_NORTH_STAR.md §1 与 server/session/types/remi_self.ts。
//
// 【本期落地差异 —— 刻意与现状 PersonaLiveState 同构，不升级到契约理想形态】
//  - mood：保持 string 标签（平静 / 开心 / 委屈 / 好奇 / 低落），不升级为
//    valence/arousal 向量。
//  - energy：保持 EnergyLevel string（low / medium / high），不改 0–1 数。
//  - topicPull：保持单个 string（PersonaLiveState 现状即 string）。
//  - currentFocus：PersonaLiveState 没有此字段；写回时从慢脑派生（最显著的未完
//    线 / proactive topic / lastTopicSummary），没有就 null。
//  - worldPresence：本期不做（DL-P2）。
//
// 持久记录 = 每用户单份 { mood, energy, currentFocus, topicPull, lastSeenAt,
// lastSavedAt }。

import type { EnergyLevel } from "../persona";

/**
 * 持久化的 RemiSelf 最小记录（每用户单份）。字段刻意与 PersonaLiveState 同构。
 */
export interface RemiSelfRecord {
  /** 心情：string 标签（平静 / 开心 / 委屈 / 好奇 / 低落 / neutral …）。 */
  mood: string;
  /** 精力：low / medium / high。 */
  energy: EnergyLevel;
  /** 正在惦记 / 挂念的事（从慢脑派生，截断封顶）；无则 null。 */
  currentFocus: string | null;
  /** 当前最想延续的话题（单个 string，空串=无明确牵引）。 */
  topicPull: string;
  /** 上次有客户端连接 / 互动的时刻。 */
  lastSeenAt: Date;
  /** 上次持久化到 DB 的时刻。 */
  lastSavedAt: Date;
}

/** 中性心情标签 —— 与 PersonaLiveState 默认 / 离线收敛目标一致。 */
export const NEUTRAL_MOOD = "平静";

/** currentFocus 写回时的硬封顶，避免把整段摘要塞进 prompt。 */
export const MAX_CURRENT_FOCUS_CHARS = 80;

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;

const THRESHOLD_30_MIN = 30 * MS_PER_MINUTE;
const THRESHOLD_4_HOURS = 4 * MS_PER_HOUR;
const THRESHOLD_24_HOURS = 24 * MS_PER_HOUR;

/** energy 向上回一档（low → medium → high；high 封顶）。 */
function energyUpOneStep(energy: EnergyLevel): EnergyLevel {
  if (energy === "low") return "medium";
  return "high";
}

/**
 * 离线漂移（纯函数，零 LLM、确定性）。基于 `now - saved.lastSeenAt` 分四档，
 * 对应 DIGITAL_LIFE_NORTH_STAR §1 的离线漂移表（已按本期落地差异降维）：
 *
 *  - <30min：原样保持。
 *  - 30min–4h：energy 向上回一档（low→medium），mood / topicPull / currentFocus 保留。
 *  - 4–24h：mood 收敛到中性「平静」，energy → medium/high（向上一档），
 *            topicPull 保留，currentFocus 保留。
 *  - >24h：mood「平静」，energy → high，topicPull 清空（volatile），
 *           currentFocus 保留。
 *
 * 【对 §1 的偏差，刻意记录】§1 的 >24h 档是「仅保留高强度话题」，但本期没有
 * 强度字段，无法判定单个 topicPull 是否「高强度」，故 >24h 直接清空 topicPull；
 * currentFocus 则**刻意保留**（"还记着上次"是本特性的卖点）。
 *
 * 返回一份新记录（不原地修改入参）。lastSavedAt 透传不变（漂移不算一次保存）。
 */
export function driftRemiSelf(saved: RemiSelfRecord, now: Date): RemiSelfRecord {
  const elapsedMs = now.getTime() - saved.lastSeenAt.getTime();

  // 时钟回拨 / 未来时间戳 → 当作「刚刚」，原样保持。
  if (elapsedMs < THRESHOLD_30_MIN) {
    return { ...saved };
  }

  if (elapsedMs < THRESHOLD_4_HOURS) {
    // 30min–4h：energy 回一档，其余保留。
    return {
      ...saved,
      energy: energyUpOneStep(saved.energy),
    };
  }

  if (elapsedMs < THRESHOLD_24_HOURS) {
    // 4–24h：mood 收敛到中性，energy 回一档，topicPull / currentFocus 保留。
    return {
      ...saved,
      mood: NEUTRAL_MOOD,
      energy: energyUpOneStep(saved.energy),
    };
  }

  // >24h：mood 中性，energy 满，topicPull 清空，currentFocus 保留。
  return {
    ...saved,
    mood: NEUTRAL_MOOD,
    energy: "high",
    topicPull: "",
  };
}

/** 把派生出的 currentFocus 文本规范化（trim + 截断），空 → null。 */
export function normalizeCurrentFocus(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_CURRENT_FOCUS_CHARS);
}
