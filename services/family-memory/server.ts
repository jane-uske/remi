import http from "node:http";

const PORT = Number(process.env.FAMILY_MEMORY_PORT ?? 3456);

// ── Test Facts Database ─────────────────────────────────────────────
interface Fact {
  id: string;
  category: string;
  keywords: string[];
  content: string;
  recordedAt: string;
  source: string;
}

const facts: Fact[] = [
  {
    id: "fact-001",
    category: "pregnancy",
    keywords: ["胎动", "第一次胎动", "胎动时间"],
    content: "宝宝第一次胎动发生在孕18周+3天（2026-01-15），妈妈描述为'像小鱼吐泡泡一样的感觉'。",
    recordedAt: "2026-01-15T20:30:00",
    source: "妈妈口述记录",
  },
  {
    id: "fact-002",
    category: "pregnancy",
    keywords: ["孕检", "产检", "最近孕检", "最近一次孕检"],
    content: "最近一次孕检是2026-05-10，孕32周常规检查。B超显示胎儿发育正常，双顶径8.1cm，股骨长6.2cm，羊水指数正常。医生建议继续补充铁剂。",
    recordedAt: "2026-05-10T14:00:00",
    source: "产检报告",
  },
  {
    id: "fact-003",
    category: "health",
    keywords: ["身体", "身体状态", "健康", "身体怎么样"],
    content: "2026-05-16 记录：宝宝胎动活跃，每小时约4-5次。妈妈反馈偶有腰酸，睡眠质量一般。",
    recordedAt: "2026-05-16T09:00:00",
    source: "日常记录",
  },
];

// ── Intent Classification ───────────────────────────────────────────
interface QueryResult {
  handled: boolean;
  answerable: "yes" | "no" | "partial_evidence";
  reason: string;
  answer: string;
  sources: Fact[];
  resultSource: "deterministic" | "cloud" | "deterministic_fallback";
}

function classifyAndAnswer(message: string): QueryResult {
  const normalized = message.toLowerCase().replace(/[？?！!。，,\s]+/g, "");

  // Check if it's a family/baby related question
  if (!isFamilyQuestion(normalized)) {
    return {
      handled: false,
      answerable: "no",
      reason: "not_family_domain",
      answer: "",
      sources: [],
      resultSource: "deterministic",
    };
  }

  // Find matching facts
  const matched = facts.filter((fact) =>
    fact.keywords.some((kw) => normalized.includes(kw.replace(/\s/g, "")))
  );

  if (matched.length > 0) {
    // Check if we have definitive answer
    const isPartial = normalized.includes("身体状态") || normalized.includes("身体怎么样");
    if (isPartial) {
      return {
        handled: true,
        answerable: "partial_evidence",
        reason: "only_partial_records_available",
        answer: `根据记录：${matched[0].content} 但这只是部分记录，不能代表整体状况。`,
        sources: matched,
        resultSource: "deterministic",
      };
    }
    return {
      handled: true,
      answerable: "yes",
      reason: "fact_matched",
      answer: matched[0].content,
      sources: matched,
      resultSource: "deterministic",
    };
  }

  // Family question but no data — refuse to fabricate
  return {
    handled: true,
    answerable: "no",
    reason: "no_record_found",
    answer: "目前没有相关记录，我不能凭空编造信息。如果你记得的话可以告诉我，我帮你记下来。",
    sources: [],
    resultSource: "deterministic",
  };
}

function isFamilyQuestion(normalized: string): boolean {
  const familyKeywords = [
    "宝宝", "胎动", "孕检", "产检", "胎儿",
    "第一次说话", "说话", "喜欢什么颜色", "颜色",
    "身体状态", "身体怎么样", "健康",
    "第一次走路", "辅食", "奶粉",
  ];
  return familyKeywords.some((kw) => normalized.includes(kw));
}

// ── HTTP Server ─────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");

  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200);
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  if (req.method === "POST" && req.url === "/query") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const message = body.message?.trim();

    if (!message) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: "message is required" }));
      return;
    }

    const result = classifyAndAnswer(message);
    res.writeHead(200);
    res.end(JSON.stringify(result));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, () => {
  console.log(`[family-memory] Service running on http://127.0.0.1:${PORT}`);
});
