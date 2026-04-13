const { expect } = require("chai");
const {
  shouldAwaitPlaybackDrain,
  shouldFinalizeDeferredChatEnd,
} = require("../src/hooks/useRemiChatTurnState");

describe("useRemiChat turn lifecycle helpers", () => {
  it("defers confirmed_end when chat_end arrives after playback already started", () => {
    expect(
      shouldAwaitPlaybackDrain({
        voiceActive: true,
        playbackSeenForGeneration: true,
      }),
    ).to.equal(true);
  });

  it("does not defer confirmed_end when no playback was observed for the generation", () => {
    expect(
      shouldAwaitPlaybackDrain({
        voiceActive: false,
        playbackSeenForGeneration: false,
      }),
    ).to.equal(false);
  });

  it("only finalizes a deferred chat_end after local playback drains", () => {
    expect(
      shouldFinalizeDeferredChatEnd({
        awaitingPlaybackDrain: true,
        voiceActive: true,
      }),
    ).to.equal(false);
    expect(
      shouldFinalizeDeferredChatEnd({
        awaitingPlaybackDrain: true,
        voiceActive: false,
      }),
    ).to.equal(true);
  });
});
