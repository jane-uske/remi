import type { DirectCapability } from "../../brain/direct_capabilities";
import { getConfig } from "../../server/config";
import { createLogger } from "../../infra/logger";
import {
  setSessionMlxVoiceStyle,
  setSessionMlxSpeedModifier,
  setSessionMlxPitchModifier,
} from "../../voice/tts_runtime_overrides";
import {
  matchVoiceStyleCommand,
  matchVoiceTuneCommand,
  isVoiceStyleResetCommand,
} from "./voice_style_presets";

const logger = createLogger("voice_style");

const CAPABILITY_ID = "voice_style";

export const voiceStyleCapability: DirectCapability = {
  id: CAPABILITY_ID,
  tryHandle(request) {
    // Only meaningful for MLX TTS — other providers ignore instruct entirely.
    if (getConfig().REMI_TTS_PROVIDER !== "mlx") return { handled: false };
    if (request.systemTriggered) return { handled: false };

    const { userMessage, ctx } = request;
    const connId = ctx.connId;

    // --- full reset ---
    if (isVoiceStyleResetCommand(userMessage)) {
      setSessionMlxVoiceStyle(connId, null);
      setSessionMlxSpeedModifier(connId, null);
      setSessionMlxPitchModifier(connId, null);
      logger.info("voice style reset (full)", { connId });
      return {
        handled: true,
        capabilityId: CAPABILITY_ID,
        reply: "好的～已经恢复原来的声音了。",
      };
    }

    // --- voice style preset switch ---
    const preset = matchVoiceStyleCommand(userMessage);
    if (preset) {
      setSessionMlxVoiceStyle(connId, preset.id);
      logger.info("voice style switched", { connId, preset: preset.id });
      return {
        handled: true,
        capabilityId: CAPABILITY_ID,
        reply: `好的～我现在用${preset.label}跟你说话哦～`,
      };
    }

    // --- speed / pitch tuning ---
    const tune = matchVoiceTuneCommand(userMessage);
    if (tune) {
      if (tune.kind === "speed") {
        setSessionMlxSpeedModifier(connId, tune.modifier);
      } else {
        setSessionMlxPitchModifier(connId, tune.modifier);
      }
      logger.info("voice tune", { connId, kind: tune.kind, direction: tune.direction });
      return {
        handled: true,
        capabilityId: CAPABILITY_ID,
        reply: tune.reply,
      };
    }

    return { handled: false };
  },
};
