const { expect } = require("chai");
const {
  buildClientContextPayload,
  mergeSttPartialText,
} = require("../src/hooks/useRemiChatHelpers");

describe("useRemiChat helper partial merge", () => {
  it("keeps the expanded interim partial when the next hypothesis regresses", () => {
    expect(mergeSttPartialText("如果你试了还是没有提前出字", "还是没有提前出字")).to.equal(
      "如果你试了还是没有提前出字",
    );
  });

  it("accepts a longer interim partial when the hypothesis keeps growing", () => {
    expect(mergeSttPartialText("如果你试了", "如果你试了还是没有提前出字")).to.equal(
      "如果你试了还是没有提前出字",
    );
  });

  it("preserves an existing real partial when fallback listening text arrives", () => {
    expect(mergeSttPartialText("如果你试了还是没有提前出字", "录音中… 1.2s")).to.equal(
      "如果你试了还是没有提前出字",
    );
  });

  it("declares the web tts transport in client_context", () => {
    const previousIntl = global.Intl;
    const previousNavigator = global.navigator;

    global.Intl = {
      DateTimeFormat: () => ({
        resolvedOptions: () => ({ timeZone: "Asia/Shanghai" }),
      }),
    };
    global.navigator = {
      languages: ["zh-CN"],
      language: "zh-CN",
    };

    try {
      expect(buildClientContextPayload()).to.deep.equal({
        type: "client_context",
        timeZone: "Asia/Shanghai",
        locale: "zh-CN",
        ttsTransport: "pcm_stream_v1",
      });
    } finally {
      if (previousIntl === undefined) {
        delete global.Intl;
      } else {
        global.Intl = previousIntl;
      }
      if (previousNavigator === undefined) {
        delete global.navigator;
      } else {
        global.navigator = previousNavigator;
      }
    }
  });
});
