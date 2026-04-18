const assert = require("assert").strict;
const {
  buildVolcTtsRequest,
  decodeVolcUnidirectionalResponse,
  planVolcExpression,
  resolveVolcTtsConfig,
} = require("../../voice/tts_volc");
const {
  clearSessionTtsRuntimeOverride,
  setSessionVolcVoiceTypeOverride,
} = require("../../voice/tts_runtime_overrides");

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

describe("tts_volc", () => {
  afterEach(() => {
    clearSessionTtsRuntimeOverride("conn-test-voice");
  });

  it("reads volc config from dedicated env vars", () => {
    withEnv(
      {
        VOLC_TTS_API_KEY: "volc-key",
        VOLC_TTS_RESOURCE_ID: "seed-tts-2.0",
        VOLC_TTS_VOICE_TYPE: "zh_female_lingling_uranus_bigtts",
        VOLC_TTS_SAMPLE_RATE: "32000",
        VOLC_TTS_SPEECH_RATE: "12",
      },
      () => {
        const config = resolveVolcTtsConfig("happy");
        assert.equal(config.apiKey, "volc-key");
        assert.equal(config.resourceId, "seed-tts-2.0");
        assert.equal(config.voiceType, "zh_female_lingling_uranus_bigtts");
        assert.equal(config.sampleRate, 32000);
        assert.equal(config.speechRate, 15);
      },
    );
  });

  it("prefers the current session runtime voice override over env", () => {
    withEnv(
      {
        VOLC_TTS_API_KEY: "volc-key",
        VOLC_TTS_RESOURCE_ID: "seed-tts-2.0",
        VOLC_TTS_VOICE_TYPE: "zh_female_lingling_uranus_bigtts",
      },
      () => {
        setSessionVolcVoiceTypeOverride(
          "conn-test-voice",
          "zh_female_custom_runtime_bigtts",
        );
        const config = resolveVolcTtsConfig(undefined, undefined, {
          connId: "conn-test-voice",
        });
        assert.equal(config.voiceType, "zh_female_custom_runtime_bigtts");
      },
    );
  });

  it("derives speech rate from emotion and dynamic style hints when explicit env is absent", () => {
    withEnv(
      {
        VOLC_TTS_API_KEY: "volc-key",
        VOLC_TTS_RESOURCE_ID: "seed-tts-2.0",
        VOLC_TTS_VOICE_TYPE: "zh_female_lingling_uranus_bigtts",
        VOLC_TTS_SPEECH_RATE: undefined,
      },
      () => {
        const config = resolveVolcTtsConfig("sad");
        assert.equal(config.speechRate, -21);
      },
    );
  });

  it("builds a unidirectional volc request with cache additions", () => {
    const body = buildVolcTtsRequest("你好，世界。", {
      apiKey: "volc-key",
      resourceId: "seed-tts-2.0",
      baseUrl: "https://openspeech.bytedance.com/api/v3/tts/unidirectional",
      voiceType: "zh_female_lingling_uranus_bigtts",
      format: "mp3",
      sampleRate: 24000,
      speechRate: 0,
      loudnessRate: 0,
      uid: "remi",
      emotion: "happy",
      emotionScale: 3,
      explicitLanguage: "zh-cn",
      contextText: "你可以说慢一点吗？",
      silenceDuration: 120,
      postProcessPitch: 2,
      useServiceCache: true,
      dynamicStyleEnabled: true,
      expressionPreset: "grounded_comfort",
    });

    assert.equal(body.user.uid, "remi");
    assert.equal(body.req_params.text, "你好，世界。");
    assert.equal(body.req_params.speaker, "zh_female_lingling_uranus_bigtts");
    assert.equal(body.req_params.audio_params.format, "mp3");
    assert.equal(body.req_params.audio_params.emotion, "happy");
    assert.equal(body.req_params.audio_params.emotion_scale, 3);
    const additions = JSON.parse(body.req_params.additions);
    assert.equal(additions.explicit_language, "zh-cn");
    assert.equal(additions.context_texts[0], "你可以说慢一点吗？");
    assert.equal(additions.silence_duration, 120);
    assert.equal(additions.post_process.pitch, 2);
    assert.equal(additions.cache_config.use_cache, true);
  });

  it("plans dynamic volc expression controls from text and emotion", () => {
    const plan = planVolcExpression("别怕，我在，你先慢一点。", "sad");
    assert.equal(plan.preset, "grounded_comfort");
    assert.equal(plan.contextText, "更轻一点，更稳一点，像在安抚对方，不要播报腔。");
    assert.equal(plan.emotion, "sad");
    assert.equal(plan.emotionScale, 4);
    assert.equal(plan.speechRate, -21);
  });

  it("keeps neutral volc speech slightly faster than zero by default", () => {
    const plan = planVolcExpression("你好。");
    assert.equal(plan.preset, "neutral_natural");
    assert.equal(plan.speechRate, 3);
  });

  it("allows disabling dynamic style and keeping explicit overrides", () => {
    withEnv(
      {
        VOLC_TTS_ENABLE_DYNAMIC_STYLE: "0",
        VOLC_TTS_CONTEXT_TEXT: "更克制一点。",
        VOLC_TTS_EMOTION: "happy",
        VOLC_TTS_EMOTION_SCALE: "5",
      },
      () => {
        const plan = planVolcExpression("啧，你终于回来了。", "happy");
        assert.equal(plan.preset, "playful_tease");
        assert.equal(plan.contextText, "更克制一点。");
        assert.equal(plan.emotion, "happy");
        assert.equal(plan.emotionScale, 5);
        assert.equal(plan.speechRate, 15);
      },
    );
  });

  it("uses relational stance and response policy to enrich context text", () => {
    const plan = planVolcExpression("过来一点，我跟你说。", "happy", {
      usage: "reply",
      relationalStance: {
        mode: "close_warmth",
        boundary: "close",
        soothingStyle: "easy_banter",
        proactiveCadence: "balanced",
        expressionDirectness: "clear",
      },
      responsePolicy: {
        openingMove: "scene_ack",
        directness: "high",
        warmth: "high",
        questionBudget: 0,
      },
    });

    assert.equal(plan.preset, "soft_intimate");
    assert.ok(plan.contextText.includes("更贴近一点"));
    assert.ok(plan.contextText.includes("说得更直接一点"));
    assert.ok(plan.contextText.includes("保持贴近和温度"));
  });

  it("leans more seductive in adult mode for intimate/playful text", () => {
    withEnv({ REMI_ADULT_MODE: "1" }, () => {
      const plan = planVolcExpression("啧，过来一点，我跟你说。", "happy", {
        usage: "reply",
        adultSceneState: {
          mode: "explicit",
          allowedExplicit: true,
          initiatedByUser: true,
          turnsSinceLastExplicitCue: 0,
          cooldownOrBoundaryHit: false,
          explicitCueStreak: 1,
          beat: "entry",
          intensity: "charged",
        },
        relationalStance: {
          mode: "close_warmth",
          boundary: "close",
          soothingStyle: "easy_banter",
          proactiveCadence: "balanced",
          expressionDirectness: "clear",
        },
        responsePolicy: {
          openingMove: "scene_ack",
          directness: "high",
          warmth: "high",
          questionBudget: 0,
        },
      });

      assert.equal(plan.preset, "playful_tease");
      assert.ok(plan.contextText.includes("暧昧"));
      assert.ok(plan.contextText.includes("勾"));
      assert.equal(plan.emotion, "happy");
      assert.equal(plan.emotionScale, 4);
    });
  });

  it("keeps adult TTS restrained while the scene is still only flirting", () => {
    withEnv({ REMI_ADULT_MODE: "1" }, () => {
      const plan = planVolcExpression("啧，过来一点，我跟你说。", "happy", {
        usage: "reply",
        adultSceneState: {
          mode: "flirt",
          allowedExplicit: false,
          initiatedByUser: false,
          turnsSinceLastExplicitCue: 1,
          cooldownOrBoundaryHit: false,
          explicitCueStreak: 0,
          beat: "entry",
          intensity: "tease",
        },
        relationalStance: {
          mode: "close_warmth",
          boundary: "close",
          soothingStyle: "easy_banter",
          proactiveCadence: "balanced",
          expressionDirectness: "clear",
        },
        responsePolicy: {
          openingMove: "scene_ack",
          directness: "high",
          warmth: "high",
          questionBudget: 0,
        },
      });

      assert.equal(plan.preset, "playful_tease");
      assert.ok(plan.contextText.includes("别直接变露骨床戏"));
      assert.ok(!plan.contextText.includes("更勾人一点"));
      assert.equal(plan.emotion, "happy");
      assert.equal(plan.emotionScale, 3);
    });
  });

  it("still allows tease in non-adult mode but keeps it restrained", () => {
    withEnv({ REMI_ADULT_MODE: "0" }, () => {
      const plan = planVolcExpression("啧，过来一点，我跟你说。", "happy", {
        usage: "reply",
        relationalStance: {
          mode: "close_warmth",
          boundary: "close",
          soothingStyle: "easy_banter",
          proactiveCadence: "balanced",
          expressionDirectness: "clear",
        },
        responsePolicy: {
          openingMove: "scene_ack",
          directness: "high",
          warmth: "high",
          questionBudget: 0,
        },
      });

      assert.equal(plan.preset, "playful_tease");
      assert.ok(plan.contextText.includes("会撩一点"));
      assert.ok(plan.contextText.includes("不要太骚"));
      assert.ok(!plan.contextText.includes("勾人"));
      assert.equal(plan.emotion, "happy");
      assert.equal(plan.emotionScale, 3);
    });
  });

  it("decodes the base64 audio payload from unidirectional response", () => {
    const audio = decodeVolcUnidirectionalResponse(
      [
        JSON.stringify({
          code: 0,
          message: "",
          data: Buffer.from("fake-").toString("base64"),
        }),
        JSON.stringify({
          code: 0,
          message: "",
          data: Buffer.from("mp3-audio").toString("base64"),
        }),
        JSON.stringify({
          code: 20000000,
          message: "OK",
          data: null,
        }),
      ].join("\n"),
    );
    assert.equal(audio.toString(), "fake-mp3-audio");
  });
});
