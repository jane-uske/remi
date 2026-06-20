import type {} from "mocha";

const assert = require("node:assert/strict");
const {
  dedupeChatMessagesById,
  mergeChatMessageLists,
} = require("../src/lib/chat/mergeChatMessages");

describe("mergeChatMessageLists", () => {
  it("removes duplicate ids across history and live", () => {
    const sharedId = "4f70eaf3-8f6d-44e6-afcf-bf87be8854f1";
    const merged = mergeChatMessageLists(
      [{ id: sharedId, role: "rem", text: "history copy" }],
      [{ id: sharedId, role: "rem", text: "live copy" }],
    );

    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.id, sharedId);
    assert.equal(merged[0]?.text, "history copy");
  });

  it("dedupes repeated ids inside a single list", () => {
    const deduped = dedupeChatMessagesById([
      { id: "a", role: "user", text: "one" },
      { id: "a", role: "user", text: "two" },
      { id: "b", role: "rem", text: "three" },
    ]);

    assert.equal(deduped.length, 2);
    assert.deepEqual(
      deduped.map((message: { id: string }) => message.id),
      ["a", "b"],
    );
  });
});