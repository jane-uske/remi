const assert = require("assert").strict;

const { resetConfig } = require("../../server/config");

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe("direct family-memory capability registration", () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
    resetConfig();
  });

  it("runs draft capability before capture capability for bare confirm", async () => {
    process.env.REMI_FAMILY_MEMORY_ENABLED = "1";
    process.env.REMI_FAMILY_MEMORY_SERVICE_URL = "http://memory.test";
    resetConfig();
    const calls = [];
    global.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/drafts/pending")) {
        return jsonResponse({
          total: 2,
          drafts: [
            { draftId: "d1", inferredDate: "2026-05-18", originalFilenames: ["a.png"] },
            { draftId: "d2", inferredDate: "2026-05-19", originalFilenames: ["b.png"] },
          ],
        });
      }
      throw new Error(`unexpected call ${url}`);
    };

    const { tryHandleDirectCapabilities } = require("../../brain/direct_capabilities");
    const result = await tryHandleDirectCapabilities({
      userMessage: "确认",
      emotion: "neutral",
      ctx: {
        connId: "registry-order",
        userId: "user-registry",
        getClientTimeZone: () => "Asia/Shanghai",
      },
      systemTriggered: false,
      inputSource: "text",
    });

    assert.equal(result.handled, true);
    assert.equal(result.capabilityId, "family_memory_drafts");
    assert.match(result.reply, /请先选择编号/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "http://memory.test/api/ai/drafts/pending");
  });
});
