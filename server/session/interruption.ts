import type { InterruptionType } from "../../avatar/types";

const CORRECTION_RE = /(不是|不对|我的意思是|我刚刚是说|我刚才是说|更准确地说|应该是|我不是问这个|我想问的是|不是那个意思|我想说的是|我不是这个意思)/u;
const TOPIC_SWITCH_RE = /(算了|换个话题|先不说这个|另外|别说这个|说点别的|这个先放一边|先放一边)/u;
const EMOTIONAL_INTERRUPT_RE = /(等等|等一下|你先别说|停一下|先停|停停停|不是这个意思|不是啦|不是这样的)/u;
const CONTINUATION_RE = /^(然后|接着|继续|还有|还有就是|补充一下|补一句|对了|另外还有|刚才那个|回到刚才|先接着刚才|还是刚才那个)/u;

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, "");
}

function sharesKeywords(a: string, b: string): boolean {
  const tokensA = normalize(a)
    .split(/[，。！？,.!?、；;：“”"'`()（）\[\]\s]+/u)
    .filter((token) => token.length >= 2);
  const tokensB = new Set(
    normalize(b)
      .split(/[，。！？,.!?、；;：“”"'`()（）\[\]\s]+/u)
      .filter((token) => token.length >= 2),
  );
  if (tokensA.length === 0 || tokensB.size === 0) return false;
  return tokensA.some((token) => tokensB.has(token));
}

export function classifyInterruption(
  nextUserText: string,
  interruptedReply: string | null,
): InterruptionType {
  const text = nextUserText.trim();
  if (!text) return "unknown";

  if (CORRECTION_RE.test(text)) return "correction";
  if (EMOTIONAL_INTERRUPT_RE.test(text)) return "emotional_interrupt";
  if (TOPIC_SWITCH_RE.test(text)) return "topic_switch";
  if (CONTINUATION_RE.test(text)) return "continuation";

  if (interruptedReply && sharesKeywords(text, interruptedReply)) {
    return "continuation";
  }

  if (text.length <= 8 && /[！？?!]/u.test(text)) {
    return "emotional_interrupt";
  }

  return "unknown";
}

export function buildCarryForwardHint(
  interruptionType: InterruptionType,
  interruptedReply: string | null,
): string | undefined {
  const previous = interruptedReply?.trim();
  switch (interruptionType) {
    case "continuation":
      return previous
        ? `对方刚刚打断了你，但大概率是在顺着上一句继续说。请自然承接刚才被打断的语境，不要像全新话题重开。开头先用一句很短的话把上下文接住，再继续展开。第一句更像「嗯，刚才那个我接着说」或「好，我顺着刚才那个说」，不要长。你上一句未说完的大意：${previous}`
        : "对方刚刚打断了你，但大概率是在顺着上一句继续说。请自然承接上下文，不要像全新话题重开，开头先用一句很短的话把上下文接住，例如「嗯，刚才那个我接着说」。";
    case "correction":
      return previous
        ? `对方刚刚是在修正或澄清上一句。请放弃你刚才被打断的断言，开头先明确接住这次修正，再继续回应。不要强行把话题拉回你上一句。第一句更像「好，我按你刚刚纠正的来」或「明白，那我按这个来」，不要长。你上一句未说完的大意：${previous}`
        : "对方刚刚是在修正或澄清上一句。请开头先接住修正，再继续回应，不要机械重复上一句。第一句可以像「好，我按你刚刚纠正的来」。";
    case "topic_switch":
      return "对方刚刚是在切换话题。请不要延续你被打断的上一句，直接顺着新话题回应，开头可以用一句很短的话完成切换，例如「好，那我们看这个」或「行，那先说这个」。";
    case "emotional_interrupt":
      return "对方刚刚是带情绪地打断你。请先用一句很短的安抚、确认或停顿接住情绪，再进入正式回复，不要直接长篇解释。第一句更像「好，我先停一下」或「嗯，我在听」，不要一下子说很多。";
    default:
      return previous
        ? `你刚刚被打断了。请保持上下文连续，但避免机械地重复上一句。开头先用一句短话重新接回上下文，例如「好，我接着说」或「嗯，回到刚才那个」。你上一句未说完的大意：${previous}`
        : "你刚刚被打断了。请保持上下文连续，但避免像机械重开，开头先用一句短话接回上下文，例如「好，我接着说」。";
  }
}

/**
 * 文本聊天专用：判断用户这条消息是否**显式**在承接/修正上一句。
 *
 * 语音打断走 `classifyInterruption`（它对模糊情况会落到 "unknown"，再由
 * `buildCarryForwardHint` 的 default 分支把上一句草稿塞进 prompt 要求"承接"）。
 * 这套逻辑对语音合理，但文本快速连发时是灾难：用户其实在问**全新问题**，却
 * 因为上一条仍在生成（interrupt.active=true）被判成 "unknown" → carry-forward
 * 上一条草稿 → 上一条已生成完整时 LLM 直接逐字复读（线上"复读机"根因）。
 *
 * 因此文本路径只在用户**显式**说"接着说/继续"(continuation) 或"不对，我是说"
 * (correction) 时才允许 carry-forward；其余一律当新问题处理，不复读上一条。
 */
export function hasExplicitCarryForwardCue(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return CONTINUATION_RE.test(t) || CORRECTION_RE.test(t);
}
