const { expect } = require("chai");
const {
  getMicAccessErrorMessage,
  getMicCaptureFaultMessage,
} = require("../src/lib/micCaptureErrors");

describe("mic capture error helpers", () => {
  it("maps permission denial to a permission-specific message", () => {
    const error = new DOMException("Permission denied", "NotAllowedError");
    expect(getMicAccessErrorMessage(error)).to.equal("麦克风权限未开启");
  });

  it("maps missing devices to a device-specific message", () => {
    const error = new DOMException("No device", "NotFoundError");
    expect(getMicAccessErrorMessage(error)).to.equal("未检测到可用麦克风");
  });

  it("maps device disconnect faults distinctly", () => {
    expect(getMicCaptureFaultMessage({ reason: "track-ended" })).to.equal(
      "麦克风已断开，请重新开启",
    );
  });

  it("falls back to a generic capture fault message", () => {
    expect(getMicCaptureFaultMessage({ reason: "context-not-running" })).to.equal(
      "音频设备异常，请重新开启麦克风",
    );
  });
});
