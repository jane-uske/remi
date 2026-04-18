import type {} from "mocha";

const assert = require("node:assert/strict");
const ReactLib = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { ChatWindow } = require("../src/components/ChatWindow");

describe("ChatWindow", () => {
  it("renders the supplied status model badge and busy state", () => {
    const markup = renderToStaticMarkup(
      ReactLib.createElement(ChatWindow, {
        messages: [
          {
            id: "m1",
            role: "user",
            text: "你好",
          },
        ],
        hasMoreHistory: false,
        loadingMoreHistory: false,
        onLoadMore: () => {},
        listMutation: "idle",
        listMutationNonce: 0,
        sttPartialText: "",
        streamingText: "",
        statusModel: {
          badgeLabel: "准备回复",
          responseBusy: true,
        },
      }),
    );

    assert.ok(markup.includes("准备回复"));
    assert.ok(markup.includes('aria-busy="true"'));
  });
});
