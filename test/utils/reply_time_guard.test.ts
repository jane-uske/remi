const assert = require("assert").strict;
const {
  checkReplyTimeGuard,
  checkReplyTimeGuardForFullText,
  legalWeekdayCharsForSentence,
  legalPeriodWordsForHour,
  stripSentenceLoose,
} = require("../../utils/reply_time_guard");

const TZ = "Asia/Shanghai";

/** 构造一个 Asia/Shanghai 当地时间为 `hour:00`、星期为 `weekdayIndex`（0=周日..6=周六）的 Date。 */
function dateFor(weekdayIndex: number, hour: number): Date {
  // 2026-06-28 是周日（jsDay=0），从这里按 weekdayIndex 天数偏移，再设置小时。
  // 用 UTC 构造再按 Asia/Shanghai（UTC+8）反推，确保没有本地时区干扰。
  const base = Date.UTC(2026, 5, 28, 0, 0, 0); // 2026-06-28T00:00:00Z == 2026-06-28 08:00 CST（周日）
  const dayOffsetMs = weekdayIndex * 24 * 60 * 60 * 1000;
  // 目标：Asia/Shanghai 本地小时 == hour。base 对应 CST 08:00，所以再加 (hour - 8) 小时。
  const hourOffsetMs = (hour - 8) * 60 * 60 * 1000;
  return new Date(base + dayOffsetMs + hourOffsetMs);
}

function assertToday(date: Date, expectedWeekdayIndex: number, expectedHour: number) {
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(date);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  assert.equal(map[wd], expectedWeekdayIndex, `sanity: weekday index for ${date.toISOString()}`);
  const hourStr = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour: "numeric",
    hourCycle: "h23",
  }).format(date);
  assert.equal(Number(hourStr), expectedHour, `sanity: hour for ${date.toISOString()}`);
}

describe("reply_time_guard", () => {
  describe("test harness sanity", () => {
    it("dateFor() produces the intended Asia/Shanghai weekday + hour", () => {
      assertToday(dateFor(6, 1), 6, 1); // 周六 01:00 (生产案例②的场景)
      assertToday(dateFor(1, 8), 1, 8); // 周一 08:00
      assertToday(dateFor(0, 14), 0, 14); // 周日 14:00
    });
  });

  describe("weekday assertion — violations", () => {
    it("flags an unqualified weekday mention that does not match today (生产案例①)", () => {
      // 今天是周六，回复却说"周一早起确实折磨人"
      const now = dateFor(6, 1); // 周六 凌晨 01:00
      const result = checkReplyTimeGuard("周一早起确实折磨人。", { now, timeZone: TZ });
      assert.equal(result.ok, false);
      assert.equal(result.violations.length, 1);
      assert.equal(result.violations[0].kind, "weekday");
      assert.equal(result.violations[0].token, "周一");
    });

    it("flags '今天是周X' style assertion when X is wrong", () => {
      const now = dateFor(6, 10); // 周六
      const result = checkReplyTimeGuard("今天是周三啊，你记错啦。", { now, timeZone: TZ });
      assert.equal(result.ok, false);
      assert.equal(result.violations[0].token, "周三");
    });
  });

  describe("weekday assertion — legal / correct", () => {
    it("passes when the weekday mentioned matches today", () => {
      const now = dateFor(6, 10); // 周六
      const result = checkReplyTimeGuard("今天确实是周六，你没记错。", { now, timeZone: TZ });
      assert.equal(result.ok, true);
      assert.deepEqual(result.violations, []);
    });
  });

  describe("weekday assertion — relative/periodic prefixes are exempt", () => {
    it("passes 上周X (last week's X, not an assertion about today)", () => {
      const now = dateFor(6, 10); // 周六
      const result = checkReplyTimeGuard("上周三我们聊过这个话题呢。", { now, timeZone: TZ });
      assert.equal(result.ok, true);
    });

    it("passes 下周X (next week's X)", () => {
      const now = dateFor(6, 10);
      const result = checkReplyTimeGuard("下周三要交作业别忘了。", { now, timeZone: TZ });
      assert.equal(result.ok, true);
    });

    it("passes 每周X (recurring, not a today-assertion)", () => {
      const now = dateFor(6, 10);
      const result = checkReplyTimeGuard("每周三我们都聊得挺开心的。", { now, timeZone: TZ });
      assert.equal(result.ok, true);
    });

    it("passes 上上周X (two weeks ago)", () => {
      const now = dateFor(6, 10);
      const result = checkReplyTimeGuard("上上周三见过你提起这事。", { now, timeZone: TZ });
      assert.equal(result.ok, true);
    });

    it("passes 周末 (weekend, not a specific weekday assertion)", () => {
      const now = dateFor(6, 10);
      const result = checkReplyTimeGuard("周末要不要一起放松一下？", { now, timeZone: TZ });
      assert.equal(result.ok, true);
    });
  });

  describe("weekday assertion — tomorrow/yesterday offset", () => {
    it("allows tomorrow's weekday when 明天 cue is present", () => {
      const now = dateFor(6, 10); // 今天周六，明天周日
      const result = checkReplyTimeGuard("明天是周日，好好休息一下。", { now, timeZone: TZ });
      assert.equal(result.ok, true);
    });

    it("still flags a weekday that is neither today nor tomorrow, even with 明天 cue", () => {
      const now = dateFor(6, 10); // 今天周六，明天周日；周三既不是今天也不是明天
      const result = checkReplyTimeGuard("明天是周三，好好休息一下。", { now, timeZone: TZ });
      assert.equal(result.ok, false);
      assert.equal(result.violations[0].token, "周三");
    });

    it("allows yesterday's weekday when 昨天 cue is present", () => {
      const now = dateFor(6, 10); // 今天周六，昨天周五
      const result = checkReplyTimeGuard("昨天是周五，你都还记得呢。", { now, timeZone: TZ });
      assert.equal(result.ok, true);
    });
  });

  describe("weekday assertion — negation / correction is not an assertion", () => {
    it("does not flag '今天不是周X' (a correction, not an assertion of X)", () => {
      const now = dateFor(6, 10); // 周六
      const result = checkReplyTimeGuard("今天不是周一啦，是周六，你放心睡吧。", {
        now,
        timeZone: TZ,
      });
      assert.equal(result.ok, true);
    });
  });

  describe("weekday assertion — plan/schedule context is exempt", () => {
    it("does not flag a future-plan mention of a weekday ('周三要交作业')", () => {
      const now = dateFor(6, 10); // 周六，作业本身是周三的事，不是断言今天
      const result = checkReplyTimeGuard("你周三要交作业别忘记安排时间。", {
        now,
        timeZone: TZ,
      });
      assert.equal(result.ok, true);
    });

    it("does not flag a proposed meeting day ('我们周三见吧')", () => {
      const now = dateFor(6, 10);
      const result = checkReplyTimeGuard("那我们就约在周三见吧。", { now, timeZone: TZ });
      assert.equal(result.ok, true);
    });
  });

  describe("weekday assertion — question / quote / hypothetical are exempt", () => {
    it("passes a question sentence ('是周六吗？')", () => {
      const now = dateFor(3, 10); // 今天其实是周三，问的是周六
      const result = checkReplyTimeGuard("是周六吗？", { now, timeZone: TZ });
      assert.equal(result.ok, true);
    });

    it("passes a quoted weekday mention", () => {
      const now = dateFor(3, 10);
      const result = checkReplyTimeGuard("「周六」只是我瞎猜的，别当真。", { now, timeZone: TZ });
      assert.equal(result.ok, true);
    });

    it("passes a hypothetical weekday mention", () => {
      const now = dateFor(3, 10);
      const result = checkReplyTimeGuard("如果是周六就更好安排了。", { now, timeZone: TZ });
      assert.equal(result.ok, true);
    });
  });

  describe("time-of-day assertion — violations (生产案例②)", () => {
    it("flags '这会儿已经黄昏了' at 01:42 (actual production bad sample)", () => {
      const now = dateFor(6, 1); // 凌晨 01:xx
      const result = checkReplyTimeGuard("这会儿已经黄昏了，你怎么还不睡？", {
        now,
        timeZone: TZ,
      });
      assert.equal(result.ok, false);
      assert.equal(result.violations[0].kind, "time_period");
      assert.equal(result.violations[0].token, "黄昏");
    });

    it("flags '现在都半夜了' said during daytime", () => {
      const now = dateFor(3, 14); // 下午 14:00
      const result = checkReplyTimeGuard("现在都半夜了还不睡觉。", { now, timeZone: TZ });
      assert.equal(result.ok, false);
      assert.equal(result.violations[0].token, "半夜");
    });
  });

  describe("time-of-day assertion — legal / tolerance band", () => {
    it("passes a correct time-period assertion", () => {
      const now = dateFor(3, 14); // 下午
      const result = checkReplyTimeGuard("现在是下午，正好适合喝杯茶。", { now, timeZone: TZ });
      assert.equal(result.ok, true);
    });

    it("gives 1-hour overlap tolerance at a period boundary (08:00 allows both 早上 and 凌晨/深夜/半夜 spillover from 04-05)", () => {
      // hour=5 is the exact start of 早上/清晨 (5-9); tolerance also allows the
      // previous range (凌晨/深夜/半夜, which ends at 5) to spill into hour 4.
      const now = dateFor(3, 4);
      const legal = legalPeriodWordsForHour(4);
      assert(legal.has("凌晨"), "hour 4 should allow 凌晨 (inside its own range)");
      assert(legal.has("早上"), "hour 4 should allow 早上 due to 1h boundary tolerance");
      const result = checkReplyTimeGuard("现在是早上，快天亮了。", { now, timeZone: TZ });
      assert.equal(result.ok, true);
    });

    it("does not flag a time-period word with no 'now' indicator (generic advice, not an assertion)", () => {
      const now = dateFor(3, 14); // 下午，句子提到"早上"但没有现在时指示词
      const result = checkReplyTimeGuard("早上记得吃早饭哦。", { now, timeZone: TZ });
      assert.equal(result.ok, true);
    });

    it("passes a question about the current time period", () => {
      const now = dateFor(6, 1);
      const result = checkReplyTimeGuard("现在已经是黄昏了吗？", { now, timeZone: TZ });
      assert.equal(result.ok, true);
    });
  });

  describe("multi-sentence full-text scan", () => {
    it("checkReplyTimeGuardForFullText reports per-sentence results, isolating the bad sentence", () => {
      const now = dateFor(6, 1); // 周六凌晨
      const text = "你说想睡了呀。周一早起确实折磨人。早点休息吧。";
      const perSentence = checkReplyTimeGuardForFullText(text, { now, timeZone: TZ });
      assert.equal(perSentence.length, 3);
      assert.equal(perSentence[0].result.ok, true);
      assert.equal(perSentence[1].result.ok, false);
      assert.equal(perSentence[1].sentence, "周一早起确实折磨人。");
      assert.equal(perSentence[2].result.ok, true);
    });
  });

  describe("legalWeekdayCharsForSentence / legalPeriodWordsForHour helpers", () => {
    it("legalWeekdayCharsForSentence returns only today by default", () => {
      const legal = legalWeekdayCharsForSentence("随便说点什么", 6);
      assert.deepEqual([...legal], ["六"]);
    });

    it("legalWeekdayCharsForSentence expands with 明天/昨天 cues", () => {
      const legalTomorrow = legalWeekdayCharsForSentence("明天怎么样", 6);
      assert.deepEqual([...legalTomorrow].sort(), ["六", "日"].sort());
      const legalYesterday = legalWeekdayCharsForSentence("昨天怎么样", 6);
      assert.deepEqual([...legalYesterday].sort(), ["五", "六"].sort());
    });
  });

  describe("edge cases", () => {
    it("returns ok=true for an empty or whitespace-only sentence", () => {
      const now = dateFor(6, 1);
      assert.equal(checkReplyTimeGuard("", { now, timeZone: TZ }).ok, true);
      assert.equal(checkReplyTimeGuard("   ", { now, timeZone: TZ }).ok, true);
    });

    it("falls back to UTC-safe behavior for an invalid timeZone instead of throwing", () => {
      const now = dateFor(6, 1);
      assert.doesNotThrow(() => {
        checkReplyTimeGuard("周一早起确实折磨人。", { now, timeZone: "Not/ARealZone" });
      });
    });
  });

  describe("stripSentenceLoose（持久化剔除的标点容错）", () => {
    it("精确匹配时直接剔除", () => {
      assert.equal(
        stripSentenceLoose("早点睡吧。周二早起确实折磨人。晚安。", "周二早起确实折磨人。"),
        "早点睡吧。晚安。",
      );
    });

    it("生产实案：chunker 句子丢了逗号也能从原文剔除", () => {
      const full =
        "既然醒了就别在床上躺着胡思乱想，起来喝口水，或者去窗边吹吹风？反正周一还远着呢，别急着把自己往床上赶。";
      const dropped = "反正周一还远着呢别急着把自己往床上赶。";
      assert.equal(
        stripSentenceLoose(full, dropped),
        "既然醒了就别在床上躺着胡思乱想，起来喝口水，或者去窗边吹吹风？",
      );
    });

    it("向前不吞：上一句的句尾标点保留", () => {
      const result = stripSentenceLoose("你要不要听听看？周三见面聊。", "周三见面聊。");
      assert.equal(result, "你要不要听听看？");
    });

    it("完全不匹配时原样返回，不误删", () => {
      const full = "今天天气不错。";
      assert.equal(stripSentenceLoose(full, "周五去爬山。"), full);
    });

    it("跨换行的标点差异也能剔除且不破坏其余段落", () => {
      const full = "嗯…那就别硬撑着了。\n\n周一早起确实折磨人，趁现在还能闭眼，赶紧睡吧。我就在这守着，不打扰你。晚安。";
      const dropped = "周一早起确实折磨人趁现在还能闭眼赶紧睡吧。";
      const result = stripSentenceLoose(full, dropped);
      assert.ok(!result.includes("周一"), `坏句应被剔除，得到: ${result}`);
      assert.ok(result.includes("我就在这守着"), "后续句子应保留");
      assert.ok(result.includes("嗯…那就别硬撑着了。"), "前段应保留");
    });
  });
});
