const assert = require("assert").strict;
const {
  describeGap,
  buildTimeContext,
  TIME_CONTEXT_MARKER,
} = require("../../brain/time_context");
const { buildPrompt } = require("../../brain/prompt_builder");
const {
  computeCacheBreakpoint,
  resolveCacheProvider,
} = require("../../brain/prompt_cache");

// M3-P0 §14.2：时间戳落在断点之后；gap 计算正确；不污染缓存前缀。
describe("time context formatting", () => {
  it("omits gap below the 3h threshold", () => {
    assert.equal(describeGap(60 * 60 * 1000), null); // 1h
    assert.equal(describeGap(2.5 * 60 * 60 * 1000), null); // 2.5h
  });

  it("describes hour / day / week gaps", () => {
    assert.equal(describeGap(5 * 60 * 60 * 1000), "5 小时");
    assert.equal(describeGap(3 * 24 * 60 * 60 * 1000), "3 天");
    assert.equal(describeGap(21 * 24 * 60 * 60 * 1000), "3 周");
  });

  it("builds a block with marker and gap clause", () => {
    const block = buildTimeContext({
      now: new Date("2026-06-22T06:30:00Z"),
      timeZone: "Asia/Shanghai",
      locale: "zh-CN",
      gapDescriptor: "3 天",
    });
    assert.ok(block.startsWith(TIME_CONTEXT_MARKER));
    assert.ok(block.includes("现在是"));
    assert.ok(block.includes("3 天"));
  });

  it("omits the gap clause when descriptor is null", () => {
    const block = buildTimeContext({
      now: new Date(),
      timeZone: null,
      locale: null,
      gapDescriptor: null,
    });
    assert.ok(!block.includes("距你上次"));
  });
});

describe("time injection lands in the dynamic tail (after cache breakpoint)", () => {
  const timeContext = TIME_CONTEXT_MARKER + "现在是 2026年6月22日星期一 14:30。";
  const messages = buildPrompt({
    memory: [],
    emotion: "neutral",
    history: [
      { role: "user", content: "在吗" },
      { role: "assistant", content: "在的～" },
    ],
    userMessage: "我回来啦",
    timeContext,
  });

  it("places the time block after history and immediately before the user message", () => {
    const last = messages[messages.length - 1];
    const tail = messages[messages.length - 2];
    assert.equal(last.role, "user");
    assert.equal(last.content, "我回来啦");
    assert.equal(tail.role, "system");
    assert.ok(tail.content.startsWith(TIME_CONTEXT_MARKER));
  });

  it("never pollutes the cacheable Tier0 prefix (messages[0])", () => {
    assert.ok(!messages[0].content.includes(TIME_CONTEXT_MARKER));
  });

  it("breakpoint sits at the time block; only the user message follows", () => {
    const bp = computeCacheBreakpoint(messages);
    assert.ok(messages[bp].content.startsWith(TIME_CONTEXT_MARKER));
    assert.equal(bp, messages.length - 2);
    assert.equal(messages[bp + 1].role, "user");
  });

  it("breakpoint falls on the user message when there is no time context", () => {
    const msgs = buildPrompt({
      memory: [],
      emotion: "neutral",
      history: [
        { role: "user", content: "a" },
        { role: "assistant", content: "b" },
      ],
      userMessage: "c",
    });
    const bp = computeCacheBreakpoint(msgs);
    assert.equal(bp, msgs.length - 1);
    assert.equal(msgs[bp].role, "user");
  });
});

describe("cache provider resolution", () => {
  it("maps base urls to providers (explicit baseUrl, no config dependency)", () => {
    assert.equal(resolveCacheProvider("https://api.anthropic.com"), "anthropic");
    assert.equal(resolveCacheProvider("https://api.openai.com/v1"), "openai_auto");
    assert.equal(resolveCacheProvider("http://127.0.0.1:1234/v1"), "local_prefix");
    assert.equal(resolveCacheProvider(""), "none");
  });
});
