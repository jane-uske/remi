const assert = require("assert").strict;
const http = require("http");

process.env.REMI_FAMILY_MEMORY_ENABLED = "1";
process.env.REMI_FAMILY_MEMORY_SERVICE_URL = "http://localhost:3458";
process.env.REMI_FAMILY_MEMORY_AI_TOKEN = "";

const {
  familyMemoryCapability,
} = require("../../capabilities/family_memory_capability");
const {
  familyMemoryDraftsCapability,
} = require("../../capabilities/family_memory_drafts_capability");
const {
  RemiSessionContext,
} = require("../../brains/remi_session_context");
const { resetConfig } = require("../../server/config");

function makeRequest(userMessage: string, connId = "test-guard-001") {
  const ctx = new RemiSessionContext(connId);
  return {
    userMessage,
    emotion: "neutral",
    ctx,
    systemTriggered: false,
    inputSource: "text" as const,
  };
}

describe("Family Memory Query Guard — confirmed-only isolation", () => {
  let mockServer: any;
  let mockPort: number;
  let askHandler: (body: any, res: any) => void;
  let draftsHandler: (res: any) => void;

  before(function (done: () => void) {
    mockServer = http.createServer((req: any, res: any) => {
      if (req.url === "/api/ai/ask" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk: string) => { body += chunk; });
        req.on("end", () => {
          askHandler(JSON.parse(body), res);
        });
      } else if (req.url === "/api/ai/drafts/pending" && req.method === "GET") {
        draftsHandler(res);
      } else if (req.method === "POST" && req.url?.includes("/confirm")) {
        let body = "";
        req.on("data", (chunk: string) => { body += chunk; });
        req.on("end", () => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        });
      } else if (req.method === "POST" && req.url?.includes("/reject")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
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
    process.env.REMI_FAMILY_MEMORY_SERVICE_URL = "http://localhost:3458";
    resetConfig();
    mockServer.close(done);
  });

  describe("1. Pending image draft — must NOT answer", () => {
    it("refuses to answer when only pending drafts exist and no confirmed memory", async () => {
      // Server has no confirmed evidence for this question
      askHandler = (_body, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          handled: true,
          answerable: false,
          answer: null,
          confidence: "none",
          reason: "no_evidence",
          sources: [],
        }));
      };

      const connId = "test-pending-img-001";
      const result = await familyMemoryCapability.tryHandle(
        makeRequest("最近一次孕检是什么时候？", connId),
      );
      assert.equal(result.handled, true);
      // Must NOT claim anything about "13周孕检" or "B超正常"
      assert.ok(!result.reply.includes("13周"));
      assert.ok(!result.reply.includes("B超正常"));
      // Must express lack of confirmed memory
      assert.ok(
        result.reply.includes("没有确认") ||
        result.reply.includes("还没有") ||
        result.reply.includes("没有相关"),
      );
    });
  });

  describe("2. Pending draft with summary but NOT confirmed — must NOT answer", () => {
    it("activeSummary in drafts session does not leak to query capability", async () => {
      // Set up: pending drafts exist
      draftsHandler = (res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          drafts: [{
            draftId: "d-guard-001",
            inferredDate: "2026-05-10",
            inferredTitle: "孕检照片",
            originalFilenames: ["IMG_6663.png"],
            attachmentIds: ["att-guard-001"],
            ocrStatus: "no_extractor",
            ocrAttachmentCount: 1,
            ocrExtractedCount: 0,
          }],
        }));
      };

      // Server returns no confirmed evidence
      askHandler = (_body, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          handled: true,
          answerable: false,
          answer: null,
          confidence: "none",
          reason: "no_evidence",
          sources: [],
        }));
      };

      const connId = "test-summary-leak-001";

      // Step 1: User queries drafts
      await familyMemoryDraftsCapability.tryHandle(
        makeRequest("有什么要确认的", connId),
      );

      // Step 2: User adds summary (stored in drafts session only)
      const summaryResult = await familyMemoryDraftsCapability.tryHandle(
        makeRequest("补充摘要：这是13周孕检，B超正常", connId),
      );
      assert.equal(summaryResult.handled, true);
      assert.ok(summaryResult.reply.includes("已补充摘要"));

      // Step 3: User asks a family question — drafts capability won't match,
      // so it falls through to family_memory_capability
      // But first the drafts capability will see "最近一次孕检..." which isn't a
      // number/confirm/reject/summary pattern, so it clears the session.
      const queryResult = await familyMemoryCapability.tryHandle(
        makeRequest("最近一次孕检是什么时候？", connId),
      );
      assert.equal(queryResult.handled, true);
      // Must NOT contain the summary content that was only in the draft session
      assert.ok(!queryResult.reply.includes("13周孕检"));
      assert.ok(!queryResult.reply.includes("B超正常"));
      // Must express no confirmed memory
      assert.ok(
        queryResult.reply.includes("没有确认") ||
        queryResult.reply.includes("还没有"),
      );
    });
  });

  describe("3. Confirmed + synced memory — CAN answer", () => {
    it("returns confirmed memory content when server has evidence", async () => {
      askHandler = (_body, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          handled: true,
          answerable: true,
          answer: "根据记录，最近一次孕检是5月10日的13周孕检，B超显示一切正常。",
          confidence: "high",
          reason: "confirmed_evidence",
          resultSource: "deterministic",
          sources: [
            { memoryId: "evt-confirmed-001", title: "13周孕检" },
          ],
        }));
      };

      const connId = "test-confirmed-001";
      const result = await familyMemoryCapability.tryHandle(
        makeRequest("最近一次孕检是什么时候？", connId),
      );
      assert.equal(result.handled, true);
      // CAN answer with confirmed content
      assert.ok(result.reply.includes("13周孕检"));
      assert.ok(result.reply.includes("正常"));
    });
  });

  describe("4. Rejected draft — must NOT answer", () => {
    it("rejected draft content never appears in query results", async () => {
      // Server has no evidence (rejected drafts are excluded)
      askHandler = (_body, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          handled: true,
          answerable: false,
          answer: null,
          confidence: "none",
          reason: "no_evidence",
          sources: [],
        }));
      };

      const connId = "test-rejected-001";
      const result = await familyMemoryCapability.tryHandle(
        makeRequest("宝宝上次疫苗打了什么？", connId),
      );
      assert.equal(result.handled, true);
      assert.ok(!result.reply.includes("疫苗"));
      assert.ok(
        result.reply.includes("没有确认") ||
        result.reply.includes("还没有"),
      );
    });
  });

  describe("5. Filename must NOT serve as fact basis", () => {
    it("attachment filename like pregnancy_check_13w.png cannot infer facts", async () => {
      // Even if the server somehow returns low-confidence answer from filename,
      // the client should not have that data — server returns no_evidence
      askHandler = (_body, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          handled: true,
          answerable: false,
          answer: null,
          confidence: "none",
          reason: "no_evidence",
          sources: [],
        }));
      };

      const connId = "test-filename-001";
      const result = await familyMemoryCapability.tryHandle(
        makeRequest("最近一次孕检是什么时候？", connId),
      );
      assert.equal(result.handled, true);
      // Must NOT infer "13 weeks" from filename
      assert.ok(!result.reply.includes("13"));
      assert.ok(!result.reply.includes("pregnancy_check"));
      assert.ok(
        result.reply.includes("没有确认") ||
        result.reply.includes("还没有"),
      );
    });
  });

  describe("6. confirmedOnly parameter is sent to API", () => {
    it("POST /api/ai/ask request body includes confirmedOnly: true", async () => {
      let receivedBody: any = null;
      askHandler = (body, res) => {
        receivedBody = body;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          handled: true,
          answerable: false,
          answer: null,
          confidence: "none",
          reason: "no_evidence",
          sources: [],
        }));
      };

      const connId = "test-param-001";
      await familyMemoryCapability.tryHandle(
        makeRequest("宝宝体重多少了？", connId),
      );
      assert.ok(receivedBody !== null, "ask endpoint should have been called");
      assert.equal(receivedBody.confirmedOnly, true);
      assert.equal(receivedBody.question, "宝宝体重多少了？");
    });
  });

  describe("7. Family query always handled=true (never falls to main LLM)", () => {
    it("even when service returns no evidence, handled is true", async () => {
      askHandler = (_body, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          handled: true,
          answerable: false,
          answer: null,
          confidence: "none",
          reason: "no_evidence",
          sources: [],
        }));
      };

      const connId = "test-handled-001";
      const result = await familyMemoryCapability.tryHandle(
        makeRequest("预产期是什么时候？", connId),
      );
      // MUST be handled — family questions never fall through to main LLM
      assert.equal(result.handled, true);
    });
  });
});
