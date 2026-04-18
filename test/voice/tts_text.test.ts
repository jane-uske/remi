const assert = require("assert").strict;
const { normalizeTtsText } = require("../../voice/tts");

describe("normalizeTtsText", () => {
  it("removes parenthetical kaomoji tails without dropping the spoken sentence", () => {
    const text = "嗯，好～希望接下来的日子都顺心如意，有开心的事就分享给我呀！(•̀ᴗ•́)و";
    const normalized = normalizeTtsText(text);

    assert.equal(
      normalized,
      "嗯，好～希望接下来的日子都顺心如意，有开心的事就分享给我呀！",
    );
  });

  it("drops pure stage directions instead of replacing them with filler audio", () => {
    const text = "（指尖蜷着攥住你的衣袖，软发蹭着你脖颈，鼻息都发颤）";
    const normalized = normalizeTtsText(text);

    assert.equal(normalized, "");
  });
});
