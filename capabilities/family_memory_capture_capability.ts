import type { DirectCapability } from "../brain/direct_capabilities";
import { getConfig } from "../server/config";
import { createLogger } from "../infra/logger";

const logger = createLogger("family_memory_capture");

// --- Intent Detection ---

const RECORD_INTENT_PATTERNS: RegExp[] = [
  /帮我记/,
  /记录一下/,
  /记一下/,
  /记下来/,
  /帮记一下/,
  /把.{0,10}记录/,
  /记住.{0,6}这/,
  /存档一下/,
  /留个记录/,
  /帮忙记/,
  /写进.*记忆/,
  /加到.*记忆/,
  /记到.*记忆/,
];

// --- Privacy Detection ---

const PRIVACY_BLOCK_PATTERNS: RegExp[] = [
  /不要给\s*AI\s*看/i,
  /私密/,
  /只给我看/,
  /别让\s*Remi.*说出来/i,
  /blocked_from_ai/i,
  /不让\s*AI/i,
  /不要\s*AI\s*知道/i,
];

// --- Post-Birth Milestone Guardrail (pregnancy stage) ---

const POST_BIRTH_MILESTONE_PATTERNS: { pattern: RegExp; keyword: string }[] = [
  { pattern: /翻身/, keyword: "翻身" },
  { pattern: /抬头/, keyword: "抬头" },
  { pattern: /坐[起了]/, keyword: "坐起" },
  { pattern: /[爬会]爬/, keyword: "爬行" },
  { pattern: /[站会]站/, keyword: "站立" },
  { pattern: /走路|学走|迈步/, keyword: "走路" },
  { pattern: /说话|开口|叫[妈爸]/, keyword: "说话" },
  { pattern: /长牙|出牙|冒牙/, keyword: "长牙" },
  { pattern: /上学|入[园学]|幼儿园/, keyword: "上学" },
  { pattern: /断奶|断[了]奶/, keyword: "断奶" },
  { pattern: /出生后.*疫苗|打.*疫苗/, keyword: "出生后疫苗" },
  { pattern: /辅食|加餐/, keyword: "辅食" },
];

function detectPostBirthMilestones(text: string): string[] {
  const matched: string[] = [];
  for (const { pattern, keyword } of POST_BIRTH_MILESTONE_PATTERNS) {
    if (pattern.test(text)) {
      matched.push(keyword);
    }
  }
  return matched;
}

// --- Confirmation Detection ---

const CONFIRM_PATTERNS: RegExp[] = [
  /^确认$/,
  /^是$/,
  /^对$/,
  /^好$/,
  /^嗯$/,
  /^ok$/i,
  /^确定$/,
  /^记吧$/,
  /^记录$/,
  /^没问题$/,
  /^可以$/,
];

const CANCEL_PATTERNS: RegExp[] = [
  /^算了$/,
  /^取消$/,
  /^不了$/,
  /^不要$/,
  /^不记了$/,
  /^别记了$/,
  /^不用了$/,
  /^cancel$/i,
];

// --- Pending Draft Store (keyed by connId) ---

interface PendingDraft {
  originalText: string
  extractedContent: string
  createdAt: number
  stageGuardrailAcked?: boolean
}

const pendingDrafts = new Map<string, PendingDraft>();
const DRAFT_TTL_MS = 5 * 60 * 1000; // 5 minutes

function cleanExpiredDrafts(): void {
  const now = Date.now();
  for (const [key, draft] of pendingDrafts) {
    if (now - draft.createdAt > DRAFT_TTL_MS) {
      pendingDrafts.delete(key);
    }
  }
}

// --- Text Extraction ---

const EXTRACTION_STRIP_PATTERNS: RegExp[] = [
  /帮我记一下/,
  /帮我记/,
  /记录一下/,
  /记一下/,
  /记下来/,
  /帮记一下/,
  /帮忙记一下/,
  /帮忙记/,
  /把.*?记录下来/,
  /把.*?记录/,
  /记住.*?这件事/,
  /存档一下/,
  /留个记录/,
  /写进.*?记忆/,
  /加到.*?记忆/,
  /记到.*?记忆/,
];

function extractRecordContent(text: string): string {
  let content = text;
  for (const p of EXTRACTION_STRIP_PATTERNS) {
    content = content.replace(p, "");
  }
  content = content.replace(/^[，,：:、\s]+/, "").replace(/[，,。.！!\s]+$/, "").trim();
  return content || text;
}

function detectPrivacyBlock(text: string): boolean {
  return PRIVACY_BLOCK_PATTERNS.some((p) => p.test(text));
}

function isRecordIntent(text: string): boolean {
  return RECORD_INTENT_PATTERNS.some((p) => p.test(text));
}

function isConfirmation(text: string): boolean {
  const trimmed = text.trim();
  return CONFIRM_PATTERNS.some((p) => p.test(trimmed));
}

function isCancellation(text: string): boolean {
  const trimmed = text.trim();
  return CANCEL_PATTERNS.some((p) => p.test(trimmed));
}

// --- Stage Fetching ---

async function fetchStage(config: ReturnType<typeof getConfig>): Promise<string | null> {
  const serviceUrl = config.REMI_FAMILY_MEMORY_SERVICE_URL;
  const token = config.REMI_FAMILY_MEMORY_AI_TOKEN;

  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  try {
    const response = await fetch(`${serviceUrl}/api/ai/stage`, {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const body = await response.json() as { stage?: string };
    return body.stage || null;
  } catch {
    return null;
  }
}

// --- Capability ---

export const familyMemoryCaptureCapability: DirectCapability = {
  id: "family_memory_capture",
  async tryHandle(request) {
    const config = getConfig();

    if (!config.REMI_FAMILY_MEMORY_ENABLED) {
      return { handled: false };
    }

    if (request.systemTriggered) {
      return { handled: false };
    }

    const connId = request.ctx.connId;
    const userMessage = request.userMessage.trim();

    // Check if this user's draft expired (before global cleanup removes it)
    const maybeDraft = pendingDrafts.get(connId);
    if (maybeDraft && Date.now() - maybeDraft.createdAt > DRAFT_TTL_MS) {
      pendingDrafts.delete(connId);
      if (isConfirmation(userMessage) || isCancellation(userMessage)) {
        logger.info("capture expired", { connId });
        return {
          handled: true,
          capabilityId: "family_memory_capture",
          reply: "记录已过期，请重新发起。",
        };
      }
    }

    cleanExpiredDrafts();

    // --- Phase 2: Handle pending confirmation ---
    const pending = pendingDrafts.get(connId);
    if (pending) {
      if (isCancellation(userMessage)) {
        pendingDrafts.delete(connId);
        logger.info("capture cancelled", { connId });
        return {
          handled: true,
          capabilityId: "family_memory_capture",
          reply: "好的，已取消记录。",
        };
      }

      if (isConfirmation(userMessage)) {
        // If stage guardrail was triggered and user confirms, they acknowledge the guardrail
        if (pending.stageGuardrailAcked === false) {
          pending.stageGuardrailAcked = true;
          logger.info("stage guardrail acknowledged", { connId });
          return {
            handled: true,
            capabilityId: "family_memory_capture",
            reply: `好的，我将记录以下内容到家庭记忆：\n\n「${pending.extractedContent}」\n\n确认记录吗？（回复"确认"记录，"算了"取消）`,
          };
        }

        pendingDrafts.delete(connId);
        const result = await callCaptureApi(pending.extractedContent, config);
        if (result.ok) {
          logger.info("capture success", { connId, noteId: result.noteId });
          return {
            handled: true,
            capabilityId: "family_memory_capture",
            reply: "已记录到家庭记忆 inbox。运行 sync 后会进入正式时间线和 Remi 可查询记忆。",
          };
        } else {
          logger.warn("capture failed", { connId, error: result.error });
          if (result.error === "privacy_blocked") {
            return {
              handled: true,
              capabilityId: "family_memory_capture",
              reply: "这条内容包含私密标记，无法通过 Remi 记录。如需保存，请通过本地管理方式手动添加为 blocked_from_ai。",
            };
          }
          if (result.error === "stage_guardrail") {
            return {
              handled: true,
              capabilityId: "family_memory_capture",
              reply: result.message || "当前阶段无法记录该内容。",
            };
          }
          return {
            handled: true,
            capabilityId: "family_memory_capture",
            reply: "家庭记忆服务暂不可用，记录失败。请稍后再试。",
          };
        }
      }

      // User said something else — treat as new intent or cancel the draft
      pendingDrafts.delete(connId);
      // Fall through to check if the new message is a record intent
    }

    // --- Phase 1: Detect record intent ---
    if (!isRecordIntent(userMessage)) {
      return { handled: false };
    }

    // Privacy check before even creating draft
    if (detectPrivacyBlock(userMessage)) {
      logger.info("capture blocked: privacy", { connId });
      return {
        handled: true,
        capabilityId: "family_memory_capture",
        reply: "这条内容包含私密标记，无法通过 Remi 记录。如需保存，请通过本地管理方式手动添加为 blocked_from_ai。",
      };
    }

    const extracted = extractRecordContent(userMessage);

    // Stage-aware guardrail: check if content contains post-birth milestones during pregnancy
    const stage = await fetchStage(config);
    if (stage === "孕期") {
      const milestones = detectPostBirthMilestones(extracted);
      if (milestones.length > 0) {
        logger.info("stage guardrail triggered", { connId, milestones });
        pendingDrafts.set(connId, {
          originalText: userMessage,
          extractedContent: extracted,
          createdAt: Date.now(),
          stageGuardrailAcked: false,
        });
        return {
          handled: true,
          capabilityId: "family_memory_capture",
          reply: `当前宝宝还在孕期，但内容提到了出生后的里程碑（${milestones.join("、")}）。\n\n如果确认要记录，请回复"确认"；如果是误操作，回复"算了"。`,
        };
      }
    }

    // Store pending draft
    pendingDrafts.set(connId, {
      originalText: userMessage,
      extractedContent: extracted,
      createdAt: Date.now(),
    });

    logger.info("capture pending", { connId, extracted: extracted.slice(0, 50) });

    return {
      handled: true,
      capabilityId: "family_memory_capture",
      reply: `好的，我将记录以下内容到家庭记忆：\n\n「${extracted}」\n\n确认记录吗？（回复"确认"记录，"算了"取消）`,
    };
  },
};

// --- API Call ---

type CaptureApiResult =
  | { ok: true; noteId: string }
  | { ok: false; error: string; message?: string };

async function callCaptureApi(
  text: string,
  config: ReturnType<typeof getConfig>,
): Promise<CaptureApiResult> {
  const serviceUrl = config.REMI_FAMILY_MEMORY_SERVICE_URL;
  const token = config.REMI_FAMILY_MEMORY_AI_TOKEN;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const today = new Date().toISOString().slice(0, 10);

  try {
    const response = await fetch(`${serviceUrl}/api/ai/capture`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        text,
        date: today,
        confirmedByParent: true,
        source: "remi",
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as Record<string, unknown>;
      return { ok: false, error: (body.error as string) || `HTTP ${response.status}`, message: body.message as string | undefined };
    }

    const body = await response.json() as { ok: boolean; noteId?: string };
    if (body.ok && body.noteId) {
      return { ok: true, noteId: body.noteId };
    }
    return { ok: false, error: "unexpected response" };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
