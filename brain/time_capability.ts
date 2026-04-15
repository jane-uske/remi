import type { DirectCapability } from "./direct_capabilities";

export type TimeIntent =
  | "time_now"
  | "date_today"
  | "weekday_today"
  | "date_time_now"
  | "date_weekday_today"
  | "date_time_weekday_today";

export type TimeReplyPerspective = "user" | "server";

const NON_TARGET_TIME_RE =
  /(明天|后天|昨天|昨晚|今晚|以后|提醒我|提醒一下|设提醒|闹钟|定时|下周|上周|月底|月初|过两天|几点睡)/u;
const TIME_NOW_RE =
  /((现在|当前).{0,8}(几点|几时|时间)|(^|[，,\s])几点了?[？?吗嘛呢啊呀啦]*$|现在几点(?:了)?|当前时间)/u;
const DATE_TODAY_RE =
  /今天.{0,8}(几号|多少号|几月几号|日期|多少日|哪一天)/u;
const WEEKDAY_TODAY_RE =
  /今天.{0,8}(星期几|周几|礼拜几)/u;

function timeCapabilityEnabled(): boolean {
  const raw = (process.env.REMI_TIME_CAPABILITY_ENABLED ?? "1").trim().toLowerCase();
  return raw !== "0" && raw !== "false";
}

function safeTimeZone(timeZone?: string | null): string {
  const candidate = timeZone?.trim() || "UTC";
  try {
    new Intl.DateTimeFormat("zh-CN", { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return "UTC";
  }
}

function partValue(
  date: Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
  partType: Intl.DateTimeFormatPartTypes,
): string {
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    ...options,
  });
  return formatter.formatToParts(date).find((part) => part.type === partType)?.value ?? "";
}

function formatTime(date: Date, timeZone: string): string {
  const hour = partValue(
    date,
    timeZone,
    { hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
    "hour",
  ).padStart(2, "0");
  const minute = partValue(
    date,
    timeZone,
    { hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
    "minute",
  ).padStart(2, "0");
  return `${hour}:${minute}`;
}

function formatDate(date: Date, timeZone: string): string {
  const year = partValue(date, timeZone, { year: "numeric" }, "year");
  const month = partValue(date, timeZone, { month: "numeric" }, "month");
  const day = partValue(date, timeZone, { day: "numeric" }, "day");
  return `${year} 年 ${month} 月 ${day} 日`;
}

function formatWeekday(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    weekday: "long",
  }).format(date);
}

export function matchTimeIntent(userMessage: string): TimeIntent | null {
  const trimmed = userMessage.trim();
  if (!trimmed || NON_TARGET_TIME_RE.test(trimmed)) {
    return null;
  }

  const hasTimeCue = TIME_NOW_RE.test(trimmed);
  const hasDateCue = DATE_TODAY_RE.test(trimmed);
  const hasWeekdayCue = WEEKDAY_TODAY_RE.test(trimmed);

  if (!hasTimeCue && !hasDateCue && !hasWeekdayCue) {
    return null;
  }

  if (hasTimeCue) {
    if (hasDateCue && hasWeekdayCue) return "date_time_weekday_today";
    if (hasDateCue) return "date_time_now";
    // Keep the intent set compact: time + weekday promotes to a full "today + weekday + time" answer.
    if (hasWeekdayCue) return "date_time_weekday_today";
    return "time_now";
  }

  if (hasDateCue && hasWeekdayCue) return "date_weekday_today";
  if (hasDateCue) return "date_today";
  if (hasWeekdayCue) return "weekday_today";
  return null;
}

export function renderTimeReply(
  intent: TimeIntent,
  now: Date,
  options?: {
    timeZone?: string | null;
    perspective?: TimeReplyPerspective;
  },
): string {
  const effectiveTimeZone = safeTimeZone(options?.timeZone);
  const referenceSide = options?.perspective === "user" ? "你那边" : "我这边";
  const today = formatDate(now, effectiveTimeZone);
  const weekday = formatWeekday(now, effectiveTimeZone);
  const time = formatTime(now, effectiveTimeZone);

  switch (intent) {
    case "time_now":
      return `按${referenceSide}现在的时间看，现在是 ${time}。`;
    case "date_today":
      return `按${referenceSide}现在的日期看，今天是 ${today}。`;
    case "weekday_today":
      return `按${referenceSide}现在的日期看，今天是${weekday}。`;
    case "date_time_now":
      return `按${referenceSide}现在的时间看，今天是 ${today}，现在是 ${time}。`;
    case "date_weekday_today":
      return `按${referenceSide}现在的日期看，今天是 ${today}，${weekday}。`;
    case "date_time_weekday_today":
      return `按${referenceSide}现在的时间看，今天是 ${today}，${weekday}，现在是 ${time}。`;
  }
}

export const timeCapability: DirectCapability = {
  id: "time",
  tryHandle(request) {
    if (request.systemTriggered || !timeCapabilityEnabled()) {
      return { handled: false };
    }

    const timeIntent = matchTimeIntent(request.userMessage);
    if (!timeIntent) {
      return { handled: false };
    }

    const serverTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const clientTimeZone = request.ctx.getClientTimeZone();
    const reply = renderTimeReply(timeIntent, new Date(), {
      timeZone: clientTimeZone ?? serverTimeZone,
      perspective: clientTimeZone ? "user" : "server",
    });

    return {
      handled: true,
      capabilityId: "time",
      reply,
    };
  },
};
