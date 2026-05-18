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

const draftA = {
  draftId: "draft-a",
  inferredDate: "2026-05-18",
  inferredTitle: null,
  inferredType: null,
  originalFilenames: ["IMG_6663.png"],
  ocrStatus: "no_extractor",
};

const draftB = {
  draftId: "draft-b",
  inferredDate: "2026-05-19",
  inferredTitle: "孕检单",
  inferredType: "pregnancy_checkup",
  originalFilenames: ["checkup.pdf"],
  ocrStatus: "extracted",
};

describe("family memory drafts capability", () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
    resetConfig();
  });

  it("lists pending drafts from family-memory", async () => {
    process.env.REMI_FAMILY_MEMORY_ENABLED = "1";
    process.env.REMI_FAMILY_MEMORY_SERVICE_URL = "http://memory.test";
    resetConfig();
    global.fetch = async (url) => {
      assert.equal(String(url), "http://memory.test/api/ai/drafts/pending");
      return jsonResponse({ total: 2, drafts: [draftA, draftB] });
    };

    const { familyMemoryDraftsCapability } = require("../../capabilities/family_memory_drafts_capability");
    const result = await familyMemoryDraftsCapability.tryHandle(
      makeRequest("有什么待确认的？", { connId: "draft-list" }),
    );

    assert.equal(result.handled, true);
    assert.match(result.reply, /待确认/);
    assert.match(result.reply, /1\./);
    assert.match(result.reply, /2\./);
    assert.match(result.reply, /IMG_6663\.png/);
    assert.match(result.reply, /请先选择编号/);
  });

  it("rejects bare confirm when multiple drafts are pending", async () => {
    process.env.REMI_FAMILY_MEMORY_ENABLED = "1";
    process.env.REMI_FAMILY_MEMORY_SERVICE_URL = "http://memory.test";
    resetConfig();
    const calls = [];
    global.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return jsonResponse({ total: 2, drafts: [draftA, draftB] });
    };

    const { familyMemoryDraftsCapability } = require("../../capabilities/family_memory_drafts_capability");
    const result = await familyMemoryDraftsCapability.tryHandle(
      makeRequest("确认", { connId: "draft-bare-confirm" }),
    );

    assert.equal(result.handled, true);
    assert.match(result.reply, /请先选择编号/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "http://memory.test/api/ai/drafts/pending");
  });

  it("supports select, summary, and confirm for the selected draft", async () => {
    process.env.REMI_FAMILY_MEMORY_ENABLED = "1";
    process.env.REMI_FAMILY_MEMORY_SERVICE_URL = "http://memory.test";
    resetConfig();
    const ctx = { connId: "draft-flow" };
    const calls = [];
    global.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/pending")) {
        return jsonResponse({ total: 2, drafts: [draftA, draftB] });
      }
      return jsonResponse({ ok: true, noteId: "note-draft-a" });
    };

    const { familyMemoryDraftsCapability } = require("../../capabilities/family_memory_drafts_capability");
    const selected = await familyMemoryDraftsCapability.tryHandle(makeRequest("选择 1", ctx));
    assert.equal(selected.handled, true);
    assert.match(selected.reply, /已选择第 1 条/);

    const summarized = await familyMemoryDraftsCapability.tryHandle(
      makeRequest("补充摘要：这是13周孕检，B超正常", ctx),
    );
    assert.equal(summarized.handled, true);
    assert.match(summarized.reply, /摘要已更新/);

    const confirmed = await familyMemoryDraftsCapability.tryHandle(makeRequest("确认", ctx));
    assert.equal(confirmed.handled, true);
    assert.match(confirmed.reply, /已生成待同步 note/);

    const confirmCall = calls.find((call) => call.url.endsWith("/api/ai/drafts/draft-a/confirm"));
    assert.ok(confirmCall);
    assert.equal(JSON.parse(confirmCall.init.body).summary, "这是13周孕检，B超正常");
  });

  it("supports skipping the selected draft", async () => {
    process.env.REMI_FAMILY_MEMORY_ENABLED = "1";
    process.env.REMI_FAMILY_MEMORY_SERVICE_URL = "http://memory.test";
    resetConfig();
    const ctx = { connId: "draft-skip" };
    const calls = [];
    global.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/pending")) {
        return jsonResponse({ total: 1, drafts: [draftA] });
      }
      return jsonResponse({ ok: true });
    };

    const { familyMemoryDraftsCapability } = require("../../capabilities/family_memory_drafts_capability");
    const result = await familyMemoryDraftsCapability.tryHandle(makeRequest("跳过", ctx));

    assert.equal(result.handled, true);
    assert.match(result.reply, /已跳过|已跳过这条/);
    assert.ok(calls.some((call) => call.url.endsWith("/api/ai/drafts/draft-a/reject")));
  });
});
