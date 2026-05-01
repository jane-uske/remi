import type {
  AvatarFrame,
  AvatarIntent,
  Emotion,
  RemiTurnState,
  RemiTurnStateReason,
  TtsLipCue,
  TtsLipSyncMode,
  TtsLipSyncSource,
} from "../avatar/types";

export type RemiClientSurface =
  | "web"
  | "desktop"
  | "ios"
  | "android"
  | "watch"
  | "world";

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
  | "awaiting_model"
  | "assistant_text_streaming"
  | "assistant_audio_prepare"
  | "assistant_audio_active"
  | "assistant_audio_tail"
  | "user_interrupt";

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

export type RemiConnectInput = {
  surface: RemiClientSurface;
  sessionToken?: string | null;
  timeZone?: string | null;
  locale?: string | null;
  capabilities?: RemiClientCapabilityInput;
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
  surface: RemiClientSurface | "world";
  actorId: "user" | "player";
  areaId?: string;
  objectId?: string;
  objectKind?: string;
  locationLabel?: string;
  emotionalWeightHint?: number;
  memoryHint?: RemiWorldEventMemoryHint;
  description?: string;
};

export type RemiWorldEventAck = {
  eventId: string;
  accepted: boolean;
  usedInCurrentTurn: boolean;
  memoryWrite: "none" | "working_memory" | "episode_candidate";
  reason?: string;
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
      type: "audio_chunk";
      audio: string;
      sampleRate: number;
      generationId: number;
    }
  | {
      type: "playback_start";
      generationId?: number;
    }
  | {
      type: "playback_end";
      generationId?: number;
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
      emotion: Emotion | string;
    }
  | {
      type: "avatar_frame";
      frame: AvatarFrame;
    }
  | {
      type: "avatar_intent";
      intent: AvatarIntent;
    }
  | {
      type: "world_event_ack";
      eventId: string;
      accepted: boolean;
      usedInCurrentTurn: boolean;
      memoryWrite: RemiWorldEventAck["memoryWrite"];
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
    audioActive: boolean;
    audioSampleRate: number | null;
    activeGenerationId: number | null;
  };
  affect: {
    emotion: string;
    avatarFrame: AvatarFrame | null;
    avatarIntent: AvatarIntent | null;
  };
  speech: {
    lipSyncCues: TtsLipCue[];
    lipSyncGenerationId: number | null;
    lipSyncComplete: boolean;
    lipSyncSource: TtsLipSyncSource | null;
  };
  world: {
    lastEventAck: RemiWorldEventAck | null;
  };
  error: string | null;
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

export function normalizeRemiClientCapabilities(
  input: RemiClientCapabilityInput = {},
): RemiClientCapabilities {
  return {
    surface: input.surface ?? "web",
    ...DEFAULT_CAPABILITIES,
    ...input,
  };
}

export function toClientContextPayload(
  input: Omit<RemiConnectInput, "sessionToken">,
): RemiClientContextPayload {
  const capabilities = normalizeRemiClientCapabilities({
    ...input.capabilities,
    surface: input.surface,
  });
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
