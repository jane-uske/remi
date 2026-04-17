const assert = require("assert").strict;

const { applyPcm16Gain } = require("../../../server/session/audio_resample");

function pcm16(samples) {
  const buffer = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => {
    buffer.writeInt16LE(sample, index * 2);
  });
  return buffer;
}

function readPcm16(buffer) {
  const samples = [];
  for (let index = 0; index < buffer.length; index += 2) {
    samples.push(buffer.readInt16LE(index));
  }
  return samples;
}

describe("audio resample helpers", () => {
  it("keeps pcm unchanged when gain is not above unity", () => {
    const input = pcm16([1200, -2400, 3000]);
    assert.deepEqual(readPcm16(applyPcm16Gain(input, 1)), [1200, -2400, 3000]);
    assert.deepEqual(readPcm16(applyPcm16Gain(input, 0.5)), [1200, -2400, 3000]);
  });

  it("amplifies pcm and clamps to int16 range", () => {
    const input = pcm16([4000, -5000, 12000, 32000, -32000]);
    assert.deepEqual(readPcm16(applyPcm16Gain(input, 3)), [
      12000,
      -15000,
      32767,
      32767,
      -32768,
    ]);
  });
});
