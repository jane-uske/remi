const assert = require("assert").strict;

const {
  createAdultSceneState,
  advanceAdultSceneState,
  buildAdultScenePrompt,
} = require("../../brain/adult_mode");

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

describe("adult_mode", () => {
  it("keeps ordinary small talk out of explicit mode", () => {
    withEnv({ REMI_ADULT_MODE: "1" }, () => {
      const decision = advanceAdultSceneState(createAdultSceneState(), {
        userMessage: "哈喽Remi，今天好无聊啊～你呢？",
      });

      assert.equal(decision.intent, "none");
      assert.equal(decision.nextState.mode, "none");
      assert.equal(decision.nextState.allowedExplicit, false);
      assert.equal(decision.nextState.initiatedByUser, false);
    });
  });

  it("enters explicit mode only after a clear user sexual invite", () => {
    withEnv({ REMI_ADULT_MODE: "1" }, () => {
      const decision = advanceAdultSceneState(createAdultSceneState(), {
        userMessage: "想不想狠狠干我？",
      });

      assert.equal(decision.intent, "sexual_invite");
      assert.equal(decision.nextState.mode, "explicit");
      assert.equal(decision.nextState.allowedExplicit, true);
      assert.equal(decision.nextState.initiatedByUser, true);
    });
  });

  it("treats dominant command phrasing as an explicit scene invite with entry guidance", () => {
    withEnv({ REMI_ADULT_MODE: "1" }, () => {
      const decision = advanceAdultSceneState(createAdultSceneState(), {
        userMessage: "为什么站着，你个骚货给我跪着含住",
      });

      assert.equal(decision.intent, "sexual_invite");
      assert.equal(decision.nextState.mode, "explicit");
      assert.equal(decision.nextState.allowedExplicit, true);
      assert.equal(decision.nextState.beat, "entry");
      assert.equal(decision.nextState.intensity, "charged");
      assert.equal(decision.nextState.style, "fantasy_execute");
    });
  });

  it("treats direct pussy/penetration commands as explicit scene invites instead of dropping to none", () => {
    withEnv({ REMI_ADULT_MODE: "1" }, () => {
      const decision = advanceAdultSceneState(createAdultSceneState(), {
        userMessage: "别他妈舌头了，你把逼伸过来，让我插一下",
      });

      assert.equal(decision.intent, "sexual_invite");
      assert.equal(decision.nextState.mode, "explicit");
      assert.equal(decision.nextState.allowedExplicit, true);
      assert.equal(decision.nextState.style, "fantasy_execute");
      assert.equal(decision.nextState.executionPlan?.opening.includes("身体目标送过去"), true);
      assert.equal(decision.nextState.executionPlan?.target.includes("逼/小穴"), true);
    });
  });

  it("keeps explicit scenes alive on continuation and exits on boundaries or topic shifts", () => {
    withEnv({ REMI_ADULT_MODE: "1" }, () => {
      const entered = advanceAdultSceneState(createAdultSceneState(), {
        userMessage: "想不想狠狠干我？",
      }).nextState;
      const continued = advanceAdultSceneState(entered, {
        userMessage: "继续，别停。",
      }).nextState;
      const cooled = advanceAdultSceneState(continued, {
        userMessage: "先别聊这个了，今天工作烦死了。",
      }).nextState;

      assert.equal(continued.mode, "explicit");
      assert.equal(continued.allowedExplicit, true);
      assert.equal(cooled.mode, "none");
      assert.equal(cooled.allowedExplicit, false);
      assert.equal(cooled.cooldownOrBoundaryHit, true);
    });
  });

  it("treats in-scene wording corrections as scene repair instead of plain continuation", () => {
    withEnv({ REMI_ADULT_MODE: "1" }, () => {
      const entered = advanceAdultSceneState(createAdultSceneState(), {
        userMessage: "为什么站着，你个骚货给我跪着含住",
      }).nextState;
      const repaired = advanceAdultSceneState(entered, {
        userMessage: "别吞进世界了，吞精液就行",
      });

      assert.equal(repaired.intent, "scene_repair");
      assert.equal(repaired.nextState.mode, "explicit");
      assert.equal(repaired.nextState.allowedExplicit, true);
      assert.equal(repaired.nextState.beat, "sustain");
      assert.equal(repaired.nextState.style, "fantasy_execute");
    });
  });

  it("treats '说人话' complaints inside an explicit scene as scene repair", () => {
    withEnv({ REMI_ADULT_MODE: "1" }, () => {
      const entered = advanceAdultSceneState(createAdultSceneState(), {
        userMessage: "为什么站着，你个骚货给我跪着含住",
      }).nextState;
      const repaired = advanceAdultSceneState(entered, {
        userMessage: "臭骚逼，你能不能说人话",
      });

      assert.equal(repaired.intent, "scene_repair");
      assert.equal(repaired.nextState.mode, "explicit");
      assert.equal(repaired.nextState.allowedExplicit, true);
      assert.equal(repaired.nextState.style, "fantasy_execute");
    });
  });

  it("treats explicit follow-up commands as dominant commands, not plain continuation", () => {
    withEnv({ REMI_ADULT_MODE: "1" }, () => {
      const entered = advanceAdultSceneState(createAdultSceneState(), {
        userMessage: "为什么站着，你个骚货给我跪着含住",
      }).nextState;
      const commanded = advanceAdultSceneState(entered, {
        userMessage: "那你先跪下来给我舔干净",
      });

      assert.equal(commanded.intent, "dominant_command");
      assert.equal(commanded.nextState.mode, "explicit");
      assert.equal(commanded.nextState.allowedExplicit, true);
      assert.equal(commanded.nextState.intensity, "explicit");
      assert.equal(commanded.nextState.style, "fantasy_execute");
    });
  });

  it("keeps lick-clean commands in fantasy execution instead of jumping to insertion beats", () => {
    withEnv({ REMI_ADULT_MODE: "1" }, () => {
      const entered = advanceAdultSceneState(createAdultSceneState(), {
        userMessage: "为什么站着，你个骚货给我跪着含住",
      }).nextState;
      const commanded = advanceAdultSceneState(entered, {
        userMessage: "那你先跪下来给我舔干净",
      });

      assert.equal(commanded.intent, "dominant_command");
      assert.equal(
        commanded.nextState.executionPlan?.nextBeat.includes("不要跳到插入、入口或顶入"),
        true,
      );
    });
  });

  it("builds restrained prompt guidance before explicit is allowed", () => {
    withEnv({ REMI_ADULT_MODE: "1" }, () => {
      const prompt = buildAdultScenePrompt({
        mode: "flirt",
        allowedExplicit: false,
        initiatedByUser: false,
        turnsSinceLastExplicitCue: 2,
        cooldownOrBoundaryHit: false,
        explicitCueStreak: 0,
        beat: "entry",
        intensity: "tease",
      });

      assert.ok(prompt.includes("只允许暧昧、调情和恋人感"));
      assert.ok(!prompt.includes("可以继续露骨描写性行为"));
    });
  });

  it("builds explicit prompt guidance that requires scene description and emotional progression", () => {
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
        style: "fantasy_execute",
      });

      assert.ok(prompt.includes("成人幻想执行"));
      assert.ok(prompt.includes("短句"));
      assert.ok(prompt.includes("不要只回一句"));
      assert.ok(prompt.includes("少写环境"));
    });
  });

  it("builds fantasy_execute guidance that forbids stage directions and demands direct multi-beat execution", () => {
    withEnv({ REMI_ADULT_MODE: "1" }, () => {
      const prompt = buildAdultScenePrompt({
        mode: "explicit",
        allowedExplicit: true,
        initiatedByUser: true,
        turnsSinceLastExplicitCue: 0,
        cooldownOrBoundaryHit: false,
        explicitCueStreak: 2,
        beat: "entry",
        intensity: "explicit",
        style: "fantasy_execute",
      });

      assert.ok(prompt.includes("两到四句"));
      assert.ok(prompt.includes("不要用括号"));
      assert.ok(prompt.includes("明确身体目标"));
      assert.ok(prompt.includes("不要写“等你来”"));
      assert.ok(prompt.includes("执行骨架"));
      assert.ok(prompt.includes("禁止替换"));
      assert.ok(prompt.includes("不要先解释用户意图"));
    });
  });

  it("builds fantasy_execute guidance that bans meta preambles and target drift for lick-clean commands", () => {
    withEnv({ REMI_ADULT_MODE: "1" }, () => {
      const state = advanceAdultSceneState(createAdultSceneState(), {
        userMessage: "那你先跪下来给我舔干净",
      }).nextState;
      const prompt = buildAdultScenePrompt(state);

      assert.ok(prompt.includes("不要先说“好，我现在就按你说的做”"));
      assert.ok(prompt.includes("不要跳到插入、入口或顶入"));
    });
  });
});
