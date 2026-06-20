import type { PromptMessage } from "../brain/prompt_builder";
import { EmotionRuntime } from "../emotion/emotion_runtime";
import type { MemoryRepository } from "../memory/memory_repository";
import type { PersistentRelationshipStateV1 } from "../memory/relationship_state";
import { SessionMemoryOverlayRepository } from "../memory/session_memory_overlay";
import { SlowBrainStore } from "./background_analysis_store";
import { trimHistoryToTokenBudget } from "./history_budget";
import { isFallbackAssistantReply } from "./assistant_reply_guard";
import type { DbMessage } from "../storage/types";
import {
  createDefaultPersona,
  applyPersonaProfilePreset,
  type PersonaState,
  type EnergyLevel,
  type ClosenessLevel,
  type AttentionState,
  type ProactiveIntent,
} from "../persona";
import {
  resetPersonaLiveState,
  type PersonaPresetId,
} from "./dev_presets";
import {
  detectAnswerNowSignal,
  detectDecisionSeekingSignal,
} from "../brain/tone_policy";
import { deriveRelationalStance } from "./relational_stance";
import {
  decayPersonaStyleOverride,
} from "../persona/style_override";
import type {
  ResponsePolicy,
  StructuredAnalysisSource,
  TurnInterpretation,
} from "../brain/turn_interpreter";

// ── Layer 2 派生逻辑 ─────────────────────────────────────────────
// 从 SlowBrainStore 已有数据推导 6 个角色状态字段，不引入额外计算。

function deriveEnergy(slowBrain: SlowBrainStore): EnergyLevel {
  const snapshot = slowBrain.getSnapshot();
  // 最近4轮情绪轨迹中负面情绪占比决定精力
  const recent = snapshot.moodTrajectory.slice(-4).map((e) => e.mood);
  if (recent.length === 0) return "medium";
  const negativeWords = ["委屈", "低落", "难过", "疲惫", "焦虑", "崩溃", "绷着", "烦躁"];
  const negCount = recent.filter((m) =>
    negativeWords.some((w) => m.includes(w)),
  ).length;
  if (negCount >= 3) return "low";
  if (negCount === 0) return "high";
  return "medium";
}

function deriveCloseness(slowBrain: SlowBrainStore): ClosenessLevel {
  const { familiarity, emotionalBond } = slowBrain.getSnapshot().relationship;
  const score = familiarity * 0.5 + emotionalBond * 0.5;
  if (score >= 0.75) return "dependent";
  if (score >= 0.55) return "relaxed";
  if (score >= 0.3) return "familiar";
  return "normal";
}

function deriveAttention(
  slowBrain: SlowBrainStore,
  topicPull: string,
): AttentionState {
  const snapshot = slowBrain.getSnapshot();
  // 有强牵引话题 → hooked
  if (topicPull) {
    const hasStrongUnresolvedMoment = snapshot.sharedMoments.some((entry) =>
      entry.unresolved &&
      (entry.salience ?? 0) >= 0.7 &&
      (entry.topic === topicPull || entry.summary.includes(topicPull)),
    );
    if (hasStrongUnresolvedMoment) {
      return "hooked";
    }
  }
  // 最近话题情绪高度负面 → scattered（情绪分散注意力）
  const lastMood = snapshot.moodTrajectory.slice(-1)[0]?.mood ?? "";
  const scattered = ["焦虑", "崩溃", "烦躁"].some((w) => lastMood.includes(w));
  if (scattered) return "scattered";
  return "focused";
}

function deriveTopicPull(slowBrain: SlowBrainStore): string {
  const snapshot = slowBrain.getSnapshot();
  // 优先取高显著、未解决的 shared moment
  const topMoment = snapshot.sharedMoments
    .filter((entry) => entry.unresolved && (entry.salience ?? 0) >= 0.6)
    .sort((a, b) =>
      (b.salience ?? 0) - (a.salience ?? 0) ||
      (b.recurrenceCount ?? 1) - (a.recurrenceCount ?? 1) ||
      b.turn - a.turn,
    )[0];
  if (topMoment?.topic) return topMoment.topic;
  // 退而取慢脑主动话题列表的第一条
  return snapshot.proactiveTopics[0] ?? "";
}

// ── Layer 4 派生逻辑 ─────────────────────────────────────────────
// 每轮决定一个轻主动行为信号，避免随机或无意义地触发。

const FOLLOWUP_TRIGGERS = [
  "压力", "担心", "难受", "委屈", "烦", "焦虑", "没办法", "不知道怎么",
  "想做", "打算", "计划", "想试试", "想去", "想改",
  "最近", "一直", "好久", "每天", "今天",
];

function isCallbackOpeningTurn(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/^(嗯+|哦+|啊+|欸+|诶+|好吧|还行|不知道|没事|随便聊聊|继续|然后呢|还有吗|你说)[。！？!?~～\s]*$/u.test(trimmed)) {
    return true;
  }
  return /(?:刚才|刚刚|上次|之前|那个|那件事|这件事|后来|最近|还).{0,10}(?:呢|怎么样|咋样|怎么说|继续)?[。！？!?~～\s]*$/u.test(trimmed);
}

function deriveProactiveIntent(
  userMessage: string,
  topicPull: string,
  slowBrain: SlowBrainStore,
  interpretation?: TurnInterpretation | null,
  responsePolicy?: ResponsePolicy | null,
): ProactiveIntent {
  const snapshot = slowBrain.getSnapshot();
  const turnCount = snapshot.relationship.turnCount;
  const msg = userMessage.trim();

  if (
    interpretation &&
    (
      interpretation.userAct === "decision_seek" ||
      interpretation.userAct === "answer_now" ||
      interpretation.userAct === "context_update" ||
      interpretation.userAct === "scene_continue" ||
      interpretation.userAct === "topic_veto"
    )
  ) {
    return "none";
  }
  if (responsePolicy?.questionBudget === 0 && responsePolicy.shouldGiveJudgment) {
    return "none";
  }

  // 用户在要明确判断，或已经嫌你老在反问时，本轮不要再抢成 followup/callback。
  if (detectDecisionSeekingSignal(msg) || detectAnswerNowSignal(msg)) {
    return "none";
  }

  // 追问：用户输入触发了情绪/计划/困难关键词
  if (FOLLOWUP_TRIGGERS.some((w) => msg.includes(w))) {
    return "followup";
  }

  // 回钩：只在用户话少、主动续接，或明显把话留给 Remi 时触发。
  if (topicPull) {
    const lastProactive = snapshot.continuityCueState?.lastProactiveTurn ?? -100;
    if (turnCount - lastProactive >= 6 && isCallbackOpeningTurn(msg)) {
      return "callback";
    }
  }

  // 偏好表达：每 8 轮最多一次，关系足够熟（familiar 以上）
  const closeness = deriveCloseness(slowBrain);
  const isClose = closeness === "familiar" || closeness === "relaxed" || closeness === "dependent";
  if (isClose && turnCount > 0 && turnCount % 8 === 0) {
    return "preference";
  }

  return "none";
}

/**
 * 单条 WebSocket 连接上的 Remi 状态：情绪、慢脑、对话历史、会话内记忆（C1）。
 */
export class RemiSessionContext {
  userId = "";
  readonly emotion: EmotionRuntime;
  readonly slowBrain: SlowBrainStore;
  readonly memory: SessionMemoryOverlayRepository;
  readonly history: PromptMessage[] = [];
  readonly persona: PersonaState;
  persistentRelationshipRepo: MemoryRepository | null = null;
  private clientTimeZone: string | null = null;
  private clientLocale: string | null = null;
  private slowBrainController: AbortController | null = null;
  /** 最后一次被打断的AI回复内容，用于回答「刚才说到哪了」 */
  lastInterruptedReply: string | null = null;
  /** 当前正在生成中的 AI 回复草稿，用于打断瞬间承接上下文。 */
  currentAssistantDraft: string | null = null;
  /** 本轮回复含图片或走生图流程时，pipeline 跳过 TTS。 */
  skipTtsThisTurn = false;
  lastInterpretation: TurnInterpretation | null = null;
  lastResponsePolicy: ResponsePolicy | null = null;
  analysisSource: StructuredAnalysisSource | null = null;
  analysisLatencyMs: number | null = null;

  constructor(readonly connId: string) {
    this.emotion = new EmotionRuntime(connId);
    this.slowBrain = new SlowBrainStore();
    this.memory = new SessionMemoryOverlayRepository();
    this.persona = createDefaultPersona();
  }

  hydratePersistentRelationshipState(
    state: PersistentRelationshipStateV1 | null,
  ): void {
    if (!state) return;
    this.slowBrain.hydratePersistentState(state);

    const snapshot = this.slowBrain.getSnapshot();
    const topicSummary =
      snapshot.conversationSummary.trim() ||
      snapshot.sharedMoments[0]?.summary ||
      snapshot.topicHistory
        .slice()
        .sort((a, b) => b.lastTurn - a.lastTurn || b.depth - a.depth)
        .slice(0, 3)
        .map((entry) => entry.topic)
        .join("、");

    // 初始化会话时用关系历史预热 Layer 2 状态
    const topicPull = deriveTopicPull(this.slowBrain);
    this.persona.liveState.topicPull = topicPull;
    this.persona.liveState.lastTopicSummary = topicSummary || topicPull || "无最近话题";
    this.persona.liveState.energy = deriveEnergy(this.slowBrain);
    this.persona.liveState.closeness = deriveCloseness(this.slowBrain);
    this.persona.liveState.attention = deriveAttention(this.slowBrain, topicPull);
    this.persona.liveState.relationalStance = deriveRelationalStance(snapshot);

    // Gap 3：恢复上次情绪（仅恢复类型，不恢复 intensity）
    if (state.lastEmotion) {
      this.emotion.setEmotion(state.lastEmotion as import("../emotion/emotion_state").Emotion);
    }
  }

  attachPersistentRelationshipRepo(repo: MemoryRepository): void {
    this.persistentRelationshipRepo = repo;
  }

  setUserId(userId: string): void {
    this.userId = userId;
  }

  setClientContext(input: { timeZone?: string | null; locale?: string | null }): void {
    const nextTimeZone = input.timeZone?.trim() || null;
    if (nextTimeZone) {
      try {
        new Intl.DateTimeFormat("zh-CN", { timeZone: nextTimeZone }).format(new Date());
        this.clientTimeZone = nextTimeZone;
      } catch {
        this.clientTimeZone = null;
      }
    } else {
      this.clientTimeZone = null;
    }

    const nextLocale = input.locale?.trim() || null;
    this.clientLocale = nextLocale ? nextLocale.slice(0, 64) : null;
  }

  getClientTimeZone(): string | null {
    return this.clientTimeZone;
  }

  getClientLocale(): string | null {
    return this.clientLocale;
  }

  hydrateHistoryFromDb(messages: DbMessage[]): void {
    const rawHistory: PromptMessage[] = messages
      .filter((m) => {
        if (m.role === "user") return true;
        if (m.role !== "assistant") return false;
        return !isFallbackAssistantReply(m.content);
      })
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    const trimmed = trimHistoryToTokenBudget(rawHistory);
    this.history.splice(0, this.history.length, ...trimmed);

    // 同步 recentInteractions 供 buildPersonaPrompt() 使用
    const tail = trimmed.slice(-6);
    this.persona.liveState.recentInteractions.splice(
      0,
      this.persona.liveState.recentInteractions.length,
      ...tail.map((m) =>
        m.role === "user" ? `用户：${m.content}` : `你：${m.content}`,
      ),
    );
  }

  applyPersonaPreset(presetId: PersonaPresetId): void {
    this.applyUserPersonaPreset(presetId);
    resetPersonaLiveState(this.persona);
  }

  applyUserPersonaPreset(presetId: PersonaPresetId): void {
    applyPersonaProfilePreset(this.persona, presetId);
  }

  resetSessionArtifacts(): void {
    this.history.splice(0, this.history.length);
    this.lastInterruptedReply = null;
    this.currentAssistantDraft = null;
    this.lastInterpretation = null;
    this.lastResponsePolicy = null;
    this.analysisSource = null;
    this.analysisLatencyMs = null;
    this.emotion.setEmotion("neutral");
    resetPersonaLiveState(this.persona);
    this.cancelSlowBrain();
  }

  cancelSlowBrain(): void {
    if (!this.slowBrainController) return;
    this.slowBrainController.abort();
    this.slowBrainController = null;
  }

  /**
   * 只在真实用户打断时调用，不能由后台慢脑取消来触发。
   */
  markInterrupted(): void {
    this.persona.liveState.lastInterrupted = true;
    this.persona.liveState.wasInterrupted = true;
  }

  beginSlowBrain(): AbortSignal {
    this.cancelSlowBrain();
    const controller = new AbortController();
    this.slowBrainController = controller;
    return controller.signal;
  }

  endSlowBrain(signal: AbortSignal): void {
    if (this.slowBrainController?.signal === signal) {
      this.slowBrainController = null;
    }
  }

  /**
   * 从文本中提取关键词（轻量规则版）
   */
  private extractKeywords(text: string): string[] {
    const stopWords = new Set([
      "的", "了", "啊", "哦", "嗯", "呀", "呢", "吗", "吧",
      "我", "你", "他", "她", "它", "我们", "你们", "他们",
      "是", "有", "在", "要", "去", "哦", "嗯",
    ]);
    return text
      .replace(/[\p{P}]/gu, " ")
      .split(/\s+/)
      .filter((word) => word.length > 1 && !stopWords.has(word))
      .map((word) => word.toLowerCase());
  }

  /**
   * 自动生成最近话题摘要（轻量规则版）
   */
  private generateTopicSummary(): string {
    const recent = this.persona.liveState.recentInteractions.slice(-4);
    if (recent.length === 0) return "无最近话题";
    const content = recent.map((line) => line.replace(/^(用户|你)：/, "")).join(" ");
    const keywords = this.extractKeywords(content);
    if (keywords.length === 0) return "闲聊";
    return keywords.slice(0, 5).join("、");
  }

  /**
   * 判断是否延续上一话题
   */
  private isContinuingPreviousTopic(currentUserInput?: string): boolean {
    if (!currentUserInput) return false;

    const continuationPhrases = [
      "继续说", "刚才说到哪", "接着说", "然后呢", "还有吗",
      "之前说的", "刚才的话题", "继续刚才的", "还是那个", "上次那个", "回到刚才",
    ];
    if (continuationPhrases.some((phrase) => currentUserInput.toLowerCase().includes(phrase))) {
      return true;
    }

    const currentKeywords = this.extractKeywords(currentUserInput);
    if (currentKeywords.length === 0) return false;

    const recentContent = this.persona.liveState.recentInteractions
      .slice(-3)
      .map((line) => line.replace(/^(用户|你)：/, ""))
      .join(" ");
    const slowBrainSnapshot = this.slowBrain.getSnapshot();
    const fallbackSummary = [
      this.persona.liveState.lastTopicSummary,
      slowBrainSnapshot.conversationSummary,
      ...slowBrainSnapshot.sharedMoments.slice(0, 2).map((e) => e.summary),
      ...slowBrainSnapshot.relationship.preferredTopics,
    ]
      .filter(Boolean)
      .join(" ");
    const sourceText = recentContent || fallbackSummary;
    if (!sourceText || sourceText === "无最近话题") return false;

    const recentKeywords = this.extractKeywords(sourceText);
    const recentKeywordSet = new Set(recentKeywords);
    const overlap = currentKeywords.filter((k) => recentKeywordSet.has(k)).length;
    return overlap / currentKeywords.length > 0.3;
  }

  /**
   * 每轮对话结束后更新 Layer 2 状态（6 字段全部重新派生）。
   */
  updateLiveState(
    mood?: string,
    lastUserMessage?: string,
    lastAssistantReply?: string,
  ): void {
    const liveState = this.persona.liveState;

    // 心情
    if (mood) {
      liveState.mood = mood;
      liveState.currentMood = mood;
      liveState.emotionalState =
        mood === "neutral" ? "平静" :
        mood === "happy"   ? "开心" :
        mood === "curious" ? "好奇" :
        mood === "shy"     ? "害羞" :
        mood === "sad"     ? "难过" : "平静";
    }

    // 最近交互记录（最多保留6条）
    if (lastUserMessage) {
      liveState.recentInteractions.push(`用户：${lastUserMessage}`);
      if (liveState.recentInteractions.length > 6) liveState.recentInteractions.shift();
    }
    if (lastAssistantReply) {
      liveState.recentInteractions.push(`你：${lastAssistantReply}`);
      if (liveState.recentInteractions.length > 6) liveState.recentInteractions.shift();
    }

    // Layer 2：从 slowBrain 派生其余4个字段
    const topicPull = deriveTopicPull(this.slowBrain);
    liveState.topicPull = topicPull;
    liveState.energy = deriveEnergy(this.slowBrain);
    liveState.closeness = deriveCloseness(this.slowBrain);
    liveState.attention = deriveAttention(this.slowBrain, topicPull);
    liveState.relationalStance = deriveRelationalStance(this.slowBrain.getSnapshot());

    // Layer 4：决定本轮主动意图
    liveState.proactiveIntent = lastUserMessage
      ? deriveProactiveIntent(
          lastUserMessage,
          topicPull,
          this.slowBrain,
          this.lastInterpretation,
          this.lastResponsePolicy,
        )
      : "none";

    // 话题延续检测 & 摘要
    liveState.isContinuingTopic = this.isContinuingPreviousTopic(lastUserMessage);
    liveState.lastTopicSummary = this.generateTopicSummary();

    // 打断标记仅生效一轮
    liveState.lastInterrupted = false;
    liveState.wasInterrupted = false;
    liveState.styleOverride = decayPersonaStyleOverride(liveState.styleOverride);
  }
}
