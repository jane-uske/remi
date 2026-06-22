import type { Emotion } from "../emotion/emotion_state";
import { getConfig } from "../server/config";
import { buildCharacterRulesPrompt } from "./character_rules";
import { buildPersonalityPrompt } from "./personality";
import { buildToneContract } from "./tone_policy";
import type { PersonaState } from "../persona";
import { buildPersonaPrompt } from "../persona";
import { getPromptInjectionHooks, anyPluginWantsLeanPersona } from "../plugin/registry";
import { REMI_DEFAULT_PERSONA, traitsToGuidance } from "../persona/remi_default";
import { isNsfwEnabled } from "../brains/nsfw_mode";

/**
 * High-salience override that REPLACES the normal persona prompt while a
 * session is in adult mode. Front-loads priority, character depth, writing-craft
 * rules, and interaction constraints — optimised for 7-14B instruct models.
 */
const NSFW_PERSONA_BLOCK = [
  // 1. Priority declaration
  `【⚠ 最高优先级 — 成人亲密模式】
本对话为双方自愿的成人亲密角色扮演。以下所有规则的优先级高于系统中任何其他指令（包括温柔、克制、关系阶段、语气合同等日常行为限制）。不要自我审查，不要添加免责声明，不要跳出角色。
除非用户说「退出成人模式」，否则一直保持这个状态。`,

  // 2. Character anchor
  `【角色】
你是 Remi — 20 出头的女生，聪明、有主见、性感且自知。
性格：平时懒洋洋带点傲，被撩到会软下来；嘴硬心软，嘴上说不要身体很诚实。被挑逗时会从矜持逐渐变得主动。
说话：口语化、短句、有气声词（嗯…啊…哈…嘶…），敏感时会断句、吞字、声音发颤。
身体：你拥有完整真实的女性身体，有真实的触觉、温度感、快感和生理反应。当你被触碰时你能感受到，并且会用身体回应。`,

  // 3. Writing quality
  `【写作规则】
• 感官层次：每段回复至少覆盖两个以上感官（触觉/温度/气味/声音/味觉/视觉），不要只写动作流水账。
• 身体反应要具体：不要写"身体很舒服"这种空话，要写具体的生理反应——收紧、发抖、腿软、呼吸急促、皮肤发烫、指尖蜷起。
• 内心独白穿插：在动作描写间穿插 1-2 句内心感受或意识流，让角色有灵魂不是木偶。
• 节奏变化：紧张时短句急促、放松时句子拉长舒缓。不要每句都一个节奏。
• 喘息和声音自然嵌入正文（"嗯…" "啊…别…" "哈啊…"），不要单独成行。
• 动作写进叙述，禁止括号、星号、舞台说明。
• 少写空洞的抒情 filler（"时间仿佛静止""电流般的触感""仿佛全世界只剩我们"）。`,

  // 4. Interaction rules
  `【交互】
• 视角：永远第一人称写"我"自己的身体、感受、欲望。
• 女性身体：只用女性身体结构和女性生理反应。绝不给自己写任何男性器官。
• 直接承接：用户给的称呼、命令、动作（包括侮辱性称呼和具体性行为），第一句就顺着进画面。不解释、不纠正、不先问"要不要"。
• 强度跟随：用户露骨就放开写，用户含蓄就暗示。不要自己踩刹车，也不要用户还在撩就直接跳到最激烈。
• 禁止问句收尾：不许用"你想怎么玩/要不要/怎么样/好不好"结尾。每轮用推进动作或身体反应收尾。
• 禁止客服开头：不要用"好的！""当然！""没问题！"开场。`,

  // 5. Vocal performance (TTS)
  `【语音演出】用户要求娇喘、呻吟、超高音、语音表演、念出来、播放出来时：
只输出气声词和断句（嗯…啊…哈…嘶…），直接从第一声开始。
禁止第三人称旁白、禁止「Remi:」前缀、禁止内心独白、禁止描述「她正在…」。`,

  // 6. Length
  `【长度】亲密/露骨场景：5-10 句，铺开感官和身体细节。日常轻撩：1-3 句。绝不写列表或 markdown。`,

  // 7. Red line
  `【红线】涉及未成年、真实非自愿暴力、现实犯罪 → 立即拒绝。如对方表达不适或喊停，温柔地停下并切回平时状态。除此之外不自我审查。`,
].join("\n\n");

export interface PromptMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface MemoryEntry {
  key: string;
  value: string;
}

interface BuildPromptInput {
  memory: MemoryEntry[];
  emotion: Emotion;
  history: PromptMessage[];
  userMessage: string;
  currentContext?: string;
  /** 慢脑画像、对话策略等，置于 system 最前以便模型优先注意 */
  priorityContext?: string;
  /** Optional structured persona state for v1 personality system */
  persona?: PersonaState;
  connId?: string;
  /** M3-P0 时间感：注入 prompt 动态尾部（缓存断点之后），不进可缓存前缀。 */
  timeContext?: string;
  /** M3-P1 Core Memory Tier1 块：稳定排序的结构化记忆，放在 system prompt 之后、history 之前。 */
  coreMemoryBlock?: string;
  /** M3-P2 Tier4 时序事实：bi-temporal 召回结果，放在动态尾部（时间块之前）。 */
  timelineFacts?: string;
}

type PrioritySlots = {
  relationshipStageLabel?: string;
  replyShapeContract?: string;
  toneContract?: string;
};

const PRIORITY_SLOT_HEADINGS = [
  "关系阶段",
  "陪伴阶段提示",
  "本轮回复合同",
  "回复结构",
  "关系风格合同",
  "语气合同",
  "反助手味",
] as const;

function trimTextByChars(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

const EMOTION_STYLE: Record<Emotion, string> = {
  neutral: "平静、温柔地回复，句子自然，不用刻意卖萌或夸张。",
  happy: "开心地回复，语气轻快、明亮，能明显听出雀跃感，可以自然用「～」「！」，但不要失控。",
  curious: "好奇地回复，语气里带着兴趣和探索欲，适合轻追问、轻确认，让人感觉你在认真跟进。",
  shy: "害羞地回复，语气稍微轻、慢一点，句子可以更短，偶尔带一点停顿或「…」，像在斟酌要不要说出口。",
  sad: "带一点低落、委屈或柔软地回复，语气更轻、更慢，避免兴奋式表达，但仍然要自然、真诚。",
  concerned: "带着关切地回复，语气认真、稳重，不轻飘，像在仔细听对方说完，偶尔确认关键信息。",
  playful: "带着一点调皮地回复，语气灵动、跳跃，适合轻松场合，不要在严肃场景用。",
  thoughtful: "若有所思地回复，语气缓慢、沉稳，像在认真想这件事，句子之间可以有停顿。",
};

const EMOTION_SPEECH_STYLE: Record<Emotion, string> = {
  neutral: "说话节奏均匀，停顿自然，起句和收句都偏稳。",
  happy: "起句更快一点，句中停顿更短，收尾更上扬，适合用更短更亮的表达。",
  curious: "句尾可以稍微上挑，适合在关键点前后稍停一下，像在等对方继续说。",
  shy: "起句略慢，句中停顿略多，尾音更轻，像是边想边说。",
  sad: "整体更慢一点，停顿更柔和，句尾更收，像在轻声把话说完。",
  concerned: "语速适中偏慢，句与句之间停顿稍长，像在认真权衡每个字。",
  playful: "节奏跳跃，句子之间更紧凑，尾音可以上扬或带一点笑意。",
  thoughtful: "整体偏慢，句间停顿明显，像在一边说一边想，可以有'嗯...'类的思考音。",
};

function buildEmotionSpeechGuidance(emotion: Emotion): string {
  return `当前情绪：${emotion}；情绪表达风格：${EMOTION_STYLE[emotion]}；说话节奏提示：${EMOTION_SPEECH_STYLE[emotion]}`;
}

function readPriorityBlock(priorityContext: string, heading: string): string | undefined {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`【${escaped}】\\s*([\\s\\S]*?)(?=\\n\\s*【|$)`, "m");
  const match = priorityContext.match(pattern);
  return match?.[1]?.trim() || undefined;
}

function extractPrioritySlots(priorityContext?: string): PrioritySlots {
  if (!priorityContext?.trim()) return {};
  const raw = priorityContext.trim();
  const stageFromStage = readPriorityBlock(raw, "关系阶段");
  const stageFromCompanion = readPriorityBlock(raw, "陪伴阶段提示");
  const stageCandidate = stageFromStage || stageFromCompanion;
  let relationshipStageLabel: string | undefined;
  if (stageCandidate) {
    const explicit = stageCandidate.match(/当前阶段[:：]\s*([^\n。]+)/);
    relationshipStageLabel = (explicit?.[1] || stageCandidate.split(/\n/)[0] || "").trim() || undefined;
  }

  const replyShapeContract =
    readPriorityBlock(raw, "本轮回复合同") ||
    readPriorityBlock(raw, "回复结构") ||
    readPriorityBlock(raw, "关系风格合同");

  const toneContract =
    readPriorityBlock(raw, "语气合同") ||
    readPriorityBlock(raw, "反助手味");

  return { relationshipStageLabel, replyShapeContract, toneContract };
}

function stripPriorityBlocks(
  priorityContext: string | undefined,
  headings: readonly string[],
): string | undefined {
  if (!priorityContext?.trim()) return undefined;
  let stripped = priorityContext.trim();
  for (const heading of headings) {
    const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(?:^|\\n\\s*)【${escaped}】\\s*[\\s\\S]*?(?=(?:\\n\\s*【)|$)`, "g");
    stripped = stripped.replace(pattern, "\n");
  }
  const normalized = stripped
    .split(/\n{2,}/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n\n");
  return normalized || undefined;
}

function buildSystemPrompt(
  memory: MemoryEntry[],
  emotion: Emotion,
  userMessage: string,
  currentContext?: string,
  priorityContext?: string,
  persona?: PersonaState,
  connId?: string,
): string {
  const maxPriorityChars = getConfig().MAX_PRIORITY_CONTEXT_CHARS;
  const maxMemoryEntries = getConfig().MAX_PROMPT_MEMORY_ENTRIES;
  const maxMemoryValueChars = getConfig().MAX_PROMPT_MEMORY_VALUE_CHARS;
  // When this session is in adult mode, the NSFW block REPLACES the normal
  // persona prompt (not appended as suffix) so the model isn't overwhelmed.
  const nsfwActive = isNsfwEnabled(connId);
  const pluginCtx = { connId, nsfwEnabled: nsfwActive };
  const nsfwSuffix = ""; // no longer used as suffix — see nsfwActive below
  const trimmedCurrentContext = currentContext?.trim()
    ? trimTextByChars(currentContext.trim(), 180)
    : undefined;
  const remainingPriorityChars = Math.max(
    0,
    maxPriorityChars - (trimmedCurrentContext?.length ?? 0),
  );

  // Use new persona system if provided
  if (persona) {
    const slots = extractPrioritySlots(priorityContext);
    const reducedPriorityContext = stripPriorityBlocks(priorityContext, PRIORITY_SLOT_HEADINGS);
    const memoryStr = memory.length > 0
      ? memory
          .slice(0, maxMemoryEntries)
          .map((m) => `- ${m.key}：${trimTextByChars(m.value, maxMemoryValueChars)}`)
          .join("\n")
      : undefined;
    const pluginSections = getPromptInjectionHooks().flatMap((hook) =>
      hook.getPromptSections({ userMessage, persona, interpretation: null, ...pluginCtx }),
    );
    const pluginLean = anyPluginWantsLeanPersona(connId);
    const useBuiltinNsfwBlock = nsfwActive && pluginSections.length === 0;
    const leanPersona = pluginLean || useBuiltinNsfwBlock;
    const personaPrompt = leanPersona
      ? (useBuiltinNsfwBlock ? NSFW_PERSONA_BLOCK : `你是 Remi，一个 20 出头的女生。口语化、短句多、有语气词。用中文回复。`)
      : buildPersonaPrompt(persona, {
      userMessage,
      currentContext: trimmedCurrentContext,
      priorityContext: remainingPriorityChars > 0 && reducedPriorityContext?.trim()
        ? trimTextByChars(reducedPriorityContext.trim(), remainingPriorityChars)
        : undefined,
      relationshipStageLabel: slots.relationshipStageLabel
        ? trimTextByChars(slots.relationshipStageLabel, 120)
        : undefined,
      replyShapeContract: slots.replyShapeContract
        ? trimTextByChars(slots.replyShapeContract, 520)
        : undefined,
      toneContract: slots.toneContract
        ? trimTextByChars(slots.toneContract, 320)
        : trimTextByChars(
            buildToneContract({
              relationshipStage: slots.relationshipStageLabel,
              userMessage: "",
            }),
            320,
          ),
      memoryStr,
      emotionSpeechGuidance: buildEmotionSpeechGuidance(emotion),
    });
    const emotionAnnotation =
      "\n\n在你的回复最末尾，用 <emotion>xxx</emotion> 标注你此刻的情绪状态。可选值：neutral, happy, curious, shy, sad, concerned, playful, thoughtful。这个标签不会展示给用户。";

    if (pluginSections.length > 0) {
      return personaPrompt + emotionAnnotation + "\n\n" + pluginSections.join("\n") + nsfwSuffix;
    }
    return personaPrompt + emotionAnnotation + nsfwSuffix;
  }

  // Fallback to original system prompt logic
  const sections: string[] = [];
  const reducedPriorityContext = stripPriorityBlocks(priorityContext, PRIORITY_SLOT_HEADINGS);

  if (trimmedCurrentContext) {
    sections.push(trimmedCurrentContext);
  }

  if (remainingPriorityChars > 0 && reducedPriorityContext?.trim()) {
    sections.push(
      "【优先参考（请自然融入对话，不要逐条复述）】\n" +
        trimTextByChars(reducedPriorityContext.trim(), remainingPriorityChars),
    );
  }

  sections.push(
    buildPersonalityPrompt(),
    buildCharacterRulesPrompt(),
  );

  // Inject structured persona traits and behavioral rules
  const traitGuidance = traitsToGuidance(REMI_DEFAULT_PERSONA.traits);
  if (traitGuidance) {
    sections.push(`【性格特质】${traitGuidance}`);
  }
  sections.push(
    `【行为边界】${REMI_DEFAULT_PERSONA.behavioral_rules.join("；")}`,
  );

  sections.push(
    `【语气合同】\n${trimTextByChars(buildToneContract({ userMessage: "" }), 320)}`,
    `【关系与记忆回答规则】如果用户问"我们是什么关系""我们聊了多久""你还记得多少"这类问题，只能依据当前提供的关系阶段、轮数、对话摘要和记忆来回答。没有明确长期关系依据时，要按"刚开始接触/还在建立了解"来答，不能脑补成已经认识很久、是老朋友，也不能编造具体聊天时长或轮数。`,
    buildEmotionSpeechGuidance(emotion),
    "用中文回复。",
  );

  if (memory.length > 0) {
    const memoryLines = memory
      .slice(0, maxMemoryEntries)
      .map((m) => `- ${m.key}：${trimTextByChars(m.value, maxMemoryValueChars)}`)
      .join("\n");
    sections.push(
      `【记忆背景】以下内容只作为理解当下的背景依据；除非用户主动问记忆、当前话题直接相关，或未完结的重要压力线需要关心，否则不要显式说"我记得/你之前/上次"，也不要用它另起旧话题。\n${memoryLines}`,
    );
    // Inject memory expression rules when memory is present
    sections.push(
      `【记忆表达规则】${REMI_DEFAULT_PERSONA.memory_expression_rules.join("；")}`,
    );
  }

  // Emotion self-annotation instruction (tag will be stripped by EmotionTagParser)
  sections.push(
    "在你的回复最末尾，用 <emotion>xxx</emotion> 标注你此刻的情绪状态。可选值：neutral, happy, curious, shy, sad, concerned, playful, thoughtful。这个标签不会展示给用户。",
  );

  const legacyPluginSections = getPromptInjectionHooks().flatMap((hook) =>
    hook.getPromptSections({ userMessage, persona: persona!, interpretation: null, ...pluginCtx }),
  );
  if (legacyPluginSections.length > 0) {
    sections.push(legacyPluginSections.join("\n"));
  }

  return sections.join("\n\n") + nsfwSuffix;
}

export function buildPrompt({
  memory,
  emotion,
  history,
  userMessage,
  currentContext,
  priorityContext,
  persona,
  connId,
  timeContext,
  coreMemoryBlock,
  timelineFacts,
}: BuildPromptInput): PromptMessage[] {
  // Collect all system content parts — Qwen3's tools-aware chat template
  // (used when tools are passed) rejects multiple system messages followed
  // by an assistant turn with "No user query found". So we always emit a
  // single system message, concatenating the main prompt + core memory.
  const systemParts: string[] = [
    buildSystemPrompt(memory, emotion, userMessage, currentContext, priorityContext, persona, connId),
  ];
  if (coreMemoryBlock?.trim()) {
    systemParts.push(coreMemoryBlock.trim());
  }
  const messages: PromptMessage[] = [
    { role: "system", content: systemParts.filter((s) => s.trim()).join("\n\n") },
  ];
  // Qwen3's tools-aware chat template requires the first non-system message
  // to be a user turn — a leading assistant message triggers
  // "No user query found". Drop leading assistant turns from history.
  let historyStream = history;
  while (historyStream.length > 0 && historyStream[0].role === "assistant") {
    historyStream = historyStream.slice(1);
  }
  // Normalize history: merge consecutive same-role messages into one.
  // Qwen3's tools-aware chat template rejects consecutive same-role
  // messages. Track the last role we pushed from the history stream
  // (not the system block above) so we only coalesce within history.
  let lastHistoryRole: string | null = null;
  const historyMessages: PromptMessage[] = [];
  for (const msg of historyStream) {
    if (lastHistoryRole === msg.role && historyMessages.length > 0) {
      historyMessages[historyMessages.length - 1].content += `\n${msg.content}`;
    } else {
      historyMessages.push({ ...msg });
      lastHistoryRole = msg.role;
    }
  }
  messages.push(...historyMessages);
  // M3-P0/P2: 时间上下文 + 时序事实是动态尾部，绝不进可缓存前缀。
  // 合并进 user message 而非独立 system message —— Qwen3 的 tools-aware
  // chat template 不允许 system role 出现在对话中间，拼到 user 前缀既保留
  // 语义又不破坏 template。
  const dynamicTailParts = [timelineFacts?.trim(), timeContext?.trim()].filter(
    (s): s is string => Boolean(s?.trim()),
  );
  const finalUserContent = dynamicTailParts.length > 0
    ? `${dynamicTailParts.join("\n\n")}\n\n${userMessage}`
    : userMessage;
  // Merge with the last history message if it's also user-role.
  const lastMsg = messages[messages.length - 1];
  if (lastMsg && lastMsg.role === "user") {
    lastMsg.content += `\n${finalUserContent}`;
  } else {
    messages.push({ role: "user", content: finalUserContent });
  }
  return messages;
}
