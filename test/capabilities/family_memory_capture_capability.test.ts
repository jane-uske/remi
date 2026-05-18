const assert = require("assert").strict;

const { resetConfig } = require("../../server/config");

function makeRequest(userMessage, ctx) {
  return {
    userMessage,
    emotion: "neutral",
    ctx,
    systemTriggered: false,
    inputSource: "text",
  };
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe("family memory capture capability", () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
    resetConfig();
  });

  it("ordinary chat is not captured", async () => {
    process.env.REMI_FAMILY_MEMORY_ENABLED = "1";
    resetConfig();
    const { familyMemoryCaptureCapability } = require("../../capabilities/family_memory_capture_capability");
    const result = await familyMemoryCaptureCapability.tryHandle(
      makeRequest("今天晚上吃什么？", { connId: "capture-normal" }),
    );

    assert.deepEqual(result, { handled: false });
  });

  it("record intent creates a pending local draft and only writes after user confirmation", async () => {
    process.env.REMI_FAMILY_MEMORY_ENABLED = "1";
    process.env.REMI_FAMILY_MEMORY_SERVICE_URL = "http://memory.test";
    resetConfig();
    const ctx = { connId: "capture-flow" };
    const calls = [];
    global.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return jsonResponse({
        ok: true,
        noteId: "note-1",
        lifecycle: "captured_to_inbox",
        message: "captured",
      });
    };

    const { familyMemoryCaptureCapability } = require("../../capabilities/family_memory_capture_capability");

    const pending = await familyMemoryCaptureCapability.tryHandle(
      makeRequest("帮我记一下：宝宝今天第一次明显踢我", ctx),
    );
    assert.equal(pending.handled, true);
    assert.match(pending.reply, /确认|要不要记/);
    assert.equal(calls.length, 0);

    const confirmed = await familyMemoryCaptureCapability.tryHandle(makeRequest("确认", ctx));
    assert.equal(confirmed.handled, true);
    assert.match(confirmed.reply, /已记录|已生成待同步 note|npm run sync/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "http://memory.test/api/ai/capture");
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.text, "宝宝今天第一次明显踢我");
    assert.equal(body.confirmedByParent, true);
    assert.equal(body.source, "remi");
  });

  it("blocked/private record intents are refused and never sent to family-memory", async () => {
    process.env.REMI_FAMILY_MEMORY_ENABLED = "1";
    resetConfig();
    let called = false;
    global.fetch = async () => {
      called = true;
      throw new Error("should not call");
    };

    const { familyMemoryCaptureCapability } = require("../../capabilities/family_memory_capture_capability");
    const result = await familyMemoryCaptureCapability.tryHandle(
      makeRequest("帮我记一下：我的银行卡密码是 123456", { connId: "capture-private" }),
    );

    assert.equal(result.handled, true);
    assert.match(result.reply, /不能|不适合|隐私|敏感/);
    assert.equal(called, false);
  });
});
