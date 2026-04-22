import { listUnresolved } from "../memory/episode_store";
import type { DbEpisode } from "../storage/repositories/episode_repository";
import type { RelationalStanceMode } from "../persona";
import type { SlowBrainSnapshot } from "./slow_brain_store";
import { deriveRelationalStance } from "./relational_stance";

export type ProactiveMode = "care" | "follow_up" | "presence";
export type ProactiveValueLevel = "low" | "medium" | "high";

export interface ProactivePlan {
  mode: ProactiveMode;
  text: string;
  episodeId?: string;
  ledgerKey: string;
  stanceMode?: RelationalStanceMode;
  whyNow: string;
  relationalValue: ProactiveValueLevel;
  intrusionRisk: ProactiveValueLevel;
}

export function buildSilenceNudgeUserMessage(plan: ProactivePlan): string {
  const toneDirective =
    plan.mode === "care"
      ? "这次主动开口更像轻轻回访一条还没过去的线，先确认近况，再决定要不要多问一句；"
      : plan.mode === "follow_up"
        ? "这次主动开口更像自然续上最近那条未完的话题，别太正式，也不要连续追问；"
        : "这次主动开口更像一句低打扰的在场问候，不回捞太多旧内容；";
  const topicHint =
    plan.mode === "presence"
      ? "不必硬找旧话题，一句轻一点的问候或分享小事也可以。"
      : `如果自然，就从这个方向轻轻开口：${plan.text}。`;
  const stanceHint =
    plan.stanceMode === "light_presence"
      ? "关系边界先放轻一点，不要像已经很熟那样贴近。"
      : plan.stanceMode === "anchored_care"
        ? "允许更明确地安抚和落点，但不要变成连续确认或说教。"
        : plan.stanceMode === "close_warmth"
          ? "像熟悉的人顺手接上生活线，口气可以更自然一点。"
          : "整体保持稳定陪伴感，先接住，再轻轻推进。";
  const riskHint =
    plan.intrusionRisk === "high"
      ? "这次打扰风险偏高，宁可更轻、更短，也不要像提醒器。"
      : plan.intrusionRisk === "medium"
        ? "控制打扰感，别像在催，也别一上来就把旧话题拉满。"
        : "打扰风险较低，但仍然只开一个小口。";
  const timingHint = `现在主动的原因：${plan.whyNow}。`;

  return `（系统情境：对方有一段时间没发消息了。请你作为 Remi，用一两句自然、温柔的中文主动开口，像在陪在身边一样；${toneDirective}${stanceHint}${riskHint}${timingHint}${topicHint}不要一次问太多问题，不要显得像在催对方回复。）`;
}

const MAX_UNRESOLVED_EPISODES = 5;
const PRESENCE_LEDGER_KEY = "presence:general";
const NEGATIVE_MOODS = new Set([
  "sad",
  "down",
  "upset",
  "anxious",
  "anxiety",
  "stressed",
  "stress",
  "tired",
  "exhausted",
  "burned_out",
  "burnout",
  "frustrated",
  "annoyed",
  "worried",
  "overwhelmed",
  "lonely",
  "insomnia",
  "sleepless",
  "烦",
  "累",
  "难过",
  "焦虑",
  "失眠",
]);

export async function planProactiveNudge(
  userId: string,
  snapshot: SlowBrainSnapshot,
): Promise<ProactivePlan | null> {
  if (!shouldNudge(snapshot)) {
    return null;
  }

  const stance = deriveRelationalStance(snapshot);
  const unresolvedEpisodes = (await listUnresolved(userId)).slice(0, MAX_UNRESOLVED_EPISODES);
  const availableEpisode = unresolvedEpisodes.find(
    (episode) => !isLedgerKeyCooling(episodeLedgerKey(episode), snapshot.proactiveLedger),
  );

  if (availableEpisode) {
    const mode = pickModeForEpisode(availableEpisode, snapshot, stance);
    const metadata = buildPlanMetadata(mode, snapshot, stance, availableEpisode);
    return {
      mode,
      text: composeNudgeText(availableEpisode, mode, stance.mode),
      episodeId: availableEpisode.id,
      ledgerKey: episodeLedgerKey(availableEpisode),
      stanceMode: stance.mode,
      whyNow: metadata.whyNow,
      relationalValue: metadata.relationalValue,
      intrusionRisk: metadata.intrusionRisk,
    };
  }

  if (stance.proactiveCadence === "low") {
    return null;
  }

  const metadata = buildPlanMetadata("presence", snapshot, stance);
  return {
    mode: "presence",
    text: composePresence(undefined, stance.mode),
    ledgerKey: PRESENCE_LEDGER_KEY,
    stanceMode: stance.mode,
    whyNow: metadata.whyNow,
    relationalValue: metadata.relationalValue,
    intrusionRisk: metadata.intrusionRisk,
  };
}

function shouldNudge(snapshot: SlowBrainSnapshot): boolean {
  const { relationship, proactiveStrategyState } = snapshot;
  if (!relationship || !proactiveStrategyState) return false;

  if (relationship.familiarity < 0.15) return false;
  if ((proactiveStrategyState.retreatLevel ?? 0) >= 3) return false;
  if ((proactiveStrategyState.cooldownUntilAt ?? 0) > Date.now()) return false;

  return true;
}

function pickModeForEpisode(
  episode: DbEpisode,
  snapshot: SlowBrainSnapshot,
  stance: ReturnType<typeof deriveRelationalStance>,
): ProactiveMode {
  if (hasTrustFriction(snapshot)) {
    return "presence";
  }
  const retreatLevel = snapshot.proactiveStrategyState?.retreatLevel ?? 0;
  if (isNegativeMood(episode.mood)) {
    if (stance.mode === "light_presence" || retreatLevel >= 2) {
      return "presence";
    }
    return "care";
  }
  if (stance.proactiveCadence === "low") {
    return "presence";
  }
  return "follow_up";
}

function composeNudgeText(
  episode: DbEpisode,
  mode: ProactiveMode,
  stanceMode: RelationalStanceMode,
): string {
  if (mode === "care") return composeCare(episode, stanceMode);
  if (mode === "follow_up") return composeFollowUp(episode, stanceMode);
  return composePresence(episode, stanceMode);
}

function composeFollowUp(
  episode: DbEpisode,
  stanceMode: RelationalStanceMode,
): string {
  if (stanceMode === "close_warmth") {
    return `还记着你前阵子那条「${episode.title}」，如果你想说，可以顺手接一下后来怎么样了。`;
  }
  if (stanceMode === "light_presence") {
    return `前阵子提到过「${episode.title}」，如果你愿意，我们也可以轻轻接一下近况。`;
  }
  return `上次聊到「${episode.title}」还没说完，可以自然地接回这个话题。`;
}

function composeCare(
  episode: DbEpisode,
  stanceMode: RelationalStanceMode,
): string {
  if (stanceMode === "anchored_care") {
    return `还记着你前阵子提过${episode.title}这条线，可以更明确地温和问问这两天有没有好一点。`;
  }
  return `上次提到${episode.title}的事情，可以温和地问问最近怎么样了。`;
}

function composePresence(
  episode?: DbEpisode,
  stanceMode?: RelationalStanceMode,
): string {
  if (episode && stanceMode === "light_presence") {
    return `前阵子那条「${episode.title}」我还记得着，如果你今天想说，我们就慢慢接上。`;
  }
  if (stanceMode === "close_warmth") {
    return "路过来打个招呼也行，聊聊今天的小事就好。";
  }
  return "好久没聊了，可以随意打个招呼或聊聊最近的事。";
}

function buildPlanMetadata(
  mode: ProactiveMode,
  snapshot: SlowBrainSnapshot,
  stance: ReturnType<typeof deriveRelationalStance>,
  episode?: DbEpisode,
): {
  whyNow: string;
  relationalValue: ProactiveValueLevel;
  intrusionRisk: ProactiveValueLevel;
} {
  const retreatLevel = snapshot.proactiveStrategyState?.retreatLevel ?? 0;
  const recentNegativeMood = snapshot.moodTrajectory
    .slice(-3)
    .some((entry) => isNegativeMood(entry.mood));
  const unresolvedEpisode = Boolean(episode?.unresolved);
  const trustFriction = hasTrustFriction(snapshot);

  const relationalValue: ProactiveValueLevel =
    mode === "care"
      ? "high"
      : mode === "follow_up"
        ? "medium"
        : unresolvedEpisode
          ? "medium"
          : "low";

  let intrusionRisk: ProactiveValueLevel =
    stance.mode === "light_presence" || retreatLevel >= 2
      ? "high"
      : stance.proactiveCadence === "guarded"
        ? "medium"
        : "low";
  if (trustFriction) {
    intrusionRisk = "high";
  }
  if (mode === "presence" && !episode && intrusionRisk === "low") {
    intrusionRisk = "medium";
  }

  let whyNow = "现在更适合低打扰地确认一下近况";
  if (episode && unresolvedEpisode && trustFriction) {
    whyNow = `这条「${episode.title}」还没收口，但现在更适合低打扰地留个口，不要像没事一样把旧线拉重`;
  } else if (episode && unresolvedEpisode) {
    whyNow =
      mode === "care"
        ? `这条「${episode.title}」还没过去，而且最近情绪仍偏沉，值得轻轻接一下`
        : `这条「${episode.title}」还没收口，现在适合低打扰地续一下`;
  } else if (trustFriction) {
    whyNow = "这会儿关系还在回稳，只适合很轻地留个口，不适合把话题拉重";
  } else if (recentNegativeMood) {
    whyNow = "最近整体情绪偏沉，但没有明确未完主线，只适合很轻地在场一下";
  }

  return {
    whyNow,
    relationalValue,
    intrusionRisk,
  };
}

function hasTrustFriction(snapshot: SlowBrainSnapshot): boolean {
  const level = snapshot.repairState?.level;
  return level === "trust_drop" || level === "rupture";
}

function episodeLedgerKey(episode: DbEpisode): string {
  return `episode:${episode.id}`;
}

function isLedgerKeyCooling(
  key: string,
  ledger: SlowBrainSnapshot["proactiveLedger"],
): boolean {
  const now = Date.now();
  return (ledger ?? []).some((entry) => entry.key === key && entry.nextEligibleAt > now);
}

function isNegativeMood(mood: string): boolean {
  const normalized = mood.trim().toLowerCase();
  return NEGATIVE_MOODS.has(normalized);
}
