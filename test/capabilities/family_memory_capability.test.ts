const assert = require("assert").strict;

const { resetConfig } = require("../../server/config");

function makeRequest(userMessage, ctx = { connId: "test-family-memory" }) {
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

describe("family memory capability", () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
    resetConfig();
  });

  it("disabled returns handled=false without calling the service", async () => {
    process.env.REMI_FAMILY_MEMORY_ENABLED = "0";
    resetConfig();
    let called = false;
    global.fetch = async () => {
      called = true;
      throw new Error("should not call");
    };

    const { familyMemoryCapability } = require("../../capabilities/family_memory_capability");
    const result = await familyMemoryCapability.tryHandle(makeRequest("最近一次孕检是什么时候？"));

    assert.deepEqual(result, { handled: false });
    assert.equal(called, false);
  });

  it("non-family questions return handled=false", async () => {
    process.env.REMI_FAMILY_MEMORY_ENABLED = "1";
    process.env.REMI_FAMILY_MEMORY_SERVICE_URL = "http://memory.test";
    resetConfig();

    const { familyMemoryCapability } = require("../../capabilities/family_memory_capability");
    const result = await familyMemoryCapability.tryHandle(makeRequest("今天晚上吃什么？"));

    assert.deepEqual(result, { handled: false });
  });

  it("family questions are handled with an honest refusal when service is unavailable", async () => {
    process.env.REMI_FAMILY_MEMORY_ENABLED = "1";
    process.env.REMI_FAMILY_MEMORY_SERVICE_URL = "http://memory.test";
    resetConfig();
    global.fetch = async () => {
      throw new Error("ECONNREFUSED");
    };

    const { familyMemoryCapability } = require("../../capabilities/family_memory_capability");
    const result = await familyMemoryCapability.tryHandle(makeRequest("最近一次孕检是什么时候？"));

    assert.equal(result.handled, true);
    assert.match(result.reply, /家庭记忆服务暂不可用|拿不到家庭记忆/);
  });

  it("no evidence returns handled=true with a grounded refusal", async () => {
    process.env.REMI_FAMILY_MEMORY_ENABLED = "1";
    process.env.REMI_FAMILY_MEMORY_SERVICE_URL = "http://memory.test";
    process.env.REMI_FAMILY_MEMORY_AI_TOKEN = "token-1";
    resetConfig();
    const calls = [];
    global.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return jsonResponse({
        handled: true,
        question: "宝宝最近胎动怎么样？",
        answerable: false,
        answer: "家庭记忆里还没有相关记录。",
        confidence: "none",
        reason: "no_evidence",
        sources: [],
        serviceStatus: "connected",
      });
    };

    const { familyMemoryCapability } = require("../../capabilities/family_memory_capability");
    const result = await familyMemoryCapability.tryHandle(makeRequest("宝宝最近胎动怎么样？"));

    assert.equal(result.handled, true);
    assert.match(result.reply, /还没有相关记录|没有查到/);
    assert.equal(calls[0].url, "http://memory.test/api/ai/ask");
    assert.equal(calls[0].init.headers.Authorization, "Bearer token-1");
  });

  it("answerable family questions return the grounded answer", async () => {
    process.env.REMI_FAMILY_MEMORY_ENABLED = "1";
    process.env.REMI_FAMILY_MEMORY_SERVICE_URL = "http://memory.test/";
    resetConfig();
    global.fetch = async () =>
      jsonResponse({
        handled: true,
        question: "最近一次孕检是什么时候？",
        answerable: true,
        answer: "最近一次孕检是 2026-05-18，记录显示 B 超正常。",
        confidence: "high",
        reason: "answerable",
        sources: [{ date: "2026-05-18", title: "13周孕检" }],
        serviceStatus: "connected",
      });

    const { familyMemoryCapability } = require("../../capabilities/family_memory_capability");
    const result = await familyMemoryCapability.tryHandle(makeRequest("最近一次孕检是什么时候？"));

    assert.equal(result.handled, true);
    assert.match(result.reply, /2026-05-18/);
    assert.match(result.reply, /B 超正常/);
  });

  it("deduplicates repeated service answer fragments before replying", async () => {
    process.env.REMI_FAMILY_MEMORY_ENABLED = "1";
    process.env.REMI_FAMILY_MEMORY_SERVICE_URL = "http://memory.test/";
    resetConfig();
    global.fetch = async () =>
      jsonResponse({
        handled: true,
        question: "最近一次孕检是什么时候？",
        answerable: true,
        answer:
          "根据家庭记忆记录（2026-05-18）：这是13周孕检，B超正常。这是13周孕检，B超正常 这是13周孕检，B超正常",
        confidence: "high",
        reason: "answerable",
        sources: [{ date: "2026-05-18", title: "这是13周孕检，B超正常" }],
        serviceStatus: "connected",
      });

    const { familyMemoryCapability } = require("../../capabilities/family_memory_capability");
    const result = await familyMemoryCapability.tryHandle(makeRequest("最近一次孕检是什么时候？"));

    assert.equal(result.handled, true);
    assert.equal(result.reply, "根据家庭记忆记录（2026-05-18）：这是13周孕检，B超正常。");
  });
});
