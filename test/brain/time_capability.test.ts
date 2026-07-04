const assert = require("assert").strict;

const {
  matchTimeIntent,
  renderTimeReply,
} = require("../../brain/time_capability");

describe("time capability", () => {
  const fixedUtcDate = new Date("2026-04-15T12:34:56.000Z");

  it("matches direct time questions", () => {
    assert.equal(matchTimeIntent("现在几点了"), "time_now");
  });

  it("matches direct date questions", () => {
    assert.equal(matchTimeIntent("今天几号"), "date_today");
  });

  it("matches direct weekday questions", () => {
    assert.equal(matchTimeIntent("今天星期几"), "weekday_today");
    assert.equal(matchTimeIntent("今天周几"), "weekday_today");
  });

  it("matches combined time and weekday questions with the full combined intent", () => {
    assert.equal(matchTimeIntent("现在几点，今天星期几"), "date_time_weekday_today");
  });

  it("ignores non-target relative-time and reminder queries", () => {
    assert.equal(matchTimeIntent("明天几点"), null);
    assert.equal(matchTimeIntent("昨晚几点睡的"), null);
    assert.equal(matchTimeIntent("以后提醒我"), null);
  });

  it("renders time/date/weekday replies against the provided timezone", () => {
    assert.equal(
      renderTimeReply("time_now", fixedUtcDate, { timeZone: "UTC", perspective: "server" }),
      "按我这边现在的时间看，现在是 12:34。",
    );
    assert.equal(
      renderTimeReply("date_today", fixedUtcDate, { timeZone: "UTC", perspective: "server" }),
      "按我这边现在的日期看，今天是 2026 年 4 月 15 日。",
    );
    assert.equal(
      renderTimeReply("weekday_today", fixedUtcDate, { timeZone: "UTC", perspective: "server" }),
      "按我这边现在的日期看，今天是星期三。",
    );
  });

  it("renders replies with a user-timezone label when the caller has a valid client timezone", () => {
    assert.equal(
      renderTimeReply("date_time_weekday_today", fixedUtcDate, {
        timeZone: "Asia/Shanghai",
        perspective: "user",
      }),
      "按你那边现在的时间看，今天是 2026 年 4 月 15 日，星期三，现在是 20:34。",
    );
  });

  it("falls back to REMI_TZ (Asia/Shanghai) when timezone is missing", () => {
    // 旧行为 fallback UTC 是 2026-07-04「凌晨四点半」案的病根：SSE 文本会话
    // 不带 timeZone 时，整个时间锚活在容器 UTC 时钟里。现在缺省回退用户时区。
    assert.equal(
      renderTimeReply("time_now", fixedUtcDate, { timeZone: "", perspective: "server" }),
      "按我这边现在的时间看，现在是 20:34。",
    );
  });
});
