const { expect } = require("chai");
import { hasPendingPlaybackWork } from "@/lib/audio/playbackLifecycle";

describe("playbackLifecycle", () => {
  it("holds playback end while the server may still stream more TTS", () => {
    expect(
      hasPendingPlaybackWork({
        playing: false,
        activeSources: 0,
        pendingPcmSamples: 0,
        hasFlushTimer: false,
        scheduledAheadMs: 0,
        serverTtsStreaming: true,
        msSinceLastEnqueue: Number.POSITIVE_INFINITY,
      }),
    ).to.equal(true);
  });

  it("holds playback end briefly after the last chunk was enqueued", () => {
    expect(
      hasPendingPlaybackWork({
        playing: false,
        activeSources: 0,
        pendingPcmSamples: 0,
        hasFlushTimer: false,
        scheduledAheadMs: 0,
        serverTtsStreaming: false,
        msSinceLastEnqueue: 120,
      }),
    ).to.equal(true);
  });

  it("allows playback end once the queue and server stream are fully idle", () => {
    expect(
      hasPendingPlaybackWork({
        playing: false,
        activeSources: 0,
        pendingPcmSamples: 0,
        hasFlushTimer: false,
        scheduledAheadMs: 0,
        serverTtsStreaming: false,
        msSinceLastEnqueue: 500,
      }),
    ).to.equal(false);
  });
});