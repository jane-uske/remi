const { expect } = require("chai");
const { MicTxGate } = require("../src/lib/micTxGate");

function makeSineFrame(amplitude: number, frequencyHz = 220, sampleRate = 16000): ArrayBuffer {
  const sampleCount = 320;
  const buf = new ArrayBuffer(sampleCount * 2);
  const view = new DataView(buf);
  for (let i = 0; i < sampleCount; i++) {
    const t = i / sampleRate;
    const sample = Math.sin(2 * Math.PI * frequencyHz * t) * amplitude;
    view.setInt16(i * 2, Math.max(-32767, Math.min(32767, Math.round(sample * 32767))), true);
  }
  return buf;
}

function makeNoiseFrame(amplitude: number): ArrayBuffer {
  const sampleCount = 320;
  const buf = new ArrayBuffer(sampleCount * 2);
  const view = new DataView(buf);
  for (let i = 0; i < sampleCount; i++) {
    const centered = ((i * 73) % 37) / 18.5 - 1;
    view.setInt16(
      i * 2,
      Math.max(-32767, Math.min(32767, Math.round(centered * amplitude * 32767))),
      true,
    );
  }
  return buf;
}

describe("MicTxGate", () => {
  it("keeps transmission closed for sustained low-level noise", () => {
    const gate = new MicTxGate({
      preRollFrames: 6,
      minStartFrames: 3,
      stopFrames: 6,
    });

    let sentFrames = 0;
    for (let i = 0; i < 12; i++) {
      const result = gate.feed(makeNoiseFrame(0.01));
      sentFrames += result.framesToSend.length;
    }

    expect(sentFrames).to.equal(0);
    expect(gate.isTransmitting()).to.equal(false);
  });

  it("keeps transmission closed for sustained environment hum above the static threshold", () => {
    const gate = new MicTxGate({
      preRollFrames: 6,
      minStartFrames: 3,
      stopFrames: 6,
    });

    let sentFrames = 0;
    for (let i = 0; i < 24; i++) {
      const result = gate.feed(makeSineFrame(0.05, 90));
      sentFrames += result.framesToSend.length;
    }

    expect(sentFrames).to.equal(0);
    expect(gate.isTransmitting()).to.equal(false);
  });

  it("opens for immediate steady speech-like frames", () => {
    const gate = new MicTxGate({
      preRollFrames: 6,
      minStartFrames: 3,
      stopFrames: 6,
    });

    gate.feed(makeSineFrame(0.08, 220));
    gate.feed(makeSineFrame(0.08, 220));
    const result = gate.feed(makeSineFrame(0.08, 220));

    expect(result.opened).to.equal(true);
    expect(gate.isTransmitting()).to.equal(true);
  });

  it("opens transmission after speech-like frames and flushes pre-roll", () => {
    const gate = new MicTxGate({
      preRollFrames: 5,
      minStartFrames: 3,
      stopFrames: 6,
    });

    gate.feed(makeNoiseFrame(0.005));
    gate.feed(makeNoiseFrame(0.006));
    const frame1 = makeSineFrame(0.04);
    const frame2 = makeSineFrame(0.05);
    const frame3 = makeSineFrame(0.05);

    gate.feed(frame1);
    gate.feed(frame2);
    const result = gate.feed(frame3);

    expect(result.opened).to.equal(true);
    expect(result.framesToSend).to.have.length(5);
    expect(result.framesToSend[0].byteLength).to.equal(frame1.byteLength);
    expect(gate.isTransmitting()).to.equal(true);
  });

  it("sends trailing silence, then closes and stops sending", () => {
    const gate = new MicTxGate({
      preRollFrames: 4,
      minStartFrames: 2,
      stopFrames: 3,
    });

    gate.feed(makeSineFrame(0.05));
    gate.feed(makeSineFrame(0.05));
    expect(gate.isTransmitting()).to.equal(true);

    const tail1 = gate.feed(makeNoiseFrame(0.002));
    const tail2 = gate.feed(makeNoiseFrame(0.002));
    const tail3 = gate.feed(makeNoiseFrame(0.002));
    const afterClose = gate.feed(makeNoiseFrame(0.002));

    expect(tail1.framesToSend).to.have.length(1);
    expect(tail2.framesToSend).to.have.length(1);
    expect(tail3.closed).to.equal(true);
    expect(tail3.framesToSend).to.have.length(1);
    expect(afterClose.framesToSend).to.have.length(0);
    expect(gate.isTransmitting()).to.equal(false);
  });
});
