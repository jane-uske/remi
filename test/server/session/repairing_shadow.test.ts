/**
 * PR7 — repairing state (SHADOW ONLY).
 *
 * A. assessTranscriptConfidence pure low-confidence signal.
 * B. SpeechRuntime repair.requested → repairing state + count (shadow).
 * C. prepareVoicePipelineTurn emits repair.requested on a low-confidence final,
 *    while the normal turn flow is unchanged.
 */
const assert = require("assert").strict;
const {
  assessTranscriptConfidence,
} = require("../../../server/session/voice/repair_signal");
const { SpeechRuntime } = require("../../../server/session/voice/speech_runtime");
const {
  prepareVoicePipelineTurn,
} = require("../../../server/session/voice_submit");

// ─── A. pure signal ────────────────────────────────────────────────────────

describe("assessTranscriptConfidence (PR7)", () => {
  const clean = { changed: false, matchedRuleIds: [] };

  it("正常完整句 + 未纠正 → 高置信", () => {
    const r = assessTranscriptConfidence("我今天想去公园散步", clean);
    assert.equal(r.lowConfidence, false);
    assert.equal(r.reason, null);
  });

  it("disambiguator 纠正过 → 低置信 (disambiguated)", () => {
    const r = assessTranscriptConfidence("我今天想去公园散步", {
      changed: true,
      matchedRuleIds: ["r1"],
    });
    assert.equal(r.lowConfidence, true);
    assert.equal(r.reason, "disambiguated");
  });

  it("空文本 → 低置信 (empty)", () => {
    assert.deepEqual(assessTranscriptConfidence("", clean), {
      lowConfidence: true,
      reason: "empty",
    });
  });

  it("非语音噪声 → 低置信 (non_speech)", () => {
    assert.equal(assessTranscriptConfidence("咳咳", clean).reason, "non_speech");
  });

  it("填充词 → 低置信 (tentative)", () => {
    assert.equal(assessTranscriptConfidence("嗯", clean).reason, "tentative");
  });
});

// ─── B. SpeechRuntime repairing ────────────────────────────────────────────

describe("SpeechRuntime repairing (PR7 shadow)", () => {
  function fresh() {
    const sr = new SpeechRuntime("conn-repair");
    sr.observeDuplexStart();
    return sr;
  }

  it("repair.requested → 进入 repairing + 计数 + 记录 reason", () => {
    const sr = fresh();
    sr.observeEvent("repair.requested", { reason: "disambiguated" });
    assert.equal(sr.getState(), "repairing");
    assert.equal(sr.getRepairRequestedCount(), 1);
    assert.equal(sr.snapshot().lastRepairReason, "disambiguated");
  });

  it("下一个真实 turn-state 事件把 repairing 纠正掉（不卡住）", () => {
    const sr = fresh();
    sr.observeEvent("repair.requested", { reason: "tentative" });
    assert.equal(sr.getState(), "repairing");
    sr.observeTurnState("assistant_entering", "tts_prepare");
    assert.equal(sr.getState(), "responding", "应被真实 turn-state 接管");
  });

  it("多次 repair.requested 累加计数", () => {
    const sr = fresh();
    sr.observeEvent("repair.requested", { reason: "empty" });
    sr.observeEvent("repair.requested", { reason: "non_speech" });
    assert.equal(sr.getRepairRequestedCount(), 2);
    assert.equal(sr.snapshot().lastRepairReason, "non_speech");
  });

  it("observe 永不抛错（无 reason / null data）", () => {
    const sr = fresh();
    assert.doesNotThrow(() => sr.observeEvent("repair.requested", null));
    assert.doesNotThrow(() => sr.observeEvent("repair.requested"));
    assert.equal(sr.getRepairRequestedCount(), 2);
  });

  it("仍是 shadow：mode=shadow", () => {
    assert.equal(fresh().snapshot().mode, "shadow");
  });
});

// ─── C. prepareVoicePipelineTurn integration ───────────────────────────────

describe("prepareVoicePipelineTurn repair emission (PR7 shadow)", () => {
  function mockRuntime() {
    const events = [];
    const sent = [];
    const runtime = {
      sink: {
        readyState: 1,
        send: (m) => {
          try {
            sent.push(typeof m === "string" ? JSON.parse(m) : m);
          } catch {
            sent.push(m);
          }
        },
      },
      connId: "conn-prep",
      brain: {},
      interrupt: {},
      avatar: {},
      sessionId: null,
      ensureDbSession: async () => null,
      currentPartialText: "",
      predictedReply: "",
      predictedStructuredAnalysis: null,
      nextGenerationId: () => 1,
      bindActiveGeneration: () => {},
      touchUserActivity: () => {},
      classifyCarryForward: () => ({ interruptionType: null }),
      publishTurnState: () => {},
      setLastSttFinalAt: () => {},
      cancelPrediction: () => {},
      getResolvedTtsTransport: () => "auto",
      observeSpeechEvent: (type, data) => events.push({ type, data }),
    };
    return { runtime, events, sent };
  }

  it("低置信 final（填充词）→ 发 repair.requested，且正常流程仍跑（发 stt_final）", () => {
    const { runtime, events, sent } = mockRuntime();
    const prepared = prepareVoicePipelineTurn(runtime, { text: "嗯", traceId: "t1" });
    // shadow event emitted
    const repair = events.find((e) => e.type === "repair.requested");
    assert.ok(repair, `events=${JSON.stringify(events)}`);
    assert.equal(repair.data.reason, "tentative");
    // behavior unchanged: final still sent + prepared turn returned
    assert.ok(sent.some((m) => m && m.type === "stt_final"));
    assert.equal(prepared.finalText, "嗯");
  });

  it("高置信 final → 不发 repair.requested（行为不变）", () => {
    const { runtime, events, sent } = mockRuntime();
    const prepared = prepareVoicePipelineTurn(runtime, {
      text: "我们明天下午三点开会",
      traceId: "t2",
    });
    assert.ok(!events.some((e) => e.type === "repair.requested"), "高置信不应触发");
    assert.ok(sent.some((m) => m && m.type === "stt_final"));
    assert.equal(prepared.finalText, "我们明天下午三点开会");
  });
});
