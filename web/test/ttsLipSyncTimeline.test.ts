import type {} from "mocha";

const assert = require("node:assert/strict");
const {
  applyTtsLipSyncPatch,
  clearTtsLipSyncState,
  resolveActiveTtsLipViseme,
} = require("../src/lib/audio/ttsLipSyncTimeline");

describe("ttsLipSyncTimeline", () => {
  it("merges replace and append patches by generation", () => {
    let state = applyTtsLipSyncPatch(
      null,
      {
        generationId: 3,
        source: "provider_word_boundary_derived",
        mode: "replace",
        complete: false,
        cues: [
          { offsetMs: 0, durationMs: 120, viseme: "aa", weight: 0.7, token: "你" },
        ],
      },
    );

    state = applyTtsLipSyncPatch(state, {
      generationId: 3,
      source: "provider_word_boundary_derived",
      mode: "append",
      complete: true,
      cues: [
        { offsetMs: 140, durationMs: 100, viseme: "oh", weight: 0.6, token: "哦" },
      ],
    });

    assert.equal(state.generationId, 3);
    assert.equal(state.complete, true);
    assert.equal(state.cues.length, 2);
    assert.equal(state.cues[1].viseme, "oh");
  });

  it("samples cues relative to playback start, not ws receive time", () => {
    const state = applyTtsLipSyncPatch(null, {
      generationId: 8,
      source: "provider_word_boundary_derived",
      mode: "replace",
      complete: true,
      cues: [
        { offsetMs: 120, durationMs: 120, viseme: "aa", weight: 0.72, token: "你" },
      ],
    });

    assert.equal(resolveActiveTtsLipViseme(state, 0), null);
    assert.deepEqual(resolveActiveTtsLipViseme(state, 160), {
      name: "aa",
      weight: 0.72,
    });
    assert.equal(resolveActiveTtsLipViseme(state, 260), null);
  });

  it("clears pending cues immediately", () => {
    const state = applyTtsLipSyncPatch(null, {
      generationId: 9,
      source: "provider_word_boundary_derived",
      mode: "replace",
      complete: true,
      cues: [
        { offsetMs: 0, durationMs: 200, viseme: "aa", weight: 0.75, token: "你好" },
      ],
    });

    const cleared = clearTtsLipSyncState(state);
    assert.equal(cleared, null);
  });
});
