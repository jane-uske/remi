import { createLogger } from "../infra/logger";
import { completeWithOptions, hasLlmConfig, type ChatMessage } from "../llm/qwen_client";
import { getFastBrainModel } from "../brains/fast_brain_model";
import { getConfig } from "../server/config";
import {
  extractSubject,
  type ImageIntent,
} from "../capabilities/image_generation/image_intent";

const logger = createLogger("image-intent-agent");

const SYSTEM_PROMPT = [
  "你是 Remi 的生图流水线第 1 步：意图识别。",
  "任务：判断用户是否想让 Remi 用 ComfyUI 画一张新图（不是聊天、不是写文档、不是比喻）。",
  "只输出合法 JSON，不要 markdown，不要解释。",
  "Schema:",
  "{",
  '  "action": "none" | "generate" | "refine" | "redraw" | "restyle",',
  '  "subject": "纯画面主题（去掉画/帮我/生成等动词），generate/restyle 时填写",',
  '  "delta": "相对上一张的改动描述（如更骚点/丝袜脱掉/屁股翘过来），仅 refine 时填写",',
  '  "style": "风格名，仅 restyle 时填写"',
  "}",
  "",
  "判定为 generate / redraw / restyle：明确要画图、重画、换画风，或隐式要求看照片/自拍/写真（如「看看你的照片」「发个自拍」「来张照片」「拍张照」）。",
  "判定为 refine：已画过图，且用户只补充/修改场景（更骚点、脱掉丝袜、翘屁股、换姿势等），没有全新主题。",
  "restyle / 扮演XX风格 / 用XX风格画：用户主动换画风时才填 style。",
  "不要输出 comfyPrompt；scene prompt 由下一步专用写作代理生成。",
  "",
  "以下情况必须判定为 none：",
  "- 画个饼、流程图/文档、讨论生图 API、换说话风格、重新生成文字回复",
  "- 问句/回忆/否定：「记得我之前让你生成什么图片吗」「不是让你生图」「你刚才画的什么」「之前那张图呢」「什么图片」「别画了」",
  "- 谈论/讨论/解释图片：「这张图不错」「图片太小了」「图片质量怎么样」",
  "- 包含否定词+生图关键词：不是/不要/别/没有/没让/不用 + 画/图/生图",
  "- 用户在提问或回忆过去的生图行为，而不是在下达新的生图指令",
].join("\n");

interface PartialImageIntentPayload {
  action?: string;
  subject?: string;
  delta?: string;
  prompt?: string;
  comfyPrompt?: string;
  style?: string;
}

function parseJsonObject(raw: string): PartialImageIntentPayload | null {
  const src = raw.trim();
  try {
    return JSON.parse(src) as PartialImageIntentPayload;
  } catch {
    const first = src.indexOf("{");
    const last = src.lastIndexOf("}");
    if (first < 0 || last <= first) return null;
    try {
      return JSON.parse(src.slice(first, last + 1)) as PartialImageIntentPayload;
    } catch {
      return null;
    }
  }
}

function recentHistorySummary(
  history: Array<{ role: string; content: string }> | undefined,
): string {
  if (!history?.length) return "";
  return history
    .slice(-4)
    .map((entry) => `${entry.role}: ${entry.content}`)
    .join("\n");
}

function sanitizeIntent(
  payload: PartialImageIntentPayload | null,
  userMessage: string,
): ImageIntent {
  const action = payload?.action?.trim().toLowerCase();
  if (action === "generate") {
    const raw = (payload?.subject?.trim() || payload?.prompt?.trim() || userMessage).trim();
    const subject = extractSubject(raw) || extractSubject(userMessage) || raw;
    return subject
      ? { kind: "generate", subject }
      : { kind: "generate", subject: "" };
  }
  if (action === "refine") {
    const delta =
      payload?.delta?.trim() ||
      payload?.subject?.trim() ||
      extractSubject(userMessage) ||
      userMessage.trim();
    return delta ? { kind: "refine", delta } : { kind: "none" };
  }
  if (action === "redraw") {
    return { kind: "redraw" };
  }
  if (action === "restyle") {
    const style = payload?.style?.trim() ?? "";
    const rawSubject = payload?.subject?.trim() || "";
    const subject = rawSubject ? extractSubject(rawSubject) || rawSubject : undefined;
    return { kind: "restyle", style, subject };
  }
  return { kind: "none" };
}

export interface InferImageIntentInput {
  userMessage: string;
  recentHistory?: Array<{ role: string; content: string }>;
  hasPreviousImage: boolean;
  lastImage?: { subject: string; prompt: string; characterStyle?: string };
  signal?: AbortSignal;
}

export async function inferImageIntentFromMessage(
  input: InferImageIntentInput,
): Promise<ImageIntent> {
  const model = getFastBrainModel();
  if (!hasLlmConfig(model)) {
    throw new Error("fast brain LLM not configured for image intent");
  }

  const recent = recentHistorySummary(input.recentHistory);
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        `本会话是否已画过图：${input.hasPreviousImage ? "是" : "否"}`,
        input.lastImage
          ? `上一张图主题：${input.lastImage.subject}\n上一张 scene 摘要：${input.lastImage.prompt.slice(0, 360)}`
          : "上一张图：无",
        recent ? `最近对话：\n${recent}` : "最近对话：无",
        `当前用户输入：\n${input.userMessage}`,
      ].join("\n\n"),
    },
  ];

  const timeoutMs = getConfig().REMI_IMAGE_INTENT_TIMEOUT_MS;
  const timeoutController = new AbortController();
  const parentAbort = () => timeoutController.abort();
  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timeoutController.abort();
      const error = new Error(`image intent agent timed out after ${timeoutMs}ms`);
      error.name = "AbortError";
      reject(error);
    }, timeoutMs);
  });
  if (input.signal) {
    if (input.signal.aborted) {
      timeoutController.abort();
    } else {
      input.signal.addEventListener("abort", parentAbort, { once: true });
    }
  }

  try {
    const raw = await Promise.race([
      completeWithOptions(messages, {
        maxTokens: 512,
        temperature: 0.1,
        model,
        reasoningEffort: "none",
        signal: timeoutController.signal,
      }),
      timeoutPromise,
    ]);
    const intent = sanitizeIntent(parseJsonObject(raw), input.userMessage);
    logger.info("image intent classified", {
      action: intent.kind,
      source: "llm",
      hasPreviousImage: input.hasPreviousImage,
      ...(intent.kind === "generate" ? { subject: intent.subject } : {}),
    });
    return intent;
  } finally {
    if (timer) clearTimeout(timer);
    if (input.signal) {
      input.signal.removeEventListener("abort", parentAbort);
    }
  }
}