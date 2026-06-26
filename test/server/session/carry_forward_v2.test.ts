const assert = require("assert").strict;
const { resetConfig } = require("../../../server/config");
const {
  looksLikeQuestion,
  buildCarryForwardHint,
  buildCarryForwardHintV1,
  buildCarryForwardHintV2,
} = require("../../../server/session/interruption");

function applyEnv(values) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetConfig();
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetConfig();
  };
}

const PREV = "我刚才说到语音真人感最重要的是接话时机";

describe("carry-forward V2 (VOICE_BEST_PRACTICES 杠杆3)", () => {
  describe("looksLikeQuestion", () => {
    it("recognizes interrogatives", () => {
      assert.equal(looksLikeQuestion("这是什么意思"), true);
      assert.equal(looksLikeQuestion("你确定吗"), true);
      assert.equal(looksLikeQuestion("为什么不行"), true);
      assert.equal(looksLikeQuestion("那我们去哪里"), true);
      assert.equal(looksLikeQuestion("现在几点了？"), true);
      assert.equal(looksLikeQuestion("能不能换一个"), true);
    });

    it("does not flag statements / backchannel / lookalikes", () => {
      assert.equal(looksLikeQuestion("今天天气不错"), false);
      assert.equal(looksLikeQuestion("继续说"), false);
      assert.equal(looksLikeQuestion("嗯嗯对"), false);
      assert.equal(looksLikeQuestion("哪怕你不来我也去"), false); // 收紧后的 哪 不再误判
      assert.equal(looksLikeQuestion("随便推荐我一部电影"), false);
      assert.equal(looksLikeQuestion("   "), false);
    });
  });

  describe("buildCarryForwardHintV2 — mid-reply 提问优先", () => {
    it("instructs answer-first + offer-to-resume when a question interrupts with prior context", () => {
      const hint = buildCarryForwardHintV2("unknown", PREV, "等下，那个是什么意思？");
      assert.ok(hint.includes("先直接、简短地回答这个问题"));
      assert.ok(hint.includes("刚才那个还要我接着说吗") || hint.includes("接着刚才那段"));
      assert.ok(hint.includes(PREV), "应携带上一句大意作为可续上下文");
    });

    it("answers and stops when a question interrupts with no prior context", () => {
      const hint = buildCarryForwardHintV2("unknown", null, "现在几点了？");
      assert.ok(hint.includes("先直接、简短地回答这个问题"));
      assert.ok(hint.includes("答完自然停在这里"));
    });

    it("does NOT take the question branch for corrections (那是改你上一句，不是新问题)", () => {
      const hint = buildCarryForwardHintV2("correction", PREV, "不对，应该是明天吗");
      // correction 排除在问题分支外 → 委托回 V1 correction 文案
      assert.equal(hint, buildCarryForwardHintV1("correction", PREV));
    });
  });

  describe("buildCarryForwardHintV2 — 非问题分支", () => {
    it("topic_switch parks the previous thread instead of dropping it", () => {
      const hint = buildCarryForwardHintV2("topic_switch", PREV, "算了，说点别的");
      assert.ok(hint.includes("轻轻挂起") || hint.includes("先放着"));
      assert.ok(hint.includes("不要把旧话题硬拉回来"));
    });

    it("emotional_interrupt soothes but keeps the old thread resumable", () => {
      const hint = buildCarryForwardHintV2("emotional_interrupt", PREV, "你先别说");
      assert.ok(hint.includes("先停一下") || hint.includes("我在听"));
      assert.ok(hint.includes("把刚才那段记着"));
    });

    it("continuation delegates to V1 (already good)", () => {
      assert.equal(
        buildCarryForwardHintV2("continuation", PREV, "然后呢"),
        buildCarryForwardHintV1("continuation", PREV),
      );
    });
  });

  describe("flag selector buildCarryForwardHint", () => {
    it("defaults to V1 (behavior unchanged when flag off)", () => {
      const restore = applyEnv({ REMI_CARRY_FORWARD_V2: "0" });
      try {
        assert.equal(
          buildCarryForwardHint("topic_switch", PREV, "算了说点别的"),
          buildCarryForwardHintV1("topic_switch", PREV),
        );
      } finally {
        restore();
      }
    });

    it("routes to V2 when REMI_CARRY_FORWARD_V2=1", () => {
      const restore = applyEnv({ REMI_CARRY_FORWARD_V2: "1" });
      try {
        assert.equal(
          buildCarryForwardHint("topic_switch", PREV, "算了说点别的"),
          buildCarryForwardHintV2("topic_switch", PREV, "算了说点别的"),
        );
      } finally {
        restore();
      }
    });
  });
});
