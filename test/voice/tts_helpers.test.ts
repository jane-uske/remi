const assert = require("assert").strict;
const {
  buildTtsCacheVariant,
  buildTtsShortCacheKey,
  normalizeTtsTextWithConfig,
} = require("../../voice/tts_helpers");

describe("tts helpers", () => {
  it("normalizes speech text with explicit config", () => {
    const normalized = normalizeTtsTextWithConfig(
      "嗯，好～希望接下来的日子都顺心如意，有开心的事就分享给我呀！(•̀ᴗ•́)و",
      {
        maxChars: 120,
        stripParenthetical: true,
        stripEmoji: true,
      },
    );

    assert.equal(
      normalized,
      "嗯，好～希望接下来的日子都顺心如意，有开心的事就分享给我呀！",
    );
  });

  it("returns empty when the input is only stripped stage directions", () => {
    const normalized = normalizeTtsTextWithConfig(
      "（指尖蜷着攥住你的衣袖，软发蹭着你脖颈，鼻息都发颤）",
      {
        maxChars: 120,
        stripParenthetical: true,
        stripEmoji: true,
      },
    );

    assert.equal(normalized, "");
  });

  it("keeps cache variant and key derivation stable", () => {
    const edgeVariant = buildTtsCacheVariant("edge", "neutral", {
      voice: "zh-CN-XiaoyiNeural",
      lang: "zh-CN",
      rate: "default",
      pitch: "default",
      model: "tts-1",
      piperModel: "piper-zh",
    });
    const openaiVariant = buildTtsCacheVariant("openai", "neutral", {
      voice: "alloy",
      lang: "zh-CN",
      rate: "default",
      pitch: "default",
      model: "tts-1",
      piperModel: "piper-zh",
    });
    const piperVariant = buildTtsCacheVariant("piper", "happy", {
      voice: "alloy",
      lang: "zh-CN",
      rate: "default",
      pitch: "default",
      model: "tts-1",
      piperModel: "piper-zh",
    });

    assert.equal(edgeVariant, ["zh-CN-XiaoyiNeural", "zh-CN", "default", "default"].join("\0"));
    assert.equal(openaiVariant, ["tts-1", "alloy", "1"].join("\0"));
    assert.equal(piperVariant, "piper-zh");
    assert.equal(
      buildTtsShortCacheKey("edge", "嗯，好。", "neutral", edgeVariant),
      ["edge", edgeVariant, "neutral", "嗯，好。"].join("\0"),
    );
  });
});
