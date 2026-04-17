const assert = require("assert").strict;
const {
  loadSessionHarness,
  waitFor,
} = require("../../helpers/session_harness");
const {
  makeBroadbandNoiseFrame,
  makeRaudFrame,
  makeSilenceFrame,
  makeSineFrame,
  makeSparseClickFrame,
  repeatFrames,
} = require("../../helpers/pcm");

function emitDuplexStart(ws, sampleRate = 16_000, mode = "duplex") {
  ws.emitMessage(JSON.stringify({ type: "duplex_start", sampleRate, mode }));
}

function emitDuplexStop(ws) {
  ws.emitMessage(JSON.stringify({ type: "duplex_stop" }));
}

function emitFrames(ws, frames, sampleRate = 16_000) {
  for (const frame of frames) {
    ws.emitMessage(makeRaudFrame(frame, sampleRate));
  }
}

function messageTypes(ws) {
  return ws.parsedMessages().map((msg) => (msg && typeof msg === "object" ? msg.type : null));
}

function messageCount(ws, type) {
  return ws.parsedMessages().filter((msg) => msg && typeof msg === "object" && msg.type === type).length;
}

describe("duplex ws+pcm regression", () => {
  it("does not enter assistant_entering or stt_final on sparse noise input", async () => {
    const { ws, restore } = loadSessionHarness({ transcript: "词曲 李宗盛" });
    try {
      emitDuplexStart(ws);
      emitFrames(ws, repeatFrames(makeSparseClickFrame(), 12));
      emitDuplexStop(ws);

      await new Promise((resolve) => setTimeout(resolve, 80));

      const types = messageTypes(ws);
      assert.equal(types.includes("assistant_entering"), false, `messages=${JSON.stringify(types)}`);
      assert.equal(types.includes("stt_final"), false, `messages=${JSON.stringify(types)}`);
    } finally {
      restore();
    }
  });

  it("does enter assistant_entering and stt_final on speech-like PCM", async () => {
    const { ws, restore } = loadSessionHarness({ transcript: "你好，我在这里。" });
    try {
      emitDuplexStart(ws);
      emitFrames(ws, repeatFrames(makeSineFrame(0.18), 14));
      emitFrames(ws, repeatFrames(makeSilenceFrame(), 8));
      emitDuplexStop(ws);

      await new Promise((resolve) => setTimeout(resolve, 450));

      const messages = ws.parsedMessages();
      const sttFinal = messages.find((msg) => msg && msg.type === "stt_final");
      const assistantEntering = messages.find((msg) => msg && msg.type === "turn_state" && msg.state === "assistant_entering");

      assert.ok(sttFinal, `messages=${JSON.stringify(messages)}`);
      assert.ok(assistantEntering, `messages=${JSON.stringify(messages)}`);
      assert.equal(sttFinal.content, "你好，我在这里。");
    } finally {
      restore();
    }
  });

  it("keeps short real feedback on the main speech_buffer path", async () => {
    const { ws, restore } = loadSessionHarness({ transcript: "谢谢" });
    try {
      emitDuplexStart(ws);
      emitFrames(ws, repeatFrames(makeSineFrame(0.18), 14));
      emitFrames(ws, repeatFrames(makeSilenceFrame(), 8));
      emitDuplexStop(ws);

      await new Promise((resolve) => setTimeout(resolve, 450));

      const messages = ws.parsedMessages();
      const sttFinal = messages.find((msg) => msg && msg.type === "stt_final");
      assert.ok(sttFinal, `messages=${JSON.stringify(messages)}`);
      assert.equal(sttFinal.content, "谢谢");
    } finally {
      restore();
    }
  });

  it("rejects low-value idle noise before it can occupy the stt queue after long duplex idle", async () => {
    const captureLogs = [];
    const { ws, session, restore } = loadSessionHarness({
      transcript: "这句不该出来",
      captureLogs,
    });
    try {
      emitDuplexStart(ws);

      const idleSince = Date.now() - 9_000;
      session.lastMeaningfulSpeechAt = idleSince;
      session.lastAcceptedSpeechAt = idleSince;
      session.lastConfirmedInterruptAt = 0;
      session.duplexRxStartedAt = idleSince;
      session.duplexSampleRate = 16_000;
      session.lastVadStartMode = "strict";
      session.speechBuffer = [Buffer.concat(repeatFrames(makeSineFrame(0.03), 18))];
      session.speechBufferBytes = session.speechBuffer[0].length;
      session.utteranceFrameCount = 18;
      session.utteranceStrongFrames = 0;
      session.utteranceMaxRms = 0.03;
      session.utteranceMaxPeak = 0.04;
      session.lastMeaningfulPartialText = "";
      session.lastPreviewText = "";

      session.vad.emit("speech_end");
      await new Promise((resolve) => setTimeout(resolve, 80));

      const messages = ws.parsedMessages();
      assert.equal(
        messages.some((msg) => msg && msg.type === "stt_final"),
        false,
        `messages=${JSON.stringify(messages)}`,
      );
      assert.equal(
        messages.some((msg) => msg && msg.type === "turn_state" && msg.state === "assistant_entering"),
        false,
        `messages=${JSON.stringify(messages)}`,
      );
      assert.ok(
        captureLogs.some((entry) => entry.message === "[Duplex] idle guard active"),
        `logs=${JSON.stringify(captureLogs)}`,
      );
      assert.ok(
        captureLogs.some((entry) => entry.message === "[Duplex] idle noise rejected before stt"),
        `logs=${JSON.stringify(captureLogs)}`,
      );
    } finally {
      restore();
    }
  });

  it("falls back to stop-time STT when audio arrived but VAD never fired", async () => {
    const { ws, session, restore } = loadSessionHarness({ transcript: "我在按住说话。" });
    try {
      session.vad.feed = () => {};

      emitDuplexStart(ws, 16_000);
      emitFrames(ws, repeatFrames(makeSineFrame(0.065), 14));
      emitDuplexStop(ws);

      await new Promise((resolve) => setTimeout(resolve, 450));

      const messages = ws.parsedMessages();
      const sttFinal = messages.find((msg) => msg && msg.type === "stt_final");
      const assistantEntering = messages.find((msg) => msg && msg.type === "turn_state" && msg.state === "assistant_entering");

      assert.ok(sttFinal, `messages=${JSON.stringify(messages)}`);
      assert.ok(assistantEntering, `messages=${JSON.stringify(messages)}`);
      assert.equal(sttFinal.content, "我在按住说话。");
    } finally {
      restore();
    }
  });

  it("relaxes no-vad fallback for push-to-talk low-energy speech", async () => {
    const { ws, session, restore } = loadSessionHarness({ transcript: "我有在说话。" });
    try {
      session.vad.feed = () => {};

      emitDuplexStart(ws, 16_000, "push_to_talk");
      emitFrames(ws, repeatFrames(makeSineFrame(0.03), 18));
      emitDuplexStop(ws);

      await new Promise((resolve) => setTimeout(resolve, 450));

      const messages = ws.parsedMessages();
      const sttFinal = messages.find((msg) => msg && msg.type === "stt_final");
      const assistantEntering = messages.find((msg) => msg && msg.type === "turn_state" && msg.state === "assistant_entering");

      assert.ok(sttFinal, `messages=${JSON.stringify(messages)}`);
      assert.ok(assistantEntering, `messages=${JSON.stringify(messages)}`);
      assert.equal(sttFinal.content, "我有在说话。");
    } finally {
      restore();
    }
  });

  it("does not force no-vad fallback on silence-only input", async () => {
    const { ws, session, restore } = loadSessionHarness({ transcript: "这句不该出来" });
    try {
      session.vad.feed = () => {};

      emitDuplexStart(ws, 16_000);
      emitFrames(ws, repeatFrames(makeSilenceFrame(), 18));
      emitDuplexStop(ws);

      await new Promise((resolve) => setTimeout(resolve, 120));

      const types = messageTypes(ws);
      assert.equal(types.includes("assistant_entering"), false, `messages=${JSON.stringify(ws.parsedMessages())}`);
      assert.equal(types.includes("stt_final"), false, `messages=${JSON.stringify(ws.parsedMessages())}`);
    } finally {
      restore();
    }
  });

  it("tolerates mixed noise but still does not promote to assistant_entering", async () => {
    const { ws, restore } = loadSessionHarness({ transcript: "词曲 李宗盛" });
    try {
      emitDuplexStart(ws);
      emitFrames(ws, [
        makeBroadbandNoiseFrame(0.14, 320, 7),
        makeSparseClickFrame(0.95, 320, 80),
        makeBroadbandNoiseFrame(0.12, 320, 17),
      ]);
      emitDuplexStop(ws);

      await new Promise((resolve) => setTimeout(resolve, 80));

      const types = messageTypes(ws);
      assert.equal(types.includes("assistant_entering"), false, `messages=${JSON.stringify(types)}`);
      assert.equal(types.includes("stt_final"), false, `messages=${JSON.stringify(types)}`);
    } finally {
      restore();
    }
  });

  it("suppresses long low-energy hum that hallucinates a long transcript", async () => {
    const { ws, restore } = loadSessionHarness({
      transcript: "请不吝点赞 订阅 转发 打赏支持明镜与点点栏目",
    });
    try {
      emitDuplexStart(ws);
      emitFrames(ws, repeatFrames(makeSineFrame(0.03), 140));
      emitDuplexStop(ws);

      await new Promise((resolve) => setTimeout(resolve, 120));

      const types = messageTypes(ws);
      const vadStarts = messageCount(ws, "vad_start");
      assert.equal(types.includes("assistant_entering"), false, `messages=${JSON.stringify(types)}`);
      assert.equal(types.includes("stt_final"), false, `messages=${JSON.stringify(types)}`);
      assert.equal(vadStarts, 0, `expected 0 vad_start, got ${vadStarts}, messages=${JSON.stringify(ws.parsedMessages())}`);
    } finally {
      restore();
    }
  });

  it("does not confirm a duplex interrupt for weak fallback noise without preview", async () => {
    const captureLogs = [];
    const { ws, session, restore } = loadSessionHarness({
      transcript: "谢谢观看!",
      captureLogs,
    });
    try {
      emitDuplexStart(ws);
      session.activeGenerationId = 42;
      session.interrupt.begin();
      session.pendingDuplexInterrupt = true;
      session.lastVadStartMode = "fallback_energy";
      session.duplexSampleRate = 16_000;
      session.speechBufferBytes = Buffer.concat(repeatFrames(makeSineFrame(0.03), 24)).length;
      session.utteranceFrameCount = 24;
      session.utteranceStrongFrames = 0;
      session.utteranceMaxRms = 0.03;
      session.utteranceMaxPeak = 0.05;
      session.lastPreviewText = "";
      session.lastMeaningfulPartialText = "";

      session.vad.emit("speech_end");
      await new Promise((resolve) => setTimeout(resolve, 80));

      const interrupts = ws.parsedMessages().filter((msg) => msg && msg.type === "interrupt");
      assert.equal(interrupts.length, 0, `messages=${JSON.stringify(ws.parsedMessages())}`);
      assert.ok(
        captureLogs.some((entry) => entry.message === "[VAD] weak_noise_interrupt_rejected"),
        `logs=${JSON.stringify(captureLogs)}`,
      );
    } finally {
      restore();
    }
  });

  it("rejects short weak fallback hallucinations before they become user turns", async () => {
    const captureLogs = [];
    const { ws, session, restore } = loadSessionHarness({
      transcript: "谢谢观看!",
      captureLogs,
    });
    try {
      emitDuplexStart(ws);
      session.duplexSampleRate = 16_000;
      session.lastVadStartMode = "fallback_energy";

      const pcm = Buffer.concat(repeatFrames(makeSineFrame(0.03), 42));
      const job = session.createDuplexUtteranceJob({
        utteranceSeq: session.nextUtteranceSeq(),
        source: "speech_buffer",
        pcm,
        durationMs: 840,
        previewText: "",
        vadMode: "fallback_energy",
        usedNoVadFallback: false,
        utteranceFrameCount: 42,
        utteranceStrongFrames: 0,
        utteranceMaxRms: 0.03,
        utteranceMaxPeak: 0.05,
        rawFrameCount: 42,
        rawStrongFrames: 0,
        rawMaxRms: 0.03,
      });
      session.enqueueDuplexSttJob(job);

      await new Promise((resolve) => setTimeout(resolve, 450));

      const messages = ws.parsedMessages();
      assert.equal(
        messages.some((msg) => msg && msg.type === "stt_final"),
        false,
        `messages=${JSON.stringify(messages)}`,
      );
      assert.equal(
        messages.some((msg) => msg && msg.type === "turn_state" && msg.state === "assistant_entering"),
        false,
        `messages=${JSON.stringify(messages)}`,
      );
      assert.ok(
        captureLogs.some((entry) => entry.message === "[STT] reject non-speech transcript"),
        `logs=${JSON.stringify(captureLogs)}`,
      );
    } finally {
      restore();
    }
  });

  it("preempts an in-flight low-value stt job when newer high-value speech arrives", async () => {
    const captureLogs = [];
    let lowStarted = false;
    const { ws, session, restore } = loadSessionHarness({
      captureLogs,
      sttEndPcmImpl: async (_pcm, _sampleRate, options) => {
        if (options?.jobPriority === "low") {
          lowStarted = true;
          return await new Promise((resolve) => {
            options?.signal?.addEventListener(
              "abort",
              () => resolve(""),
              { once: true },
            );
          });
        }
        return "你好，我在这里。";
      },
    });
    try {
      emitDuplexStart(ws);
      session.duplexSampleRate = 16_000;
      session.lastVadStartMode = "fallback_energy";

      const lowPcm = Buffer.concat(repeatFrames(makeSineFrame(0.03), 14));
      const lowJob = session.createDuplexUtteranceJob({
        utteranceSeq: session.nextUtteranceSeq(),
        source: "duplex_stop_no_vad",
        pcm: lowPcm,
        durationMs: 280,
        previewText: "",
        vadMode: "fallback_energy",
        usedNoVadFallback: true,
        utteranceFrameCount: 14,
        utteranceStrongFrames: 0,
        utteranceMaxRms: 0.03,
        utteranceMaxPeak: 0.04,
        rawFrameCount: 14,
        rawStrongFrames: 0,
        rawMaxRms: 0.03,
      });
      session.enqueueDuplexSttJob(lowJob);
      await waitFor(() => lowStarted, 200);

      const highPcm = Buffer.concat(repeatFrames(makeSineFrame(0.18), 36));
      const highJob = session.createDuplexUtteranceJob({
        utteranceSeq: session.nextUtteranceSeq(),
        source: "speech_buffer",
        pcm: highPcm,
        durationMs: 720,
        previewText: "喂喂喂",
        vadMode: "strict",
        usedNoVadFallback: false,
        utteranceFrameCount: 36,
        utteranceStrongFrames: 30,
        utteranceMaxRms: 0.18,
        utteranceMaxPeak: 0.18,
        rawFrameCount: 36,
        rawStrongFrames: 30,
        rawMaxRms: 0.18,
      });
      session.enqueueDuplexSttJob(highJob);

      await new Promise((resolve) => setTimeout(resolve, 180));

      const messages = ws.parsedMessages();
      const sttFinals = messages.filter((msg) => msg && msg.type === "stt_final");
      assert.equal(sttFinals.length, 1, `messages=${JSON.stringify(messages)}`);
      assert.equal(sttFinals[0].content, "你好，我在这里。");
      assert.ok(
        captureLogs.some((entry) => entry.message === "[STT] preempted low-value utterance during transcribe"),
        `logs=${JSON.stringify(captureLogs)}`,
      );
      const highQueueLog = captureLogs.find(
        (entry) =>
          entry.message === "[STT] queue separated" &&
          entry.data?.traceId === highJob.traceId,
      );
      assert.ok(highQueueLog, `logs=${JSON.stringify(captureLogs)}`);
      assert.ok(
        Number(highQueueLog.data?.queueWaitMs ?? Number.POSITIVE_INFINITY) <= 200,
        `logs=${JSON.stringify(captureLogs)}`,
      );
    } finally {
      restore();
    }
  });

  it("does not externalize low-confidence fallback previews while assistant is speaking", async () => {
    const { ws, session, restore } = loadSessionHarness();
    try {
      emitDuplexStart(ws);
      session.turnState = "assistant_speaking";
      session.interrupt.begin();
      session.lastVadStartMode = "fallback_energy";
      session.duplexSampleRate = 16_000;
      Object.defineProperty(session.vad, "speaking", {
        configurable: true,
        get: () => true,
      });
      session.speechBuffer = [Buffer.concat(repeatFrames(makeSineFrame(0.03), 18))];
      session.speechBufferBytes = session.speechBuffer[0].length;
      session.utteranceFrameCount = 18;
      session.utteranceStrongFrames = 0;
      session.utteranceMaxRms = 0.03;
      session.utteranceMaxPeak = 0.05;
      session.stt.canPreviewPcm = () => true;
      session.stt.previewPcmBuffer = async () => "Teddy";

      await session.runSttPreview();

      const messages = ws.parsedMessages();
      assert.equal(
        messages.some((msg) => msg && msg.type === "vad_start"),
        false,
        `messages=${JSON.stringify(messages)}`,
      );
      assert.equal(
        messages.some((msg) => msg && msg.type === "stt_partial"),
        false,
        `messages=${JSON.stringify(messages)}`,
      );
    } finally {
      restore();
    }
  });

  it("does not externalize low-confidence strict previews while assistant is speaking", async () => {
    const { ws, session, restore } = loadSessionHarness();
    try {
      emitDuplexStart(ws);
      session.turnState = "assistant_speaking";
      session.interrupt.begin();
      session.lastVadStartMode = "strict";
      session.duplexSampleRate = 16_000;
      Object.defineProperty(session.vad, "speaking", {
        configurable: true,
        get: () => true,
      });
      session.speechBuffer = [Buffer.concat(repeatFrames(makeSineFrame(0.03), 18))];
      session.speechBufferBytes = session.speechBuffer[0].length;
      session.utteranceFrameCount = 18;
      session.utteranceStrongFrames = 0;
      session.utteranceMaxRms = 0.03;
      session.utteranceMaxPeak = 0.05;
      session.stt.canPreviewPcm = () => true;
      session.stt.previewPcmBuffer = async () => "Teddy";

      await session.runSttPreview();

      const messages = ws.parsedMessages();
      assert.equal(
        messages.some((msg) => msg && msg.type === "vad_start"),
        false,
        `messages=${JSON.stringify(messages)}`,
      );
      assert.equal(
        messages.some((msg) => msg && msg.type === "stt_partial"),
        false,
        `messages=${JSON.stringify(messages)}`,
      );
    } finally {
      restore();
    }
  });

  it("does not confirm a duplex interrupt for short strict noise without preview while assistant is speaking", async () => {
    const captureLogs = [];
    const { ws, session, restore } = loadSessionHarness({
      transcript: "[音乐]",
      captureLogs,
    });
    try {
      emitDuplexStart(ws);
      session.turnState = "assistant_speaking";
      session.activeGenerationId = 42;
      session.interrupt.begin();
      session.pendingDuplexInterrupt = true;
      session.lastVadStartMode = "strict";
      session.duplexSampleRate = 16_000;
      session.speechBufferBytes = Buffer.concat(repeatFrames(makeSineFrame(0.06), 24)).length;
      session.utteranceFrameCount = 24;
      session.utteranceStrongFrames = 8;
      session.utteranceMaxRms = 0.06;
      session.utteranceMaxPeak = 0.08;
      session.lastPreviewText = "";
      session.lastMeaningfulPartialText = "";

      session.vad.emit("speech_end");
      await new Promise((resolve) => setTimeout(resolve, 80));

      const interrupts = ws.parsedMessages().filter((msg) => msg && msg.type === "interrupt");
      assert.equal(interrupts.length, 0, `messages=${JSON.stringify(ws.parsedMessages())}`);
      assert.ok(
        captureLogs.some((entry) => entry.message === "[VAD] weak_noise_interrupt_rejected"),
        `logs=${JSON.stringify(captureLogs)}`,
      );
    } finally {
      restore();
    }
  });

  it("still confirms a strict duplex interrupt when there is strong speech evidence and meaningful preview", async () => {
    const { ws, session, restore } = loadSessionHarness();
    try {
      emitDuplexStart(ws);
      session.turnState = "assistant_speaking";
      session.activeGenerationId = 42;
      session.interrupt.begin();
      session.pendingDuplexInterrupt = true;
      session.lastVadStartMode = "strict";
      session.duplexSampleRate = 16_000;
      session.speechBufferBytes = Buffer.concat(repeatFrames(makeSineFrame(0.18), 36)).length;
      session.utteranceFrameCount = 36;
      session.utteranceStrongFrames = 30;
      session.utteranceMaxRms = 0.18;
      session.utteranceMaxPeak = 0.18;
      session.lastPreviewText = "喂喂喂";
      session.lastMeaningfulPartialText = "喂喂喂";

      session.vad.emit("speech_end");
      await new Promise((resolve) => setTimeout(resolve, 80));

      const interrupts = ws.parsedMessages().filter((msg) => msg && msg.type === "interrupt");
      assert.equal(interrupts.length, 1, `messages=${JSON.stringify(ws.parsedMessages())}`);
    } finally {
      restore();
    }
  });

  it("still sends interrupt while assistant playback is active even if the pipeline run already ended", async () => {
    const { ws, session, restore } = loadSessionHarness();
    try {
      emitDuplexStart(ws);
      ws.emitMessage(JSON.stringify({ type: "playback_start", generationId: 77 }));
      session.turnState = "assistant_speaking";
      session.pendingDuplexInterrupt = true;
      session.lastVadStartMode = "strict";
      session.duplexSampleRate = 16_000;
      session.speechBufferBytes = Buffer.concat(repeatFrames(makeSineFrame(0.18), 36)).length;
      session.utteranceFrameCount = 36;
      session.utteranceStrongFrames = 30;
      session.utteranceMaxRms = 0.18;
      session.utteranceMaxPeak = 0.18;
      session.lastPreviewText = "等一下先别说";
      session.lastMeaningfulPartialText = "等一下先别说";

      session.vad.emit("speech_end");
      await new Promise((resolve) => setTimeout(resolve, 80));

      const interrupts = ws
        .parsedMessages()
        .filter((msg) => msg && msg.type === "interrupt");
      assert.equal(interrupts.length, 1, `messages=${JSON.stringify(ws.parsedMessages())}`);
      assert.equal(interrupts[0].generationId, 77, `messages=${JSON.stringify(ws.parsedMessages())}`);
    } finally {
      restore();
    }
  });

  it("keeps a pending correction commit alive when weak fallback noise restarts during hold", async () => {
    const captureLogs = [];
    const { ws, session, restore, pipelineCalls } = loadSessionHarness({
      transcript: "不是不是，我是说你给我记录一下。",
      captureLogs,
    });
    try {
      emitDuplexStart(ws);

      const pcm = Buffer.concat(repeatFrames(makeSineFrame(0.18), 24));
      session.speechBuffer = [pcm];
      session.speechBufferBytes = pcm.length;
      session.duplexSampleRate = 16_000;
      session.duplexInputMode = "duplex";
      session.lastVadStartMode = "strict";
      session.utteranceSeq = 10;
      session.utteranceFrameCount = 24;
      session.utteranceStrongFrames = 24;
      session.utteranceMaxRms = 0.18;
      session.utteranceMaxPeak = 0.18;
      session.lastPreviewText = "不是不是,我是说你给我记录一下。";
      session.lastMeaningfulPartialText = "不是不是,我是说你给我记录一下。";
      session.lastMeaningfulPartialAt = Date.now() - 40;
      session.lastMeaningfulGrowthAt = Date.now() - 40;
      session.lastMeaningfulGrowthChars = 6;
      session.turnTakingState = "HOLD";

      session.vad.emit("speech_end");
      await new Promise((resolve) => setTimeout(resolve, 60));

      session.vad.emit("speech_start", {
        mode: "fallback_energy",
        energy: 0.022,
        zcr: 0.012,
        crest: 1.8,
        activeRatio: 0.83,
      });
      await new Promise((resolve) => setTimeout(resolve, 40));
      session.vad.emit("speech_end");

      await new Promise((resolve) => setTimeout(resolve, 900));

      const messages = ws.parsedMessages();
      const sttFinal = messages.find((msg) => msg && msg.type === "stt_final");
      assert.ok(sttFinal, `messages=${JSON.stringify(messages)}`);
      assert.equal(sttFinal.content, "不是不是，我是说你给我记录一下。");
      assert.equal(pipelineCalls.length, 1, `pipelineCalls=${JSON.stringify(pipelineCalls)}`);
      assert.ok(
        captureLogs.some((entry) => entry.message === "[VAD] ignore weak fallback restart during pending commit"),
        `logs=${JSON.stringify(captureLogs)}`,
      );
    } finally {
      restore();
    }
  });

  it("suppresses short recovered fallback utterances at duplex_stop when they stay weak", async () => {
    const { ws, restore } = loadSessionHarness({ transcript: "再说一遍。" });
    try {
      emitDuplexStart(ws);
      emitFrames(ws, [
        ...repeatFrames(makeSineFrame(0.03), 12),
        ...repeatFrames(makeSilenceFrame(), 10),
        ...repeatFrames(makeSineFrame(0.03), 12),
        ...repeatFrames(makeSilenceFrame(), 10),
      ]);
      emitDuplexStop(ws);

      await new Promise((resolve) => setTimeout(resolve, 450));

      const types = messageTypes(ws);
      assert.equal(types.includes("assistant_entering"), false, `messages=${JSON.stringify(ws.parsedMessages())}`);
      assert.equal(types.includes("stt_final"), false, `messages=${JSON.stringify(ws.parsedMessages())}`);
    } finally {
      restore();
    }
  });

  it("suppresses recovered fallback politeness hallucinations like 谢谢", async () => {
    const captureLogs = [];
    const { ws, session, restore } = loadSessionHarness({
      transcript: "谢谢!",
      captureLogs,
    });
    try {
      emitDuplexStart(ws);
      session.duplexSampleRate = 16_000;
      session.lastVadStartMode = "fallback_energy";

      const pcm = Buffer.concat(repeatFrames(makeSineFrame(0.03), 17));
      const job = session.createDuplexUtteranceJob({
        utteranceSeq: session.nextUtteranceSeq(),
        source: "duplex_stop_suppressed_fallback",
        pcm,
        durationMs: 1260,
        previewText: "",
        vadMode: "fallback_energy",
        usedNoVadFallback: false,
        utteranceFrameCount: 17,
        utteranceStrongFrames: 1,
        utteranceMaxRms: 0.03,
        utteranceMaxPeak: 0.05,
        rawFrameCount: 17,
        rawStrongFrames: 1,
        rawMaxRms: 0.03,
      });
      session.enqueueDuplexSttJob(job);

      await new Promise((resolve) => setTimeout(resolve, 450));

      const messages = ws.parsedMessages();
      assert.equal(
        messages.some((msg) => msg && msg.type === "stt_final"),
        false,
        `messages=${JSON.stringify(messages)}`,
      );
      assert.equal(
        messages.some((msg) => msg && msg.type === "turn_state" && msg.state === "assistant_entering"),
        false,
        `messages=${JSON.stringify(messages)}`,
      );
      assert.ok(
        captureLogs.some((entry) => entry.message === "[STT] suppress recovered fallback utterance"),
        `logs=${JSON.stringify(captureLogs)}`,
      );
    } finally {
      restore();
    }
  });

  it("recovers a deferred short utterance when the newer utterance is rejected as noise", async () => {
    let transcriptCall = 0;
    const { ws, session, restore, pipelineCalls } = loadSessionHarness({
      sttEndPcmImpl: async () => {
        transcriptCall += 1;
        return transcriptCall === 1 ? "继续讲吧" : "谢谢观看!";
      },
    });
    try {
      emitDuplexStart(ws);
      session.duplexSampleRate = 16_000;

      const strongPcm = Buffer.concat(repeatFrames(makeSineFrame(0.18), 18));
      const firstSeq = session.nextUtteranceSeq();
      const firstJob = session.createDuplexUtteranceJob({
        utteranceSeq: firstSeq,
        source: "speech_buffer",
        pcm: strongPcm,
        durationMs: 720,
        previewText: "",
        vadMode: "strict",
        usedNoVadFallback: false,
        utteranceFrameCount: 18,
        utteranceStrongFrames: 18,
        utteranceMaxRms: 0.18,
        utteranceMaxPeak: 0.18,
        rawFrameCount: 18,
        rawStrongFrames: 18,
        rawMaxRms: 0.18,
      });
      session.enqueueDuplexSttJob(firstJob);

      const secondSeq = session.nextUtteranceSeq();
      const weakPcm = Buffer.concat(repeatFrames(makeSineFrame(0.03), 18));
      const secondJob = session.createDuplexUtteranceJob({
        utteranceSeq: secondSeq,
        source: "speech_buffer",
        pcm: weakPcm,
        durationMs: 720,
        previewText: "",
        vadMode: "fallback_energy",
        usedNoVadFallback: false,
        utteranceFrameCount: 18,
        utteranceStrongFrames: 0,
        utteranceMaxRms: 0.03,
        utteranceMaxPeak: 0.05,
        rawFrameCount: 18,
        rawStrongFrames: 0,
        rawMaxRms: 0.03,
      });
      session.enqueueDuplexSttJob(secondJob);

      await new Promise((resolve) => setTimeout(resolve, 450));

      const messages = ws.parsedMessages();
      const finals = messages.filter((msg) => msg && msg.type === "stt_final");
      assert.equal(finals.length, 1, `messages=${JSON.stringify(messages)}`);
      assert.equal(finals[0].content, "继续讲吧");
      assert.equal(pipelineCalls.length, 1, `pipelineCalls=${JSON.stringify(pipelineCalls)}`);
    } finally {
      restore();
    }
  });

  it("still suppresses recovered fallback utterances when STT hallucinates long text", async () => {
    const { ws, restore } = loadSessionHarness({
      transcript: "请不吝点赞 订阅 转发 打赏支持明镜与点点栏目",
    });
    try {
      emitDuplexStart(ws);
      emitFrames(ws, [
        ...repeatFrames(makeSineFrame(0.03), 12),
        ...repeatFrames(makeSilenceFrame(), 10),
        ...repeatFrames(makeSineFrame(0.03), 12),
        ...repeatFrames(makeSilenceFrame(), 10),
      ]);
      emitDuplexStop(ws);

      await new Promise((resolve) => setTimeout(resolve, 180));

      const types = messageTypes(ws);
      assert.equal(types.includes("assistant_entering"), false, `messages=${JSON.stringify(ws.parsedMessages())}`);
      assert.equal(types.includes("stt_final"), false, `messages=${JSON.stringify(ws.parsedMessages())}`);
    } finally {
      restore();
    }
  });

  it("rejects bracketed non-speech transcripts before they become user turns", async () => {
    const { ws, session, restore } = loadSessionHarness({
      transcript: "[音乐]",
    });
    try {
      emitDuplexStart(ws);
      session.duplexSampleRate = 16_000;
      session.lastVadStartMode = "strict";

      const pcm = Buffer.concat(repeatFrames(makeSineFrame(0.12), 42));
      const job = session.createDuplexUtteranceJob({
        utteranceSeq: session.nextUtteranceSeq(),
        source: "speech_buffer",
        pcm,
        durationMs: 840,
        previewText: "",
        vadMode: "strict",
        usedNoVadFallback: false,
        utteranceFrameCount: 42,
        utteranceStrongFrames: 30,
        utteranceMaxRms: 0.12,
        utteranceMaxPeak: 0.16,
        rawFrameCount: 42,
        rawStrongFrames: 30,
        rawMaxRms: 0.12,
      });
      session.enqueueDuplexSttJob(job);

      await new Promise((resolve) => setTimeout(resolve, 450));

      const types = messageTypes(ws);
      assert.equal(types.includes("assistant_entering"), false, `messages=${JSON.stringify(ws.parsedMessages())}`);
      assert.equal(types.includes("stt_final"), false, `messages=${JSON.stringify(ws.parsedMessages())}`);
    } finally {
      restore();
    }
  });
});
