// ── Slow Brain ──────────────────────────────────────────────
// Runs asynchronously AFTER Fast Brain finishes streaming.
// Pipeline: local heuristics → LLM deep analysis → state update.
// NEVER blocks the response path.

import { complete, hasLlmConfig, type ChatMessage } from "../llm/qwen_client";
import { extractMemory } from "../memory/memory_agent";
import type { EpisodeLifecycleStatus } from "../memory/episode_store";
import { ingest } from "../memory/episode_store";
import { recordTextArchiveEntry } from "../cold_layer/text_archive_ledger";
import {
  classifyEmbeddingError,
  getEmbeddingHealthSnapshot,
} from "../llm/embedding_client";
import type { MemoryRepository } from "../memory/memory_repository";
import {
  relationshipStateEnabled,
  savePersistentRelationshipState,
} from "../memory/relationship_state";
import { momentToEpisodeV3View, toEpisodeV3View } from "../memory/episode_v3";
import { isLightAcknowledgementTurn } from "../memory/prompt_memory_support";
import type { PromptMessage } from "../brain/prompt_builder";
import { createLogger } from "../infra/logger";
import type { SlowBrainStore } from "./background_analysis_store";

const logger = createLogger("slow_brain");

const LIGHT_TOUCH_TURN_PATTERN =
  /^(?:你好呀?|您好|哈喽|hello|hi|嗨|嘿|在吗|在不在|晚安(?:啦|呀)?|早安|早上好|晚上好|睡了|嗯+|嗯嗯+|哦+|噢+|啊+|好+|好的|好哦|好哒|收到|行吧?|ok(?:ay)?|okk+)[!！?？~～。\s]*$/iu;

function isLightTouchTurn(userMessage: string): boolean {
  const trimmed = userMessage.trim();
  if (!trimmed) return false;
  return isLightAcknowledgementTurn(trimmed) || (trimmed.length <= 12 && LIGHT_TOUCH_TURN_PATTERN.test(trimmed));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export interface SlowBrainInput {
  connId?: string;
  turnId?: string;
  inputSource?: "text" | "voice";
  userId: string;
  userMessage: string;
  assistantReply: string;
  history: PromptMessage[];
  slowBrain: SlowBrainStore;
  memoryRepo: MemoryRepository;
  relationshipRepo?: MemoryRepository | null;
  signal?: AbortSignal;
}

// ── Public API ──

export async function runSlowBrain(input: SlowBrainInput): Promise<void> {
  const t0 = Date.now();
  const { userId, userMessage, assistantReply, history, slowBrain, memoryRepo } =
    input;
  const relationshipRepo = input.relationshipRepo ?? memoryRepo;
  const lightTouchTurn = isLightTouchTurn(userMessage);

  slowBrain.recordTurn();
  const slowMemoryWrites = !lightTouchTurn
    ? extractMemory(userMessage, memoryRepo)
    : [];
  localAnalysis(slowBrain, userMessage);

  const configured = hasLlmConfig();
  let llmAborted = false;

  if (configured && !lightTouchTurn) {
    try {
      await llmAnalysis(
        userMessage,
        assistantReply,
        history,
        slowBrain,
        memoryRepo,
        input.signal,
      );
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        logger.info("LLM 分析已取消");
        llmAborted = true;
      } else {
        logger.warn("LLM 分析失败，仅使用本地分析", { error: (err as Error).message });
      }
    }
  }

  updateRelationship(slowBrain, userMessage);
  const sharedMomentRecord = !lightTouchTurn
    ? await maybeRecordSharedMoment(slowBrain, userMessage, assistantReply, userId)
    : null;

  if (relationshipStateEnabled() && relationshipRepo) {
    try {
      await savePersistentRelationshipState(
        relationshipRepo,
        slowBrain.exportPersistentState(),
      );
    } catch (err) {
      logger.warn("关系状态持久化失败", {
        error: (err as Error).message,
      });
    }
  }

  if ((input.inputSource ?? "text") === "text") {
    recordTextArchiveEntry({
      kind: "text_archive",
      stage: "slow_brain",
      recordedAt: new Date().toISOString(),
      turnId:
        input.turnId ??
        `text:${input.connId ?? "unknown"}:${Date.now().toString(36)}:slow`,
      connId: input.connId,
      userId,
      inputSource: input.inputSource ?? "text",
      systemTriggered: false,
      userMessage,
      assistantReply,
      llmConfigured: configured,
      llmAborted,
      memoryWrites: slowMemoryWrites.map((entry) => ({
        ...entry,
        source: "slow_extract" as const,
      })),
      extractedMoments: sharedMomentRecord ? [sharedMomentRecord.moment] : [],
      episodeViews: sharedMomentRecord ? [sharedMomentRecord.episodeView] : [],
    });
  }

  logger.info("分析完成", {
    duration: Date.now() - t0,
    llmAborted,
  });
}

// ── Phase 1: Local heuristics (zero-cost) ──

const TOPIC_PATTERNS: { pattern: RegExp; topic: string }[] = [
  { pattern: /工作|上班|公司|老板|同事|加班|摸鱼/, topic: "工作" },
  { pattern: /债务|负债|花呗|贷款|网贷|还款|赔偿|赔了|月收入|月薪|工资|房租|现金流/, topic: "债务" },
  { pattern: /游戏|打游戏|电竞|手游|steam|switch/, topic: "游戏" },
  { pattern: /电影|电视|动漫|番剧|追剧|漫画/, topic: "影视动漫" },
  { pattern: /吃|美食|餐厅|做饭|烹饪|外卖/, topic: "美食" },
  { pattern: /旅游|旅行|出去玩|度假|出国/, topic: "旅行" },
  { pattern: /学习|考试|作业|学校|大学|论文/, topic: "学习" },
  { pattern: /音乐|歌|听歌|唱歌|演唱会/, topic: "音乐" },
  { pattern: /运动|健身|跑步|锻炼|球/, topic: "运动" },
  { pattern: /猫|狗|宠物|养/, topic: "宠物" },
  { pattern: /感情|恋爱|对象|暧昧|喜欢的人/, topic: "感情" },
];

const MOOD_KEYWORDS: { keywords: string[]; mood: string }[] = [
  { keywords: ["开心", "高兴", "好棒", "太好了", "哈哈", "耶"], mood: "开心" },
  { keywords: ["难过", "伤心", "不开心", "哭", "心痛"], mood: "难过" },
  { keywords: ["烦", "烦死了", "崩溃", "emo", "丧", "累"], mood: "疲惫/烦躁" },
  { keywords: ["紧张", "焦虑", "害怕", "担心"], mood: "焦虑" },
  { keywords: ["无聊", "没意思", "好闲"], mood: "无聊" },
];

function localAnalysis(store: SlowBrainStore, userMessage: string): void {
  for (const { pattern, topic } of TOPIC_PATTERNS) {
    if (pattern.test(userMessage)) {
      const sentiment = guessSentiment(userMessage);
      store.touchTopic(topic, sentiment);
    }
  }

  for (const { keywords, mood } of MOOD_KEYWORDS) {
    if (keywords.some((kw) => userMessage.includes(kw))) {
      store.recordMood(mood);
      return;
    }
  }
  store.recordMood("平静");
}

function guessSentiment(
  msg: string,
): "positive" | "neutral" | "negative" {
  const pos = ["喜欢", "爱", "好", "棒", "开心", "有趣", "期待"];
  const neg = ["讨厌", "烦", "累", "差", "难", "无聊", "失望"];
  const pScore = pos.filter((w) => msg.includes(w)).length;
  const nScore = neg.filter((w) => msg.includes(w)).length;
  if (pScore > nScore) return "positive";
  if (nScore > pScore) return "negative";
  return "neutral";
}

// ── Phase 2: LLM deep analysis ──

interface LLMAnalysis {
  user_facts?: { key: string; value: string; confidence?: number }[];
  interests?: string[];
  personality_note?: string;
  emotional_undertone?: string;
  conversation_summary?: string;
  proactive_topics?: string[];
  relationship_signal?: "warming" | "stable" | "cooling";
}

const ANALYSIS_PROMPT = `你是一个对话分析引擎，不是对话参与者。
分析以下对话片段，提取结构化信息。

严格返回合法 JSON（不要 markdown 代码块），格式如下：
{
  "user_facts": [{"key": "...", "value": "...", "confidence": 0.9}],
  "interests": ["..."],
  "personality_note": "对用户性格的一句话观察，没有明显观察则为空字符串",
  "emotional_undertone": "用户在这段对话中的深层情绪（一两个词）",
  "conversation_summary": "用一两句话概括到目前为止的对话内容和进展",
  "proactive_topics": ["Remi 下次可以主动提起的话题"],
  "relationship_signal": "warming 或 stable 或 cooling"
}

注意：
- user_facts 只提取用户明确提到的事实（姓名、年龄、职业、住所等），不要猜测
- user_facts confidence 表示事实可靠程度（0.0–1.0），用户直接说"我叫X"给0.9+，推测性的给0.5以下
- interests 只提取用户表现出兴趣的事物
- conversation_summary 要覆盖整段对话，不只是最后一轮
- proactive_topics 是未来可以自然聊到的话题，基于用户兴趣`;

async function llmAnalysis(
  userMessage: string,
  assistantReply: string,
  history: PromptMessage[],
  store: SlowBrainStore,
  memoryRepo: MemoryRepository,
  signal?: AbortSignal,
): Promise<void> {
  const recentHistory = history.slice(-8);
  const historyText = recentHistory
    .map((m) => `${m.role === "user" ? "用户" : "Remi"}：${m.content}`)
    .join("\n");

  const currentTurn = `用户：${userMessage}\nRem：${assistantReply}`;

  const messages: ChatMessage[] = [
    { role: "system", content: ANALYSIS_PROMPT },
    {
      role: "user",
      content: `对话历史：\n${historyText}\n\n最新一轮：\n${currentTurn}`,
    },
  ];

  const raw = await complete(messages, 512, signal);
  const analysis = parseAnalysis(raw);
  if (!analysis) return;

  if (analysis.user_facts) {
    for (const { key, value, confidence } of analysis.user_facts) {
      if (!key || !value) continue;
      const k = key.trim();
      const v = value.trim();
      store.addFact(k, v);
      try {
        await memoryRepo.upsert(
          normalizeMemoryKey(k),
          v,
          typeof confidence === "number" && confidence >= 0 && confidence <= 1
            ? confidence
            : 0.55,
        );
      } catch (err) {
        logger.warn("记忆同步失败", { key: k, error: (err as Error).message });
      }
    }
  }

  if (analysis.interests) {
    for (const interest of analysis.interests) {
      if (interest) store.addInterest(interest);
    }
  }

  if (analysis.personality_note) {
    store.addPersonalityNote(analysis.personality_note);
  }

  if (analysis.emotional_undertone) {
    store.recordMood(analysis.emotional_undertone);
  }

  if (analysis.conversation_summary) {
    store.setConversationSummary(analysis.conversation_summary);
  }

  if (analysis.proactive_topics?.length) {
    store.setProactiveTopics(analysis.proactive_topics);
  }

  if (analysis.relationship_signal) {
    const delta =
      analysis.relationship_signal === "warming"
        ? 0.05
        : analysis.relationship_signal === "cooling"
          ? -0.03
          : 0.01;
    store.bumpRelationship({ emotionalBondDelta: delta });
  }

  logger.debug("LLM 分析结果", {
    analysis: JSON.stringify(analysis, null, 0).slice(0, 200),
  });
}

function parseAnalysis(raw: string): LLMAnalysis | null {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]) as LLMAnalysis;
  } catch {
    logger.warn("JSON 解析失败", { raw: raw.slice(0, 100) });
    return null;
  }
}

// ── Phase 3: Relationship bookkeeping ──

function normalizeMemoryKey(key: string): string {
  return key.replace(/\s+/g, "").slice(0, 48);
}

function updateRelationship(store: SlowBrainStore, userMessage: string): void {
  store.bumpRelationship({ familiarityDelta: 0.02 });

  const emotionalSharing =
    /我(觉得|感到|心里|内心)|说实话|跟你说|其实/.test(userMessage);
  if (emotionalSharing) {
    store.bumpRelationship({ emotionalBondDelta: 0.05 });
  }

  if (/我(以前|之前|小时候|年轻|那时|曾经)/.test(userMessage)) {
    store.bumpRelationship({ emotionalBondDelta: 0.03 });
  }
}

function episodeMemoryEnabled(): boolean {
  const raw = (process.env.REMI_EPISODE_MEMORY_ENABLED ?? "1").trim().toLowerCase();
  return raw !== "0" && raw !== "false";
}

async function maybeRecordSharedMoment(
  store: SlowBrainStore,
  userMessage: string,
  assistantReply: string,
  userId: string,
): Promise<{
  moment: import("../memory/episode_store").MomentInput;
  episodeView: ReturnType<typeof toEpisodeV3View>;
} | null> {
  if (!episodeMemoryEnabled()) return null;

  const trimmedUser = userMessage.trim();
  const trimmedReply = assistantReply.trim();
  if (!trimmedUser || !trimmedReply) return null;
  if (isLightAcknowledgementTurn(trimmedUser)) return null;
  if (trimmedUser.length < 8) return null;
  if (/^(继续说|继续刚才|刚才说到哪|接着说|然后呢|嗯|哦|好吧)$/i.test(trimmedUser)) {
    return null;
  }

  const topic = detectSharedMomentTopic(trimmedUser, store);
  const mood = detectSharedMomentMood(trimmedUser, store);
  const kind = detectSharedMomentKind(trimmedUser, topic, mood);
  const unresolved = detectSharedMomentUnresolved(trimmedUser, assistantReply, kind);
  const statusHint = detectSharedMomentStatus(trimmedUser, assistantReply, kind, unresolved);
  const looksMeaningful = detectMeaningfulMomentSignal(trimmedUser, trimmedReply, topic, kind);
  if (!looksMeaningful) return null;

  const summary = buildSharedMomentSummary(trimmedUser, topic);
  const salience = estimateSharedMomentSalience(trimmedUser, mood, kind);
  const moment = {
    userId,
    summary,
    topic,
    mood,
    kind,
    salience,
    unresolved,
    statusHint,
  } satisfies import("../memory/episode_store").MomentInput;

  store.recordSharedMoment({
    summary,
    topic,
    mood,
    hook: buildSharedMomentHook(topic, store, trimmedUser),
    kind,
    salience,
    unresolved,
  });

  let episodeView = momentToEpisodeV3View(moment);

  try {
    const storedEpisode = await ingest(moment);
    episodeView = toEpisodeV3View(storedEpisode);
  } catch (err) {
    const health = getEmbeddingHealthSnapshot();
    logger.warn("episodeStore.ingest degraded; shared moment kept only in snapshot", {
      userId,
      topic: topic || undefined,
      mood,
      salience,
      unresolved,
      error: (err as Error).message,
      embeddingStatus: classifyEmbeddingError(err),
      embeddingConfigured: health.configured,
      embeddingBaseURL: health.baseURL ?? undefined,
      embeddingModel: health.model ?? undefined,
    });
  }
  return {
    moment,
    episodeView,
  };
}

function detectSharedMomentTopic(
  userMessage: string,
  store: SlowBrainStore,
): string {
  for (const { pattern, topic } of TOPIC_PATTERNS) {
    if (pattern.test(userMessage)) {
      return topic;
    }
  }

  const snapshot = store.getSnapshot();
  return snapshot.topicHistory
    .slice()
    .sort((a, b) => b.lastTurn - a.lastTurn || b.depth - a.depth)[0]?.topic ?? "";
}

function detectSharedMomentMood(
  userMessage: string,
  store: SlowBrainStore,
): string {
  for (const { keywords, mood } of MOOD_KEYWORDS) {
    if (keywords.some((kw) => userMessage.includes(kw))) {
      return mood;
    }
  }
  return store.getSnapshot().moodTrajectory.slice(-1)[0]?.mood ?? "平静";
}

function detectSharedMomentKind(
  userMessage: string,
  topic: string,
  mood: string,
): "support" | "stress" | "joy" | "goal" | "routine" | "bond" {
  if (/一起|陪你|你跟我说|我们聊到|你愿意和我说/u.test(userMessage)) {
    return "bond";
  }
  if (/计划|打算|准备|想要|目标|决定|试试看/u.test(userMessage)) {
    return "goal";
  }
  if (/开心|高兴|兴奋|松一口气|终于|好起来/u.test(userMessage) || mood === "开心") {
    return "joy";
  }
  if (
    /委屈|焦虑|崩溃|烦|难过|失眠|睡不着|误解|冲突|吵架|压力|欠|负债|赔偿|房租|还款|还到什么时候|喘不过气/u.test(userMessage) ||
    mood === "焦虑" ||
    mood === "难过" ||
    mood === "疲惫/烦躁"
  ) {
    return topic === "工作" || topic === "感情" || topic === "债务" ? "stress" : "support";
  }
  return "routine";
}

function detectMeaningfulMomentSignal(
  userMessage: string,
  assistantReply: string,
  topic: string,
  kind: "support" | "stress" | "joy" | "goal" | "routine" | "bond",
): boolean {
  if (topic) return true;

  const temporalOrEmotional =
    /今天|昨天|昨晚|最近|刚刚|第一次|一直|因为|结果|开心|难过|焦虑|累|失眠|散步|跑步|工作|朋友|家人/u;
  if (temporalOrEmotional.test(userMessage)) return true;

  const realWorldPressure =
    /欠|负债|花呗|贷款|网贷|还款|赔偿|赔了|月收入|月薪|工资|房租|现金|现金流|存款|手里只剩|还到啥时候|还到什么时候|压得|喘不过气/u;
  if (realWorldPressure.test(userMessage)) return true;

  if (kind === "stress" || kind === "support") {
    if (/后来|现在|最近|一直|又|还|没过去|卡住|压着/u.test(userMessage)) {
      return true;
    }
    if (/慢慢来|先别急|继续看看|一步一步/u.test(assistantReply)) {
      return true;
    }
  }

  return false;
}

function detectSharedMomentUnresolved(
  userMessage: string,
  assistantReply: string,
  kind: "support" | "stress" | "joy" | "goal" | "routine" | "bond",
): boolean {
  if (kind === "joy" || kind === "routine" || kind === "bond") return false;
  if (/已经好了|解决了|没事了|缓过来了|结束了|过去了/u.test(userMessage)) {
    return false;
  }
  if (/慢慢来|先别急|之后再看看|我们继续看看/u.test(assistantReply)) {
    return true;
  }
  return true;
}

function detectSharedMomentStatus(
  userMessage: string,
  assistantReply: string,
  kind: "support" | "stress" | "joy" | "goal" | "routine" | "bond",
  unresolved: boolean,
): EpisodeLifecycleStatus {
  if (
    /已经好了|已经解决|解决了|搞定了|处理好了|没事了|缓过来了|过去了|结束了|不用再聊|不用说这个|不聊这个了|不用担心了/u.test(
      userMessage,
    )
  ) {
    return "resolved";
  }
  if (unresolved) {
    return "active";
  }
  if (
    /后来|最近|刚刚|这阵子|继续|后面|这两天|现在|今天|昨天/u.test(userMessage) ||
    /先这样|慢慢来|有进展再说|后面再看/u.test(assistantReply) ||
    kind === "goal" ||
    kind === "support" ||
    kind === "stress"
  ) {
    return "cooling";
  }
  return "resolved";
}

function estimateSharedMomentSalience(
  userMessage: string,
  mood: string,
  kind: "support" | "stress" | "joy" | "goal" | "routine" | "bond",
): number {
  let score = 0.38;
  if (kind === "support" || kind === "stress") score += 0.22;
  if (kind === "goal" || kind === "joy") score += 0.12;
  if (kind === "bond") score += 0.15;
  if (/第一次|一直|总是|反复|真的|特别|很|太/u.test(userMessage)) score += 0.08;
  if (/委屈|焦虑|崩溃|开心|失眠|睡不着|误解|冲突/u.test(`${userMessage}${mood}`)) {
    score += 0.1;
  }
  if (userMessage.length >= 18) score += 0.06;
  return clamp01(score);
}

function buildSharedMomentSummary(userMessage: string, topic: string): string {
  const clipped = clipText(userMessage, 38);
  if (topic) {
    return `${topic}：用户围绕这个主题提到「${clipped}」。`;
  }
  return `用户提到「${clipped}」。`;
}

function buildSharedMomentHook(
  topic: string,
  store: SlowBrainStore,
  userMessage: string,
): string {
  const snapshot = store.getSnapshot();
  const relevant = snapshot.proactiveTopics.find((entry) => {
    if (!topic) return false;
    return entry.includes(topic) || userMessage.includes(topic);
  });
  if (relevant) return relevant;
  if (topic) return `${topic}这条线后来怎么样了？`;
  return snapshot.proactiveTopics[0] ?? "那条未完情况后来有新进展吗？";
}

function clipText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}
