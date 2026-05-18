const assert = require("assert").strict;
const http = require("http");

// Set env before importing capability
process.env.REMI_FAMILY_MEMORY_ENABLED = "1";
process.env.REMI_FAMILY_MEMORY_SERVICE_URL = "http://localhost:3456";
process.env.REMI_FAMILY_MEMORY_AI_TOKEN = "";

const {
  familyMemoryCaptureCapability,
} = require("../../capabilities/family_memory_capture_capability");
const {
  RemiSessionContext,
} = require("../../brains/remi_session_context");
const { resetConfig } = require("../../server/config");

function makeRequest(userMessage: string, connId = "test-conn-001") {
  const ctx = new RemiSessionContext(connId);
  return {
    userMessage,
    emotion: "neutral",
    ctx,
    systemTriggered: false,
    inputSource: "text" as const,
  };
}

describe("v0.9.1: Family Memory Capture Capability", () => {
  it("detects record intent and returns confirmation prompt", async () => {
    const result = await familyMemoryCaptureCapability.tryHandle(
      makeRequest("帮我记一下，今天宝宝第一次翻身了"),
    );
    assert.equal(result.handled, true);
    assert.ok(result.reply.includes("今天宝宝第一次翻身了"));
    assert.ok(result.reply.includes("确认"));
  });

  it("does not trigger on normal chat", async () => {
    const result = await familyMemoryCaptureCapability.tryHandle(
      makeRequest("宝宝今天好可爱啊"),
    );
    assert.equal(result.handled, false);
  });

  it("does not trigger on general family questions", async () => {
    const result = await familyMemoryCaptureCapability.tryHandle(
      makeRequest("最近一次孕检情况如何？"),
    );
    assert.equal(result.handled, false);
  });

  it("blocks privacy-marked content immediately", async () => {
    const result = await familyMemoryCaptureCapability.tryHandle(
      makeRequest("帮我记一下，这条不要给AI看：宝宝的小秘密"),
    );
    assert.equal(result.handled, true);
    assert.ok(result.reply.includes("私密"));
    assert.ok(result.reply.includes("blocked_from_ai"));
  });

  it("handles cancellation after pending draft", async () => {
    const connId = "test-cancel-001";
    await familyMemoryCaptureCapability.tryHandle(
      makeRequest("记录一下今天去了医院", connId),
    );
    const result = await familyMemoryCaptureCapability.tryHandle(
      makeRequest("算了", connId),
    );
    assert.equal(result.handled, true);
    assert.ok(result.reply.includes("取消"));
  });

  it("does not handle when disabled", async () => {
    const origEnabled = process.env.REMI_FAMILY_MEMORY_ENABLED;
    process.env.REMI_FAMILY_MEMORY_ENABLED = "0";
    resetConfig();
    try {
      const result = await familyMemoryCaptureCapability.tryHandle(
        makeRequest("帮我记一下，今天宝宝翻身了"),
      );
      assert.equal(result.handled, false);
    } finally {
      process.env.REMI_FAMILY_MEMORY_ENABLED = origEnabled!;
      resetConfig();
    }
  });

  it("extracts content correctly from intent phrases", async () => {
    const connId = "test-extract-001";
    const result = await familyMemoryCaptureCapability.tryHandle(
      makeRequest("帮我记一下，今天去公园散步了", connId),
    );
    assert.equal(result.handled, true);
    assert.ok(result.reply.includes("今天去公园散步了"));
  });

  it("handles service unavailable gracefully on confirmation", async () => {
    const origUrl = process.env.REMI_FAMILY_MEMORY_SERVICE_URL;
    process.env.REMI_FAMILY_MEMORY_SERVICE_URL = "http://localhost:19999";
    resetConfig();
    try {
      const connId = "test-unavail-001";
      await familyMemoryCaptureCapability.tryHandle(
        makeRequest("帮我记一下今天翻身了", connId),
      );
      const result = await familyMemoryCaptureCapability.tryHandle(
        makeRequest("确认", connId),
      );
      assert.equal(result.handled, true);
      assert.ok(result.reply.includes("暂不可用"));
    } finally {
      process.env.REMI_FAMILY_MEMORY_SERVICE_URL = origUrl!;
      resetConfig();
    }
  });

  it("clears pending draft when user sends unrelated message", async () => {
    const connId = "test-clear-001";
    await familyMemoryCaptureCapability.tryHandle(
      makeRequest("记录一下宝宝笑了", connId),
    );
    const result = await familyMemoryCaptureCapability.tryHandle(
      makeRequest("今天天气真好", connId),
    );
    assert.equal(result.handled, false);
  });
});

describe("v0.9.2: Stage-Aware Guardrail (Remi Capability)", () => {
  let mockServer: any;
  let mockPort: number;

  before(function (done: () => void) {
    mockServer = http.createServer((req: any, res: any) => {
      if (req.url === "/api/ai/stage") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ stage: "孕期" }));
      } else if (req.url === "/api/ai/capture" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk: string) => { body += chunk; });
        req.on("end", () => {
          const data = JSON.parse(body);
          if (data.text.includes("翻身")) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "stage_guardrail", message: "当前阶段为孕期" }));
          } else {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, noteId: "test-note-001" }));
          }
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    mockServer.listen(0, () => {
      mockPort = mockServer.address().port;
      process.env.REMI_FAMILY_MEMORY_SERVICE_URL = `http://localhost:${mockPort}`;
      resetConfig();
      done();
    });
  });

  after(function (done: () => void) {
    process.env.REMI_FAMILY_MEMORY_SERVICE_URL = "http://localhost:3456";
    resetConfig();
    mockServer.close(done);
  });

  it("triggers stage guardrail for post-birth milestone during pregnancy", async () => {
    const connId = "test-stage-guard-001";
    const result = await familyMemoryCaptureCapability.tryHandle(
      makeRequest("帮我记一下，宝宝翻身了", connId),
    );
    assert.equal(result.handled, true);
    assert.ok(result.reply.includes("孕期"));
    assert.ok(result.reply.includes("翻身"));
    assert.ok(result.reply.includes("确认"));
  });

  it("allows recording after guardrail acknowledgment", async () => {
    const connId = "test-stage-ack-001";
    await familyMemoryCaptureCapability.tryHandle(
      makeRequest("帮我记一下，宝宝翻身了", connId),
    );
    // First confirm acknowledges the guardrail
    const ackResult = await familyMemoryCaptureCapability.tryHandle(
      makeRequest("确认", connId),
    );
    assert.equal(ackResult.handled, true);
    assert.ok(ackResult.reply.includes("确认记录"));

    // Second confirm actually records (server returns stage_guardrail error though)
    const finalResult = await familyMemoryCaptureCapability.tryHandle(
      makeRequest("确认", connId),
    );
    assert.equal(finalResult.handled, true);
    // Server mock returns stage_guardrail error for 翻身 content
    assert.ok(finalResult.reply.includes("孕期") || finalResult.reply.includes("无法"));
  });

  it("allows cancellation during stage guardrail", async () => {
    const connId = "test-stage-cancel-001";
    await familyMemoryCaptureCapability.tryHandle(
      makeRequest("帮我记一下，宝宝走路了", connId),
    );
    const result = await familyMemoryCaptureCapability.tryHandle(
      makeRequest("算了", connId),
    );
    assert.equal(result.handled, true);
    assert.ok(result.reply.includes("取消"));
  });

  it("does not trigger guardrail for pregnancy-appropriate content", async () => {
    const connId = "test-stage-ok-001";
    const result = await familyMemoryCaptureCapability.tryHandle(
      makeRequest("帮我记一下，今天胎动很频繁", connId),
    );
    assert.equal(result.handled, true);
    // Should go straight to confirmation, not guardrail warning
    assert.ok(!result.reply.includes("孕期"));
    assert.ok(result.reply.includes("确认记录"));
  });

  it("lifecycle reply includes captured_to_inbox on success", async () => {
    const connId = "test-lifecycle-001";
    await familyMemoryCaptureCapability.tryHandle(
      makeRequest("帮我记一下，今天感受到胎动了", connId),
    );
    const result = await familyMemoryCaptureCapability.tryHandle(
      makeRequest("确认", connId),
    );
    assert.equal(result.handled, true);
    assert.ok(result.reply.includes("captured_to_inbox"));
  });
});
