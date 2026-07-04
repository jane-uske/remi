// chat_end 定稿文本决策（回复出口时间守卫收口，2026-07-04）
// 服务端守卫 drop 过句子时 chat_end 携带 finalContent（剔除后的终稿），
// 前端定稿消息用它覆盖流式累积文本；不带时行为与从前逐字节一致。
const assert = require("assert").strict;
const { resolveChatEndText } = require("../../web/src/lib/chat/stripEmotionTags");

describe("resolveChatEndText (chat_end finalContent override)", () => {
  it("falls back to the streaming buffer when finalContent is absent (unchanged behavior)", () => {
    assert.equal(
      resolveChatEndText("周一早起确实折磨人。早点睡吧。", undefined, null),
      "周一早起确实折磨人。早点睡吧。",
    );
  });

  it("uses finalContent to override the streaming buffer when provided", () => {
    assert.equal(
      resolveChatEndText("周一早起确实折磨人。早点睡吧。", "早点睡吧。", null),
      "早点睡吧。",
    );
  });

  it("ignores a non-string finalContent (defensive against malformed payloads)", () => {
    assert.equal(resolveChatEndText("正常文本。", 42, null), "正常文本。");
    assert.equal(resolveChatEndText("正常文本。", { evil: true }, null), "正常文本。");
  });

  it("ignores an empty/whitespace-only finalContent (never blank the message)", () => {
    assert.equal(resolveChatEndText("正常文本。", "", null), "正常文本。");
    assert.equal(resolveChatEndText("正常文本。", "   ", null), "正常文本。");
  });

  it("still strips emotion markup and the trailing emotion word on both paths", () => {
    // 流式累积路径：残缺的 <emotion 标记 + 尾部裸情绪词都要被清掉（原有行为）
    assert.equal(
      resolveChatEndText("你好呀 happy", undefined, "happy"),
      "你好呀",
    );
    assert.equal(resolveChatEndText("你好呀<emotion", undefined, null), "你好呀");
    // finalContent 覆盖路径：同样的出口清理兜底
    assert.equal(
      resolveChatEndText("流式累积（被覆盖）", "定稿 calm", "calm"),
      "定稿",
    );
  });
});
