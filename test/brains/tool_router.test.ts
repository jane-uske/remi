import { expect } from "chai";
import { toolRouterPrefilter } from "../../brains/tool_router";

describe("tool router prefilter", () => {
  // The prefilter is intentionally HIGH-RECALL: it only decides whether the
  // extra router LLM call is worth making. It must let through every plausible
  // capability request (false positives are cheap — the router LLM then
  // correctly declines). It must NOT fire on pure emotional chat (that's the
  // common path and the latency-sensitive one).

  const capabilityPhrases = [
    "画一只猫",
    "不穿衣服呢？", // ambiguous image — the case regex-only missed
    "让我看看你现在的样子",
    "给我做个海浪拍岸的视频",
    "开启成人模式",
    "退出成人模式",
    "现在几点了",
    "今天几号",
    "来张你的自拍",
  ];

  for (const phrase of capabilityPhrases) {
    it(`fires for capability-adjacent input: 「${phrase}」`, () => {
      expect(toolRouterPrefilter(phrase)).to.equal(true);
    });
  }

  const pureChatPhrases = [
    "你好呀，今天上班好累",
    "我们之前聊到哪了来着",
    "我今天有点难过，想找你说说话",
    "谢谢你一直陪着我",
    "嗯，那你觉得我该怎么跟他说",
  ];

  for (const phrase of pureChatPhrases) {
    it(`skips pure emotional chat (no extra latency): 「${phrase}」`, () => {
      expect(toolRouterPrefilter(phrase)).to.equal(false);
    });
  }

  it("skips empty / whitespace input", () => {
    expect(toolRouterPrefilter("")).to.equal(false);
    expect(toolRouterPrefilter("   ")).to.equal(false);
  });

  it("skips very long inputs (essays/pastes, not commands)", () => {
    const longText = "画".padStart(250, "今天天气真好我很开心地和你聊了很多事情");
    expect(longText.length).to.be.greaterThan(200);
    expect(toolRouterPrefilter(longText)).to.equal(false);
  });
});
