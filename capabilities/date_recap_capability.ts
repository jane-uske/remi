import { isDbReady } from "../infra/app_state";
import { createLogger } from "../infra/logger";
import { completeWithOptions } from "../llm/qwen_client";
import { getUserMessagesInRange } from "../storage/repositories/message_repository";
import type { DbMessage } from "../storage/types";
import type { DirectCapability } from "../brain/direct_capabilities";

const logger = createLogger("date_recap");

const DAY_MS = 24 * 60 * 60 * 1000;
const CURRENT_QUERY_ECHO_WINDOW_MS = 60 * 1000;
const MAX_RECAP_MESSAGES = 80;
const MAX_RECAP_TRANSCRIPT_CHARS = 7000;

const RECAP_CUE_RE =
  /(聊了什么|聊过什么|都聊了什么|都聊了啥|说了什么|说过什么|讲了什么|回顾一下|回顾下|总结一下|总结下|主要聊了什么)/u;
const TODAY_RE = /今天/u;
const YESTERDAY_RE = /(昨天|昨晚)/u;
const DAY_BEFORE_YESTERDAY_RE = /前天/u;
const ABSOLUTE_DATE_RE = /(?:(\d{4})年\s*)?(\d{1,2})月\s*(\d{1,2})(?:日|号)/u;

function dateRecapCapabilityEnabled(): boolean {
  const raw = (process.env.REMI_DATE_RECAP_CAPABILITY_ENABLED ?? "1").trim().toLowerCase();
  return raw !== "0" && raw !== "false";
}

export type DateRecapIntent =
  | { kind: "relative"; offsetDays: 0 | 1 | 2; referenceLabel: "今天" | "昨天" | "前天" }
  | { kind: "absolute"; year?: number; month: number; day: number; referenceLabel: string };

export type DateRecapWindow = {
  timeZone: string;
  referenceLabel: string;
  dateLabel: string;
  startAt: Date;
  endAt: Date;
};

function safeTimeZone(timeZone?: string | null): string {
  const candidate = timeZone?.trim() || "UTC";
  try {
    new Intl.DateTimeFormat("zh-CN", { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return "UTC";
  }
}

function timeZoneParts(date: Date, timeZone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: values.year ?? date.getUTCFullYear(),
    month: values.month ?? date.getUTCMonth() + 1,
    day: values.day ?? date.getUTCDate(),
    hour: values.hour ?? 0,
    minute: values.minute ?? 0,
    second: values.second ?? 0,
  };
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = timeZoneParts(date, timeZone);
  const utcFromLocalView = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return utcFromLocalView - date.getTime();
}

function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  let result = new Date(utcGuess);
  let offset = getTimeZoneOffsetMs(result, timeZone);
  result = new Date(utcGuess - offset);
  const refinedOffset = getTimeZoneOffsetMs(result, timeZone);
  if (refinedOffset !== offset) {
    result = new Date(utcGuess - refinedOffset);
  }
  return result;
}

function addDaysToParts(
  parts: { year: number; month: number; day: number },
  deltaDays: number,
): { year: number; month: number; day: number } {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + deltaDays, 12, 0, 0));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function formatChineseDate(parts: { year: number; month: number; day: number }): string {
  return `${parts.year} 年 ${parts.month} 月 ${parts.day} 日`;
}

function formatLocalClock(date: Date, timeZone: string): string {
  const parts = timeZoneParts(date, timeZone);
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

function inferAbsoluteYear(
  intent: Extract<DateRecapIntent, { kind: "absolute" }>,
  now: Date,
  timeZone: string,
): number {
  if (intent.year) return intent.year;
  const today = timeZoneParts(now, timeZone);
  const todayMonthDay = today.month * 100 + today.day;
  const askedMonthDay = intent.month * 100 + intent.day;
  return askedMonthDay > todayMonthDay ? today.year - 1 : today.year;
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  const probe = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() + 1 === month &&
    probe.getUTCDate() === day
  );
}

function trimCurrentQueryEcho(
  messages: DbMessage[],
  userMessage: string,
  now: Date,
): { messages: DbMessage[]; trimmedCurrentQuery: boolean } {
  if (messages.length === 0) {
    return { messages, trimmedCurrentQuery: false };
  }

  const last = messages[messages.length - 1];
  if (
    last.role === "user" &&
    last.content.trim() === userMessage.trim() &&
    Math.abs(now.getTime() - last.created_at.getTime()) <= CURRENT_QUERY_ECHO_WINDOW_MS
  ) {
    return {
      messages: messages.slice(0, -1),
      trimmedCurrentQuery: true,
    };
  }

  return { messages, trimmedCurrentQuery: false };
}

function buildRecapTranscript(messages: DbMessage[], timeZone: string): string {
  const lines = messages
    .slice(0, MAX_RECAP_MESSAGES)
    .map((message) => {
      const speaker = message.role === "user" ? "用户" : "Remi";
      return `${formatLocalClock(message.created_at, timeZone)} ${speaker}：${message.content.trim()}`;
    })
    .filter((line) => line.trim().length > 0);

  const fullText = lines.join("\n");
  if (fullText.length <= MAX_RECAP_TRANSCRIPT_CHARS) {
    return fullText;
  }

  const head = lines.slice(0, 18);
  const tail = lines.slice(-32);
  const omitted = Math.max(0, lines.length - head.length - tail.length);
  return [
    ...head,
    omitted > 0 ? `……中间省略 ${omitted} 条消息……` : "",
    ...tail,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_RECAP_TRANSCRIPT_CHARS);
}

function heuristicRecap(
  messages: DbMessage[],
  referenceSide: string,
  referenceLabel: string,
): string {
  const userSnippets = Array.from(
    new Set(
      messages
        .filter((message) => message.role === "user")
        .map((message) => message.content.trim())
        .filter(Boolean)
        .map((text) => (text.length > 28 ? `${text.slice(0, 28).trimEnd()}…` : text)),
    ),
  ).slice(0, 3);

  const assistantSnippets = Array.from(
    new Set(
      messages
        .filter((message) => message.role === "assistant")
        .map((message) => message.content.trim())
        .filter(Boolean)
        .map((text) => (text.length > 24 ? `${text.slice(0, 24).trimEnd()}…` : text)),
    ),
  ).slice(0, 2);

  const lines: string[] = [
    `按${referenceSide}${referenceLabel}的聊天记录看，那天一共聊了 ${messages.length} 条消息。`,
  ];

  if (userSnippets.length > 0) {
    lines.push(`你主要提到的是：${userSnippets.join("；")}。`);
  }
  if (assistantSnippets.length > 0) {
    lines.push(`我当时主要是这样接的：${assistantSnippets.join("；")}。`);
  }
  return lines.join("");
}

async function summarizeMessagesWithModel(input: {
  messages: DbMessage[];
  dateLabel: string;
  referenceLabel: string;
  referenceSide: string;
  timeZone: string;
  signal?: AbortSignal;
}): Promise<string> {
  const transcript = buildRecapTranscript(input.messages, input.timeZone);
  const reply = await completeWithOptions(
    [
      {
        role: "system",
        content:
          "你在做按日期回顾聊天的能力。只根据给定聊天记录回答，不要脑补。输出 2 到 4 句中文，总结当天主要聊了什么、有没有形成判断/待办、整体氛围如何。不要追问，不要主持，不要加列表，不要说你看不到记录。",
      },
      {
        role: "user",
        content:
          `请回顾 ${input.dateLabel} 的聊天。\n` +
          `参考表达：按${input.referenceSide}${input.referenceLabel}的聊天记录看……\n` +
          `消息总数：${input.messages.length}\n` +
          `聊天记录：\n${transcript}`,
      },
    ],
    {
      maxTokens: 220,
      temperature: 0.2,
      signal: input.signal,
    },
  );
  return reply.trim();
}

export function matchDateRecapIntent(userMessage: string): DateRecapIntent | null {
  const trimmed = userMessage.trim();
  if (!trimmed || !RECAP_CUE_RE.test(trimmed)) return null;

  if (DAY_BEFORE_YESTERDAY_RE.test(trimmed)) {
    return { kind: "relative", offsetDays: 2, referenceLabel: "前天" };
  }
  if (YESTERDAY_RE.test(trimmed)) {
    return { kind: "relative", offsetDays: 1, referenceLabel: "昨天" };
  }
  if (TODAY_RE.test(trimmed)) {
    return { kind: "relative", offsetDays: 0, referenceLabel: "今天" };
  }

  const explicit = trimmed.match(ABSOLUTE_DATE_RE);
  if (explicit) {
    const year = explicit[1] ? Number(explicit[1]) : undefined;
    const month = Number(explicit[2]);
    const day = Number(explicit[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return {
        kind: "absolute",
        year,
        month,
        day,
        referenceLabel: year ? `${year}年${month}月${day}日` : `${month}月${day}日`,
      };
    }
  }

  return null;
}

export function resolveDateRecapWindow(
  intent: DateRecapIntent,
  now: Date,
  timeZone?: string | null,
): DateRecapWindow {
  const effectiveTimeZone = safeTimeZone(timeZone);
  const todayParts = timeZoneParts(now, effectiveTimeZone);

  const targetParts =
    intent.kind === "relative"
      ? addDaysToParts(
          { year: todayParts.year, month: todayParts.month, day: todayParts.day },
          -intent.offsetDays,
        )
      : {
          year: inferAbsoluteYear(intent, now, effectiveTimeZone),
          month: intent.month,
          day: intent.day,
        };

  if (!isValidCalendarDate(targetParts.year, targetParts.month, targetParts.day)) {
    throw new Error(`Invalid recap date: ${targetParts.year}-${targetParts.month}-${targetParts.day}`);
  }

  const nextParts = addDaysToParts(targetParts, 1);
  return {
    timeZone: effectiveTimeZone,
    referenceLabel: intent.referenceLabel,
    dateLabel: formatChineseDate(targetParts),
    startAt: zonedTimeToUtc(
      targetParts.year,
      targetParts.month,
      targetParts.day,
      0,
      0,
      0,
      effectiveTimeZone,
    ),
    endAt: zonedTimeToUtc(
      nextParts.year,
      nextParts.month,
      nextParts.day,
      0,
      0,
      0,
      effectiveTimeZone,
    ),
  };
}

export async function tryHandleDateRecap(input: {
  userId: string;
  userMessage: string;
  now: Date;
  clientTimeZone?: string | null;
  serverTimeZone?: string | null;
  signal?: AbortSignal;
}): Promise<string | null> {
  const intent = matchDateRecapIntent(input.userMessage);
  if (!intent) return null;

  const rawClientTimeZone = input.clientTimeZone?.trim() || "";
  const validClientTimeZone =
    rawClientTimeZone && safeTimeZone(rawClientTimeZone) === rawClientTimeZone
      ? rawClientTimeZone
      : "";
  const timeZone = safeTimeZone(validClientTimeZone || input.serverTimeZone);
  const referenceSide = validClientTimeZone ? "你那边" : "我这边";
  let window: DateRecapWindow;
  try {
    window = resolveDateRecapWindow(intent, input.now, timeZone);
  } catch {
    return `我知道你是在问按日期回顾聊天，但这个日期本身不成立，所以我没法准确回顾那天聊了什么。`;
  }

  if (!isDbReady() || !input.userId.trim()) {
    return `我知道你是在问 ${window.referenceLabel} 的聊天回顾，但我这边现在拿不到按日期的历史记录，所以没法准确回顾那天聊了什么。`;
  }

  const rawMessages = await getUserMessagesInRange(
    input.userId,
    window.startAt,
    window.endAt,
    MAX_RECAP_MESSAGES + 8,
  );
  const trimmed = trimCurrentQueryEcho(rawMessages, input.userMessage, input.now);

  if (trimmed.messages.length === 0) {
    if (trimmed.trimmedCurrentQuery && window.referenceLabel === "今天") {
      return `按${referenceSide}${window.referenceLabel}的聊天记录看，除了你刚刚这句回顾问题，我这边还没查到别的聊天记录。`;
    }
    return `按${referenceSide}${window.referenceLabel}的聊天记录看，那天没有查到聊天记录。`;
  }

  try {
    const summary = await summarizeMessagesWithModel({
      messages: trimmed.messages,
      dateLabel: window.dateLabel,
      referenceLabel: window.referenceLabel,
      referenceSide,
      timeZone: window.timeZone,
      signal: input.signal,
    });
    if (summary) {
      return summary;
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw err;
    }
    logger.warn("date recap summary fallback", {
      error: (err as Error).message,
      userId: input.userId,
      referenceLabel: window.referenceLabel,
    });
  }

  return heuristicRecap(trimmed.messages, referenceSide, window.referenceLabel);
}

export const dateRecapCapability: DirectCapability = {
  id: "date_recap",
  async tryHandle(request) {
    if (request.systemTriggered || !dateRecapCapabilityEnabled()) {
      return { handled: false };
    }

    const serverTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const reply = await tryHandleDateRecap({
      userId: request.ctx.userId,
      userMessage: request.userMessage,
      now: new Date(),
      clientTimeZone: request.ctx.getClientTimeZone(),
      serverTimeZone,
      signal: request.signal,
    });
    if (!reply) {
      return { handled: false };
    }

    return {
      handled: true,
      capabilityId: "date_recap",
      reply,
    };
  },
};
