const assert = require("assert").strict;
const { EventEmitter } = require("events");

const {
  createRealtimeSttRuntime,
  readRealtimeSttConfig,
} = require("../../voice/stt_realtime_runtime");

class FakeRealtimeSocket extends EventEmitter {
  sent = [];
  closed = [];
  socket = new EventEmitter();

  constructor() {
    super();
    this.socket.readyState = 0;
  }

  send(event) {
    this.sent.push(event);
  }

  close(props) {
    this.closed.push(props ?? null);
    this.socket.readyState = 3;
  }

  open() {
    this.socket.readyState = 1;
    this.socket.emit("open");
  }

  fail(err) {
    this.emit("error", err);
  }

  emitServer(event) {
    this.emit("event", event);
    this.emit(event.type, event);
  }
}

describe("stt realtime runtime", () => {
  it("parses config for the realtime transcription provider", () => {
    const config = readRealtimeSttConfig({
      stt_provider: "openai-realtime",
      stt_key: "sk-test",
      stt_base_url: "https://api.openai.com/v1",
      stt_model: "gpt-4o-mini-transcribe",
      stt_language: "zh",
      stt_prompt: "expect remi-related words",
      REMI_STREAMING_STT_ENABLED: "1",
      STT_REALTIME_VAD_THRESHOLD: "0.63",
      STT_REALTIME_VAD_PREFIX_PADDING_MS: "420",
      STT_REALTIME_VAD_SILENCE_MS: "360",
      STT_REALTIME_NOISE_REDUCTION: "far_field",
    });

    assert.deepEqual(config, {
      enabled: true,
      provider: "openai-realtime",
      apiKey: "sk-test",
      baseURL: "https://api.openai.com/v1",
      model: "gpt-4o-mini-transcribe",
      language: "zh",
      prompt: "expect remi-related words",
      inputSampleRate: 24_000,
      vadThreshold: 0.63,
      vadPrefixPaddingMs: 420,
      vadSilenceDurationMs: 360,
      noiseReduction: "far_field",
    });
  });

  it("configures the transcription session and flushes queued pcm after websocket open", async () => {
    const fakeSocket = new FakeRealtimeSocket();
    const runtime = createRealtimeSttRuntime({
      env: {
        stt_provider: "openai-realtime",
        stt_key: "sk-test",
        stt_base_url: "https://api.openai.com/v1",
        stt_model: "gpt-4o-mini-transcribe",
        stt_language: "zh",
        stt_prompt: "expect remi-related words",
        REMI_STREAMING_STT_ENABLED: "1",
        STT_REALTIME_NOISE_REDUCTION: "near_field",
      },
      connect: async () => fakeSocket,
    });

    const session = await runtime.createSession({
      onPartial: () => {},
      onFinal: () => {},
      onError: () => {},
    });

    const pcm16k = Buffer.alloc(1600, 0x34);
    session.appendPcm(pcm16k, 16_000);
    assert.equal(fakeSocket.sent.length, 0);

    fakeSocket.open();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(fakeSocket.sent.length, 2);
    assert.deepEqual(fakeSocket.sent[0], {
      type: "transcription_session.update",
      session: {
        input_audio_format: "pcm16",
        input_audio_noise_reduction: { type: "near_field" },
        input_audio_transcription: {
          model: "gpt-4o-mini-transcribe",
          language: "zh",
          prompt: "expect remi-related words",
        },
        turn_detection: {
          type: "server_vad",
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 500,
        },
      },
    });
    assert.equal(fakeSocket.sent[1].type, "input_audio_buffer.append");
    const appended = Buffer.from(fakeSocket.sent[1].audio, "base64");
    assert.ok(appended.length > pcm16k.length, `appended=${appended.length} input=${pcm16k.length}`);
    assert.equal(appended.length % 2, 0);

    await session.close();
    assert.equal(fakeSocket.closed.length, 1);
  });

  it("aggregates delta events and emits the completed transcript per item", async () => {
    const fakeSocket = new FakeRealtimeSocket();
    const partials = [];
    const finals = [];
    const runtime = createRealtimeSttRuntime({
      env: {
        stt_provider: "openai-realtime",
        stt_key: "sk-test",
        REMI_STREAMING_STT_ENABLED: "1",
      },
      connect: async () => fakeSocket,
    });

    await runtime.createSession({
      onPartial: (event) => partials.push(event),
      onFinal: (event) => finals.push(event),
      onError: () => {},
    });
    fakeSocket.open();
    await new Promise((resolve) => setImmediate(resolve));

    fakeSocket.emitServer({
      type: "conversation.item.input_audio_transcription.delta",
      event_id: "evt_1",
      item_id: "item_1",
      content_index: 0,
      delta: "你好",
    });
    fakeSocket.emitServer({
      type: "conversation.item.input_audio_transcription.delta",
      event_id: "evt_2",
      item_id: "item_1",
      content_index: 0,
      delta: "Remi",
    });
    fakeSocket.emitServer({
      type: "conversation.item.input_audio_transcription.completed",
      event_id: "evt_3",
      item_id: "item_1",
      content_index: 0,
      transcript: "你好 Remi",
      usage: { type: "duration", seconds: 0.8 },
    });

    assert.deepEqual(
      partials.map((entry) => entry.content),
      ["你好", "你好Remi"],
    );
    assert.equal(partials[1].itemId, "item_1");
    assert.equal(partials[1].stability, "interim");
    assert.deepEqual(
      finals.map((entry) => entry.content),
      ["你好 Remi"],
    );
    assert.equal(finals[0].itemId, "item_1");
    assert.equal(finals[0].stability, "final");
  });
});
