const { expect } = require("chai");
const {
  parseGenerationId,
  parseServerHistoryPage,
  parseServerTurnState,
} = require("../src/hooks/useRemiChatProtocol");

describe("useRemiChat protocol helpers", () => {
  it("normalizes generation ids without changing numeric semantics", () => {
    expect(parseGenerationId(12)).to.equal(12);
    expect(parseGenerationId("12.9")).to.equal(12);
    expect(parseGenerationId("not-a-number")).to.equal(null);
    expect(parseGenerationId(null)).to.equal(null);
  });

  it("parses turn_state payloads into stable hook inputs", () => {
    expect(
      parseServerTurnState({
        type: "turn_state",
        state: "assistant_speaking",
        reason: "playback_start",
        preview: "  hello  ",
        interruptionType: "continuation",
        generationId: "8",
      }),
    ).to.deep.equal({
      state: "assistant_speaking",
      reason: "playback_start",
      preview: "hello",
      interruptionType: "continuation",
      generationId: 8,
    });

    expect(parseServerTurnState({ type: "turn_state", reason: "playback_start" })).to.equal(null);
  });

  it("parses history_page payloads into normalized messages and cursor state", () => {
    expect(
      parseServerHistoryPage({
        type: "history_page",
        mode: "prepend",
        hasMore: 1,
        messages: [
          {
            id: "m1",
            role: "assistant",
            content: "hello",
            createdAt: "2026-04-15T08:00:00.000Z",
          },
          {
            id: "m2",
            role: "user",
            content: "hi",
          },
          {
            id: "",
            role: "assistant",
            content: "ignored",
          },
        ],
        nextCursor: {
          id: "cursor-1",
          createdAt: "2026-04-15T08:01:00.000Z",
        },
      }),
    ).to.deep.equal({
      mode: "prepend",
      messages: [
        {
          id: "m1",
          role: "rem",
          text: "hello",
          createdAt: "2026-04-15T08:00:00.000Z",
        },
        {
          id: "m2",
          role: "user",
          text: "hi",
          createdAt: undefined,
        },
      ],
      nextCursor: {
        id: "cursor-1",
        createdAt: "2026-04-15T08:01:00.000Z",
      },
      hasMore: true,
    });
  });
});
