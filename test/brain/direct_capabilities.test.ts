const assert = require("assert").strict;

const { RemiSessionContext } = require("../../brains/remi_session_context");
const { tryHandleDirectCapabilities } = require("../../brain/direct_capabilities");

describe("direct capabilities", () => {
  it("handles direct time questions through the shared direct-capability entrypoint", async () => {
    const restore = process.env.REMI_TIME_CAPABILITY_ENABLED;
    process.env.REMI_TIME_CAPABILITY_ENABLED = "1";

    try {
      const ctx = new RemiSessionContext("direct-capability-time");
      const result = await tryHandleDirectCapabilities({
        userMessage: "现在几点了",
        emotion: "neutral",
        ctx,
        systemTriggered: false,
        inputSource: "text",
      });

      assert.equal(result.handled, true);
      if (result.handled) {
        assert.equal(result.capabilityId, "time");
        assert.match(result.reply, /^按我这边现在的时间看，现在是 \d{2}:\d{2}。$/);
      }
    } finally {
      if (restore === undefined) {
        delete process.env.REMI_TIME_CAPABILITY_ENABLED;
      } else {
        process.env.REMI_TIME_CAPABILITY_ENABLED = restore;
      }
    }
  });

  it("skips direct capabilities for system-triggered turns", async () => {
    const restore = process.env.REMI_TIME_CAPABILITY_ENABLED;
    process.env.REMI_TIME_CAPABILITY_ENABLED = "1";

    try {
      const ctx = new RemiSessionContext("direct-capability-system");
      const result = await tryHandleDirectCapabilities({
        userMessage: "现在几点了",
        emotion: "neutral",
        ctx,
        systemTriggered: true,
        inputSource: "text",
      });

      assert.deepEqual(result, { handled: false });
    } finally {
      if (restore === undefined) {
        delete process.env.REMI_TIME_CAPABILITY_ENABLED;
      } else {
        process.env.REMI_TIME_CAPABILITY_ENABLED = restore;
      }
    }
  });
});
