const assert = require("assert").strict;
const {
  buildTtsCacheVariant,
  buildTtsShortCacheKey,
  containsImageMarkdown,
  extractNsfwVocalLine,
  filterMixedNsfwVocalForTts,
  foldMoaningInterjections,
  isNsfwNarrationSegment,
  normalizeTtsTextWithConfig,
  resolveTtsQueueText,
  sanitizePastedChatContent,
  stripImageMarkdownForTts,
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

  it("maps ellipsis and tildes to speakable punctuation without removing words", () => {
    const normalized = normalizeTtsTextWithConfig(
      "现在来听听吧：啊……啊……啊……哈啊啊啊啊～～～嗯啊啊啊～～～呜呜呜……不行了……要高潮了啊啊啊啊～～～",
      {
        maxChars: 120,
        stripParenthetical: true,
        stripEmoji: true,
        speakablePunct: true,
      },
    );

    assert.equal(
      normalized,
      "啊，啊啊，哈啊啊啊啊嗯啊啊啊呜呜呜，不行了，要高潮了啊啊啊啊",
    );

    const dotted = normalizeTtsTextWithConfig("嗯...啊...哈...要高潮了啊啊啊啊~", {
      maxChars: 120,
      stripParenthetical: true,
      stripEmoji: true,
      speakablePunct: true,
    });
    assert.equal(dotted, "嗯啊，哈，要高潮了啊啊啊啊");
    assert.match(normalized, /要高潮了/);
  });

  it("leaves moaning text unchanged when speakable punctuation is disabled", () => {
    const raw =
      "啊……啊……要高潮了啊啊啊啊～～～";
    const normalized = normalizeTtsTextWithConfig(raw, {
      maxChars: 120,
      stripParenthetical: true,
      stripEmoji: true,
      speakablePunct: false,
    });

    // Tildes are stripped by stripDecorativeTailForTts, but the ellipsis
    // and moaning words remain intact when speakablePunct is off.
    assert.equal(normalized, "啊……啊……要高潮了啊啊啊啊");
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

  it("extracts moaning vocal line from mixed NSFW narration", () => {
    const mixed =
      "要是能再深入一点，Remi:嗯...啊...哈...嘶...不行了...要高潮了啊啊啊啊~";
    const vocal = extractNsfwVocalLine(mixed);
    assert.ok(vocal);
    assert.match(vocal, /嗯/);
    assert.doesNotMatch(vocal, /要是能再深入/);
    assert.doesNotMatch(vocal, /Remi/i);

    const queued = resolveTtsQueueText(mixed, { nsfw: true, speakablePunct: true });
    assert.ok(queued);
    assert.match(queued, /嗯啊/);
    assert.match(queued, /哈嘶/);
    assert.doesNotMatch(queued, /要是能再深入/);
  });

  it("skips third-person narration segments in NSFW TTS queue", () => {
    assert.equal(
      resolveTtsQueueText("Remi, 被挑逗到时，会从矜持逐渐变得主动。", {
        nsfw: true,
        speakablePunct: true,
      }),
      null,
    );
    assert.equal(isNsfwNarrationSegment("现在她正在经历一种强烈的快感。"), true);
  });

  it("folds moaning interjection commas in pairs", () => {
    assert.equal(
      foldMoaningInterjections("嗯，啊，哈，嘶，不行了"),
      "嗯啊，哈嘶，不行了",
    );
    // Two chars: fold into one pair
    assert.equal(
      foldMoaningInterjections("嗯，啊，好深"),
      "嗯啊，好深",
    );
    // Three chars: fold first pair, leave the third
    assert.equal(
      foldMoaningInterjections("啊，哈，嘶，好深"),
      "啊哈，嘶，好深",
    );
    // Single: no change
    assert.equal(
      foldMoaningInterjections("嗯，好深"),
      "嗯，好深",
    );
  });

  it("sanitizes pasted chat replay from user input", () => {
    const pasted =
      "用超高音娇喘演出来：啊……啊…… Remi Remi: 嗯...啊...哈...";
    const cleaned = sanitizePastedChatContent(pasted);
    assert.doesNotMatch(cleaned, /Remi\s*:/i);
    assert.match(cleaned, /演出来/);
  });

  it("filters literary narration from mixed NSFW vocal chunks", () => {
    const chunk0 =
      "嗯，哈啊，好深，顶到喉咙了，唔，甘甜的津液顺着嘴角流下来，";
    const chunk1 = "舔干净你的每一寸，嘶，被你撑得发酸也舍不得松口，";

    assert.equal(
      filterMixedNsfwVocalForTts(chunk0),
      "嗯，哈啊，好深，顶到喉咙了，唔",
    );
    assert.equal(
      filterMixedNsfwVocalForTts(chunk1),
      "舔干净你的每一寸，嘶",
    );

    const queued0 = resolveTtsQueueText(chunk0, {
      nsfw: true,
      speakablePunct: true,
    });
    const queued1 = resolveTtsQueueText(chunk1, {
      nsfw: true,
      speakablePunct: true,
    });

    assert.equal(queued0, "嗯哈啊，好深，顶到喉咙了，唔");
    assert.equal(queued1, "舔干净你的每一寸，嘶");
    assert.doesNotMatch(queued0, /津液/);
    assert.doesNotMatch(queued1, /发酸/);
  });

  it("keeps first-person speech clauses in mixed NSFW lines (no skip)", () => {
    // Regression: long first-person clauses without a moan char must NOT be
    // dropped. Previously "我腿早就软得站不住了" / "全靠你那只手..." were deleted
    // by a length>=10 heuristic, so playback skipped the middle of the line.
    const line =
      "门一关，那两道贪婪的目光就像黏腻的舌头，死死舔在我身上，哈啊，我腿早就软得站不住了，全靠你那只手死死掐着腰才没瘫在地上。";
    const filtered = filterMixedNsfwVocalForTts(line);
    assert.ok(filtered);
    assert.match(filtered, /我腿早就软得站不住了/);
    assert.match(filtered, /全靠你那只手死死掐着腰才没瘫在地上/);

    const queued = resolveTtsQueueText(line, { nsfw: true, speakablePunct: true });
    assert.ok(queued);
    assert.match(queued, /我腿早就软得站不住了/);
    assert.match(queued, /全靠你那只手死死掐着腰才没瘫在地上/);
  });

  it("detects markdown image embeds for TTS suppression", () => {
    const reply = '画好啦～\n![猫](/api/comfyui/view?filename=a.png)';
    assert.equal(containsImageMarkdown(reply), true);
    assert.equal(
      stripImageMarkdownForTts(reply),
      "画好啦～",
    );
    assert.equal(containsImageMarkdown("今天天气不错"), false);
  });
});
