import type { Emotion } from "../emotion/emotion_state";
import { createLogger } from "../infra/logger";
import type { RemiSessionContext } from "../brains/remi_session_context";
import type { ImageIntent } from "../capabilities/image_generation/image_intent";
import { dateRecapCapability } from "../capabilities/date_recap_capability";
import { familyMemoryDraftsCapability } from "../capabilities/family_memory_drafts_capability";
import { familyMemoryCaptureCapability } from "../capabilities/family_memory_capture_capability";
import { familyMemoryCapability } from "../capabilities/family_memory_capability";
import { imageGenerationCapability } from "../capabilities/image_generation/image_generation_capability";
import { videoGenerationCapability } from "../capabilities/video_generation/video_generation_capability";
import { modeControlCapability } from "../capabilities/mode_control/mode_control_capability";
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
  // Voice style must run before mode control and image generation.
  voiceStyleCapability,
  // Mode control before image gen so "开启成人模式" is caught as a command.
  modeControlCapability,
  // Image/video generation via regex fast-path. The LLM tool-use
  // infrastructure (tool_registry.ts / collectStreamTokens tools param) is
  // in place but the current local uncensored model doesn't reliably call
  // tools under the Remi persona prompt — it fabricates fake image URLs
  // instead. Fast-path regex is reliable for explicit requests. To switch
  // to tool-use, remove these two and pass tools to fastBrainStream.
  imageGenerationCapability,
  videoGenerationCapability,
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
