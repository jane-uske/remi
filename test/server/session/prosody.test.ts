const assert = require("assert").strict;

const {
  appendProsodySample,
  summarizeProsody,
} = require("../../../voice/prosody_detector");

function makeToneFrame({
  frequencyHz,
  amplitude = 0.18,
  sampleRate = 16_000,
  samples = 640,
}) {
  const buf = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) {
    const phase = (i / sampleRate) * Math.PI * 2 * frequencyHz;
    const sample = Math.sin(phase) * amplitude;
    buf.writeInt16LE(Math.round(sample * 32767), i * 2);
  }
  return buf;
}

function collectSummary(frames) {
  let samples = [];
  let at = 1_000;
  for (const frame of frames) {
    samples = appendProsodySample(samples, frame, 16_000, 12, at);
    at += 20;
  }
  return summarizeProsody(samples);
}

describe("prosody summary", () => {
  it("detects a rising voiced tail", () => {
    const summary = collectSummary([
      makeToneFrame({ frequencyHz: 170, amplitude: 0.18 }),
      makeToneFrame({ frequencyHz: 182, amplitude: 0.18 }),
      makeToneFrame({ frequencyHz: 206, amplitude: 0.18 }),
      makeToneFrame({ frequencyHz: 228, amplitude: 0.18 }),
    ]);

    assert.ok(summary);
    assert.equal(summary.reliable, true);
    assert.equal(summary.risingTail, true);
    assert.equal(summary.sustainedVoicedTail, true);
    assert.ok((summary.pitchSlopeHz ?? 0) >= 18);
  });

  it("detects a falling tail with a clear energy drop", () => {
    const summary = collectSummary([
      makeToneFrame({ frequencyHz: 220, amplitude: 0.22 }),
      makeToneFrame({ frequencyHz: 205, amplitude: 0.2 }),
      makeToneFrame({ frequencyHz: 186, amplitude: 0.12 }),
      makeToneFrame({ frequencyHz: 168, amplitude: 0.08 }),
    ]);

    assert.ok(summary);
    assert.equal(summary.reliable, true);
    assert.equal(summary.fallingTail, true);
    assert.ok((summary.tailEnergyDrop ?? 0) > 0.008);
  });

  it("treats silence as unreliable prosody", () => {
    const summary = collectSummary([
      Buffer.alloc(640 * 2),
      Buffer.alloc(640 * 2),
      Buffer.alloc(640 * 2),
      Buffer.alloc(640 * 2),
    ]);

    assert.ok(summary);
    assert.equal(summary.reliable, false);
    assert.equal(summary.pitchFrames, 0);
  });
});
