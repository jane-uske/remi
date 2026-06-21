/**
 * Video-generation intent recognition — regex only (no LLM gate for v1).
 * Mirrors image_intent.ts but much simpler: generate | none.
 */

export type VideoIntent =
  | { kind: "generate"; subject: string }
  | { kind: "cancel" }
  | { kind: "none" };

const VIDEO_CANDIDATE_RE =
  /视频|短片|短视频|动画|影片|vlog|mv/u;

/**
 * Unambiguous "stop now" commands — these stand alone (the whole message is a
 * stop), so they're safe to treat as cancel even without a video noun. Guarded
 * downstream by `activeBySession`: if nothing is running the capability returns
 * handled:false and the message falls through to the companion.
 */
const VIDEO_HARD_STOP_RE =
  /^[\s,，。!！~～]*(?:取消|停止|停下来?|停一下|别生成了?|别做了?|不(?:生成|做)了|cancel|stop)(?:生成|视频|它|这个|吧|了|！|。|，)*[\s,，。!！?？~～]*$/iu;

/**
 * A stop/negation cue that needs a video noun nearby to count as a cancel —
 * keeps casual phrases like "我不想做作业了" from killing a running render.
 */
const VIDEO_STOP_CUE_RE =
  /取消|停止|停下|别(?:再)?(?:做|生成|搞|拍|继续)|不(?:想|要|用)?(?:再)?(?:做|生成|拍|继续)了?/iu;

const VIDEO_GENERATE_RE =
  /(?:帮我|给我|帮忙|替我|请|麻烦)?(?:生成|做|拍|来|录|创建|制作)(?:一[个段条部支]|[个段条部支])?(?:.{0,12})?(?:视频|短片|短视频|动画|影片|vlog|mv)|(?:跳舞|舞蹈|跳 ?k-?pop)(?:.{0,6})?(?:视频|短片)|(?:视频|短片|动画|影片)(?:生成|制作)/iu;

const VIDEO_REJECT_RE =
  /^(?:不是|不要|别|没有?|没让|不用|不需要).*(?:视频|短片|动画)|(?:什么|怎么|为什么).*(?:视频|短片).*[吗呢？?]$/u;

const LEADING_COMMAND_RE =
  /^[\s,，。!！~～]*(?:帮我|给我|帮忙|替我|请|麻烦)?(?:生成|做|拍|来|录|创建|制作)(?:一[个段条部支]|[个段条部支])?(?:关于|有关)?/u;

const TRAILING_COMMAND_RE =
  /[\s,，]*(?:的)?(?:视频|短片|短视频|动画|影片|vlog|mv)[\s,，。!！?？~～]*$/iu;

function cleanSubject(text: string): string {
  return text
    .replace(/^[\s,，:：、。!！?？~～]+/u, "")
    .replace(/[\s,，。!！?？~～]+$/u, "")
    .replace(/(谢谢|拜托|呗|吧|呀|啦|哦|哈|嘛|呢|麻烦了?)$/u, "")
    .trim();
}

function extractSubject(message: string): string {
  const stripped = message.trim()
    .replace(LEADING_COMMAND_RE, "")
    .replace(TRAILING_COMMAND_RE, "");
  return cleanSubject(stripped);
}

export function mightBeVideoCommand(message: string): boolean {
  return VIDEO_CANDIDATE_RE.test(message.trim());
}

export function classifyVideoIntent(message: string): VideoIntent {
  const trimmed = message.trim();
  if (!trimmed) return { kind: "none" };

  // Cancel wins over reject/generate. A bare stop command counts on its own;
  // a softer stop/negation cue only counts when a video noun is present.
  if (VIDEO_HARD_STOP_RE.test(trimmed)) return { kind: "cancel" };
  if (VIDEO_STOP_CUE_RE.test(trimmed) && mightBeVideoCommand(trimmed)) {
    return { kind: "cancel" };
  }

  if (VIDEO_REJECT_RE.test(trimmed)) return { kind: "none" };

  if (VIDEO_GENERATE_RE.test(trimmed)) {
    return { kind: "generate", subject: extractSubject(trimmed) };
  }

  return { kind: "none" };
}
