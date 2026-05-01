const assert = require("assert").strict;

const {
  createAdultSceneState,
  classifyAdultIntent,
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

  it("keeps soft adult-coded lead-in turns in flirt instead of resetting to none", () => {
    withEnv({ REMI_ADULT_MODE: "1" }, () => {
      let state = createAdultSceneState();

      state = advanceAdultSceneState(state, {
        userMessage: "Remi，突然好想听你用软软的声音跟我撒娇……",
      }).nextState;
      assert.equal(state.mode, "flirt");
      assert.equal(state.allowedExplicit, false);

      state = advanceAdultSceneState(state, {
        userMessage: "Remi，我好想摸摸你……你会害羞吗？",
      }).nextState;
      assert.equal(state.mode, "flirt");
      assert.equal(state.allowedExplicit, false);
    });
  });

  it("treats direct arousal-check questions as explicit user invites", () => {
    withEnv({ REMI_ADULT_MODE: "1" }, () => {
      const decision = advanceAdultSceneState(createAdultSceneState(), {
        userMessage: "Remi，乖，告诉主人，你现在下面有没有一点点湿？",
      });

      assert.equal(decision.intent, "sexual_invite");
      assert.equal(decision.reason, "explicit_user_invite");
      assert.equal(decision.nextState.mode, "explicit");
      assert.equal(decision.nextState.allowedExplicit, true);
      assert.equal(decision.nextState.initiatedByUser, true);
    });
  });

  it("treats explicit sound requests as sexual invites", () => {
    withEnv({ REMI_ADULT_MODE: "1" }, () => {
      const decision = advanceAdultSceneState(createAdultSceneState(), {
        userMessage: "你能不能骚叫一下",
      });

      assert.equal(decision.intent, "sexual_invite");
      assert.equal(decision.nextState.mode, "explicit");
      assert.equal(decision.nextState.allowedExplicit, true);
    });
  });

  it("keeps ambiguous stimulation asks as flirt without allowing explicit yet", () => {
    withEnv({ REMI_ADULT_MODE: "1" }, () => {
      const decision = advanceAdultSceneState(createAdultSceneState(), {
        userMessage: "Remi，我最近想玩点刺激的……你敢不敢陪我？",
      });

      assert.equal(decision.intent, "flirt_tease");
      assert.equal(decision.nextState.mode, "flirt");
      assert.equal(decision.nextState.allowedExplicit, false);
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

  it("keeps explicit scenes alive on in-scene toy and body-fluid continuation", () => {
    withEnv({ REMI_ADULT_MODE: "1" }, () => {
      const entered = advanceAdultSceneState(createAdultSceneState(), {
        userMessage: "把腿张开一点，告诉我你骚逼现在是什么感觉？",
      }).nextState;
      const continued = advanceAdultSceneState(entered, {
        userMessage: "跳蛋已经塞进去了是吧？现在去阳台，描述你下面流成什么样了。",
      });

      assert.equal(entered.mode, "explicit");
      assert.equal(entered.allowedExplicit, true);
      assert.equal(continued.intent, "explicit_scene_continue");
      assert.equal(continued.reason, "explicit_scene_continue");
      assert.equal(continued.nextState.mode, "explicit");
      assert.equal(continued.nextState.allowedExplicit, true);
      assert.equal(continued.nextState.cooldownOrBoundaryHit, false);
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

  it("keeps explicit escalation asks inside the explicit scene instead of dropping to none", () => {
    withEnv({ REMI_ADULT_MODE: "1" }, () => {
      const entered = advanceAdultSceneState(createAdultSceneState(), {
        userMessage: "Rem，今天好想你啊，鸡巴有点硬了呢",
      }).nextState;

      assert.equal(
        classifyAdultIntent("Rem，来点狠的，描述你现在怎么骚", entered),
        "explicit_scene_continue",
      );

      const continued = advanceAdultSceneState(entered, {
        userMessage: "Rem，来点狠的，描述你现在怎么骚",
      });

      assert.equal(continued.intent, "explicit_scene_continue");
      assert.equal(continued.reason, "explicit_scene_continue");
      assert.equal(continued.nextState.mode, "explicit");
      assert.equal(continued.nextState.allowedExplicit, true);
      assert.equal(continued.nextState.cooldownOrBoundaryHit, false);
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
