const assert = require("assert").strict;
const http = require("http");

process.env.REMI_FAMILY_MEMORY_ENABLED = "1";
process.env.REMI_FAMILY_MEMORY_SERVICE_URL = "http://localhost:3457";
process.env.REMI_FAMILY_MEMORY_AI_TOKEN = "";

const {
  familyMemoryDraftsCapability,
} = require("../../capabilities/family_memory_drafts_capability");
const {
  RemiSessionContext,
} = require("../../brains/remi_session_context");
const { resetConfig } = require("../../server/config");

function makeRequest(userMessage: string, connId = "test-drafts-001") {
  const ctx = new RemiSessionContext(connId);
  return {
    userMessage,
    emotion: "neutral",
    ctx,
    systemTriggered: false,
    inputSource: "text" as const,
  };
}

describe("Family Memory Drafts Capability — Enhanced UX", () => {
  let mockServer: any;
  let mockPort: number;
  let pendingDraftsResponse: any = { drafts: [] };

  before(function (done: () => void) {
    mockServer = http.createServer((req: any, res: any) => {
      if (req.url === "/api/ai/drafts/pending" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(pendingDraftsResponse));
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
    process.env.REMI_FAMILY_MEMORY_SERVICE_URL = "http://localhost:3457";
    resetConfig();
    mockServer.close(done);
  });

  describe("Image no_extractor draft hint", () => {
    it("shows hint about images not being auto-recognizable for single draft", async () => {
      pendingDraftsResponse = {
        drafts: [
          {
            draftId: "d-img-001",
            inferredDate: "2026-05-10",
            inferredTitle: "宝宝超声图",
            originalFilenames: ["ultrasound.jpg"],
            attachmentIds: ["att-001"],
            ocrStatus: "no_extractor",
            ocrAttachmentCount: 1,
            ocrExtractedCount: 0,
          },
        ],
      };
      const connId = "test-img-hint-001";
      const result = await familyMemoryDraftsCapability.tryHandle(
        makeRequest("有什么要确认的", connId),
      );
      assert.equal(result.handled, true);
      assert.ok(result.reply.includes("图片当前还不能自动识别内容"));
      assert.ok(result.reply.includes("补充摘要"));
    });
  });

  describe("PDF extracted draft hint", () => {
    it("shows hint about PDF text extraction for single draft", async () => {
      pendingDraftsResponse = {
        drafts: [
          {
            draftId: "d-pdf-001",
            inferredDate: "2026-05-12",
            inferredTitle: "产检报告",
            originalFilenames: ["checkup-report.pdf"],
            attachmentIds: ["att-002"],
            ocrStatus: "extracted",
            ocrAttachmentCount: 1,
            ocrExtractedCount: 1,
          },
        ],
      };
      const connId = "test-pdf-hint-001";
      const result = await familyMemoryDraftsCapability.tryHandle(
        makeRequest("有什么要确认的", connId),
      );
      assert.equal(result.handled, true);
      assert.ok(result.reply.includes("PDF 已提取文本"));
      assert.ok(result.reply.includes("确认摘要"));
    });
  });

  describe("Multi-draft list includes number and OCR status", () => {
    it("displays numbered list with OCR status and summary warnings", async () => {
      pendingDraftsResponse = {
        drafts: [
          {
            draftId: "d-multi-001",
            inferredDate: "2026-05-10",
            inferredTitle: "B超照片",
            originalFilenames: ["b-chao.jpg", "b-chao-2.jpg"],
            attachmentIds: ["att-m1", "att-m2"],
            ocrStatus: "no_extractor",
            ocrAttachmentCount: 2,
            ocrExtractedCount: 0,
          },
          {
            draftId: "d-multi-002",
            inferredDate: "2026-05-11",
            inferredTitle: "产检PDF",
            originalFilenames: ["report.pdf"],
            attachmentIds: ["att-m3"],
            ocrStatus: "extracted",
            ocrAttachmentCount: 1,
            ocrExtractedCount: 1,
          },
          {
            draftId: "d-multi-003",
            inferredDate: null,
            inferredTitle: null,
            originalFilenames: ["misc.bin"],
            attachmentIds: ["att-m4"],
            ocrStatus: "error",
            ocrAttachmentCount: 1,
            ocrExtractedCount: 0,
          },
        ],
      };
      const connId = "test-multi-list-001";
      const result = await familyMemoryDraftsCapability.tryHandle(
        makeRequest("有什么要确认的", connId),
      );
      assert.equal(result.handled, true);
      // Check numbered items
      assert.ok(result.reply.includes("1."));
      assert.ok(result.reply.includes("2."));
      assert.ok(result.reply.includes("3."));
      // Check OCR status labels
      assert.ok(result.reply.includes("无法自动识别"));
      assert.ok(result.reply.includes("已提取文本"));
      assert.ok(result.reply.includes("提取失败"));
      // Check summary warning
      assert.ok(result.reply.includes("需补充摘要"));
      // Check file count
      assert.ok(result.reply.includes("文件数：2"));
      assert.ok(result.reply.includes("文件数：1"));
    });
  });

  describe("Summary supplement preserves active draft", () => {
    it("after adding summary, session stays active and confirms with summary", async () => {
      pendingDraftsResponse = {
        drafts: [
          {
            draftId: "d-summary-001",
            inferredDate: "2026-05-15",
            inferredTitle: "宝宝写真",
            originalFilenames: ["photo1.jpg"],
            attachmentIds: ["att-s1"],
            ocrStatus: "no_extractor",
            ocrAttachmentCount: 1,
            ocrExtractedCount: 0,
          },
        ],
      };
      const connId = "test-summary-keep-001";

      // Trigger drafts listing
      await familyMemoryDraftsCapability.tryHandle(
        makeRequest("有什么要确认的", connId),
      );

      // Add summary
      const summaryResult = await familyMemoryDraftsCapability.tryHandle(
        makeRequest("补充摘要：第一次拍全家福", connId),
      );
      assert.equal(summaryResult.handled, true);
      assert.ok(summaryResult.reply.includes("已补充摘要到第 1 条草稿"));
      assert.ok(summaryResult.reply.includes("即可生成待同步 note"));

      // Confirm should still work (session not cleared)
      const confirmResult = await familyMemoryDraftsCapability.tryHandle(
        makeRequest("确认", connId),
      );
      assert.equal(confirmResult.handled, true);
      assert.ok(confirmResult.reply.includes("已生成待同步 note"));
      assert.ok(confirmResult.reply.includes("npm run sync"));
    });
  });

  describe("Confirm reply includes sync instructions", () => {
    it("confirm reply mentions npm run sync and timeline", async () => {
      pendingDraftsResponse = {
        drafts: [
          {
            draftId: "d-confirm-001",
            inferredDate: "2026-05-16",
            inferredTitle: "胎动记录",
            originalFilenames: ["kick.txt"],
            attachmentIds: ["att-c1"],
            ocrStatus: "extracted",
            ocrAttachmentCount: 1,
            ocrExtractedCount: 1,
          },
        ],
      };
      const connId = "test-confirm-msg-001";

      await familyMemoryDraftsCapability.tryHandle(
        makeRequest("有什么要确认的", connId),
      );
      const result = await familyMemoryDraftsCapability.tryHandle(
        makeRequest("确认", connId),
      );
      assert.equal(result.handled, true);
      assert.ok(result.reply.includes("已生成待同步 note"));
      assert.ok(result.reply.includes("npm run sync"));
      assert.ok(result.reply.includes("正式时间线"));
      assert.ok(result.reply.includes("Remi 可查询记忆"));
    });
  });

  describe("Service unavailable handled=true", () => {
    it("returns handled=true with error message when service is down", async () => {
      const origUrl = process.env.REMI_FAMILY_MEMORY_SERVICE_URL;
      process.env.REMI_FAMILY_MEMORY_SERVICE_URL = "http://localhost:19999";
      resetConfig();
      try {
        const connId = "test-unavail-drafts-001";
        const result = await familyMemoryDraftsCapability.tryHandle(
          makeRequest("有什么要确认的", connId),
        );
        assert.equal(result.handled, true);
        assert.ok(result.reply.includes("暂不可用"));
      } finally {
        process.env.REMI_FAMILY_MEMORY_SERVICE_URL = origUrl!;
        resetConfig();
      }
    });
  });

  describe("Select pattern with '选择 N'", () => {
    it("recognizes '选择 2' as draft selection", async () => {
      pendingDraftsResponse = {
        drafts: [
          {
            draftId: "d-sel-001",
            inferredDate: "2026-05-10",
            inferredTitle: "照片A",
            originalFilenames: ["a.jpg"],
            attachmentIds: ["att-a"],
            ocrStatus: "no_extractor",
            ocrAttachmentCount: 1,
            ocrExtractedCount: 0,
          },
          {
            draftId: "d-sel-002",
            inferredDate: "2026-05-11",
            inferredTitle: "报告B",
            originalFilenames: ["b.pdf"],
            attachmentIds: ["att-b"],
            ocrStatus: "extracted",
            ocrAttachmentCount: 1,
            ocrExtractedCount: 1,
          },
        ],
      };
      const connId = "test-select-pattern-001";

      await familyMemoryDraftsCapability.tryHandle(
        makeRequest("有什么要确认的", connId),
      );
      const result = await familyMemoryDraftsCapability.tryHandle(
        makeRequest("选择2", connId),
      );
      assert.equal(result.handled, true);
      assert.ok(result.reply.includes("已选择第 2 条"));
      assert.ok(result.reply.includes("PDF 已提取文本"));
    });
  });

  describe("Multi-draft bare confirm is rejected", () => {
    it("refuses bare confirm when multiple drafts are pending", async () => {
      pendingDraftsResponse = {
        drafts: [
          {
            draftId: "d-bare-001",
            inferredDate: "2026-05-10",
            inferredTitle: "A",
            originalFilenames: ["a.jpg"],
            attachmentIds: ["a1"],
          },
          {
            draftId: "d-bare-002",
            inferredDate: "2026-05-11",
            inferredTitle: "B",
            originalFilenames: ["b.jpg"],
            attachmentIds: ["b1"],
          },
        ],
      };
      const connId = "test-bare-confirm-001";

      await familyMemoryDraftsCapability.tryHandle(
        makeRequest("有什么要确认的", connId),
      );
      const result = await familyMemoryDraftsCapability.tryHandle(
        makeRequest("确认", connId),
      );
      assert.equal(result.handled, true);
      assert.ok(result.reply.includes("请先输入编号"));
    });
  });
});
