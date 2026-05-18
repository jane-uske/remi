import type { DirectCapability, DirectCapabilityRequest } from "../brain/direct_capabilities";
import type { RemiSessionContext } from "../brains/remi_session_context";
import { familyMemoryConfig, familyMemoryFetchJson } from "./family_memory_capability";

type PendingCapture = {
  text: string;
};

type CaptureResponse = {
  ok?: boolean;
  noteId?: string;
  lifecycle?: string;
  message?: string;
  error?: string;
};

const pendingCaptures = new WeakMap<object, PendingCapture>();

const RECORD_INTENT_RE =
  /^(?:帮我)?(?:记一下|记录一下|存一下|记住|帮我记一下|帮我记录一下)[：:\s]*(.+)$/u;
const CONFIRM_RE = /^(确认|确认吧|好，确认|好,确认|好的|可以|记吧|保存)$/u;
const CANCEL_RE = /^(算了|取消|别记了|不要了|跳过)$/u;
const PRIVATE_RE =
  /(密码|银行卡|身份证|验证码|私密|隐私|不要给AI看|不要给 ai 看|别给AI看|别给 ai 看|保密)/iu;

function contextKey(ctx: RemiSessionContext): object {
  return ctx as unknown as object;
}

export function matchFamilyMemoryRecordText(userMessage: string): string | null {
  const trimmed = userMessage.trim();
  const match = trimmed.match(RECORD_INTENT_RE);
  const text = match?.[1]?.trim() ?? "";
  return text || null;
}

function isPrivateOrBlocked(text: string): boolean {
  return PRIVATE_RE.test(text);
}

function pendingReply(text: string): string {
  return `我先不直接写入家庭记忆。你要确认记录这条吗？\n「${text}」\n回复“确认”后我再保存，回复“算了”就不记。`;
}

async function confirmPendingCapture(
  request: DirectCapabilityRequest,
  pending: PendingCapture,
): Promise<string> {
  const result = await familyMemoryFetchJson<CaptureResponse>(
    "/api/ai/capture",
    {
      method: "POST",
      body: JSON.stringify({
        text: pending.text,
        confirmedByParent: true,
        source: "remi",
      }),
    },
  );

  if (!result.ok || result.data.ok === false) {
    return "我现在没能把这条写入 family-memory，所以不会假装已经记好了。";
  }

  pendingCaptures.delete(contextKey(request.ctx));
  return "已记录。已生成待同步 note，运行 npm run sync 后会进入正式时间线和 Remi 可查询记忆。";
}

export const familyMemoryCaptureCapability: DirectCapability = {
  id: "family_memory_capture",
  async tryHandle(request) {
    if (request.systemTriggered || !familyMemoryConfig().enabled) {
      return { handled: false };
    }

    const key = contextKey(request.ctx);
    const trimmed = request.userMessage.trim();
    const pending = pendingCaptures.get(key);

    if (pending) {
      if (CONFIRM_RE.test(trimmed)) {
        return {
          handled: true,
          capabilityId: "family_memory_capture",
          reply: await confirmPendingCapture(request, pending),
        };
      }
      if (CANCEL_RE.test(trimmed)) {
        pendingCaptures.delete(key);
        return {
          handled: true,
          capabilityId: "family_memory_capture",
          reply: "好，这条不记。",
        };
      }
    }

    const recordText = matchFamilyMemoryRecordText(trimmed);
    if (!recordText) {
      return { handled: false };
    }

    if (isPrivateOrBlocked(recordText)) {
      return {
        handled: true,
        capabilityId: "family_memory_capture",
        reply: "这条包含隐私或敏感信息，不适合写入家庭记忆。我不会保存。",
      };
    }

    pendingCaptures.set(key, { text: recordText });
    return {
      handled: true,
      capabilityId: "family_memory_capture",
      reply: pendingReply(recordText),
    };
  },
};
