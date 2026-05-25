import type { DirectCapability } from "../brain/direct_capabilities";
import { getConfig } from "../server/config";
import { createLogger } from "../infra/logger";
import { classifyFamilyMemoryIntent } from "./family_memory_intent";

const logger = createLogger("family_memory");

const REPLY_SERVICE_UNAVAILABLE = "家庭记忆服务暂不可用，无法回答家庭相关问题，请稍后再试。";
const REPLY_NO_EVIDENCE =
  "我现在还没有确认过这条家庭记忆。你可以先让我查看待确认记忆，补充摘要并确认后，我再能把它作为正式记忆回答。";

export const familyMemoryCapability: DirectCapability = {
  id: "family_memory",
  async tryHandle(request) {
    const config = getConfig();

    if (!config.REMI_FAMILY_MEMORY_ENABLED) {
      return { handled: false };
    }

    if (request.systemTriggered) {
      return { handled: false };
    }

    const intent = await classifyFamilyMemoryIntent(request.userMessage);
    if (!intent.isFamilyMemory) {
      return { handled: false };
    }

    logger.debug("family-memory intent classified", {
      connId: request.ctx.connId,
      confidence: intent.confidence,
      method: intent.method,
    });

    // Past this point: question IS family-related and feature IS enabled.
    // MUST return handled=true — never let family questions fall to main LLM.

    const serviceUrl = config.REMI_FAMILY_MEMORY_SERVICE_URL;
    const token = config.REMI_FAMILY_MEMORY_AI_TOKEN;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    let response: Response;
    try {
      response = await fetch(`${serviceUrl}/api/ai/ask`, {
        method: "POST",
        headers,
        body: JSON.stringify({ question: request.userMessage, confirmedOnly: true }),
        signal: request.signal ?? AbortSignal.timeout(8000),
      });
    } catch (err) {
      logger.warn("family-memory service unreachable", {
        connId: request.ctx.connId,
        error: (err as Error).message,
      });
      return { handled: true, capabilityId: "family_memory", reply: REPLY_SERVICE_UNAVAILABLE };
    }

    if (!response.ok) {
      logger.warn("family-memory service returned error", {
        connId: request.ctx.connId,
        status: response.status,
      });
      return { handled: true, capabilityId: "family_memory", reply: REPLY_SERVICE_UNAVAILABLE };
    }

    const result = (await response.json()) as {
      handled?: boolean;
      answerable?: boolean;
      answer?: string;
      confidence?: string;
      reason?: string;
      resultSource?: string;
      provenanceNote?: string;
      sources?: { memoryId?: string; title?: string }[];
    };

    logger.info("family-memory result", {
      connId: request.ctx.connId,
      question: request.userMessage,
      answerable: result.answerable,
      confidence: result.confidence,
      reason: result.reason,
      resultSource: result.resultSource,
      sources: result.sources?.length ?? 0,
    });

    if (!result.answerable || !result.answer) {
      return { handled: true, capabilityId: "family_memory", reply: result.answer || REPLY_NO_EVIDENCE };
    }

    const reply = result.provenanceNote
      ? `${result.answer}\n\n${result.provenanceNote}`
      : result.answer;

    return {
      handled: true,
      capabilityId: "family_memory",
      reply,
    };
  },
};
