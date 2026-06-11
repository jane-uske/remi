const assert = require("assert").strict;
const { EmotionTagParser } = require("../../utils/emotion_tag_parser");

const REPLY = "哈哈蛋挞赢过地铁！替你开心～\n<emotion>happy</emotion>";

function runTokens(tokens: string[]) {
  const parser = new EmotionTagParser();
  let clean = "";
  for (const token of tokens) {
    clean += parser.feed(token).cleanText;
  }
  clean += parser.flush().cleanText;
  return { clean, emotion: parser.getDetectedEmotion() };
}

describe("EmotionTagParser", () => {
  it("strips a tag contained in a single chunk", () => {
    const { clean, emotion } = runTokens([REPLY]);
    assert.equal(clean, "哈哈蛋挞赢过地铁！替你开心～\n");
    assert.equal(emotion, "happy");
  });

  it("strips a tag whose close marker is split across chunks (streamed BPE tokens)", () => {
    const { clean, emotion } = runTokens([
      "哈哈蛋挞赢过地铁！替你开心～\n",
      "<",
      "emotion",
      ">",
      "happy",
      "</",
      "emotion",
      ">",
    ]);
    assert.equal(clean, "哈哈蛋挞赢过地铁！替你开心～\n");
    assert.equal(emotion, "happy");
  });

  it("strips a tag streamed one character at a time", () => {
    const { clean, emotion } = runTokens(REPLY.split(""));
    assert.equal(clean, "哈哈蛋挞赢过地铁！替你开心～\n");
    assert.equal(emotion, "happy");
  });

  it("keeps text that follows the close tag", () => {
    const { clean, emotion } = runTokens(["前<emotion>sad</", "emotion>后"]);
    assert.equal(clean, "前后");
    assert.equal(emotion, "sad");
  });

  it("ignores invalid emotion values but still strips the tag", () => {
    const { clean, emotion } = runTokens(["好<emotion>angry</", "emotion>"]);
    assert.equal(clean, "好");
    assert.equal(emotion, null);
  });

  it("flushes an overlong false-positive tag back as plain text", () => {
    const noise = "<emotion>" + "嗯".repeat(60);
    const { clean, emotion } = runTokens([noise]);
    assert.equal(clean, noise);
    assert.equal(emotion, null);
  });

  it("flushes an unclosed tag at end of stream as plain text", () => {
    const { clean, emotion } = runTokens(["话<emotion>hap"]);
    assert.equal(clean, "话<emotion>hap");
    assert.equal(emotion, null);
  });
});
