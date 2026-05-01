const { expect } = require("chai");
const {
  buildRemiVrmLabStatus,
  resolveVrmLabModelUrl,
} = require("../src/components/remiVrmLabModel");

describe("remiVrmLabModel", () => {
  it("summarizes SDK avatar model state for the VRM validation page", () => {
    const status = buildRemiVrmLabStatus({
      phase: "speaking",
      phaseReason: "assistant_audio_active",
      turnState: "assistant_speaking",
      turnReason: "playback_start",
      emotion: "curious",
      avatarIntent: {
        emotion: "curious",
        gesture: "lean_in",
        gestureIntensity: 2,
        facialAccent: "brow_raise",
        energy: 2,
        holdMs: 700,
        source: "llm",
      },
      avatarFrame: null,
      lipSync: {
        generationId: 4,
        complete: false,
        source: "provider_word_boundary_derived",
        cues: [
          {
            offsetMs: 0,
            durationMs: 120,
            viseme: "aa",
            weight: 0.7,
          },
        ],
      },
    });

    expect(status).to.deep.equal({
      phaseLabel: "speaking / assistant_audio_active",
      turnLabel: "assistant_speaking / playback_start",
      intentLabel: "llm · curious · lean_in · brow_raise",
      lipSyncLabel: "gen 4 · 1 cue · streaming · provider_word_boundary_derived",
      cueCount: 1,
    });
  });

  it("falls back to the bundled VRM when the configured model is not a VRM asset", () => {
    expect(resolveVrmLabModelUrl("/vrm/missing.glb")).to.equal(
      "/vrm/1497262518610234440.vrm",
    );
    expect(resolveVrmLabModelUrl("/vrm/rem.vrm")).to.equal("/vrm/rem.vrm");
  });
});
