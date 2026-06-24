/**
 * PR6 integration — runPrediction emits the thinking lifecycle to SpeechRuntime.
 *
 * Stubs computeSessionPrediction (so no LLM is hit) and drives the session's
 * real runPrediction during user speech, asserting the shadow SpeechRuntime
 * observes thinking.start → thinking.done and records the window. Verifies the
 * tap is wired into the real control flow, while changing no behavior.
 */
const assert = require("assert").strict;
const path = require("path");
const { loadSessionHarness, waitFor } = require("../../helpers/session_harness");

// Replace the prediction module export BEFORE the session calls it. ts-node
// compiles `import { computeSessionPrediction }` to a namespace access at call
// time, so swapping the property here is picked up by the session.
const predictionPath = path.resolve(__dirname, "../../../server/session/prediction.ts");

describe("PR6 thinking_while_listening integration", () => {
  it("runPrediction 在用户说话中发出 thinking.start→done，window 被记录", async () => {
    const predictionMod = require(predictionPath);
    const original = predictionMod.computeSessionPrediction;
    predictionMod.computeSessionPrediction = async () => ({
      reply: "我在听，你说。",
      analysis: null,
    });

    const { ws, session, restore } = loadSessionHarness();
    try {
      // Put the shadow runtime into user_speaking (real tap path).
      session.speechRuntime.observeEvent("vad.speech_start", { mode: "strict" });
      assert.equal(session.speechRuntime.getState(), "user_speaking");

      // Enable prediction on this instance and run it for the current partial.
      session.predictionEnabled = true;
      session.currentPartialText = "你今天过得怎么样";
      await session.runPrediction("你今天过得怎么样", { mode: "full" });

      const events = session.speechRuntime.getEvents().map((e) => e.type);
      assert.ok(events.includes("thinking.start"), `events=${events.join(",")}`);
      assert.ok(events.includes("thinking.done"), `events=${events.join(",")}`);

      const snap = session.speechRuntime.snapshot();
      assert.equal(snap.lastThinkingOutcome, "completed");
      assert.equal(typeof snap.lastThinkingWindowMs, "number");
      assert.ok(snap.lastThinkingWindowMs >= 0);

      // Pure shadow: prediction result is still produced; behavior unchanged.
      assert.equal(session.predictedReply, "我在听，你说。");
    } finally {
      predictionMod.computeSessionPrediction = original;
      restore();
    }
  });

  it("预判失败 → 发出 thinking.aborted，outcome=aborted，不抛错", async () => {
    const predictionMod = require(predictionPath);
    const original = predictionMod.computeSessionPrediction;
    predictionMod.computeSessionPrediction = async () => {
      throw new Error("llm down");
    };

    const { session, restore } = loadSessionHarness();
    try {
      session.speechRuntime.observeEvent("vad.speech_start", {});
      session.predictionEnabled = true;
      session.currentPartialText = "嗯我想问一下";
      await assert.doesNotReject(() =>
        session.runPrediction("嗯我想问一下", { mode: "full" }),
      );
      const snap = session.speechRuntime.snapshot();
      assert.equal(snap.lastThinkingOutcome, "aborted");
    } finally {
      predictionMod.computeSessionPrediction = original;
      restore();
    }
  });
});
