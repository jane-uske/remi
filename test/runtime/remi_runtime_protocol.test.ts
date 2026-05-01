const assert = require("assert").strict;

const {
  REMI_WS_CLOSED,
  REMI_WS_OPEN,
  RemiRuntimeClient,
  RemiRuntimeShadow,
  createInitialRemiRuntimeState,
  normalizeRemiClientCapabilities,
  reduceRemiRuntimeEvent,
  selectRemiAvatarRuntimeModel,
  translateRemiServerMessageToRuntimeEvent,
  toClientContextPayload,
} = require("../../runtime");

describe("Remi runtime protocol", () => {
  it("normalizes sparse client capabilities without assuming every surface can render Remi", () => {
    const capabilities = normalizeRemiClientCapabilities({
      surface: "watch",
      textInput: true,
      audioOutput: true,
      notifications: true,
    });

    assert.deepEqual(capabilities, {
      surface: "watch",
      textInput: true,
      audioInput: false,
      audioOutput: true,
      streamingAudio: false,
      avatar2d: false,
      avatar3d: false,
      lipSync: false,
      worldEvents: false,
      backgroundPresence: false,
      notifications: true,
    });
  });

  it("builds a client_context payload with a stable capability block", () => {
    const payload = toClientContextPayload({
      surface: "world",
      timeZone: "Asia/Shanghai",
      locale: "zh-CN",
      capabilities: {
        textInput: true,
        audioOutput: true,
        avatar3d: true,
        lipSync: true,
        worldEvents: true,
      },
    });

    assert.deepEqual(payload, {
      type: "client_context",
      surface: "world",
      timeZone: "Asia/Shanghai",
      locale: "zh-CN",
      ttsTransport: "pcm_stream_v1",
      capabilities: {
        surface: "world",
        textInput: true,
        audioInput: false,
        audioOutput: true,
        streamingAudio: false,
        avatar2d: false,
        avatar3d: true,
        lipSync: true,
        worldEvents: true,
        backgroundPresence: false,
        notifications: false,
      },
    });
  });

  it("reduces Remi server events into a platform-neutral runtime state", () => {
    let state = createInitialRemiRuntimeState();

    state = reduceRemiRuntimeEvent(state, {
      type: "connection",
      state: "open",
    });
    state = reduceRemiRuntimeEvent(state, {
      type: "turn_state",
      state: "assistant_entering",
      reason: "tts_prepare",
      generationId: 7,
    });
    state = reduceRemiRuntimeEvent(state, {
      type: "text_delta",
      text: "我在",
      generationId: 7,
    });
    state = reduceRemiRuntimeEvent(state, {
      type: "emotion",
      emotion: "curious",
    });

    assert.equal(state.connection, "open");
    assert.equal(state.phase, "speaking");
    assert.equal(state.phaseReason, "assistant_audio_prepare");
    assert.equal(state.turn.serverState, "assistant_entering");
    assert.equal(state.turn.generationId, 7);
    assert.equal(state.assistant.streamingText, "我在");
    assert.equal(state.affect.emotion, "curious");
  });

  it("moves the shared avatar phase from connecting to idle-ready when the socket opens", () => {
    let state = createInitialRemiRuntimeState();

    state = reduceRemiRuntimeEvent(state, {
      type: "connection",
      state: "connecting",
    });
    assert.deepEqual(selectRemiAvatarRuntimeModel(state), {
      phase: "idle",
      phaseReason: "connecting",
      turnState: null,
      turnReason: null,
      emotion: "neutral",
      avatarIntent: null,
      avatarFrame: null,
      lipSync: {
        generationId: null,
        cues: [],
        complete: false,
        source: null,
      },
    });

    state = reduceRemiRuntimeEvent(state, {
      type: "connection",
      state: "open",
    });

    const model = selectRemiAvatarRuntimeModel(state);
    assert.equal(model.phase, "idle");
    assert.equal(model.phaseReason, "idle_ready");
  });

  it("keeps world events as observations, not memory writes", () => {
    const state = reduceRemiRuntimeEvent(createInitialRemiRuntimeState(), {
      type: "world_event_ack",
      eventId: "player_placed_object:lamp:front-garden:1",
      accepted: true,
      usedInCurrentTurn: true,
      memoryWrite: "none",
    });

    assert.deepEqual(state.world.lastEventAck, {
      eventId: "player_placed_object:lamp:front-garden:1",
      accepted: true,
      usedInCurrentTurn: true,
      memoryWrite: "none",
    });
  });

  it("translates WebSocket text events into runtime text events", () => {
    assert.deepEqual(
      translateRemiServerMessageToRuntimeEvent({
        type: "chat_chunk",
        content: "我在",
        generationId: "7",
      }),
      {
        type: "text_delta",
        text: "我在",
        generationId: 7,
      },
    );

    assert.deepEqual(
      translateRemiServerMessageToRuntimeEvent({
        type: "chat_end",
        content: "我在这里",
        generationId: 7,
      }),
      {
        type: "text_final",
        text: "我在这里",
        generationId: 7,
      },
    );
  });

  it("translates WebSocket audio and lip-sync events without throwing on malformed ids", () => {
    assert.deepEqual(
      translateRemiServerMessageToRuntimeEvent({
        type: "voice",
        audio: "base64-audio",
        generationId: 8,
      }),
      {
        type: "audio_chunk",
        audio: "base64-audio",
        sampleRate: 24000,
        generationId: 8,
      },
    );

    assert.deepEqual(
      translateRemiServerMessageToRuntimeEvent({
        type: "voice_pcm_chunk",
        audio: "pcm",
        sampleRate: 16000,
        generationId: "9",
      }),
      {
        type: "audio_chunk",
        audio: "pcm",
        sampleRate: 16000,
        generationId: 9,
      },
    );

    assert.deepEqual(
      translateRemiServerMessageToRuntimeEvent({
        type: "tts_lip_sync",
        cues: [{ startMs: 0, endMs: 120, value: "aa" }],
        complete: true,
        generationId: 9,
      }),
      {
        type: "lip_sync",
        cues: [{ startMs: 0, endMs: 120, value: "aa" }],
        complete: true,
        generationId: 9,
        mode: "replace",
        source: "provider_word_boundary_derived",
      },
    );

    assert.equal(
      translateRemiServerMessageToRuntimeEvent({
        type: "voice_pcm_chunk",
        audio: "pcm",
        generationId: "bad-id",
      }),
      null,
    );
  });

  it("normalizes runtime-safe state and avatar events from WebSocket payloads", () => {
    assert.deepEqual(
      translateRemiServerMessageToRuntimeEvent({
        type: "turn_state",
        state: "assistant_entering",
        reason: "tts_prepare",
        preview: "马上说",
        generationId: "10",
      }),
      {
        type: "turn_state",
        state: "assistant_entering",
        reason: "tts_prepare",
        preview: "马上说",
        generationId: 10,
      },
    );

    assert.deepEqual(
      translateRemiServerMessageToRuntimeEvent({
        type: "emotion",
        emotion: "curious",
      }),
      {
        type: "emotion",
        emotion: "curious",
      },
    );

    assert.deepEqual(
      translateRemiServerMessageToRuntimeEvent({
        type: "avatar_frame",
        frame: { emotion: "soft" },
      }),
      {
        type: "avatar_frame",
        frame: { emotion: "soft" },
      },
    );

    assert.deepEqual(
      translateRemiServerMessageToRuntimeEvent({
        type: "avatar_intent",
        intent: { mood: "warm", intensity: 0.5, holdMs: 500 },
      }),
      {
        type: "avatar_intent",
        intent: { mood: "warm", intensity: 0.5, holdMs: 500 },
      },
    );

    assert.deepEqual(
      translateRemiServerMessageToRuntimeEvent({
        type: "error",
        content: "boom",
      }),
      {
        type: "error",
        message: "boom",
      },
    );
  });

  it("ignores non-runtime WebSocket events in the translator", () => {
    for (const type of [
      "history_page",
      "stt_partial",
      "stt_final",
      "stt_prediction",
      "vad_start",
      "vad_end",
      "dev_preset_applied",
      "dev_tts_voice_applied",
      "dev_state_reset",
      "persona_preset_state",
    ]) {
      assert.equal(translateRemiServerMessageToRuntimeEvent({ type }), null, type);
    }
  });

  it("keeps streaming text scoped by generation", () => {
    let state = createInitialRemiRuntimeState();
    state = reduceRemiRuntimeEvent(state, {
      type: "text_delta",
      text: "你",
      generationId: 1,
    });
    state = reduceRemiRuntimeEvent(state, {
      type: "text_delta",
      text: "好",
      generationId: 1,
    });
    assert.equal(state.assistant.streamingText, "你好");

    state = reduceRemiRuntimeEvent(state, {
      type: "text_delta",
      text: "新",
      generationId: 2,
    });
    assert.equal(state.assistant.streamingText, "新");
    assert.equal(state.assistant.activeGenerationId, 2);
  });

  it("final text clears streaming text while audio and lip-sync do not overwrite text", () => {
    let state = createInitialRemiRuntimeState();
    state = reduceRemiRuntimeEvent(state, {
      type: "text_delta",
      text: "先说",
      generationId: 3,
    });
    state = reduceRemiRuntimeEvent(state, {
      type: "audio_chunk",
      audio: "pcm",
      sampleRate: 24000,
      generationId: 3,
    });
    state = reduceRemiRuntimeEvent(state, {
      type: "lip_sync",
      cues: [{ startMs: 0, endMs: 80, value: "aa" }],
      complete: false,
      generationId: 3,
    });
    assert.equal(state.assistant.streamingText, "先说");

    state = reduceRemiRuntimeEvent(state, {
      type: "text_final",
      text: "先说完",
      generationId: 3,
    });
    assert.equal(state.assistant.streamingText, "");
    assert.equal(state.assistant.finalText, "先说完");
    assert.equal(state.speech.lipSyncCues.length, 1);
  });

  it("projects a platform-neutral avatar runtime model from shared runtime state", () => {
    const intent = {
      emotion: "curious",
      gesture: "lean_in",
      gestureIntensity: 2,
      facialAccent: "brow_raise",
      energy: 2,
      holdMs: 700,
      source: "llm",
      reason: "asks a curious follow-up",
    };
    const frame = {
      emotion: "curious",
      face: {
        browUpL: 0.42,
        browUpR: 0.38,
        mouthOpen: 0.12,
      },
    };
    const cue = {
      offsetMs: 40,
      durationMs: 160,
      viseme: "aa",
      weight: 0.72,
      token: "我",
    };

    let state = createInitialRemiRuntimeState();
    state = reduceRemiRuntimeEvent(state, {
      type: "turn_state",
      state: "assistant_speaking",
      reason: "playback_start",
      generationId: 22,
    });
    state = reduceRemiRuntimeEvent(state, { type: "emotion", emotion: "curious" });
    state = reduceRemiRuntimeEvent(state, { type: "avatar_intent", intent });
    state = reduceRemiRuntimeEvent(state, { type: "avatar_frame", frame });
    state = reduceRemiRuntimeEvent(state, {
      type: "lip_sync",
      generationId: 22,
      source: "provider_word_boundary_derived",
      mode: "replace",
      complete: false,
      cues: [cue],
    });

    assert.deepEqual(selectRemiAvatarRuntimeModel(state), {
      phase: "speaking",
      phaseReason: "assistant_audio_active",
      turnState: "assistant_speaking",
      turnReason: "playback_start",
      emotion: "curious",
      avatarIntent: intent,
      avatarFrame: frame,
      lipSync: {
        generationId: 22,
        cues: [cue],
        complete: false,
        source: "provider_word_boundary_derived",
      },
    });
  });

  it("keeps appended lip-sync cues in the SDK timeline for the active generation", () => {
    const firstCue = {
      offsetMs: 0,
      durationMs: 120,
      viseme: "aa",
      weight: 0.68,
      token: "你",
    };
    const secondCue = {
      offsetMs: 130,
      durationMs: 150,
      viseme: "oh",
      weight: 0.52,
      token: "好",
    };

    let state = createInitialRemiRuntimeState();
    state = reduceRemiRuntimeEvent(state, {
      type: "lip_sync",
      generationId: 31,
      source: "provider_word_boundary_derived",
      mode: "append",
      complete: false,
      cues: [firstCue],
    });
    state = reduceRemiRuntimeEvent(state, {
      type: "lip_sync",
      generationId: 31,
      source: "provider_word_boundary_derived",
      mode: "append",
      complete: true,
      cues: [secondCue],
    });

    const model = selectRemiAvatarRuntimeModel(state);
    assert.deepEqual(model.lipSync, {
      generationId: 31,
      cues: [firstCue, secondCue],
      complete: true,
      source: "provider_word_boundary_derived",
    });
  });

  it("settles the shared avatar phase when local playback ends", () => {
    let state = createInitialRemiRuntimeState();

    state = reduceRemiRuntimeEvent(state, {
      type: "playback_start",
      generationId: 42,
    });

    assert.deepEqual(selectRemiAvatarRuntimeModel(state), {
      phase: "speaking",
      phaseReason: "assistant_audio_active",
      turnState: "assistant_speaking",
      turnReason: "playback_start",
      emotion: "neutral",
      avatarIntent: null,
      avatarFrame: null,
      lipSync: {
        generationId: null,
        cues: [],
        complete: false,
        source: null,
      },
    });

    state = reduceRemiRuntimeEvent(state, {
      type: "playback_end",
      generationId: 42,
    });

    const model = selectRemiAvatarRuntimeModel(state);
    assert.equal(model.phase, "idle");
    assert.equal(model.phaseReason, "idle_ready");
    assert.equal(model.turnState, "confirmed_end");
    assert.equal(model.turnReason, "confirmed_end");
  });

  it("preserves streamed text as final text when chat_end has no content field", () => {
    let state = createInitialRemiRuntimeState();
    state = reduceRemiRuntimeEvent(state, {
      type: "text_delta",
      text: "流式文本",
      generationId: 12,
    });
    state = reduceRemiRuntimeEvent(state, {
      type: "text_final",
      text: "",
      generationId: 12,
    });

    assert.equal(state.assistant.streamingText, "");
    assert.equal(state.assistant.finalText, "流式文本");
  });

  it("records runtime errors without destroying the existing state", () => {
    let state = createInitialRemiRuntimeState();
    state = reduceRemiRuntimeEvent(state, {
      type: "text_delta",
      text: "保留",
      generationId: 4,
    });
    state = reduceRemiRuntimeEvent(state, {
      type: "error",
      message: "bad",
    });

    assert.equal(state.error, "bad");
    assert.equal(state.assistant.streamingText, "保留");
    assert.equal(state.assistant.activeGenerationId, 4);
  });

  it("keeps runtime shadow disabled when the explicit flag is off", () => {
    const shadow = new RemiRuntimeShadow({ enabled: false });

    assert.equal(
      shadow.recordRawMessage({
        type: "chat_chunk",
        content: "不会进入",
        generationId: 1,
      }),
      null,
    );
    assert.equal(shadow.getState(), null);
  });

  it("mirrors translated events when runtime shadow is enabled", () => {
    const updates = [];
    const shadow = new RemiRuntimeShadow({
      enabled: true,
      onUpdate: (event, state) => updates.push([event.type, state.assistant.streamingText]),
    });

    const next = shadow.recordRawMessage({
      type: "chat_chunk",
      content: "旁路",
      generationId: 11,
    });

    assert.equal(next.assistant.streamingText, "旁路");
    assert.deepEqual(updates, [["text_delta", "旁路"]]);
    assert.equal(shadow.getState().assistant.streamingText, "旁路");
  });

  it("runtime client owns websocket context, sendText, raw events, and runtime state", () => {
    const sockets = [];
    const rawMessages = [];
    const runtimeEvents = [];
    class FakeSocket {
      constructor(url) {
        this.url = url;
        this.readyState = 0;
        this.sent = [];
        sockets.push(this);
      }

      send(data) {
        this.sent.push(data);
      }

      close() {
        this.readyState = REMI_WS_CLOSED;
        this.onclose?.();
      }

      open() {
        this.readyState = REMI_WS_OPEN;
        this.onopen?.();
      }

      receive(data) {
        this.onmessage?.({ data });
      }
    }

    const client = new RemiRuntimeClient({
      url: "ws://localhost:3001/ws",
      clientContext: {
        type: "client_context",
        ttsTransport: "pcm_stream_v1",
        timeZone: "Asia/Shanghai",
      },
      createTransport: (url) => new FakeSocket(url),
      onRawMessage: (message) => rawMessages.push(message.type),
      onRuntimeEvent: (event) => runtimeEvents.push(event.type),
    });

    client.connect();
    assert.equal(sockets[0].url, "ws://localhost:3001/ws");
    sockets[0].open();

    assert.deepEqual(JSON.parse(sockets[0].sent[0]), {
      type: "client_context",
      ttsTransport: "pcm_stream_v1",
      timeZone: "Asia/Shanghai",
    });

    assert.equal(client.sendText("你好"), true);
    assert.deepEqual(JSON.parse(sockets[0].sent[1]), {
      type: "chat",
      content: "你好",
    });

    sockets[0].receive(
      JSON.stringify({
        type: "chat_chunk",
        content: "我在",
        generationId: 1,
      }),
    );

    assert.deepEqual(rawMessages, ["chat_chunk"]);
    assert.deepEqual(runtimeEvents, ["connection", "connection", "text_delta"]);
    assert.equal(client.getState().assistant.streamingText, "我在");
  });

  it("runtime client exposes voice protocol outlets without owning capture or playback", () => {
    const sockets = [];
    class FakeSocket {
      constructor(url) {
        this.url = url;
        this.readyState = REMI_WS_OPEN;
        this.sent = [];
        sockets.push(this);
      }

      send(data) {
        this.sent.push(data);
      }

      close() {
        this.readyState = REMI_WS_CLOSED;
        this.onclose?.();
      }
    }

    const runtimeEvents = [];
    const client = new RemiRuntimeClient({
      url: "ws://localhost:3001/ws",
      createTransport: (url) => new FakeSocket(url),
      onRuntimeEvent: (event) => runtimeEvents.push(event.type),
    });
    client.connect();

    const pcmFrame = new ArrayBuffer(4);
    assert.equal(client.startDuplex(16000), true);
    assert.equal(client.sendAudioFrame(pcmFrame), true);
    assert.equal(client.sendAudioStreamBase64("abcd", 16000), true);
    assert.equal(client.notifyPlaybackStart(5), true);
    assert.equal(client.notifyPlaybackEnd(5), true);
    assert.equal(client.stopDuplex(), true);

    assert.deepEqual(
      sockets[0].sent.map((item) => (typeof item === "string" ? JSON.parse(item) : item)),
      [
        { type: "duplex_start", sampleRate: 16000 },
        pcmFrame,
        { type: "audio_stream", audio: "abcd", sampleRate: 16000 },
        { type: "playback_start", generationId: 5 },
        { type: "playback_end", generationId: 5 },
        { type: "duplex_stop" },
      ],
    );
    assert.deepEqual(runtimeEvents, [
      "connection",
      "playback_start",
      "playback_end",
    ]);
    assert.equal(client.getState().phase, "idle");
    assert.equal(client.getState().phaseReason, "idle_ready");
  });

  it("runtime client exposes a world-event outlet without deciding memory policy", () => {
    const sockets = [];
    class FakeSocket {
      constructor(url) {
        this.url = url;
        this.readyState = REMI_WS_OPEN;
        this.sent = [];
        sockets.push(this);
      }

      send(data) {
        this.sent.push(data);
      }

      close() {
        this.readyState = REMI_WS_CLOSED;
        this.onclose?.();
      }
    }

    const client = new RemiRuntimeClient({
      url: "ws://localhost:3001/ws",
      createTransport: (url) => new FakeSocket(url),
    });
    client.connect();

    assert.equal(
      client.sendWorldEvent({
        id: "event-1",
        type: "player_placed_object",
        occurredAt: "2026-04-30T10:00:00.000Z",
        surface: "world",
        actorId: "player",
        objectKind: "lamp",
        locationLabel: "near Remi's porch",
        emotionalWeightHint: 0.72,
        memoryHint: "candidate",
        description: "You set a lamp near Remi's porch.",
      }),
      true,
    );

    assert.deepEqual(JSON.parse(sockets[0].sent[0]), {
      type: "world_event",
      event: {
        id: "event-1",
        type: "player_placed_object",
        occurredAt: "2026-04-30T10:00:00.000Z",
        surface: "world",
        actorId: "player",
        objectKind: "lamp",
        locationLabel: "near Remi's porch",
        emotionalWeightHint: 0.72,
        memoryHint: "candidate",
        description: "You set a lamp near Remi's porch.",
      },
    });
  });
});
