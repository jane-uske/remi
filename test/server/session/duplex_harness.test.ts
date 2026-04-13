const assert = require("assert").strict;
const { spawnSync } = require("child_process");
const path = require("path");

describe("duplex harness", () => {
  it("runs the PCM duplex regression harness in an isolated process", function () {
    this.timeout(8000);
    const script = path.join(__dirname, "duplex_harness.ts");
    const tsNodeRegister = require.resolve("ts-node/register/transpile-only");
    const result = spawnSync(
      process.execPath,
      ["-r", tsNodeRegister, script],
      {
        cwd: path.join(__dirname, "../../.."),
        encoding: "utf8",
        env: {
          ...process.env,
          NODE_ENV: "test",
          LOG_LEVEL: "silent",
          stt_preview_enabled: "0",
          STT_PREVIEW_ENABLED: "0",
          STT_PARTIAL_PREDICTION_ENABLED: "0",
          STT_PREDICTION_PUSH_ENABLED: "0",
          VOICE_BACKCHANNEL_ENABLED: "0",
          REMI_THINKING_FILLER: "0",
          rem_thinking_filler: "0",
          whisper_use_server: "0",
          WHISPER_USE_SERVER: "0",
        },
      },
    );

    if (result.status !== 0) {
      throw new Error(
        [
          "duplex harness failed",
          `stdout:\n${result.stdout || ""}`,
          `stderr:\n${result.stderr || ""}`,
        ].join("\n\n"),
      );
    }

    const markerLine = result.stdout
      .split(/\r?\n/)
      .reverse()
      .find((line) => line.startsWith("HARNESS_RESULT "));
    if (!markerLine) {
      throw new Error(`Missing HARNESS_RESULT marker.\nstdout:\n${result.stdout || ""}\nstderr:\n${result.stderr || ""}`);
    }
    const parsed = JSON.parse(markerLine.slice("HARNESS_RESULT ".length));
    assert.equal(parsed.ok, true);
    assert.deepEqual(Object.keys(parsed).sort(), [
      "fallbackLongHumNoise",
      "humanSpeech",
      "ok",
      "sparseClickNoise",
      "speechResumeBeforeGapCommit",
      "speechWithShortInternalSilence",
      "strictNoPreviewNoise",
    ]);
    assert.equal(parsed.sparseClickNoise.name, "sparseClickNoise");
    assert.equal(parsed.strictNoPreviewNoise.name, "strictNoPreviewNoise");
    assert.equal(parsed.fallbackLongHumNoise.name, "fallbackLongHumNoise");
    assert.equal(parsed.humanSpeech.name, "humanSpeech");
    assert.equal(parsed.speechWithShortInternalSilence.name, "speechWithShortInternalSilence");
    assert.equal(parsed.speechResumeBeforeGapCommit.name, "speechResumeBeforeGapCommit");
    assert.ok(parsed.humanSpeech.messageTypes.includes("stt_final"));
    assert.ok(parsed.humanSpeech.turnStates.includes("assistant_entering"));
    assert.ok(parsed.speechWithShortInternalSilence.messageTypes.includes("stt_final"));
    assert.ok(parsed.speechResumeBeforeGapCommit.messageTypes.includes("stt_final"));
  });
});
