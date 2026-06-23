// ── M3-P3a: 主动搭话仲裁门控 ────────────────────────────────────────
// 把散落在 proactive_planner / background_analysis_store 中的门控逻辑
// 提取成统一接口，新增安静时段 + 会话后冷却两个规则。
//
// 克制优先：宁可不说，不要烦人。

import { createLogger } from "../infra/logger";

const logger = createLogger("arbitration_gate");

// ── Types ──

export interface InitiationCandidate {
  id: string;
  source: string;        // "silence_nudge" | "follow_up" | "care" | "presence" | "prospective"
  text: string;
  urgency: number;       // 0-1, higher = more important
  episodeId?: string;
  ledgerKey?: string;
}

export interface UserOutreachState {
  lastOutreachAt: number | null;       // epoch ms
  ignoredStreak: number;
  retreatLevel: number;                // 0-5, exponential backoff
  cooldownUntilAt: number;             // epoch ms
  lastConversationEndedAt: number | null;
  familiarityScore: number;            // 0-1
}

export interface ArbitrationConfig {
  quietHoursStart: number;  // 0-23, e.g. 23
  quietHoursEnd: number;    // 0-23, e.g. 7
  postConversationCooldownMs: number;  // e.g. 5 * 60 * 1000 (5 min)
  minFamiliarity: number;   // e.g. 0.15
  maxRetreatLevel: number;  // e.g. 3
}

export interface ArbitrationResult {
  decision: "send" | "hold";
  chosen?: InitiationCandidate;
  reason: string;
}

// ── Default config ──

export const DEFAULT_ARBITRATION_CONFIG: ArbitrationConfig = {
  quietHoursStart: 23,
  quietHoursEnd: 7,
  postConversationCooldownMs: 5 * 60 * 1000,
  minFamiliarity: 0.15,
  maxRetreatLevel: 3,
};

// ── Gate ──

export function arbitrate(
  candidates: InitiationCandidate[],
  state: UserOutreachState,
  now: Date,
  userTimezone: string | null,
  config: ArbitrationConfig = DEFAULT_ARBITRATION_CONFIG,
): ArbitrationResult {
  // Gate 1: no candidates
  if (candidates.length === 0) {
    return { decision: "hold", reason: "no_candidates" };
  }

  // Gate 2: familiarity threshold
  if (state.familiarityScore < config.minFamiliarity) {
    return { decision: "hold", reason: "familiarity_too_low" };
  }

  // Gate 3: retreat level (exponential backoff on ignores)
  if (state.retreatLevel >= config.maxRetreatLevel) {
    return { decision: "hold", reason: "retreat_level_exceeded" };
  }

  // Gate 4: active cooldown
  if (state.cooldownUntilAt > now.getTime()) {
    return { decision: "hold", reason: "cooldown_active" };
  }

  // Gate 5: quiet hours (NEW)
  if (isQuietHours(now, userTimezone, config)) {
    return { decision: "hold", reason: "quiet_hours" };
  }

  // Gate 6: post-conversation cooldown (NEW)
  if (state.lastConversationEndedAt) {
    const elapsed = now.getTime() - state.lastConversationEndedAt;
    if (elapsed < config.postConversationCooldownMs) {
      return { decision: "hold", reason: "post_conversation_cooldown" };
    }
  }

  // All gates passed — pick best candidate by urgency
  const sorted = [...candidates].sort((a, b) => b.urgency - a.urgency);
  const chosen = sorted[0];

  logger.debug("arbitration: send", {
    candidateCount: candidates.length,
    chosenSource: chosen.source,
    urgency: chosen.urgency,
  });

  return { decision: "send", chosen, reason: "gates_passed" };
}

// ── Helpers ──

function isQuietHours(
  now: Date,
  userTimezone: string | null,
  config: ArbitrationConfig,
): boolean {
  let hour: number;
  try {
    if (userTimezone) {
      const formatted = new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        hour12: false,
        timeZone: userTimezone,
      }).format(now);
      hour = parseInt(formatted, 10);
    } else {
      hour = now.getHours();
    }
  } catch {
    hour = now.getHours();
  }

  const { quietHoursStart, quietHoursEnd } = config;
  if (quietHoursStart <= quietHoursEnd) {
    // e.g. 1:00 - 6:00
    return hour >= quietHoursStart && hour < quietHoursEnd;
  }
  // e.g. 23:00 - 7:00 (wraps midnight)
  return hour >= quietHoursStart || hour < quietHoursEnd;
}
