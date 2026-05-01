import type { Emotion } from "../emotion/emotion_state";
import { buildCharacterRulesPrompt } from "./character_rules";
import { buildAdultScenePrompt } from "./adult_mode";
import { buildPersonalityPrompt } from "./personality";
import { buildToneContract } from "./tone_policy";
import type { PersonaState } from "../persona";
import { buildPersonaPrompt } from "../persona";

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

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

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
};

const EMOTION_SPEECH_STYLE: Record<Emotion, string> = {
  neutral: "说话节奏均匀，停顿自然，起句和收句都偏稳。",
  happy: "起句更快一点，句中停顿更短，收尾更上扬，适合用更短更亮的表达。",
  curious: "句尾可以稍微上挑，适合在关键点前后稍停一下，像在等对方继续说。",
  shy: "起句略慢，句中停顿略多，尾音更轻，像是边想边说。",
  sad: "整体更慢一点，停顿更柔和，句尾更收，像在轻声把话说完。",
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
): string {
  const maxPriorityChars = parsePositiveInt(process.env.MAX_PRIORITY_CONTEXT_CHARS, 500);
  const maxMemoryEntries = parsePositiveInt(process.env.MAX_PROMPT_MEMORY_ENTRIES, 5);
  const maxMemoryValueChars = parsePositiveInt(process.env.MAX_PROMPT_MEMORY_VALUE_CHARS, 40);
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
    return buildPersonaPrompt(persona, {
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
  const adultScenePrompt = buildAdultScenePrompt();
  if (adultScenePrompt) {
    sections.push(adultScenePrompt);
  }
  sections.push(
    `【语气合同】\n${trimTextByChars(buildToneContract({ userMessage: "" }), 320)}`,
    "【关系与记忆回答规则】如果用户问“我们是什么关系”“我们聊了多久”“你还记得多少”这类问题，只能依据当前提供的关系阶段、轮数、对话摘要和记忆来回答。没有明确长期关系依据时，要按“刚开始接触/还在建立了解”来答，不能脑补成已经认识很久、是老朋友，也不能编造具体聊天时长或轮数。",
    buildEmotionSpeechGuidance(emotion),
    "用中文回复。",
  );

  if (memory.length > 0) {
    const memoryLines = memory
      .slice(0, maxMemoryEntries)
      .map((m) => `- ${m.key}：${trimTextByChars(m.value, maxMemoryValueChars)}`)
      .join("\n");
    sections.push(
      `【记忆背景】以下内容只作为理解当下的背景依据；除非用户主动问记忆、当前话题直接相关，或未完结的重要压力线需要关心，否则不要显式说“我记得/你之前/上次”，也不要用它另起旧话题。\n${memoryLines}`,
    );
  }

  return sections.join("\n\n");
}

export function buildPrompt({
  memory,
  emotion,
  history,
  userMessage,
  currentContext,
  priorityContext,
  persona,
}: BuildPromptInput): PromptMessage[] {
  return [
    { role: "system", content: buildSystemPrompt(memory, emotion, userMessage, currentContext, priorityContext, persona) },
    ...history,
    { role: "user", content: userMessage },
  ];
}
