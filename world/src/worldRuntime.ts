export const REMI_WS_CONNECTING = 0;
export const REMI_WS_OPEN = 1;
export const REMI_WS_CLOSED = 3;

export type RemiRuntimeTransportMessage = {
  data: string | ArrayBuffer;
};

export type RemiRuntimeTransport = {
  readyState: number;
  send(data: string | ArrayBuffer): void;
  close(): void;
  onopen?: (() => void) | null;
  onmessage?: ((event: RemiRuntimeTransportMessage) => void) | null;
  onclose?: (() => void) | null;
  onerror?: (() => void) | null;
};

export type RemiClientSurface = "world";

export type RemiClientCapabilities = {
  surface: RemiClientSurface;
  textInput: boolean;
  audioInput: boolean;
  audioOutput: boolean;
  streamingAudio: boolean;
  avatar2d: boolean;
  avatar3d: boolean;
  lipSync: boolean;
  worldEvents: boolean;
  backgroundPresence: boolean;
  notifications: boolean;
};

export type RemiClientCapabilityInput =
  Partial<Omit<RemiClientCapabilities, "surface">> & {
    surface?: RemiClientSurface;
  };

export type RemiClientContextPayload = {
  type: "client_context";
  surface: RemiClientSurface;
  timeZone?: string;
  locale?: string;
  ttsTransport: "pcm_stream_v1";
  capabilities: RemiClientCapabilities;
};

export type RemiWorldEventType =
  | "world_entered"
  | "world_left"
  | "player_near_remi"
  | "player_focused_remi"
  | "player_focused_object"
  | "player_placed_object"
  | "player_removed_object"
  | "player_changed_area"
  | "player_started_talking_to_remi";

export type RemiWorldEventMemoryHint = "none" | "current_turn" | "candidate";

export type RemiWorldEvent = {
  id: string;
  type: RemiWorldEventType;
  occurredAt: string;
  surface: RemiClientSurface;
  actorId: "user" | "player";
  areaId?: string;
  objectId?: string;
  objectKind?: string;
  locationLabel?: string;
  emotionalWeightHint?: number;
  memoryHint?: RemiWorldEventMemoryHint;
  description?: string;
};

export type RemiRuntimeConnection = "connecting" | "open" | "closed";
export type RemiRuntimePhase =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "interrupted";
export type RemiRuntimePhaseReason =
  | "connecting"
  | "disconnected"
  | "idle_ready"
  | "user_voice"
  | "user_hold"
  | "awaiting_commit"
  | "assistant_text_streaming"
  | "assistant_audio_prepare"
  | "assistant_audio_active"
  | "user_interrupt";

export type RemiTurnState =
  | "listening_active"
  | "listening_hold"
  | "likely_end"
  | "assistant_entering"
  | "assistant_speaking"
  | "interrupted_by_user"
  | "confirmed_end";

export type RemiTurnStateReason = string;

export type TtsLipSyncSource =
  | "provider_viseme"
  | "provider_word_boundary_derived";

export type TtsLipSyncMode = "replace" | "append";

export type TtsLipCue = {
  offsetMs: number;
  durationMs: number;
  viseme: string;
  weight: number;
};

export type RemiRuntimeEvent =
  | {
      type: "connection";
      state: RemiRuntimeConnection;
    }
  | {
      type: "turn_state";
      state: RemiTurnState;
      reason: RemiTurnStateReason;
      generationId?: number;
      preview?: string;
    }
  | {
      type: "text_delta";
      text: string;
      generationId: number;
    }
  | {
      type: "text_final";
      text: string;
      generationId: number;
    }
  | {
      type: "lip_sync";
      cues: TtsLipCue[];
      generationId: number;
      complete: boolean;
      mode?: TtsLipSyncMode;
      source?: TtsLipSyncSource;
    }
  | {
      type: "emotion";
      emotion: string;
    }
  | {
      type: "avatar_frame";
      frame: Record<string, unknown>;
    }
  | {
      type: "avatar_intent";
      intent: Record<string, unknown>;
    }
  | {
      type: "world_event_ack";
      eventId: string;
      accepted: boolean;
      usedInCurrentTurn: boolean;
      memoryWrite: "none" | "working_memory" | "episode_candidate";
      reason?: string;
    }
  | {
      type: "error";
      message: string;
    };

export type RemiRuntimeState = {
  connection: RemiRuntimeConnection;
  phase: RemiRuntimePhase;
  phaseReason: RemiRuntimePhaseReason;
  turn: {
    serverState: RemiTurnState | null;
    reason: RemiTurnStateReason | null;
    generationId: number | null;
    previewText: string | null;
  };
  assistant: {
    streamingText: string;
    finalText: string;
    activeGenerationId: number | null;
  };
  affect: {
    emotion: string;
    avatarFrame: Record<string, unknown> | null;
    avatarIntent: Record<string, unknown> | null;
  };
  speech: {
    lipSyncCues: TtsLipCue[];
    lipSyncGenerationId: number | null;
    lipSyncComplete: boolean;
    lipSyncSource: TtsLipSyncSource | null;
  };
  world: {
    lastEventAck: {
      eventId: string;
      accepted: boolean;
      usedInCurrentTurn: boolean;
      memoryWrite: "none" | "working_memory" | "episode_candidate";
      reason?: string;
    } | null;
  };
  error: string | null;
};

export type RemiAvatarRuntimeModel = {
  phase: RemiRuntimePhase;
  phaseReason: RemiRuntimePhaseReason;
  turnState: RemiTurnState | null;
  turnReason: RemiTurnStateReason | null;
  emotion: string;
  avatarIntent: Record<string, unknown> | null;
  avatarFrame: Record<string, unknown> | null;
  lipSync: {
    generationId: number | null;
    cues: TtsLipCue[];
    complete: boolean;
    source: TtsLipSyncSource | null;
  };
};

export type RemiRuntimeClientOptions = {
  url: string;
  clientContext?: RemiClientContextPayload | null;
  createTransport: (url: string) => RemiRuntimeTransport;
  onRuntimeEvent?: (event: RemiRuntimeEvent, state: RemiRuntimeState) => void;
};

const DEFAULT_CAPABILITIES: Omit<RemiClientCapabilities, "surface"> = {
  textInput: false,
  audioInput: false,
  audioOutput: false,
  streamingAudio: false,
  avatar2d: false,
  avatar3d: false,
  lipSync: false,
  worldEvents: false,
  backgroundPresence: false,
  notifications: false,
};

export function toClientContextPayload(input: {
  surface: RemiClientSurface;
  timeZone?: string;
  locale?: string;
  capabilities?: RemiClientCapabilityInput;
}): RemiClientContextPayload {
  const capabilities = {
    surface: input.surface,
    ...DEFAULT_CAPABILITIES,
    ...input.capabilities,
  };
  const payload: RemiClientContextPayload = {
    type: "client_context",
    surface: input.surface,
    ttsTransport: "pcm_stream_v1",
    capabilities,
  };
  const timeZone = input.timeZone?.trim();
  if (timeZone) payload.timeZone = timeZone;
  const locale = input.locale?.trim();
  if (locale) payload.locale = locale;
  return payload;
}

export function createInitialRemiRuntimeState(): RemiRuntimeState {
  return {
    connection: "closed",
    phase: "idle",
    phaseReason: "disconnected",
    turn: {
      serverState: null,
      reason: null,
      generationId: null,
      previewText: null,
    },
    assistant: {
      streamingText: "",
      finalText: "",
      activeGenerationId: null,
    },
    affect: {
      emotion: "neutral",
      avatarFrame: null,
      avatarIntent: null,
    },
    speech: {
      lipSyncCues: [],
      lipSyncGenerationId: null,
      lipSyncComplete: false,
      lipSyncSource: null,
    },
    world: {
      lastEventAck: null,
    },
    error: null,
  };
}

export function selectRemiAvatarRuntimeModel(
  state: RemiRuntimeState,
): RemiAvatarRuntimeModel {
  return {
    phase: state.phase,
    phaseReason: state.phaseReason,
    turnState: state.turn.serverState,
    turnReason: state.turn.reason,
    emotion: state.affect.emotion,
    avatarIntent: state.affect.avatarIntent,
    avatarFrame: state.affect.avatarFrame,
    lipSync: {
      generationId: state.speech.lipSyncGenerationId,
      cues: state.speech.lipSyncCues,
      complete: state.speech.lipSyncComplete,
      source: state.speech.lipSyncSource,
    },
  };
}

export class RemiRuntimeClient {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  private readonly url: string;
  private readonly clientContext: RemiClientContextPayload | null;
  private readonly createTransport: (url: string) => RemiRuntimeTransport;
  private readonly onRuntimeEvent?: RemiRuntimeClientOptions["onRuntimeEvent"];
  private transport: RemiRuntimeTransport | null = null;
  private state: RemiRuntimeState = createInitialRemiRuntimeState();

  constructor(options: RemiRuntimeClientOptions) {
    this.url = options.url;
    this.clientContext = options.clientContext ?? null;
    this.createTransport = options.createTransport;
    this.onRuntimeEvent = options.onRuntimeEvent;
  }

  get readyState(): number {
    return this.transport?.readyState ?? REMI_WS_CLOSED;
  }

  connect(): void {
    const transport = this.createTransport(this.url);
    this.transport = transport;
    this.recordRuntimeEvent({ type: "connection", state: "connecting" });
    transport.onopen = () => {
      this.recordRuntimeEvent({ type: "connection", state: "open" });
      if (this.clientContext) {
        this.sendJson(this.clientContext);
      }
      this.onopen?.();
    };
    transport.onmessage = (event) => {
      this.handleMessage(event);
    };
    transport.onclose = () => {
      this.recordRuntimeEvent({ type: "connection", state: "closed" });
      this.onclose?.();
    };
    transport.onerror = () => {
      this.onerror?.();
    };
  }

  close(): void {
    this.transport?.close();
  }

  isOpen(): boolean {
    return this.readyState === REMI_WS_OPEN;
  }

  send(data: string | ArrayBuffer): void {
    if (!this.transport || this.transport.readyState !== REMI_WS_OPEN) {
      throw new Error("Remi World transport is not open");
    }
    this.transport.send(data);
  }

  sendJson(payload: Record<string, unknown>): boolean {
    if (!this.isOpen()) return false;
    this.send(JSON.stringify(payload));
    return true;
  }

  sendText(content: string): boolean {
    const text = content.trim();
    if (!text) return false;
    return this.sendJson({ type: "chat", content: text });
  }

  sendWorldEvent(event: RemiWorldEvent): boolean {
    return this.sendJson({
      type: "world_event",
      event,
    });
  }

  getState(): RemiRuntimeState {
    return this.state;
  }

  private handleMessage(event: RemiRuntimeTransportMessage): void {
    if (typeof event.data !== "string") return;
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(event.data) as Record<string, unknown>;
    } catch {
      return;
    }
    const runtimeEvent = translateRemiServerMessageToRuntimeEvent(message);
    if (runtimeEvent) {
      this.recordRuntimeEvent(runtimeEvent);
    }
  }

  private recordRuntimeEvent(event: RemiRuntimeEvent): void {
    this.state = reduceRemiRuntimeEvent(this.state, event);
    this.onRuntimeEvent?.(event, this.state);
  }
}

function reduceRemiRuntimeEvent(
  state: RemiRuntimeState,
  event: RemiRuntimeEvent,
): RemiRuntimeState {
  switch (event.type) {
    case "connection":
      return {
        ...state,
        connection: event.state,
        phase: "idle",
        phaseReason:
          event.state === "connecting"
            ? "connecting"
            : event.state === "closed"
              ? "disconnected"
              : "idle_ready",
      };

    case "turn_state": {
      const phase = phaseFromTurnState(event.state);
      return {
        ...state,
        ...phase,
        turn: {
          serverState: event.state,
          reason: event.reason,
          generationId: event.generationId ?? state.turn.generationId,
          previewText: event.preview ?? null,
        },
      };
    }

    case "text_delta": {
      const reset = state.assistant.activeGenerationId !== event.generationId;
      return {
        ...state,
        phase: state.phase === "speaking" ? state.phase : "thinking",
        phaseReason:
          state.phase === "speaking"
            ? state.phaseReason
            : "assistant_text_streaming",
        assistant: {
          ...state.assistant,
          streamingText: reset
            ? event.text
            : state.assistant.streamingText + event.text,
          activeGenerationId: event.generationId,
        },
      };
    }

    case "text_final":
      return {
        ...state,
        phase: "idle",
        phaseReason: "idle_ready",
        assistant: {
          ...state.assistant,
          streamingText: "",
          finalText: event.text || state.assistant.streamingText,
          activeGenerationId: event.generationId,
        },
      };

    case "lip_sync":
      return {
        ...state,
        speech: {
          lipSyncCues:
            event.mode === "append" &&
            state.speech.lipSyncGenerationId === event.generationId
              ? [...state.speech.lipSyncCues, ...event.cues]
              : event.cues,
          lipSyncGenerationId: event.generationId,
          lipSyncComplete: event.complete,
          lipSyncSource: event.source ?? state.speech.lipSyncSource,
        },
      };

    case "emotion":
      return {
        ...state,
        affect: {
          ...state.affect,
          emotion: event.emotion,
        },
      };

    case "avatar_frame":
      return {
        ...state,
        affect: {
          ...state.affect,
          avatarFrame: event.frame,
        },
      };

    case "avatar_intent":
      return {
        ...state,
        affect: {
          ...state.affect,
          avatarIntent: event.intent,
        },
      };

    case "world_event_ack":
      return {
        ...state,
        world: {
          lastEventAck: {
            eventId: event.eventId,
            accepted: event.accepted,
            usedInCurrentTurn: event.usedInCurrentTurn,
            memoryWrite: event.memoryWrite,
            ...(event.reason ? { reason: event.reason } : {}),
          },
        },
      };

    case "error":
      return {
        ...state,
        error: event.message,
      };

    default:
      return state;
  }
}

function phaseFromTurnState(
  state: RemiTurnState,
): { phase: RemiRuntimePhase; phaseReason: RemiRuntimePhaseReason } {
  switch (state) {
    case "listening_active":
      return { phase: "listening", phaseReason: "user_voice" };
    case "listening_hold":
      return { phase: "listening", phaseReason: "user_hold" };
    case "likely_end":
      return { phase: "listening", phaseReason: "awaiting_commit" };
    case "assistant_entering":
      return { phase: "speaking", phaseReason: "assistant_audio_prepare" };
    case "assistant_speaking":
      return { phase: "speaking", phaseReason: "assistant_audio_active" };
    case "interrupted_by_user":
      return { phase: "interrupted", phaseReason: "user_interrupt" };
    default:
      return { phase: "idle", phaseReason: "idle_ready" };
  }
}

function translateRemiServerMessageToRuntimeEvent(
  raw: Record<string, unknown>,
): RemiRuntimeEvent | null {
  switch (raw.type) {
    case "chat_chunk": {
      const generationId = parseGenerationId(raw.generationId);
      if (generationId == null) return null;
      return {
        type: "text_delta",
        text: typeof raw.content === "string" ? raw.content : "",
        generationId,
      };
    }

    case "chat_end": {
      const generationId = parseGenerationId(raw.generationId);
      if (generationId == null) return null;
      return {
        type: "text_final",
        text: typeof raw.content === "string" ? raw.content : "",
        generationId,
      };
    }

    case "turn_state": {
      if (typeof raw.state !== "string" || typeof raw.reason !== "string") {
        return null;
      }
      const generationId = parseGenerationId(raw.generationId);
      return {
        type: "turn_state",
        state: raw.state as RemiTurnState,
        reason: raw.reason,
        ...(generationId != null ? { generationId } : {}),
        ...(typeof raw.preview === "string" ? { preview: raw.preview } : {}),
      };
    }

    case "tts_lip_sync": {
      const generationId = parseGenerationId(raw.generationId);
      if (generationId == null || !Array.isArray(raw.cues)) return null;
      return {
        type: "lip_sync",
        cues: raw.cues as TtsLipCue[],
        generationId,
        complete: raw.complete === true,
        mode: raw.mode === "append" ? "append" : "replace",
        source:
          raw.source === "provider_viseme"
            ? "provider_viseme"
            : "provider_word_boundary_derived",
      };
    }

    case "emotion":
      if (raw.emotion == null) return null;
      return {
        type: "emotion",
        emotion: String(raw.emotion),
      };

    case "avatar_frame":
      if (!isRecord(raw.frame)) return null;
      return {
        type: "avatar_frame",
        frame: raw.frame,
      };

    case "avatar_intent":
      if (!isRecord(raw.intent)) return null;
      return {
        type: "avatar_intent",
        intent: raw.intent,
      };

    case "world_event_ack":
      if (typeof raw.eventId !== "string") return null;
      return {
        type: "world_event_ack",
        eventId: raw.eventId,
        accepted: raw.accepted === true,
        usedInCurrentTurn: raw.usedInCurrentTurn === true,
        memoryWrite: parseWorldEventMemoryWrite(raw.memoryWrite),
        ...(typeof raw.reason === "string" ? { reason: raw.reason } : {}),
      };

    case "error":
      return {
        type: "error",
        message: String(raw.content ?? raw.message ?? "World bridge error"),
      };

    default:
      return null;
  }
}

function parseGenerationId(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.floor(raw);
  }
  if (typeof raw === "string") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      return Math.floor(parsed);
    }
  }
  return null;
}

function parseWorldEventMemoryWrite(
  raw: unknown,
): "none" | "working_memory" | "episode_candidate" {
  if (raw === "working_memory" || raw === "episode_candidate") {
    return raw;
  }
  return "none";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
