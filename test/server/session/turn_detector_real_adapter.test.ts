/**
 * PR5b — real (async) turn-detector adapter + shadow wiring.
 *
 * Uses a REAL local http server as a mock sidecar (deterministic, no ML weights
 * needed) to exercise the full HTTP path of LiveKitTurnDetectorAdapter:
 *   - availability probe + caching
 *   - turn-end probability → state mapping (threshold honored)
 *   - barge-in decision mapping
 *   - timeout → null (unavailable) → legacy fallback
 *   - malformed/500 responses → null, never throws
 *   - ShadowTurnDetector: primary returns legacy synchronously; the real async
 *     provider is fire-and-forget and never changes the returned result.
 */
const assert = require("assert").strict;
const http = require("http");
const { resetConfig } = require("../../../server/config");
const {
  LegacyVadTurnDetector,
  SmartTurnStub,
  ShadowTurnDetector,
  LiveKitTurnDetectorAdapter,
} = require("../../../server/session/voice/turn_detector");

/** Async-safe env override: keeps env active across awaits (unlike the sync
 * withConfigEnv, which restores before an async body resolves). */
async function withConfigEnvAsync(overrides, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(overrides)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetConfig();
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    resetConfig();
  }
}

// ─── mock sidecar ────────────────────────────────────────────────────────

function startMockSidecar(handlers) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const handler = handlers[req.url] || handlers["*"];
        if (!handler) {
          res.writeHead(404);
          res.end();
          return;
        }
        handler(req, res, body ? JSON.parse(body) : {});
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, endpoint: `http://127.0.0.1:${port}` });
    });
  });
}

function ok(res, obj) {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
}

function makeTurnInput(overrides = {}) {
  return {
    baseGapMs: 300,
    previewText: "我今天有点累",
    nowMs: 10_000,
    lastPartialUpdateAt: 9_000,
    lastGrowthAt: 9_000,
    hesitationHoldMs: 600,
    growthHoldMs: 500,
    likelyStableMs: 480,
    confirmedStableMs: 800,
    releaseMs: 120,
    minGapMs: 80,
    ...overrides,
  };
}

function makeBargeInInput(overrides = {}) {
  return {
    assistantActive: true,
    speechDurationMs: 350,
    minSpeechMs: 320,
    hasReliableEvidence: true,
    hasPartial: true,
    partialText: "等一下",
    ...overrides,
  };
}

// ─── adapter tests ─────────────────────────────────────────────────────────

describe("LiveKitTurnDetectorAdapter (PR5b)", () => {
  it("health ok → isAvailable() true（并缓存）", async () => {
    let healthHits = 0;
    const { server, endpoint } = await startMockSidecar({
      "/health": (_q, res) => { healthHits++; ok(res, { ok: true, model: "mock-zh" }); },
    });
    try {
      const a = new LiveKitTurnDetectorAdapter(endpoint);
      assert.equal(await a.isAvailable(), true);
      assert.equal(await a.isAvailable(), true); // cached within TTL
      assert.equal(healthHits, 1, "TTL 内只探活一次");
    } finally {
      server.close();
    }
  });

  it("sidecar 不可达 → isAvailable() false，evaluateTurnEndAsync → null", async () => {
    // Point at a closed port (nothing listening)
    const a = new LiveKitTurnDetectorAdapter("http://127.0.0.1:1");
    assert.equal(await a.isAvailable(), false);
    assert.equal(await a.evaluateTurnEndAsync(makeTurnInput()), null);
  });

  it("turn-end eou=0.9 → CONFIRMED_END，latencyMs ≥ 0", async () => {
    const { server, endpoint } = await startMockSidecar({
      "/health": (_q, res) => ok(res, { ok: true }),
      "/turn-end": (_q, res) => ok(res, { eou_probability: 0.9 }),
    });
    try {
      await withConfigEnvAsync({ REMI_TURN_DETECTOR_EOU_THRESHOLD: "0.5" }, async () => {
        const a = new LiveKitTurnDetectorAdapter(endpoint);
        const r = await a.evaluateTurnEndAsync(makeTurnInput());
        assert.ok(r, "应有结果");
        assert.equal(r.state, "CONFIRMED_END");
        assert.equal(r.endOfTurnProb, 0.9);
        assert.equal(r.source, "livekit_v1mini");
        assert.ok(typeof r.latencyMs === "number" && r.latencyMs >= 0);
      });
    } finally {
      server.close();
    }
  });

  it("turn-end eou=0.1 → HOLD；eou=0.4（≥0.5*0.7）→ LIKELY_END", async () => {
    let prob = 0.1;
    const { server, endpoint } = await startMockSidecar({
      "/health": (_q, res) => ok(res, { ok: true }),
      "/turn-end": (_q, res) => ok(res, { eou_probability: prob }),
    });
    try {
      await withConfigEnvAsync({ REMI_TURN_DETECTOR_EOU_THRESHOLD: "0.5" }, async () => {
        const a = new LiveKitTurnDetectorAdapter(endpoint);
        prob = 0.1;
        assert.equal((await a.evaluateTurnEndAsync(makeTurnInput())).state, "HOLD");
        prob = 0.4; // ≥ 0.35 (=0.5*0.7) and < 0.5 → LIKELY_END
        assert.equal((await a.evaluateTurnEndAsync(makeTurnInput())).state, "LIKELY_END");
      });
    } finally {
      server.close();
    }
  });

  it("阈值可配：threshold=0.8 时 eou=0.7 → 不是 CONFIRMED_END", async () => {
    const { server, endpoint } = await startMockSidecar({
      "/health": (_q, res) => ok(res, { ok: true }),
      "/turn-end": (_q, res) => ok(res, { eou_probability: 0.7 }),
    });
    try {
      await withConfigEnvAsync({ REMI_TURN_DETECTOR_EOU_THRESHOLD: "0.8" }, async () => {
        const a = new LiveKitTurnDetectorAdapter(endpoint);
        const r = await a.evaluateTurnEndAsync(makeTurnInput());
        assert.notEqual(r.state, "CONFIRMED_END");
      });
    } finally {
      server.close();
    }
  });

  it("超时 → null（标记 unavailable，不抛错）", async () => {
    const { server, endpoint } = await startMockSidecar({
      "/health": (_q, res) => ok(res, { ok: true }),
      "/turn-end": (_q, res) => { /* never responds → timeout */ },
    });
    try {
      await withConfigEnvAsync({ REMI_TURN_DETECTOR_TIMEOUT_MS: "60" }, async () => {
        const a = new LiveKitTurnDetectorAdapter(endpoint);
        const r = await a.evaluateTurnEndAsync(makeTurnInput());
        assert.equal(r, null);
      });
    } finally {
      server.close();
    }
  });

  it("barge-in: is_barge_in=true conf=0.8 → confirmed；conf=0.5 → candidate；false → none", async () => {
    let resp = { is_barge_in: true, confidence: 0.8 };
    const { server, endpoint } = await startMockSidecar({
      "/health": (_q, res) => ok(res, { ok: true }),
      "/barge-in": (_q, res) => ok(res, resp),
    });
    try {
      const a = new LiveKitTurnDetectorAdapter(endpoint);
      resp = { is_barge_in: true, confidence: 0.8 };
      assert.equal((await a.evaluateBargeInAsync(makeBargeInInput())).decision, "confirmed");
      resp = { is_barge_in: true, confidence: 0.5 };
      assert.equal((await a.evaluateBargeInAsync(makeBargeInInput())).decision, "candidate");
      resp = { is_barge_in: false, confidence: 0.9 };
      assert.equal((await a.evaluateBargeInAsync(makeBargeInInput())).decision, "none");
    } finally {
      server.close();
    }
  });

  it("500 / 畸形 JSON → null，从不抛错", async () => {
    const { server, endpoint } = await startMockSidecar({
      "/health": (_q, res) => ok(res, { ok: true }),
      "/turn-end": (_q, res) => { res.writeHead(500); res.end("boom"); },
      "/barge-in": (_q, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end("{not json"); },
    });
    try {
      const a = new LiveKitTurnDetectorAdapter(endpoint);
      let r1, r2;
      await assert.doesNotReject(async () => { r1 = await a.evaluateTurnEndAsync(makeTurnInput()); });
      assert.equal(r1, null);
      // re-probe available again after the 500 marked it unavailable
      await a.isAvailable();
      await assert.doesNotReject(async () => { r2 = await a.evaluateBargeInAsync(makeBargeInInput()); });
      assert.equal(r2, null);
    } finally {
      server.close();
    }
  });
});

// ─── ShadowTurnDetector async wiring ───────────────────────────────────────

describe("ShadowTurnDetector + async real provider (PR5b)", () => {
  function fakeAsyncProvider(calls) {
    return {
      id: "livekit_v1mini",
      async isAvailable() { return true; },
      async evaluateTurnEndAsync(input) {
        calls.turnEnd.push(input);
        return { state: "CONFIRMED_END", endOfTurnProb: 0.95, source: "livekit_v1mini", latencyMs: 12 };
      },
      async evaluateBargeInAsync(input) {
        calls.bargeIn.push(input);
        return { decision: "confirmed", source: "livekit_v1mini", latencyMs: 8 };
      },
    };
  }

  it("primary 同步返回 legacy；real provider 被 fire-and-forget 调用", async () => {
    const calls = { turnEnd: [], bargeIn: [] };
    const legacy = new LegacyVadTurnDetector();
    const shadow = new ShadowTurnDetector(legacy, new SmartTurnStub(), "conn-real-1", fakeAsyncProvider(calls));

    const input = makeTurnInput();
    const legacyExpected = legacy.evaluateTurnEnd(input);
    const result = shadow.evaluateTurnEnd(input);

    // Returned synchronously and equals legacy
    assert.equal(result.state, legacyExpected.state);
    // Async provider invoked (fire-and-forget) — let microtasks flush
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(calls.turnEnd.length, 1, "real turn-end 被调用一次");
  });

  it("real provider 不可用（返回 null）→ 不改变 primary，不抛错", async () => {
    const legacy = new LegacyVadTurnDetector();
    const unavailable = {
      id: "livekit_v1mini",
      async isAvailable() { return false; },
      async evaluateTurnEndAsync() { return null; },
      async evaluateBargeInAsync() { return null; },
    };
    const shadow = new ShadowTurnDetector(legacy, new SmartTurnStub(), "conn-real-2", unavailable);

    const input = makeTurnInput();
    const expected = legacy.evaluateTurnEnd(input);
    let result;
    assert.doesNotThrow(() => { result = shadow.evaluateTurnEnd(input); });
    assert.equal(result.state, expected.state);
    await new Promise((r) => setTimeout(r, 10));
  });

  it("real provider 抛错也不影响 primary（fire-and-forget 吞掉）", async () => {
    const legacy = new LegacyVadTurnDetector();
    const throwing = {
      id: "livekit_v1mini",
      async isAvailable() { return true; },
      async evaluateTurnEndAsync() { throw new Error("real exploded"); },
      async evaluateBargeInAsync() { throw new Error("real exploded"); },
    };
    const shadow = new ShadowTurnDetector(legacy, new SmartTurnStub(), "conn-real-3", throwing);

    const input = makeBargeInInput();
    const expected = legacy.evaluateBargeIn(input);
    let result;
    assert.doesNotThrow(() => { result = shadow.evaluateBargeIn(input); });
    assert.equal(result.decision, expected.decision);
    await new Promise((r) => setTimeout(r, 10));
  });

  it("无 asyncShadow 时行为与 PR5a 完全一致", () => {
    const legacy = new LegacyVadTurnDetector();
    const shadow = new ShadowTurnDetector(legacy, new SmartTurnStub(), "conn-real-4");
    const input = makeTurnInput();
    assert.equal(shadow.evaluateTurnEnd(input).state, legacy.evaluateTurnEnd(input).state);
  });
});
