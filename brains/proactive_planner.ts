import { listUnresolved } from "../memory/episode_store";
import type { DbEpisode } from "../storage/repositories/episode_repository";
import type { SlowBrainSnapshot } from "./slow_brain_store";

export type ProactiveMode = "care" | "follow_up" | "presence";

export interface ProactivePlan {
  mode: ProactiveMode;
  text: string;
  episodeId?: string;
  ledgerKey: string;
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

  return `（系统情境：对方有一段时间没发消息了。请你作为 Rem，用一两句自然、温柔的中文主动开口，像在陪在身边一样；${toneDirective}${topicHint}不要一次问太多问题，不要显得像在催对方回复。）`;
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

  const unresolvedEpisodes = (await listUnresolved(userId)).slice(0, MAX_UNRESOLVED_EPISODES);
  const availableEpisode = unresolvedEpisodes.find(
    (episode) => !isLedgerKeyCooling(episodeLedgerKey(episode), snapshot.proactiveLedger),
  );

  if (availableEpisode) {
    const mode = pickModeForEpisode(availableEpisode);
    return {
      mode,
      text: mode === "care" ? composeCare(availableEpisode) : composeFollowUp(availableEpisode),
      episodeId: availableEpisode.id,
      ledgerKey: episodeLedgerKey(availableEpisode),
    };
  }

  return {
    mode: "presence",
    text: composePresence(),
    ledgerKey: PRESENCE_LEDGER_KEY,
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

function pickModeForEpisode(episode: DbEpisode): ProactiveMode {
  return isNegativeMood(episode.mood) ? "care" : "follow_up";
}

function composeFollowUp(episode: DbEpisode): string {
  return `上次聊到「${episode.title}」还没说完，可以自然地接回这个话题。`;
}

function composeCare(episode: DbEpisode): string {
  return `上次提到${episode.title}的事情，可以温和地问问最近怎么样了。`;
}

function composePresence(): string {
  return "好久没聊了，可以随意打个招呼或聊聊最近的事。";
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
