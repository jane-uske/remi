// ── Slow Brain ──────────────────────────────────────────────
// Runs asynchronously AFTER Fast Brain finishes streaming.
// Pipeline: local heuristics → LLM deep analysis → state update.
// NEVER blocks the response path.

import { complete, hasLlmConfig, type ChatMessage } from "../llm/qwen_client";
import { getConfig } from "../server/config";
import type { EpisodeLifecycleStatus } from "../memory/episode_store";
import { ingest } from "../memory/episode_store";
import { recordTextArchiveEntry } from "../cold_layer/text_archive_ledger";
import {
  classifyEmbeddingError,
  getEmbeddingHealthSnapshot,
} from "../llm/embedding_client";
import type { MemoryRepository, UpsertOptions } from "../memory/memory_repository";
import {
  relationshipStateEnabled,
  savePersistentRelationshipState,
} from "../memory/relationship_state";
import { momentToEpisodeV3View, toEpisodeV3View } from "../memory/episode_v3";
import {
  isLightAcknowledgementTurn,
  isVolatileMemoryKey,
} from "../memory/prompt_memory_support";
import type { PromptMessage } from "../brain/prompt_builder";
import { createLogger } from "../infra/logger";
import type { SlowBrainStore } from "./background_analysis_store";
import { isNsfwEnabled } from "./nsfw_mode";
import { runProjectMemoryAnalysis } from "./project_memory_analysis";
import { normalizeExtractedFact, normalizeFactKey, identityGateRejectionReason } from "./fact_postprocess";
import type { TemporalFactsRepository } from "../storage/repositories/temporal_facts_repository";

const logger = createLogger("background_analysis");

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
  /** M3-P2: bi-temporal 事实仓库（可选，无 DB 时为 InMemory 实现或 undefined） */
  temporalFactsRepo?: TemporalFactsRepository;
  signal?: AbortSignal;
  /**
   * 观察日期覆盖（YYYY-MM-DD）。仅供离线回填（scripts/memory_backfill.ts）
   * 重放历史批次时传入消息的原始日期，让"明天/昨晚"这类相对时间换算和
   * 状态类事实的日期标注都锚在事发当天而不是回填执行日。线上不传，取当天。
   */
  observationDateOverride?: string;
}

// ── Public API ──

export async function runSlowBrain(input: SlowBrainInput): Promise<void> {
  const t0 = Date.now();
  const { userId, userMessage, assistantReply, history, slowBrain, memoryRepo } =
    input;
  const relationshipRepo = input.relationshipRepo ?? memoryRepo;
  const lightTouchTurn = isLightTouchTurn(userMessage);

  slowBrain.recordTurn();
  const slowMemoryWrites: { key: string; value: string }[] = [];
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
        input.connId,
        input.temporalFactsRepo,
        input.userId,
        input.observationDateOverride,
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
  const nsfwActive = isNsfwEnabled(input.connId);
  const sharedMomentRecord = !lightTouchTurn && !nsfwActive
    ? await maybeRecordSharedMoment(slowBrain, userMessage, assistantReply, userId)
    : null;

  if (relationshipStateEnabled() && relationshipRepo && !nsfwActive) {
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

  // Project Memory Layer: extract reusable project info (decisions / progress /
  // working style / performance profiles) off the hot path. Self-gates on
  // flag + worthiness + LLM config; never throws into the slow-brain pipeline.
  if (!lightTouchTurn && !nsfwActive) {
    await runProjectMemoryAnalysis({
      userId,
      userMessage,
      assistantReply,
      history,
      repo: relationshipRepo,
      signal: input.signal,
      connId: input.connId,
    });
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
  user_facts?: { key: string; value: string; confidence?: number; source?: "user" | "assistant" }[];
  interests?: string[];
  personality_note?: string;
  emotional_undertone?: string;
  conversation_summary?: string;
  proactive_topics?: string[];
  relationship_signal?: "warming" | "stable" | "cooling";
  /** M3-P1: Core Memory 差分编辑。慢脑产出 add/update/remove 操作。 */
  core_memory_edits?: { op: string; section: string; key: string; value?: string }[];
  /** M3-P2: bi-temporal 事实。会变的事实（工作状态、城市、关系状态等），用于时序记忆。 */
  temporal_facts?: { subject: string; predicate: string; object: string }[];
}

const ANALYSIS_PROMPT = `你是一个对话分析引擎，不是对话参与者。
分析以下对话片段，提取结构化信息。

严格返回合法 JSON（不要 markdown 代码块），格式如下：
{
  "user_facts": [{"key": "...", "value": "...", "confidence": 0.9, "source": "user"}],
  "interests": ["..."],
  "personality_note": "对用户性格的一句话观察，没有明显观察则为空字符串",
  "emotional_undertone": "用户在这段对话中的深层情绪（一两个词）",
  "conversation_summary": "在【已有摘要】基础上增量更新后的整段对话摘要（一到三句，覆盖整段关系，而不是只概括最近几轮）",
  "proactive_topics": ["Remi 下次可以主动提起的话题"],
  "relationship_signal": "warming 或 stable 或 cooling",
  "core_memory_edits": [{"op": "add|update|remove", "section": "aboutYou|aboutUs|rightNow", "key": "...", "value": "..."}],
  "temporal_facts": [{"subject": "用户的工作", "predicate": "状态", "object": "在还债"}]
}

注意：
- user_facts 只提取用户明确提到的事实（姓名、年龄、职业、住所等），不要猜测
- 用户的疑问句不是事实陈述：他问"今天是周一？""我是不是该睡了？"是在求证或质疑，绝不能把问句内容当成事实提炼（例如从"今天是周一？"提炼出"星期=周一"就是错的）；助手回复里的说法同样不是用户事实
- user_facts confidence 表示事实可靠程度（0.0–1.0），用户直接说"我叫X"给0.9+，推测性的给0.5以下
- user_facts source 标注事实来源："user" 表示用户直接陈述，"assistant" 表示助手推断
- 【全部输出字段】（user_facts/conversation_summary/proactive_topics/core_memory_edits/temporal_facts）都严禁出现指示性时间词（明天/昨天/上次/最近/现在/今晚/这周/仍在/刚才等）：这些词的所指会随日期漂移，这份分析会被之后任何一天读到，一旦写入就永久失真。提到这类词时，必须参照【观察日期】换算成绝对表述，例如"明天要早起"→"周一（2026-06-24）要早起"，"昨晚没睡好"→"6月28日晚没睡好"，"晚上20:22仍在加班"→"6月24日加班到深夜"
- conversation_summary 增量更新时，还要把【已有摘要】里遗留的瞬时表述一并改写成过去式绝对表述（如"仍在加班"→"6月24日曾加班到深夜"）或直接移除——摘要是滚动继承的，不修正就会永远带着过期状态
- proactive_topics 必须是不依赖具体日期也成立的话题（如"工作日早起的安排"而不是"周一早起的安排"）
- user_facts 按性质分两类，写法不同：
  1. 属性类（车辆/城市/职业/口味/关系称呼等长期不变的事实）：直接写值，不需要带日期，如 {"key": "交通工具", "value": "Tesla"}
  2. 状态类（身体状况/情绪/作息/临时安排等会过期的快照）：value 必须附带【观察日期】换算出的具体日期，如 {"key": "身体状况", "value": "胃痛、失眠（2026-06-28记）"}，让后续读到这条记忆的人知道这是哪天的状态、不是现状
- 纯瞬时的状态（刚睡醒、今晚困、正在通勤等只在本轮对话当下成立、脱离对话即无意义的表述）不要写进 user_facts——那不是可复用的长期记忆，写进去只会污染记忆库
- interests 只提取用户表现出兴趣的事物
- conversation_summary 必须在【已有摘要】基础上做增量更新：融入【最新一轮】的新进展，保留仍然重要的旧信息不要丢弃；若本轮无实质进展，就在旧摘要上做最小改动或原样保留。它要累积覆盖整段关系，而不是只概括最近几轮
- proactive_topics 是未来可以自然聊到的话题，基于用户兴趣
- core_memory_edits 用于维护用户的核心记忆块。aboutYou 记关于用户的事实/偏好（如名字、城市、工作状态），aboutUs 记关系相关（如关系阶段变化），rightNow 记当前上下文（如活跃线程、待解决的事）。op=add 新增，update 更新已有 key 的值，remove 删除不再成立的条目。只在有变化时才输出，没变化可以不写这个字段
- temporal_facts 提取会随时间变化的事实（如工作状态、居住城市、感情状况），subject 是实体，predicate 是关系，object 是当前值。只在发现新的或变化的事实时才输出，没有则不写`;

/**
 * 构造慢脑摘要分析消息。导出供测试：验证"喂回上一版摘要 + 增量累积"，而不是
 * 只镜像最近窗口。recentHistory 仅作本轮新增上下文；窗口外的旧信息由
 * priorSummary 承载，不依赖窗口保留（修 history.slice(-8) + 整条覆盖的洞）。
 */
export function buildAnalysisMessages(input: {
  userMessage: string;
  assistantReply: string;
  history: PromptMessage[];
  priorSummary: string;
  observationDate: string;
}): ChatMessage[] {
  const recentHistory = input.history.slice(-8);
  const historyText = recentHistory
    .map((m) => `${m.role === "user" ? "用户" : "Remi"}：${m.content}`)
    .join("\n");
  const currentTurn = `用户：${input.userMessage}\nRem：${input.assistantReply}`;
  const priorBlock = input.priorSummary.trim() || "（暂无，本轮为首次生成）";
  return [
    { role: "system", content: ANALYSIS_PROMPT },
    {
      role: "user",
      content:
        `【观察日期】${input.observationDate}\n\n` +
        `【已有摘要】（在此基础上增量更新，保留仍然重要的旧信息）：\n${priorBlock}\n\n` +
        `最近对话（仅本轮新增上下文，不要因为它没出现就丢弃已有摘要里更早的信息）：\n${historyText}\n\n` +
        `最新一轮：\n${currentTurn}`,
    },
  ];
}

async function llmAnalysis(
  userMessage: string,
  assistantReply: string,
  history: PromptMessage[],
  store: SlowBrainStore,
  memoryRepo: MemoryRepository,
  signal?: AbortSignal,
  connId?: string,
  temporalFactsRepo?: TemporalFactsRepository,
  userId?: string,
  observationDateOverride?: string,
): Promise<void> {
  const observationDate =
    observationDateOverride ?? new Date().toISOString().slice(0, 10);
  const messages = buildAnalysisMessages({
    userMessage,
    assistantReply,
    history,
    priorSummary: store.getSnapshot().conversationSummary,
    observationDate,
  });

  const raw = await complete(messages, 512, signal);
  const analysis = parseAnalysis(raw);
  if (!analysis) return;

  // NSFW 模式下跳过所有可能污染持久化人格画像的字段（interests /
  // personalityNotes / conversationSummary / proactiveTopics），
  // 只保留客观 user_facts 和 emotional_undertone。
  const nsfwActive = isNsfwEnabled(connId);
  if (nsfwActive) {
    logger.debug("NSFW 模式：跳过 interests/personalityNotes/summary/proactiveTopics 持久化", {
      connId,
    });
  }

  if (analysis.user_facts) {
    for (const { key, value, confidence, source } of analysis.user_facts) {
      if (!key || !value) continue;
      const k = key.trim();
      const v = value.trim();
      // 瞬时键（当前时间 / 现在 / 今天…）不是长期记忆，跳过持久化，
      // 否则会以 "当前时间:23:14" 这类噪声污染 facts 和 memories 表。
      if (isVolatileMemoryKey(k)) {
        logger.debug("跳过瞬时 fact 持久化", { key: k });
        continue;
      }
      // 构造性校验层：key 时间词剥离/超长截断、状态类 fact 自动补观察日期、
      // 残留指示性时间词兜底、低置信度推断过滤、身份类高危键第一人称直陈门槛
      // （"阿兵案"根治：虚构叙事场景里的人名/职业不得被当成用户本人事实）。
      // null 表示这条 fact 不值得保留——store.addFact（会话内存）和
      // memoryRepo.upsert（长期持久化）两条消费路径共用同一次归一化结果，
      // 一起跳过（不是只挡 DB 写入）。
      const normalized = normalizeExtractedFact({ key: k, value: v, confidence, source }, observationDate, userMessage);
      if (!normalized) {
        // 身份类高危键门槛（规则 5）拒绝时单独记 INFO 日志，便于观测拦截率；
        // 其余拒绝原因（规则 1-4）维持原有 debug 级别，避免噪声升级。
        const identityRejectionReason = identityGateRejectionReason(normalizeFactKey(k), userMessage);
        if (identityRejectionReason) {
          logger.info("身份类高危键写入被拒绝", {
            key: k,
            value: v.slice(0, 60),
            reason: identityRejectionReason,
          });
        } else {
          logger.debug("fact 后处理校验未通过，跳过", { key: k, value: v.slice(0, 60) });
        }
        continue;
      }
      const { key: nk, value: nv } = normalized;
      store.addFact(nk, nv);
      // NSFW 模式下仍在内存保留 fact（当前会话可用），但不写入 DB，
      // 避免 NSFW 对话上下文产生的 fact（如角色扮演角色名）污染长期记忆。
      if (nsfwActive) continue;
      const upsertOpts: UpsertOptions = {
        attributedTo: source === "assistant" ? "assistant" : "user",
        validAt: Date.now(),
      };
      try {
        await memoryRepo.upsert(
          normalizeMemoryKey(nk),
          nv,
          typeof confidence === "number" && confidence >= 0 && confidence <= 1
            ? confidence
            : 0.55,
          upsertOpts,
        );
      } catch (err) {
        logger.warn("记忆同步失败", { key: nk, error: (err as Error).message });
      }
    }
  }

  if (analysis.interests && !nsfwActive) {
    for (const interest of analysis.interests) {
      if (interest) store.addInterest(interest);
    }
  }

  if (analysis.personality_note && !nsfwActive) {
    store.addPersonalityNote(analysis.personality_note);
  }

  if (analysis.emotional_undertone) {
    store.recordMood(analysis.emotional_undertone);
  }

  if (analysis.conversation_summary && !nsfwActive) {
    store.setConversationSummary(analysis.conversation_summary);
  }

  if (analysis.proactive_topics?.length && !nsfwActive) {
    store.setProactiveTopics(analysis.proactive_topics);
  }

  if (analysis.relationship_signal && !nsfwActive) {
    const delta =
      analysis.relationship_signal === "warming"
        ? 0.05
        : analysis.relationship_signal === "cooling"
          ? -0.03
          : 0.01;
    store.bumpRelationship({ emotionalBondDelta: delta });
  }

  // M3-P1: Core Memory 差分编辑
  if (analysis.core_memory_edits?.length && !nsfwActive) {
    const validOps = new Set(["add", "update", "remove"]);
    const validSections = new Set(["aboutYou", "aboutUs", "rightNow"]);
    const edits = analysis.core_memory_edits
      .filter((e) =>
        validOps.has(e.op) &&
        validSections.has(e.section) &&
        typeof e.key === "string" && e.key.trim(),
      )
      .map((e) => ({
        op: e.op as "add" | "update" | "remove",
        section: e.section as "aboutYou" | "aboutUs" | "rightNow",
        key: e.key.trim(),
        ...(e.op !== "remove" && e.value ? { value: e.value.trim() } : {}),
      }));
    if (edits.length > 0) {
      store.applyCoreMemoryEdits(edits as import("./core_memory").CoreMemoryEdit[]);
      logger.debug("Core Memory edits applied", { count: edits.length });
    }
  }

  // M3-P2: bi-temporal 事实写入（fire-and-forget，不阻塞）
  if (analysis.temporal_facts?.length && !nsfwActive && temporalFactsRepo && userId) {
    for (const tf of analysis.temporal_facts) {
      if (!tf.subject?.trim() || !tf.predicate?.trim() || !tf.object?.trim()) continue;
      void temporalFactsRepo.ingest(userId, {
        subject: tf.subject.trim(),
        predicate: tf.predicate.trim(),
        object: tf.object.trim(),
      }).catch((err) => logger.warn("temporal fact ingest failed", { error: (err as Error).message }));
    }
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
  return getConfig().REMI_EPISODE_MEMORY_ENABLED;
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

function buildSharedMomentSummary(userMessage: string, _topic: string): string {
  const clipped = clipText(userMessage, 38);
  // 不在这里点名具体 topic（连"聊到${topic}时"这种叙事化嵌入也不行）：
  // episode_store.buildEpisodeSummary 和 background_analysis_store 的两处
  // snapshot 渲染（长期关系主线/当前未完主线）都会各自在外层拼一次
  // `${topic}：${summary}`。旧版直接把 topic 又拼了一次，两层各拼一次产生
  // "工作：工作：..." 的重复前缀（2026-07 生产坏样本实证）；把 topic 具名
  // 嵌进叙事句同样会撞上这个坑，只是变成更隐蔽的 "工作：聊到工作时，用户
  // 提到…"——踩了同一个坑的换皮版本，本次改造过程中曾经引入又发现（同一
  // 会话内自查修正）。topic 参数保留形参签名（调用方传，未来可能要用），
  // 但 body 就是不点名它，统一交给外层 caller 拼一次。
  //
  // 叙事化框架（而不是「」裸引语）：这条 pipeline 是纯本地模板，没有 LLM
  // 可用来"概括"clip 原文——概括=编造改写的风险，不能本地做。能改的只有
  // 叙述外壳：不再把 clip 摆成"字段: 值"式的记录腔（"用户提到「xxx」。"
  // 读起来像机器人念数据库字段），而是嵌进一句有主语的陈述里（"用户提到
  // …"）。clip 内容 100% 保真不变，只是不再用引号把它 crop 出来当"证据
  // 展示"，读起来像在转述一件事而不是转储一条记录。
  const body = `用户提到${clipped}`;
  return endsWithTerminalPunct(body) ? body : `${body}。`;
}

function endsWithTerminalPunct(text: string): boolean {
  return /[。！？…]$/.test(text);
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
