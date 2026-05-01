import { describe, expect, it } from "vitest";

import {
  REMI_WS_CLOSED,
  REMI_WS_OPEN,
  type RemiRuntimeTransport,
  type RemiRuntimeTransportMessage,
} from "./worldRuntime";
import { createWorldEvent } from "./worldEvents";
import {
  createRemiWorldBridge,
  toRemiWorldEvent,
} from "./remiWorldBridge";

class FakeSocket implements RemiRuntimeTransport {
  readyState = 0;
  sent: Array<string | ArrayBuffer> = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: RemiRuntimeTransportMessage) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {}

  send(data: string | ArrayBuffer): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = REMI_WS_CLOSED;
    this.onclose?.();
  }

  open(): void {
    this.readyState = REMI_WS_OPEN;
    this.onopen?.();
  }

  receive(data: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

describe("remiWorldBridge", () => {
  it("connects World through the shared runtime client context and mirrors Remi state", () => {
    const sockets: FakeSocket[] = [];
    const snapshots: string[] = [];
    const bridge = createRemiWorldBridge({
      url: "ws://localhost:3001/ws",
      createTransport: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
      timeZone: "Asia/Shanghai",
      locale: "zh-CN",
      onStateChange: (state) => snapshots.push(state.assistant.streamingText),
    });

    bridge.connect();
    sockets[0].open();

    expect(JSON.parse(sockets[0].sent[0] as string)).toEqual({
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
        streamingAudio: true,
        avatar2d: false,
        avatar3d: true,
        lipSync: true,
        worldEvents: true,
        backgroundPresence: false,
        notifications: false,
      },
    });

    sockets[0].receive({
      type: "chat_chunk",
      content: "我在岛上",
      generationId: 2,
    });

    expect(snapshots).toContain("我在岛上");
    expect(bridge.getState().assistant.streamingText).toBe("我在岛上");
  });

  it("exposes the shared avatar runtime model for World NPC rendering", () => {
    const socket = new FakeSocket("ws://localhost:3001/ws");
    const bridge = createRemiWorldBridge({
      url: socket.url,
      createTransport: () => socket,
    });

    bridge.connect();
    socket.open();
    socket.receive({
      type: "turn_state",
      state: "assistant_speaking",
      reason: "playback_start",
      generationId: 8,
    });
    socket.receive({
      type: "avatar_intent",
      intent: {
        emotion: "happy",
        gesture: "happy_hop",
        gestureIntensity: 3,
        facialAccent: "soft_smile",
        energy: 3,
        holdMs: 820,
        source: "llm",
      },
    });
    socket.receive({
      type: "tts_lip_sync",
      source: "provider_word_boundary_derived",
      mode: "replace",
      complete: false,
      generationId: 8,
      cues: [
        {
          offsetMs: 0,
          durationMs: 120,
          viseme: "aa",
          weight: 0.7,
        },
      ],
    });

    expect(bridge.getAvatarRuntimeModel()).toMatchObject({
      phase: "speaking",
      phaseReason: "assistant_audio_active",
      turnState: "assistant_speaking",
      turnReason: "playback_start",
      emotion: "neutral",
      avatarIntent: {
        emotion: "happy",
        gesture: "happy_hop",
      },
      lipSync: {
        generationId: 8,
        complete: false,
        source: "provider_word_boundary_derived",
        cues: [
          {
            offsetMs: 0,
            durationMs: 120,
            viseme: "aa",
            weight: 0.7,
          },
        ],
      },
    });
  });

  it("maps local world events into runtime world events without sending them by default", () => {
    const socket = new FakeSocket("ws://localhost:3001/ws");
    const bridge = createRemiWorldBridge({
      url: socket.url,
      createTransport: () => socket,
    });
    const event = createWorldEvent({
      actorId: "player",
      locationLabel: "near Remi's porch",
      objectKind: "lamp",
      occurredAt: "2026-04-30T10:00:00.000Z",
      type: "player_placed_object",
    });

    bridge.connect();
    socket.open();
    const report = bridge.reportWorldEvent(event);

    expect(report.sent).toBe(false);
    expect(report.event).toEqual({
      id: event.id,
      type: "player_placed_object",
      occurredAt: "2026-04-30T10:00:00.000Z",
      surface: "world",
      actorId: "player",
      objectKind: "lamp",
      locationLabel: "near Remi's porch",
      emotionalWeightHint: 0.72,
      memoryHint: "candidate",
      description: "You set a lamp near Remi's porch.",
    });
    expect(socket.sent).toHaveLength(1);
  });

  it("can explicitly send world events after the server supports the route", () => {
    const socket = new FakeSocket("ws://localhost:3001/ws");
    const bridge = createRemiWorldBridge({
      url: socket.url,
      createTransport: () => socket,
      sendWorldEvents: true,
    });
    const event = createWorldEvent({
      actorId: "player",
      locationLabel: "the garden shoreline",
      occurredAt: "2026-04-30T10:00:00.000Z",
      type: "player_expanded_land",
    });

    bridge.connect();
    socket.open();
    const report = bridge.reportWorldEvent(event);

    expect(report.sent).toBe(true);
    expect(report.event.type).toBe("player_changed_area");
    expect(JSON.parse(socket.sent[1] as string)).toEqual({
      type: "world_event",
      event: toRemiWorldEvent(event),
    });
  });

  it("maps local land removal into the existing runtime area-change event family", () => {
    const event = createWorldEvent({
      actorId: "player",
      locationLabel: "the front shore",
      occurredAt: "2026-04-30T10:00:00.000Z",
      type: "player_removed_land",
    });

    expect(toRemiWorldEvent(event)).toMatchObject({
      type: "player_changed_area",
      locationLabel: "the front shore",
      memoryHint: "none",
      description: "You removed a filled shoreline patch near the front shore.",
    });
  });
});
