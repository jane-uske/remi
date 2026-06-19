import type { DirectCapability } from "../../brain/direct_capabilities";
import { getConfig } from "../../server/config";
import { createLogger } from "../../infra/logger";
import { setNsfw } from "../../brains/nsfw_mode";

const logger = createLogger("mode_control");

const CAPABILITY_ID = "mode_control";

// "adult mode" terms. Kept tight so casual mentions don't toggle anything.
const ADULT_TERM_RE = /(成人模式|限制级模式|nsfw\s*模式|18\s*禁模式)/iu;
// Turn-off verbs checked before turn-on (so "关闭成人模式" → disable, not enable).
const DISABLE_RE = /(退出|关闭|关掉|结束|停止|取消|切回|回到普通|回到正常)/u;
const ENABLE_RE = /(开启|打开|进入|开始|启用|切到|切换到|来点|想要)/u;

type ModeIntent = "enable" | "disable" | "none";

export function classifyModeIntent(message: string): ModeIntent {
  const trimmed = message.trim();
  if (!trimmed || !ADULT_TERM_RE.test(trimmed)) return "none";
  if (DISABLE_RE.test(trimmed)) return "disable";
  if (ENABLE_RE.test(trimmed)) return "enable";
  return "none";
}

const ENABLE_REPLY =
  "好的～已经为你开启成人模式了😳 这里只有我们俩，想聊什么、想怎么聊都可以。\n（随时说一句「退出成人模式」就能回到平时的我～）";
const DISABLE_REPLY = "好啦，已经退出成人模式啦，我们回到平时的样子～";

export const modeControlCapability: DirectCapability = {
  id: CAPABILITY_ID,
  tryHandle(request) {
    if (request.systemTriggered) return { handled: false };
    // Master switch (settings page). When off, let the message fall through to
    // the normal LLM so "开启成人模式" just gets a normal in-character reply.
    if (!getConfig().REMI_NSFW_ENABLED) return { handled: false };

    const intent = classifyModeIntent(request.userMessage);
    if (intent === "none") return { handled: false };

    const connId = request.ctx.connId;
    setNsfw(connId, intent === "enable");
    logger.info("adult mode toggled", { connId, enabled: intent === "enable" });

    return {
      handled: true,
      capabilityId: CAPABILITY_ID,
      reply: intent === "enable" ? ENABLE_REPLY : DISABLE_REPLY,
    };
  },
};
