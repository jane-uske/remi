import { createLogger } from "../infra/logger";
import { isNsfwEnabled } from "../brains/nsfw_mode";
import { getFastBrainModel } from "../brains/fast_brain_model";
import { completeWithOptions, hasLlmConfig, type ChatMessage } from "../llm/qwen_client";
import { getConfig } from "../server/config";
import type { ImageIntent } from "../capabilities/image_generation/image_intent";
import {
  extractSceneBaseline,
  stripFreestyleStyleTags,
} from "../capabilities/image_generation/image_character_style";

const logger = createLogger("image-prompt-agent");

const SYSTEM_PROMPT = [
  "你是 Remi 本地 ComfyUI 生图流水线的第 2 步：scene prompt 写作。",
  "任务：把用户想画的内容写成英文 positive prompt，供扩散模型使用。",
  "只输出 prompt 纯文本，不要 JSON、不要 markdown、不要解释。",
  "",
  "写作风格：",
  "- 放开写：姿势、表情、服装状态、身体细节、液体/汗渍/红晕、视线、构图、光线都可展开",
  "- 用具体英文标签堆叠画面，不怕长；用户没说的细节可以合理补全，让画面更满、更撩",
  "- 成人场景：露骨、直白、感官化；不回避、不淡化、不道德说教、不用隐喻糊弄",
  "- 禁止画风/美学标签：不要写 anime style、photorealistic、1girl、8k photo、masterpiece 等（画风由下游锁定）",
  "- 中文否定改英文正向：没有尾巴 → tailless, no tail",
  "- refine 模式：在「上一张 scene 基线」上合并用户改动，输出完整新 scene（不是只写 delta）",
].join("\n");

export interface LastImageContext {
  subject: string;
  prompt: string;
  characterStyle?: string;
}

function recentHistorySummary(
  history: Array<{ role: string; content: string }> | undefined,
): string {
  if (!history?.length) return "";
  return history
    .slice(-6)
    .map((entry) => `${entry.role}: ${entry.content.slice(0, 320)}`)
    .join("\n");
}

function intentSummary(intent: ImageIntent): string {
  if (intent.kind === "generate") {
    return `action=generate\nsubject=${intent.subject}`;
  }
  if (intent.kind === "refine") {
    return `action=refine\ndelta=${intent.delta}`;
  }
  if (intent.kind === "restyle") {
    return `action=restyle\nsubject=${intent.subject ?? ""}\nstyle=${intent.style}`;
  }
  return `action=${intent.kind}`;
}

export interface ComposeScenePromptInput {
  userMessage: string;
  intent: ImageIntent;
  recentHistory?: Array<{ role: string; content: string }>;
  lastImage?: LastImageContext;
  connId: string;
  signal?: AbortSignal;
}

function sanitizeScenePrompt(raw: string): string {
  const trimmed = raw
    .trim()
    .replace(/^```[\w]*\n?/i, "")
    .replace(/\n?```$/i, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
  return stripFreestyleStyleTags(trimmed);
}

export async function composeScenePromptWithLlm(
  input: ComposeScenePromptInput,
): Promise<string | null> {
  if (
    input.intent.kind !== "generate" &&
    input.intent.kind !== "refine" &&
    input.intent.kind !== "restyle"
  ) {
    return null;
  }

  if (input.intent.kind === "refine" && !input.lastImage) {
    return null;
  }

  const model = getFastBrainModel();
  if (!hasLlmConfig(model)) {
    throw new Error("fast brain LLM not configured for image prompt");
  }

  const recent = recentHistorySummary(input.recentHistory);
  const nsfw = isNsfwEnabled(input.connId);
  const baseline = input.lastImage
    ? extractSceneBaseline(input.lastImage.prompt, input.lastImage.characterStyle)
    : "";

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        `成人模式：${nsfw ? "开启（尽情放飞，细节写满，按用户原意最大化展开）" : "关闭（含蓄即可，不写露骨细节）"}`,
        input.lastImage
          ? [
              `上一张图主题：${input.lastImage.subject}`,
              baseline ? `上一张 scene 基线（必须在此基础上改版）：\n${baseline}` : "",
            ]
              .filter(Boolean)
              .join("\n")
          : "上一张图：无",
        recent ? `最近对话：\n${recent}` : "最近对话：无",
        `意图：\n${intentSummary(input.intent)}`,
        `用户原话：\n${input.userMessage}`,
      ].join("\n\n"),
    },
  ];

  const timeoutMs = getConfig().REMI_IMAGE_PROMPT_TIMEOUT_MS;
  const maxTokens = getConfig().REMI_IMAGE_PROMPT_MAX_TOKENS;
  const timeoutController = new AbortController();
  const parentAbort = () => timeoutController.abort();
  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timeoutController.abort();
      const error = new Error(`image prompt agent timed out after ${timeoutMs}ms`);
      error.name = "AbortError";
      reject(error);
    }, timeoutMs);
  });
  if (input.signal) {
    if (input.signal.aborted) timeoutController.abort();
    else input.signal.addEventListener("abort", parentAbort, { once: true });
  }

  try {
    const raw = await Promise.race([
      completeWithOptions(messages, {
        maxTokens,
        temperature: getConfig().REMI_IMAGE_PROMPT_TEMPERATURE,
        model,
        reasoningEffort: "none",
        signal: timeoutController.signal,
      }),
      timeoutPromise,
    ]);
    const scene = sanitizeScenePrompt(raw);
    if (!scene) return null;
    logger.info("image scene prompt composed", {
      connId: input.connId,
      action: input.intent.kind,
      hasBaseline: Boolean(baseline),
      chars: scene.length,
      preview: scene.slice(0, 160),
    });
    return scene;
  } finally {
    if (timer) clearTimeout(timer);
    if (input.signal) input.signal.removeEventListener("abort", parentAbort);
  }
}