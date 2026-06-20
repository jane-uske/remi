const assert = require("assert").strict;

const {
  matchVoiceStyleCommand,
  isVoiceStyleResetCommand,
  buildVoiceStyleInstruct,
  getVoiceStylePresets,
  matchVoiceTuneCommand,
  VOICE_STYLE_PRESETS,
} = require("../../capabilities/voice_style/voice_style_presets");

describe("voice_style_presets", () => {
  // -----------------------------------------------------------------------
  // matchVoiceStyleCommand
  // -----------------------------------------------------------------------
  describe("matchVoiceStyleCommand", () => {
    const POSITIVE_CASES = [
      ["用御姐音", "yujie"],
      ["换成萝莉音", "luoli"],
      ["切换温柔音色", "wenrou"],
      ["来个元气音", "yuanqi"],
      ["换个冷酷声音", "lengku"],
      ["来点妩媚嗓音", "wumei"],
      ["切到御姐", "yujie"],
      ["用萝莉声音", "luoli"],
    ];

    for (const [input, expectedId] of POSITIVE_CASES) {
      it(`"${input}" → ${expectedId}`, () => {
        const result = matchVoiceStyleCommand(input);
        assert.ok(result, `expected a match for "${input}"`);
        assert.equal(result.id, expectedId);
      });
    }

    const NEGATIVE_CASES = [
      "你好呀",
      "御姐",
      "她的声音很像御姐",
      "",
      "开启成人模式",
      "画一张图",
    ];

    for (const input of NEGATIVE_CASES) {
      it(`"${input}" → null`, () => {
        assert.equal(matchVoiceStyleCommand(input), null);
      });
    }
  });

  // -----------------------------------------------------------------------
  // isVoiceStyleResetCommand
  // -----------------------------------------------------------------------
  describe("isVoiceStyleResetCommand", () => {
    const POSITIVE = [
      "恢复原来的声音",
      "换回默认音色",
      "回到正常的声音",
      "还原之前的声音",
    ];
    for (const input of POSITIVE) {
      it(`"${input}" → true`, () => {
        assert.equal(isVoiceStyleResetCommand(input), true);
      });
    }

    const NEGATIVE = [
      "用御姐音",
      "你好呀",
      "恢复一下",
      "",
    ];
    for (const input of NEGATIVE) {
      it(`"${input}" → false`, () => {
        assert.equal(isVoiceStyleResetCommand(input), false);
      });
    }
  });

  // -----------------------------------------------------------------------
  // buildVoiceStyleInstruct
  // -----------------------------------------------------------------------
  describe("buildVoiceStyleInstruct", () => {
    it("combines base instruct with emotion modifier", () => {
      const result = buildVoiceStyleInstruct("yujie", "happy");
      assert.ok(result.includes(VOICE_STYLE_PRESETS.yujie.instruct));
      assert.ok(result.includes("笑意"));
    });

    it("returns base instruct only for neutral emotion", () => {
      const result = buildVoiceStyleInstruct("yujie", "neutral");
      assert.equal(result, VOICE_STYLE_PRESETS.yujie.instruct);
    });

    it("returns base instruct only when emotion is undefined", () => {
      const result = buildVoiceStyleInstruct("wenrou");
      assert.equal(result, VOICE_STYLE_PRESETS.wenrou.instruct);
    });

    it("falls back to default per-emotion instruct for unknown preset id", () => {
      const result = buildVoiceStyleInstruct("nonexistent", "happy");
      assert.ok(typeof result === "string");
      assert.ok(result.length > 0);
    });

    it("adds sad modifier correctly", () => {
      const result = buildVoiceStyleInstruct("lengku", "sad");
      assert.ok(result.includes(VOICE_STYLE_PRESETS.lengku.instruct));
      assert.ok(result.includes("语速缓慢"));
    });
  });

  // -----------------------------------------------------------------------
  // matchVoiceTuneCommand — speed
  // -----------------------------------------------------------------------
  describe("matchVoiceTuneCommand (speed)", () => {
    const SLOW_CASES = [
      "说慢点",
      "你说得太快了",
      "语速慢一点",
      "讲慢一些",
      "太快了",
    ];
    for (const input of SLOW_CASES) {
      it(`"${input}" → speed down`, () => {
        const r = matchVoiceTuneCommand(input);
        assert.ok(r, `expected match for "${input}"`);
        assert.equal(r.kind, "speed");
        assert.equal(r.direction, "down");
        assert.ok(r.modifier && r.modifier.includes("慢"));
      });
    }

    const FAST_CASES = [
      "说快点",
      "你说得太慢了",
      "语速快一点",
      "太慢了",
    ];
    for (const input of FAST_CASES) {
      it(`"${input}" → speed up`, () => {
        const r = matchVoiceTuneCommand(input);
        assert.ok(r, `expected match for "${input}"`);
        assert.equal(r.kind, "speed");
        assert.equal(r.direction, "up");
        assert.ok(r.modifier && r.modifier.includes("快"));
      });
    }

    it('"语速恢复正常" → speed reset', () => {
      const r = matchVoiceTuneCommand("语速恢复正常");
      assert.ok(r);
      assert.equal(r.kind, "speed");
      assert.equal(r.direction, "reset");
      assert.equal(r.modifier, null);
    });
  });

  // -----------------------------------------------------------------------
  // matchVoiceTuneCommand — pitch
  // -----------------------------------------------------------------------
  describe("matchVoiceTuneCommand (pitch)", () => {
    const HIGH_CASES = [
      "调子高一点",
      "声音高一些",
      "音调太低了",
    ];
    for (const input of HIGH_CASES) {
      it(`"${input}" → pitch up`, () => {
        const r = matchVoiceTuneCommand(input);
        assert.ok(r, `expected match for "${input}"`);
        assert.equal(r.kind, "pitch");
        assert.equal(r.direction, "up");
      });
    }

    const LOW_CASES = [
      "调子低一点",
      "声音低沉一些",
      "音调太高了",
      "声音太尖了",
    ];
    for (const input of LOW_CASES) {
      it(`"${input}" → pitch down`, () => {
        const r = matchVoiceTuneCommand(input);
        assert.ok(r, `expected match for "${input}"`);
        assert.equal(r.kind, "pitch");
        assert.equal(r.direction, "down");
      });
    }

    it('"音调恢复正常" → pitch reset', () => {
      const r = matchVoiceTuneCommand("音调恢复正常");
      assert.ok(r);
      assert.equal(r.kind, "pitch");
      assert.equal(r.direction, "reset");
    });
  });

  // -----------------------------------------------------------------------
  // matchVoiceTuneCommand — negative
  // -----------------------------------------------------------------------
  describe("matchVoiceTuneCommand (negative)", () => {
    const NEGATIVE = ["你好呀", "今天天气怎么样", "画一张图", ""];
    for (const input of NEGATIVE) {
      it(`"${input}" → null`, () => {
        assert.equal(matchVoiceTuneCommand(input), null);
      });
    }
  });

  // -----------------------------------------------------------------------
  // getVoiceStylePresets
  // -----------------------------------------------------------------------
  describe("getVoiceStylePresets", () => {
    it("returns all 6 presets", () => {
      const presets = getVoiceStylePresets();
      assert.equal(presets.length, 6);
      const ids = presets.map((p) => p.id);
      for (const expected of ["yujie", "luoli", "wenrou", "yuanqi", "lengku", "wumei"]) {
        assert.ok(ids.includes(expected), `missing preset: ${expected}`);
      }
    });
  });
});
