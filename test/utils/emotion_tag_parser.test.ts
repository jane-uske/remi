const assert = require("node:assert").strict;
const { EmotionTagParser } = require("../../utils/emotion_tag_parser");

function parseChunks(chunks: string[]) {
  const parser = new EmotionTagParser();
  let text = "";
  for (const chunk of chunks) {
    text += parser.feed(chunk).cleanText;
  }
  text += parser.flush().cleanText;
  return { text, emotion: parser.getDetectedEmotion() };
}

describe("EmotionTagParser", () => {
  it("strips an emotion tag when the closing tag is split before the final bracket", () => {
    assert.deepEqual(
      parseChunks(["你好\n<emotion>", "neutral", "</emotion", ">"]),
      { text: "你好\n", emotion: "neutral" },
    );
  });
});
