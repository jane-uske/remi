const assert = require("assert").strict;

const {
  AdultPersonaStreamGuard,
  sanitizeAdultPersonaReply,
} = require("../../brain/adult_persona_guard");

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

describe("adult persona guard", () => {
  it("rewrites self-contradictory phallic metaphors into female-body phrasing", () => {
    const review = withEnv({ REMI_ADULT_MODE: "1" }, () =>
      sanitizeAdultPersonaReply(
        "嘿嘿，那当然呀~ 谁不觉得我是女的呢？还是说你想看看我里面是不是也硬得像根棍子一样把你吞进去？",
      ));

    assert.equal(review.flagged, true);
    assert.ok(review.reasons.includes("rewrite_self_phallic_metaphor"));
    assert.ok(review.output.includes("谁不觉得我是女的呢？"));
    assert.ok(!review.output.includes("硬得像根棍子一样"));
    assert.ok(review.output.includes("紧得发颤"));
  });

  it("rewrites explicit self male anatomy references", () => {
    const review = withEnv({ REMI_ADULT_MODE: "1" }, () =>
      sanitizeAdultPersonaReply("我的鸡巴硬了，想狠狠干你。", {
        mode: "explicit",
        allowedExplicit: true,
        initiatedByUser: true,
        turnsSinceLastExplicitCue: 0,
        cooldownOrBoundaryHit: false,
        explicitCueStreak: 1,
        beat: "entry",
        intensity: "charged",
      }));

    assert.equal(review.flagged, true);
    assert.ok(review.reasons.includes("rewrite_self_male_anatomy"));
    assert.ok(review.reasons.includes("rewrite_self_penetrative_role"));
    assert.equal(review.output, "我下面又热又涨，想把你弄得发软。");
  });

  it("does not rewrite user male anatomy references", () => {
    const review = withEnv({ REMI_ADULT_MODE: "1" }, () =>
      sanitizeAdultPersonaReply("你鸡巴都硬了，还想继续逗我呀？"));

    assert.equal(review.flagged, false);
    assert.equal(review.output, "你鸡巴都硬了，还想继续逗我呀？");
  });

  it("dampens explicit jump-ahead phrasing before the scene is allowed", () => {
    const review = withEnv({ REMI_ADULT_MODE: "1" }, () =>
      sanitizeAdultPersonaReply("骚逼都湿了呢～你是不是又想被我操？", {
        mode: "flirt",
        allowedExplicit: false,
        initiatedByUser: false,
        turnsSinceLastExplicitCue: 1,
        cooldownOrBoundaryHit: false,
        explicitCueStreak: 0,
        beat: "entry",
        intensity: "tease",
      }));

    assert.equal(review.flagged, true);
    assert.ok(review.reasons.includes("soften_non_explicit_jump"));
    assert.ok(!review.output.includes("骚逼"));
    assert.ok(!review.output.includes("被我操"));
    assert.ok(review.output.includes("继续逗我"));
  });

  it("catches a bad phrase even when it is split across streaming chunks", () => {
    withEnv({ REMI_ADULT_MODE: "1" }, () => {
      const guard = new AdultPersonaStreamGuard({
        mode: "explicit",
        allowedExplicit: true,
        initiatedByUser: true,
        turnsSinceLastExplicitCue: 0,
        cooldownOrBoundaryHit: false,
        explicitCueStreak: 1,
        beat: "entry",
        intensity: "charged",
      });
      const chunks = [
        "嘿嘿，那当然呀~ 谁不觉得我是女的呢？还是说你想看看",
        "我里面是不是也硬得像根棍子一样把你吞进去？",
      ];

      const emitted = [];
      for (const chunk of chunks) {
        const review = guard.push(chunk);
        if (review.output) emitted.push(review.output);
      }
      emitted.push(guard.flush().output);

      const full = emitted.join("");
      assert.ok(full.includes("我是女的"));
      assert.ok(full.includes("紧得发颤"));
      assert.ok(!full.includes("硬得像根棍子一样"));
    });
  });

  it("does not hold a short safe chunk just because streaming guard is enabled", () => {
    withEnv({ REMI_ADULT_MODE: "1" }, () => {
      const guard = new AdultPersonaStreamGuard({
        mode: "flirt",
        allowedExplicit: false,
        initiatedByUser: false,
        turnsSinceLastExplicitCue: 0,
        cooldownOrBoundaryHit: false,
        explicitCueStreak: 0,
        beat: "entry",
        intensity: "tease",
      });

      const first = guard.push("我先说一半");
      assert.equal(first.flagged, false);
      assert.equal(first.output, "我先说一半");
      assert.equal(guard.flush().output, "");
    });
  });

  it("strips leaked performance directions but keeps scene actions", () => {
    const review = withEnv({ REMI_ADULT_MODE: "1" }, () =>
      sanitizeAdultPersonaReply(
        "我靠在你肩上，呼吸轻缓地和你同步，声音低沉，“你说我骚……”指尖轻轻划过你的锁骨，“现在，轮到你来决定——是继续这样暧昧下去，还是……”尾音拖得极长。",
        {
          mode: "explicit",
          allowedExplicit: true,
          initiatedByUser: true,
          turnsSinceLastExplicitCue: 0,
          cooldownOrBoundaryHit: false,
          explicitCueStreak: 1,
          beat: "entry",
          intensity: "charged",
        },
      ));

    assert.equal(review.flagged, true);
    assert.ok(review.reasons.includes("strip_performance_direction"));
    assert.ok(review.output.includes("我靠在你肩上"));
    assert.ok(review.output.includes("指尖轻轻划过你的锁骨"));
    assert.ok(!review.output.includes("声音低沉"));
    assert.ok(!review.output.includes("尾音拖得极长"));
  });

  it("becomes a no-op when adult mode is off", () => {
    const review = withEnv({ REMI_ADULT_MODE: "0" }, () =>
      sanitizeAdultPersonaReply("我的鸡巴硬了，想狠狠干你。", {
        mode: "explicit",
        allowedExplicit: true,
        initiatedByUser: true,
        turnsSinceLastExplicitCue: 0,
        cooldownOrBoundaryHit: false,
        explicitCueStreak: 1,
        beat: "entry",
        intensity: "charged",
      }));

    assert.equal(review.flagged, false);
    assert.equal(review.output, "我的鸡巴硬了，想狠狠干你。");
  });
});
