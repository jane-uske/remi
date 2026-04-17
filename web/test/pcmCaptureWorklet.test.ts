const fs = require("fs");
const path = require("path");
const { expect } = require("chai");

describe("pcm capture worklet registration", () => {
  it("registers the processor name expected by startPcmCapture", () => {
    const workletPath = path.resolve(
      __dirname,
      "../public/audio/pcm-capture-worklet.js",
    );
    const source = fs.readFileSync(workletPath, "utf8");
    expect(source).to.include(
      'registerProcessor("remi-pcm-capture-processor", RemPcmCaptureProcessor);',
    );
  });
});
