const assert = require("assert").strict;

const {
  buildCharacterRulesPrompt,
  buildAdultScenePrompt,
  isAdultModeEnabled,
} = require("../../brain/character_rules");

function withEnv(overrides, fn) {
  const restore = Object.entries(overrides).map(([key, value]) => {
    const previous = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
    return () => {
      if (previous === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous;
      }
    };
  });

  try {
    return fn();
  } finally {
    for (const undo of restore.reverse()) undo();
  }
}

describe("character_rules", () => {
  it("defaults adult mode to off", () => {
    withEnv({ REMI_ADULT_MODE: undefined, remi_adult_mode: undefined }, () => {
      assert.equal(isAdultModeEnabled(), false);
      const prompt = buildCharacterRulesPrompt();
      assert.ok(prompt.includes("像真人朋友，不像客服或主持"));
      assert.ok(!prompt.includes("极度饥渴的25岁巨乳御姐"));
    });
  });

  it("enables adult rules when REMI_ADULT_MODE=1", () => {
    withEnv({ REMI_ADULT_MODE: "1" }, () => {
      assert.equal(isAdultModeEnabled(), true);
      const prompt = buildCharacterRulesPrompt();
      assert.ok(prompt.includes("允许自然 flirt / tease"));
      assert.ok(prompt.includes("不默认 explicit"));
      assert.ok(!prompt.includes("极度饥渴的25岁巨乳御姐"));
      assert.ok(!prompt.includes("默认保持高频重口开车模式"));
    });
  });

  it("adds scene-state guidance instead of treating adult mode as always explicit", () => {
    withEnv({ REMI_ADULT_MODE: "1" }, () => {
      const prompt = buildAdultScenePrompt({
        mode: "explicit",
        allowedExplicit: true,
        initiatedByUser: true,
        turnsSinceLastExplicitCue: 0,
        cooldownOrBoundaryHit: false,
        explicitCueStreak: 1,
        beat: "entry",
        intensity: "charged",
      });

      assert.ok(prompt.includes("当前已进入 explicit scene"));
      assert.ok(prompt.includes("先直接承接用户刚给出的动作或命令"));
      assert.ok(prompt.includes("动作、姿势、距离、身体反应"));
      assert.ok(prompt.includes("不能把自己说成拥有男性器官"));
    });
  });
});
