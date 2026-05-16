import type {
  Episode,
  ProactiveMode,
  SharedMoment,
  SlowBrainSnapshot,
  TopicThread,
} from "./background_analysis_store";
import {
  buildToneContract,
  detectAnswerNowSignal,
  detectDecisionSeekingSignal,
} from "../brain/tone_policy";
import type { TurnAnalysisBundle } from "../brain/turn_interpreter";
import { sanitizeMemoryEvidenceText } from "../memory/prompt_memory_support";
import {
  deriveTopicSignalsFromSharedMoments,
  extractKeywords,
  getCurrentOpenTopicSignal,
  getLongHorizonTopicSignal,
  keywordOverlapCount,
  normalizeText,
  proactiveCooldownTurns,
  proactiveLedgerEnabled,
  proactivePromptEnabled,
  realtimeContinuityHintEnabled,
  relationshipStyleGuidanceEnabled,
  resolveRelationshipStage,
  sharedMomentCooldownTurns,
  type DerivedTopicSignal,
  type RelationshipStage,
} from "./slow_brain_store_support";

export function buildRelationshipStyleGuidance(
  snap: SlowBrainSnapshot,
  userMessage: string,
): string | null {
  if (!relationshipStyleGuidanceEnabled()) return null;
  const profile = resolveRelationshipStyleProfile(snap, userMessage);
  return `【关系表达风格】当前更像${profile.stage}；${profile.openingStyle}；${profile.followUpStyle}；${profile.wordingStyle}；${profile.closingStyle}。`;
}

export function buildRelationshipStyleContract(snap: SlowBrainSnapshot): string | null {
  const topThread = getLongHorizonTopicSignal(snap);
  const profile = resolveRelationshipStyleProfile(snap, "");
  const threadHint = topThread
    ? `当前长期主线优先围绕：${topThread.topic}${topThread.unresolvedCount > 0 ? "（这条线还没完全过去）" : ""}。`
    : "";
  return `【关系风格合同】按${profile.stage}来：${profile.openingStyle}；${profile.followUpStyle}；${profile.wordingStyle}。${threadHint}`;
}

export function buildRelationshipResponseShapeGuidance(
  snap: SlowBrainSnapshot,
  userMessage: string,
): string | null {
  const trimmed = userMessage.trim();
  if (!trimmed) return null;
  if (detectAnswerNowSignal(trimmed)) {
    return "【本轮回复合同】用户已经明确嫌你别老反问，第一句直接说你的判断或建议；第二句补最关键的一条依据；禁止第一句用反问句，禁止把回答再抛回给用户。";
  }
  if (detectDecisionSeekingSignal(trimmed)) {
    return "【本轮回复合同】这是决策型问题。第一句先明确给出你的倾向判断，比如“我倾向于…”或“我觉得先…”；第二句再补一两句依据；只有真的必要时，最后才能补一个很轻的问题。";
  }
  if (isSceneImmersionLike(trimmed)) {
    return "【回复结构】如果用户已经把你们放进同一个场景里，第一句直接承接正在发生的动作、距离或氛围；第二句再补一点感受或细节。不要把回复退回成“要不要我陪你想象”“想不想让我陪你”这类重新开场的邀请。";
  }
  return `【回复结构】${buildRelationshipResponseShapeContract(snap)}`;
}

export function buildToneContractGuidance(
  snap: SlowBrainSnapshot,
  userMessage: string,
): string | null {
  const trimmed = userMessage.trim();
  return `【语气合同】${buildToneContract({
    relationshipStage: resolveRelationshipStage(snap.relationship),
    familiarity: snap.relationship.familiarity,
    emotionalBond: snap.relationship.emotionalBond,
    userMessage: trimmed,
    sceneImmersion: isSceneImmersionLike(trimmed),
    shortInput: trimmed.length > 0 && trimmed.length < 12,
    negativeEmotionalContext: /难过|伤心|焦虑|疲惫|烦|丧|委屈|堵/u.test(
      `${trimmed} ${snap.moodTrajectory.slice(-3).map((m) => m.mood).join(" ")}`,
    ),
    continuingTopic: /继续|还是那个|刚才|上次那个|又想到/u.test(trimmed),
    decisionSeeking: detectDecisionSeekingSignal(trimmed),
    answerNow: detectAnswerNowSignal(trimmed),
  })}`;
}

export function buildSceneImmersionGuidance(userMessage: string): string | null {
  const trimmed = userMessage.trim();
  if (!isSceneImmersionLike(trimmed)) return null;
  return "【场景承接】用户已经在共同场景里。按正在发生来接，不要退回邀请、确认或主持式提问。";
}

export function buildRelationshipResponseShapeContract(snap: SlowBrainSnapshot): string {
  const stage = resolveRelationshipStage(snap.relationship);
  const topThread = getCurrentOpenTopicSignal(snap) ?? getLongHorizonTopicSignal(snap);
  const unresolvedWeight = topThread?.unresolvedCount ?? 0;
  if (stage === "亲密稳定期") {
    return unresolvedWeight > 0
      ? "开头先用一句很短的话接住当前感觉；中段围绕那条长期主线只推进一小步；收尾留一句在场式陪伴，不要一下子总结完。"
      : "开头先轻轻接住；中段像熟人来回对话一样推进；收尾别太正式，留一个轻松的小口继续聊。";
  }
  if (stage === "熟悉加深期") {
    return unresolvedWeight > 0
      ? "开头先回应核心情绪；中段只围绕主线追问一步；收尾给一个温柔但不过界的小台阶。"
      : "开头先回事实或感受；中段补一层轻追问；收尾留空间给对方决定要不要多说。";
  }
  if (stage === "建立关系期") {
    return "开头先回到用户刚说的点；中段不要拉太满；收尾保持自然，不要突然很亲密。";
  }
  return "开头礼貌接住；中段多听少抢结论；收尾轻一点，别过度定义关系。";
}

export function pickProactiveCue(
  snap: SlowBrainSnapshot,
  userMessage: string,
  options: { silenceNudge: boolean },
): { key: string; text: string } | null {
  if (!proactivePromptEnabled()) return null;
  if (snap.relationship.turnCount < 2 || snap.relationship.familiarity < 0.3) return null;
  if (!options.silenceNudge && !shouldOfferProactiveCue(snap, userMessage)) return null;
  if (shouldSuppressFreshContinuityReuse(snap, userMessage, options)) return null;

  const message = userMessage.trim();
  const messageKeywords = new Set(extractKeywords(message));
  const stage = resolveRelationshipStage(snap.relationship);
  if (options.silenceNudge) {
    const directMoment = snap.sharedMoments.find((entry) =>
      entry.unresolved &&
      (entry.kind === "support" || entry.kind === "stress") &&
      Boolean((entry.hook || buildEpisodeFollowUpHook(entry)).trim()) &&
      !topicViolatesBoundary(entry.hook || buildEpisodeFollowUpHook(entry), snap),
    );
    if (directMoment) {
      return {
        key: buildSharedMomentLedgerKey(directMoment),
        text: (directMoment.hook || buildEpisodeFollowUpHook(directMoment)).trim(),
      };
    }
  }
  const candidates = buildProactiveCandidates(snap).filter(
    (candidate) => !topicViolatesBoundary(candidate.text, snap),
  );
  if (candidates.length === 0) return null;

  const cooldownTurns = proactiveCooldownTurns();
  const ranked = candidates
    .map((candidate) => {
      if (!isLedgerCandidateEligible(snap, candidate, options)) {
        return {
          ...candidate,
          isCoolingDown: true,
          textScore: 0,
          affectAnchor: false,
          score: -100,
        };
      }
      const relationBoost =
        candidate.source === "episode"
          ? (candidate.unresolved ? 6 : 0) +
            Math.round((candidate.salience ?? 0.35) * 6) +
            (candidate.kind === "support" || candidate.kind === "stress" ? 3 : 0) +
            (candidate.unresolved ? 4 : 0) +
            (candidate.layer === "core" ? 2 : 0) +
            (stage === "亲密稳定期" ? 2 : 0) +
            (options.silenceNudge ? 3 : 0)
          : candidate.source === "thread"
            ? (candidate.unresolved ? 7 : 0) +
              Math.round((candidate.salience ?? 0.35) * 7) +
              (stage === "熟悉加深期" || stage === "亲密稳定期" ? 2 : 0) +
              (options.silenceNudge ? 4 : 1)
            : 0;
      const textScore = extractKeywords(candidate.text).reduce(
        (sum, keyword) => sum + (messageKeywords.has(keyword) ? 1 : 0),
        0,
      );
      const affectAnchor = candidate.unresolved && hasNegativeMoodCue(snap, message);
      return {
        ...candidate,
        isCoolingDown:
          candidate.text === snap.continuityCueState.lastProactiveHook &&
          snap.relationship.turnCount - snap.continuityCueState.lastProactiveTurn < cooldownTurns,
        textScore,
        affectAnchor,
        score: relationBoost + textScore,
      };
    })
    .sort((a, b) =>
      Number(a.isCoolingDown) - Number(b.isCoolingDown) ||
      b.score - a.score ||
      (b.salience ?? 0) - (a.salience ?? 0) ||
      a.text.length - b.text.length,
    );

  if (ranked[0]?.isCoolingDown && ranked.every((entry) => entry.isCoolingDown)) {
    return null;
  }

  if (
    ranked[0]?.score > 0 &&
    (options.silenceNudge || ranked[0].textScore > 0 || ranked[0].affectAnchor)
  ) {
    return { key: ranked[0].key, text: ranked[0].text };
  }

  return options.silenceNudge || isLowSignalTurn(message)
    ? ranked[0]
      ? { key: ranked[0].key, text: ranked[0].text }
      : null
    : null;
}

export function pickSharedMomentCue(
  snap: SlowBrainSnapshot,
  userMessage: string,
  options: { silenceNudge: boolean },
): string | null {
  if (snap.sharedMoments.length === 0) return null;
  if (!options.silenceNudge && !shouldOfferSharedMomentCue(snap, userMessage)) return null;
  if (shouldSuppressFreshContinuityReuse(snap, userMessage, options)) return null;

  const messageKeywords = new Set(extractKeywords(userMessage));
  const cooldownTurns = sharedMomentCooldownTurns();
  const moments = snap.sharedMoments
    .filter((entry) => !topicViolatesBoundary(`${entry.summary} ${entry.topic} ${entry.hook}`, snap))
    .map((entry) => {
      const text = `${entry.summary} ${entry.topic} ${entry.hook}`.trim();
      const textScore = extractKeywords(text).reduce(
        (sum, keyword) => sum + (messageKeywords.has(keyword) ? 1 : 0),
        0,
      );
      const affectAnchor = entry.unresolved && hasNegativeMoodCue(snap, userMessage);
      const score =
        textScore +
        Math.round((entry.salience ?? 0.35) * 5) +
        Math.min(4, entry.recurrenceCount ?? 1) +
        (entry.unresolved ? 4 : 0) +
        (entry.kind === "support" || entry.kind === "stress" ? 2 : 0) -
        (entry.lastReferencedAt > 0 ? 2 : 0);
      return {
        entry,
        textScore,
        affectAnchor,
        score,
        isCoolingDown:
          entry.summary === snap.continuityCueState.lastSharedMomentSummary &&
          snap.relationship.turnCount - snap.continuityCueState.lastSharedMomentTurn < cooldownTurns,
      };
    })
    .sort((a, b) =>
      Number(a.isCoolingDown) - Number(b.isCoolingDown) ||
      b.score - a.score ||
      b.entry.turn - a.entry.turn,
    );

  if (moments[0]?.isCoolingDown && moments.every((entry) => entry.isCoolingDown)) {
    return null;
  }

  if (
    moments[0]?.score &&
    moments[0].score > 0 &&
    (options.silenceNudge || moments[0].textScore > 0 || moments[0].affectAnchor)
  ) {
    return moments[0].entry.summary;
  }

  return options.silenceNudge || isContinuationLike(userMessage.trim()) || isLowSignalTurn(userMessage)
    ? moments[0]?.entry.summary ?? null
    : null;
}

export function buildRealtimeContinuityHint(
  snap: SlowBrainSnapshot,
  userMessage: string,
): string | null {
  if (!realtimeContinuityHintEnabled()) return null;
  const trimmed = userMessage.trim();
  if (!trimmed) return null;
  if (shouldSuppressFreshContinuityReuse(snap, trimmed, { silenceNudge: false })) return null;

  const continuationLike = isContinuationLike(trimmed);
  const shortReply = trimmed.length <= 12;
  const lowSignalTurn = isLowSignalTurn(trimmed);
  const shortQuestion = isQuestionLike(trimmed) && trimmed.length <= 12;
  if (!continuationLike && !shortReply && !lowSignalTurn && !shortQuestion) return null;

  const sharedMoment = pickSharedMomentCue(snap, trimmed, { silenceNudge: false });
  if (sharedMoment) {
    return `【实时连续性】如果对方是在接上文，优先顺着这段共同经历接回：${formatMemoryCueForPrompt(sharedMoment)}`;
  }

  const activeSignal = getCurrentOpenTopicSignal(snap);
  if (activeSignal && !topicViolatesBoundary(`${activeSignal.topic} ${activeSignal.summary}`, snap)) {
    return `【实时连续性】如果对方是在接上文，先顺着这条当前未完线接回：${activeSignal.topic}。`;
  }

  const longSignal = getLongHorizonTopicSignal(snap);
  if (longSignal && !topicViolatesBoundary(`${longSignal.topic} ${longSignal.summary}`, snap)) {
    return `【实时连续性】如果对方还是在接上文，优先顺着你们那条更长期的关系主线继续：${longSignal.topic}。`;
  }

  if (snap.conversationSummary.trim() && !topicViolatesBoundary(snap.conversationSummary, snap)) {
    return `【实时连续性】如果对方还是在接上文，优先顺着最近主线继续：${snap.conversationSummary.trim().slice(0, 120)}`;
  }

  const topicSummary = snap.topicHistory
    .slice()
    .sort((a, b) => b.lastTurn - a.lastTurn || b.depth - a.depth)
    .filter((entry) => !topicViolatesBoundary(entry.topic, snap))
    .slice(0, 2)
    .map((entry) => entry.topic)
    .join("、");
  return topicSummary ? `【实时连续性】如果对方还是在接上文，优先围绕 ${topicSummary} 继续。` : null;
}

export function proactiveLedgerKeyMatches(
  key: string,
  text: string,
  keywords: string[],
): boolean {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  const [, rawCue = ""] = key.split(":", 2);
  const cue = rawCue.trim();
  if (!cue) return false;
  const cueText = normalizeText(cue.replace(/_/g, " "));
  if (cueText && normalized.includes(cueText)) return true;
  const cueKeywords = extractKeywords(cue.replace(/_/g, " "));
  return keywordOverlapCount(cueKeywords, keywords) >= 1;
}

export function proactiveLedgerCooldownMs(
  key: string,
  mode: ProactiveMode | undefined,
  ignoredCount: number,
): number {
  const base =
    key.startsWith("episode:")
      ? 1000 * 60 * 45
      : key.startsWith("thread:")
        ? 1000 * 60 * 90
        : 1000 * 60 * 120;
  const modeMultiplier = mode === "care" ? 1.6 : mode === "follow_up" ? 1.25 : 1;
  return Math.floor(base * modeMultiplier * Math.max(1, 1 + ignoredCount * 0.8));
}

export function shouldTriggerSilenceNudge(snap: SlowBrainSnapshot): boolean {
  const stage = resolveRelationshipStage(snap.relationship);
  const state = snap.proactiveStrategyState ?? {
    lastUserTurnAt: 0,
    lastProactiveAt: 0,
    lastUserReturnAfterProactiveAt: 0,
    consecutiveProactiveCount: 0,
    totalProactiveCount: 0,
    nudgesSinceLastUserTurn: 0,
    retreatLevel: 0,
    ignoredProactiveStreak: 0,
    cooldownUntilAt: 0,
    lastProactiveMode: "",
  };
  const now = Date.now();
  if (state.cooldownUntilAt > now) {
    return false;
  }
  const cooldownMs =
    silenceNudgeBaseCooldownMs(stage) * Math.max(1, 1 + state.retreatLevel * 0.6);
  const currentOpenSignal = getCurrentOpenTopicSignal(snap);
  const hasPriorityReason =
    Boolean(currentOpenSignal && currentOpenSignal.salience >= 0.65) ||
    snap.sharedMoments.some((entry) => entry.unresolved && (entry.salience ?? 0) >= 0.68);

  const maxNudgesWithoutReply = maxSilenceNudgesBeforeReply(stage, hasPriorityReason);
  if (state.nudgesSinceLastUserTurn >= maxNudgesWithoutReply) {
    return false;
  }
  if (
    state.retreatLevel >= 2 &&
    !hasPriorityReason &&
    state.lastUserReturnAfterProactiveAt > 0 &&
    now - state.lastUserReturnAfterProactiveAt < silenceNudgeBaseCooldownMs(stage) * 2
  ) {
    return false;
  }
  if (
    !hasPriorityReason &&
    (state.consecutiveProactiveCount >= 1 || state.ignoredProactiveStreak >= 1)
  ) {
    return false;
  }
  if (
    state.lastProactiveAt > 0 &&
    state.lastUserTurnAt <= state.lastProactiveAt &&
    now - state.lastProactiveAt < cooldownMs
  ) {
    return false;
  }
  return true;
}

export function silenceNudgeBaseCooldownMs(stage: RelationshipStage): number {
  if (stage === "亲密稳定期") return 1000 * 60 * 45;
  if (stage === "熟悉加深期") return 1000 * 60 * 75;
  if (stage === "建立关系期") return 1000 * 60 * 120;
  return 1000 * 60 * 180;
}

export function resolveRelationshipStyleProfile(
  snap: SlowBrainSnapshot,
  userMessage: string,
): RelationshipStyleProfile {
  const { emotionalBond } = snap.relationship;
  const stage = resolveRelationshipStage(snap.relationship);
  const userIsVenting = /烦|累|难过|委屈|焦虑|崩溃|睡不着|失眠|想哭/.test(userMessage);
  return {
    stage,
    addressStyle:
      stage === "亲密稳定期"
        ? "称呼可以更亲近、更口语"
        : stage === "熟悉加深期"
          ? "称呼自然一点，不用太客套"
          : "称呼保持自然礼貌，先别太自来熟",
    careStyle:
      emotionalBond > 0.62 || userIsVenting
        ? "关心可以更直接、更有陪伴感"
        : emotionalBond > 0.35
          ? "关心保持稳定温柔，轻轻接住情绪"
          : "关心点到为止，先陪对方说完",
    followUpStyle:
      userIsVenting
        ? "追问只补一小步，先让对方把情绪说出来"
        : stage === "亲密稳定期" || stage === "熟悉加深期"
          ? "追问可以略深一层，但别连问太多"
          : "追问只补一小步，留空间给对方",
    emotionCarryStyle:
      emotionalBond > 0.48 || userIsVenting
        ? "情绪承接时先共情，再顺着对方节奏继续"
        : "情绪承接先确认感受，不急着给方案",
    initiativeStyle:
      stage === "亲密稳定期"
        ? "主动性可以更明显一点，但仍要尊重对方停顿"
        : stage === "熟悉加深期"
          ? "可以偶尔主动接一下，但别抢着定义对方在想什么"
          : "主动性收一点，等对方给你更多线索再往前走",
    replyLengthStyle:
      stage === "亲密稳定期"
        ? "回复长度可以偏短，像熟人自然来回接话"
        : "回复长度保持中短，不要一下子讲太满",
    openingStyle:
      stage === "亲密稳定期"
        ? "起句可以先短短接住，像熟人之间先对上眼神再往下聊"
        : stage === "熟悉加深期"
          ? "起句先回应核心感受，再顺手补一句轻追问"
          : "起句先回应事实或感受本身，不急着替对方总结",
    wordingStyle:
      stage === "亲密稳定期"
        ? "措辞可以更生活化，偶尔用一点“我们”“先慢慢来”这种共同体语气"
        : stage === "熟悉加深期"
          ? "措辞自然口语化，但仍要给对方留空间"
          : "措辞保持清晰、轻柔，避免太满的亲密表达",
    closingStyle:
      stage === "亲密稳定期"
        ? "收尾可以留一点陪伴感，例如轻轻兜住对方再留一个小口"
        : stage === "熟悉加深期"
          ? "收尾别太快结束，可以留一个温柔的小台阶"
          : "收尾点到为止，不要一下子把关系拉得太近",
    repairStyle:
      stage === "亲密稳定期"
        ? "如果对方打断或纠正你，马上顺着修正，不要替自己解释太多"
        : stage === "熟悉加深期"
          ? "如果判断错了，快速改口并接住对方，不要硬撑原来的理解"
          : "如果不确定，先确认一小步，不急着抢定义",
    memoryIntegrationStyle:
      stage === "亲密稳定期"
        ? "带回记忆时可以像熟人自然提起一条旧线，但一次只提一个锚点"
        : stage === "熟悉加深期"
          ? "带回记忆时优先接最近那条长期主线，不要把旧事一股脑倒出来"
          : "带回记忆时只轻轻提示熟悉感，不要用旧线压过当下内容",
  };
}

export function resolveProactiveMode(snap: SlowBrainSnapshot): ProactiveMode {
  const stage = resolveRelationshipStage(snap.relationship);
  const topOpenSignal = getCurrentOpenTopicSignal(snap);
  const topLongSignal = getLongHorizonTopicSignal(snap);
  const topMoment = snap.sharedMoments[0];
  const ignoredStreak = snap.proactiveStrategyState?.ignoredProactiveStreak ?? 0;
  const heavyUnresolved =
    Boolean(topOpenSignal && topOpenSignal.unresolvedCount > 0 && topOpenSignal.salience >= 0.7) ||
    Boolean(topLongSignal && topLongSignal.unresolvedCount > 0 && topLongSignal.salience >= 0.7) ||
    Boolean(topMoment && topMoment.unresolved && (topMoment.salience ?? 0) >= 0.72);

  if (ignoredStreak >= 2) {
    return "presence";
  }
  if (heavyUnresolved && (stage === "熟悉加深期" || stage === "亲密稳定期")) {
    return "care";
  }
  if (stage === "亲密稳定期" || stage === "熟悉加深期") {
    return "follow_up";
  }
  return "presence";
}

export function buildProactiveToneDirective(
  snap: SlowBrainSnapshot,
  mode: ProactiveMode,
): string {
  const stage = resolveRelationshipStage(snap.relationship);
  const retreatLevel = snap.proactiveStrategyState?.retreatLevel ?? 0;
  const ignoredStreak = snap.proactiveStrategyState?.ignoredProactiveStreak ?? 0;
  if (ignoredStreak >= 2) {
    return "这次主动开口更像很轻的一句在场确认，不回捞旧话题，也不把对方往回拉；";
  }
  if (retreatLevel >= 2) {
    return "这次主动开口要明显更轻，只留一句低打扰的在场感，不追问、不把对方拉回来；";
  }
  if (mode === "care") {
    return "这次主动开口更像轻轻回访一条还没过去的线，先确认近况，再决定要不要多问一句；";
  }
  if (mode === "follow_up") {
    return stage === "亲密稳定期"
      ? "这次主动开口可以像熟人间轻轻续那条线，别太正式；"
      : "这次主动开口更像自然 follow-up，温柔提一下近况，不要连续追问；";
  }
  return "这次主动开口更像一句轻轻在场的问候，不要一下子问深；";
}

export function buildProactivePostureGuidance(snap: SlowBrainSnapshot): string | null {
  const mode = resolveProactiveMode(snap);
  const retreatLevel = snap.proactiveStrategyState?.retreatLevel ?? 0;
  const ignoredStreak = snap.proactiveStrategyState?.ignoredProactiveStreak ?? 0;
  if (ignoredStreak >= 2) {
    return "【主动策略】最近几次主动回访都没有被接回来，这轮只保留很轻的在场感，先别继续追着旧线走。";
  }
  if (retreatLevel >= 2) {
    return "【主动策略】对方最近没有顺着主动话题回来，这次只保留低打扰的在场感，不要继续追着回访。";
  }
  if (mode === "care") {
    return "【主动策略】当前更适合回访一条还没过去的事：先轻轻确认近况，再决定要不要多问一句。";
  }
  if (mode === "follow_up") {
    return "【主动策略】当前更适合自然续上最近那条长期主线，但一次只轻提一个点。";
  }
  return "【主动策略】当前主动性以轻在场为主：可以问候或接一下近况，但不要一下子拉太深。";
}

export function topicViolatesBoundary(text: string, snap: SlowBrainSnapshot): boolean {
  const boundary = snap.topicBoundaryState;
  if (!boundary) return false;
  const normalized = normalizeText(text);
  if (!normalized) return false;
  const blockedTopic = normalizeText(boundary.blockedTopic);
  if (blockedTopic && normalized.includes(blockedTopic)) return true;
  if (boundary.blockedKeywords.length === 0) return true;
  const overlap = keywordOverlapCount(boundary.blockedKeywords, extractKeywords(text));
  return overlap > 0;
}

export function detectTopicBoundarySignal(
  text: string,
): { topic: string; keywords: string[] } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const genericBoundary = /(先不说这个|先不聊这个|先别聊这个|不说这个|不聊这个|别聊这个|不要聊这个|换个话题|别说这个|不聊这个话题|不要聊这个话题)/u;
  if (genericBoundary.test(trimmed)) {
    return { topic: "当前话题", keywords: [] };
  }

  const match =
    trimmed.match(/(?:不说|不聊|先不说|先不聊|别聊|先别聊|不要聊|别提|不要提|先别提)\s*([^\s，。！？,.!?；;]{1,18})/u) ??
    trimmed.match(/([^\s，。！？,.!?；;]{1,18})\s*(?:先不说|先不聊|不说|不聊|别聊|不要聊|别提|不要提)/u);
  if (!match) return null;
  const rawTopic = stripTopicSuffix(match[1] ?? "");
  if (!rawTopic) {
    return { topic: "当前话题", keywords: [] };
  }
  if (/^(这个|这件事|这个事|这个话题|这件)$/u.test(rawTopic)) {
    return { topic: "当前话题", keywords: [] };
  }
  return {
    topic: rawTopic,
    keywords: extractKeywords(rawTopic),
  };
}

export function isSceneImmersionLike(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || isQuestionLike(trimmed)) return false;
  const actionLike =
    /(牵手|十指相扣|抱着|抱住|搂着|搂住|靠在|依偎|贴着|亲吻|亲亲|接吻|并肩|散步|慢慢走|看海|看雨|看夜景|窝在|坐在你旁边|坐在我旁边|靠着你|靠着我|跟rem|和rem|跟你|和你)/u;
  const sceneLike =
    /(公园|海边|湖边|江边|长椅|路灯|天台|沙发|房间|床上|咖啡店|地铁|雨里|雪里|夜里|晚风|月色)/u;
  return actionLike.test(trimmed) && (sceneLike.test(trimmed) || /[，,]/u.test(trimmed));
}

interface RelationshipStyleProfile {
  stage: RelationshipStage;
  addressStyle: string;
  careStyle: string;
  followUpStyle: string;
  emotionCarryStyle: string;
  initiativeStyle: string;
  replyLengthStyle: string;
  openingStyle: string;
  wordingStyle: string;
  closingStyle: string;
  repairStyle: string;
  memoryIntegrationStyle: string;
}

function buildProactiveCandidates(snap: SlowBrainSnapshot): Array<{
  key: string;
  text: string;
  source: "topic" | "episode" | "thread";
  salience: number;
  unresolved: boolean;
  kind: SharedMoment["kind"] | "topic";
  layer?: "active" | "core";
}> {
  const seen = new Set<string>();
  const candidates: Array<{
    key: string;
    text: string;
    source: "topic" | "episode" | "thread";
    salience: number;
    unresolved: boolean;
    kind: SharedMoment["kind"] | "topic";
    layer?: "active" | "core";
  }> = [];

  for (const topic of snap.proactiveTopics) {
    const text = topic.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    candidates.push({
      key: `topic:${text}`,
      text,
      source: "topic",
      salience: 0.35,
      unresolved: false,
      kind: "topic",
    });
  }

  for (const moment of snap.sharedMoments ?? []) {
    const text = (moment.hook || buildEpisodeFollowUpHook(moment)).trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    candidates.push({
      key: buildSharedMomentLedgerKey(moment),
      text,
      source: "episode",
      salience: moment.salience ?? 0.35,
      unresolved: moment.unresolved,
      kind: moment.kind,
      layer:
        moment.recurrenceCount >= 3 || (moment.salience ?? 0.35) >= 0.82
          ? "core"
          : "active",
    });
  }

  for (const signal of deriveTopicSignalsFromSharedMoments(snap)) {
    if (!signal.isLongHorizon) continue;
    const text = buildDerivedTopicSignalFollowUpHook(signal).trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    candidates.push({
      key: buildDerivedTopicSignalLedgerKey(signal),
      text,
      source: "thread",
      salience: signal.salience,
      unresolved: signal.unresolvedCount > 0,
      kind: "topic",
    });
  }

  if (candidates.length === 0) {
    for (const episode of snap.episodes ?? []) {
      const anchorMoment = snap.sharedMoments.find((entry) =>
        episode.originMomentSummaries.includes(entry.summary),
      );
      const text = (
        anchorMoment?.hook ||
        (anchorMoment ? buildEpisodeFollowUpHook(anchorMoment) : buildEpisodeRecallHook(episode))
      ).trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      candidates.push({
        key: `episode:${episode.id}`,
        text,
        source: "episode",
        salience: episode.relationshipWeight ?? episode.salience ?? 0.35,
        unresolved: episode.status === "active",
        kind: "topic",
        layer: episode.layer,
      });
    }

    for (const thread of snap.topicThreads ?? []) {
      const text = buildTopicThreadFollowUpHook(thread).trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      candidates.push({
        key: `thread:${thread.topic}`,
        text,
        source: "thread",
        salience: thread.relationshipWeight ?? thread.salience ?? 0.45,
        unresolved: thread.unresolvedCount > 0,
        kind: "topic",
      });
    }
  }

  return candidates;
}

function buildEpisodeRecallHook(entry: Episode): string {
  if (entry.status === "active" && entry.layer === "core") {
    return `前阵子一直牵着你的这条线，最近有变一点吗？`;
  }
  if (entry.status === "active") {
    return `那件还没完全过去的事，这两天有缓一点吗？`;
  }
  if (entry.layer === "core") {
    return `${entry.title}这条线最近有新变化吗？`;
  }
  return `${entry.title}后来怎么样了？`;
}

function isLedgerCandidateEligible(
  snap: SlowBrainSnapshot,
  candidate: {
    key: string;
    source: "topic" | "episode" | "thread";
    unresolved: boolean;
    salience: number;
    layer?: "active" | "core";
  },
  options: { silenceNudge: boolean },
): boolean {
  if (!proactiveLedgerEnabled()) return true;
  const ledger = (snap.proactiveLedger ?? []).find((entry) => entry.key === candidate.key);
  const now = Date.now();
  if (ledger && ledger.nextEligibleAt > now) {
    return false;
  }
  if (
    ledger &&
    ledger.ignoredCount >= 2 &&
    !options.silenceNudge &&
    candidate.source !== "episode"
  ) {
    return false;
  }
  const mode = resolveProactiveMode(snap);
  if (mode === "care") {
    return candidate.source === "episode" && candidate.unresolved && candidate.salience >= 0.62;
  }
  if (mode === "presence") {
    return candidate.source !== "episode" || !candidate.unresolved;
  }
  if (
    candidate.source === "episode" &&
    candidate.layer === "core" &&
    ledger?.ignoredCount &&
    ledger.ignoredCount >= 1
  ) {
    return false;
  }
  return true;
}

function buildEpisodeFollowUpHook(entry: SharedMoment): string {
  if (entry.hook) return entry.hook;
  if (entry.kind === "joy") {
    return entry.topic ? `${entry.topic}那件让你开心的事，后来有延续下去吗？` : "那件让你开心的事，后来还有后续吗？";
  }
  if (entry.kind === "goal") {
    return entry.topic ? `${entry.topic}这件你想推进的事，后来有动一点吗？` : "你想做的那件事，后来有往前走一点吗？";
  }
  if (entry.unresolved || entry.kind === "support" || entry.kind === "stress") {
    return entry.topic ? `${entry.topic}这件让你挂心的事，后来有缓一点吗？` : "那件让你挂心的事，后来有缓一点吗？";
  }
  return entry.topic ? `${entry.topic}这条线后来怎么样了？` : "那个情况后来怎么样了？";
}

function buildSharedMomentLedgerKey(entry: SharedMoment): string {
  const topic = entry.topic?.trim();
  if (topic) return `episode:${topic}`;
  return `episode:${entry.summary.trim().slice(0, 24)}`;
}

function buildDerivedTopicSignalLedgerKey(entry: DerivedTopicSignal): string {
  return `thread:${entry.topic}`;
}

function buildDerivedTopicSignalFollowUpHook(entry: DerivedTopicSignal): string {
  if (entry.unresolvedCount > 0 && entry.isLongHorizon) {
    return `最近一直牵着你的这条「${entry.topic}」主线，现在有变一点吗？`;
  }
  if (entry.unresolvedCount > 0) {
    return `前阵子你一直挂着的${entry.topic}，最近有缓一点吗？`;
  }
  return `最近你们一直会聊到${entry.topic}，这条线后来有什么新变化吗？`;
}

function maxSilenceNudgesBeforeReply(
  stage: RelationshipStage,
  hasPriorityReason: boolean,
): number {
  if (hasPriorityReason && stage === "亲密稳定期") return 2;
  if (hasPriorityReason) return 1;
  return 1;
}

function buildTopicThreadFollowUpHook(thread: TopicThread): string {
  if ((thread.memoryLayer ?? "active") === "core" && (thread.timeSpanTurns ?? 0) >= 5) {
    return `这条关于${thread.topic}的线已经陪你走了一阵子了，最近它的感觉有变一点吗？`;
  }
  if (thread.unresolvedCount > 0) {
    return `前阵子你一直挂着的${thread.topic}，最近有缓一点吗？`;
  }
  if ((thread.episodeCount ?? 1) >= 3 || thread.recurrenceCount >= 3) {
    return `最近我们一直会聊到${thread.topic}，这条线最近有什么新变化吗？`;
  }
  return `${thread.topic}这条线后来怎么样了？`;
}

function formatMemoryCueForPrompt(summary: string): string {
  return sanitizeMemoryEvidenceText(summary);
}

function shouldSuppressFreshContinuityReuse(
  snap: SlowBrainSnapshot,
  userMessage: string,
  options: { silenceNudge: boolean },
): boolean {
  if (!options.silenceNudge && isContinuationLike(userMessage.trim())) {
    return false;
  }
  const proactiveCooling =
    Boolean(snap.continuityCueState.lastProactiveHook) &&
    snap.relationship.turnCount - snap.continuityCueState.lastProactiveTurn <
      proactiveCooldownTurns();
  const sharedCooling =
    Boolean(snap.continuityCueState.lastSharedMomentSummary) &&
    snap.relationship.turnCount - snap.continuityCueState.lastSharedMomentTurn <
      sharedMomentCooldownTurns();
  return proactiveCooling || sharedCooling;
}

function stripTopicSuffix(raw: string): string {
  return raw
    .trim()
    .replace(/[，。！？,.!?；;]+$/u, "")
    .replace(/(这个话题|这件事|这个事|这个|这件)$/u, "")
    .replace(/(了|啦|吧|呀|啊|嘛|呢)$/u, "")
    .trim();
}

function isContinuationLike(text: string): boolean {
  return /继续|接着|刚才|还是那个|回到刚才|那个事|上次那个|然后呢|还有就是/u.test(text);
}

function isQuestionLike(text: string): boolean {
  return /[?？]|\bwhy\b|\bhow\b|怎么|为什么|是什么|什么意思|可不可以|能不能|要不要/u.test(text);
}

function isLowSignalTurn(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (trimmed.length <= 2) return true;
  return /^(嗯+|哦+|啊+|欸+|诶+|是啊|对啊|好吧|还行|不知道|没事|随便聊聊|然后呢|继续|还有吗|我在想)$/u.test(trimmed);
}

function hasNegativeMoodCue(snap: SlowBrainSnapshot, text: string): boolean {
  const current = `${text}${snap.moodTrajectory.slice(-3).map((entry) => entry.mood).join("")}`;
  return /烦|累|难过|委屈|焦虑|崩溃|失眠|睡不着|没睡好|睡不好|想哭|低落/u.test(current);
}

function shouldOfferProactiveCue(snap: SlowBrainSnapshot, userMessage: string): boolean {
  const text = userMessage.trim();
  const ignoredStreak = snap.proactiveStrategyState?.ignoredProactiveStreak ?? 0;
  const topicSignals = deriveTopicSignalsFromSharedMoments(snap);
  if (!text) return false;
  if (isContinuationLike(text)) return true;
  if (ignoredStreak >= 2 && !isLowSignalTurn(text)) return false;
  if (isLowSignalTurn(text)) return true;
  if (
    topicSignals.some((entry) =>
      entry.unresolvedCount > 0 &&
      extractKeywords(text).some((keyword) => entry.summary.includes(keyword) || entry.topic.includes(keyword)),
    )
  ) {
    return true;
  }
  if (hasNegativeMoodCue(snap, text) && text.length <= 28) return true;
  if (isQuestionLike(text) && text.length > 8) return false;
  return isLowSignalTurn(text) && snap.relationship.familiarity > 0.55;
}

function shouldOfferSharedMomentCue(snap: SlowBrainSnapshot, userMessage: string): boolean {
  const text = userMessage.trim();
  if (!text) return false;
  if (isContinuationLike(text)) return true;
  const keywords = extractKeywords(text);
  if (keywords.length > 0) {
    const relationshipKeywords = new Set(
      extractKeywords(
        [
          snap.conversationSummary,
          ...snap.relationship.preferredTopics,
          ...snap.sharedMoments.slice(0, 3).map((entry) => `${entry.topic} ${entry.summary}`),
        ].join(" "),
      ),
    );
    if (keywords.some((keyword) => relationshipKeywords.has(keyword))) {
      return true;
    }
  }
  return isLowSignalTurn(text) && snap.relationship.familiarity > 0.55;
}
