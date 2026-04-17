const assert = require("assert").strict;
const {
  buildVolcTtsRequest,
  decodeVolcUnidirectionalResponse,
  resolveVolcTtsConfig,
} = require("../../voice/tts_volc");

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
        assert.equal(config.speechRate, 12);
      },
    );
  });

  it("falls back to emotion-derived speech rate when explicit env is absent", () => {
    withEnv(
      {
        VOLC_TTS_API_KEY: "volc-key",
        VOLC_TTS_RESOURCE_ID: "seed-tts-2.0",
        VOLC_TTS_VOICE_TYPE: "zh_female_lingling_uranus_bigtts",
        VOLC_TTS_SPEECH_RATE: undefined,
      },
      () => {
        const config = resolveVolcTtsConfig("sad");
        assert.equal(config.speechRate, -18);
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
      explicitLanguage: "zh-cn",
      contextText: "你可以说慢一点吗？",
      useServiceCache: true,
    });

    assert.equal(body.user.uid, "remi");
    assert.equal(body.req_params.text, "你好，世界。");
    assert.equal(body.req_params.speaker, "zh_female_lingling_uranus_bigtts");
    assert.equal(body.req_params.audio_params.format, "mp3");
    const additions = JSON.parse(body.req_params.additions);
    assert.equal(additions.explicit_language, "zh-cn");
    assert.equal(additions.context_texts[0], "你可以说慢一点吗？");
    assert.equal(additions.cache_config.use_cache, true);
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
