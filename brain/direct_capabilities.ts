import type { Emotion } from "../emotion/emotion_state";
import { createLogger } from "../infra/logger";
import type { RemiSessionContext } from "../brains/remi_session_context";
import type { ImageIntent } from "../capabilities/image_generation/image_intent";
import { dateRecapCapability } from "../capabilities/date_recap_capability";
import { familyMemoryDraftsCapability } from "../capabilities/family_memory_drafts_capability";
import { familyMemoryCaptureCapability } from "../capabilities/family_memory_capture_capability";
import { familyMemoryCapability } from "../capabilities/family_memory_capability";
import { voiceStyleCapability } from "../capabilities/voice_style/voice_style_capability";
import { timeCapability } from "./time_capability";

const logger = createLogger("direct_capabilities");

export interface DirectCapabilityRequest {
  userMessage: string;
  emotion: Emotion;
  ctx: RemiSessionContext;
  signal?: AbortSignal;
  systemTriggered: boolean;
  inputSource: "text" | "voice";
  /** Pre-resolved by context_orchestrator when hybrid image-intent gate runs. */
  imageIntent?: ImageIntent;
}

export type DirectCapabilityResult =
  | {
      handled: false;
    }
  | {
      handled: true;
      capabilityId: string;
      reply: string;
    };

export interface DirectCapability {
  id: string;
  tryHandle(
    request: DirectCapabilityRequest,
  ): DirectCapabilityResult | Promise<DirectCapabilityResult>;
}

const REGISTERED_DIRECT_CAPABILITIES: readonly DirectCapability[] = [
  // Deterministic zero-latency capabilities — fast-path regex, no LLM needed.
  timeCapability,
  dateRecapCapability,
  familyMemoryDraftsCapability,
  familyMemoryCaptureCapability,
  familyMemoryCapability,
  voiceStyleCapability,
  // Image generation, video generation, and mode control are now handled by
  // LLM tool-use (function calling) in context_orchestrator.ts. They were
  // removed from this chain to let the LLM drive intent detection for
  // ambiguous inputs (e.g. "不穿衣服呢？" implying image generation).
];

export async function tryHandleDirectCapabilities(
  request: DirectCapabilityRequest,
): Promise<DirectCapabilityResult> {
  for (const capability of REGISTERED_DIRECT_CAPABILITIES) {
    try {
      const result = await capability.tryHandle(request);
      if (result.handled) {
        return {
          ...result,
          capabilityId: capability.id,
        };
      }
    } catch (err) {
      logger.warn("direct capability failed, falling back to main route", {
        capabilityId: capability.id,
        connId: request.ctx.connId,
        error: (err as Error).message,
      });
    }
  }

  return { handled: false };
}
