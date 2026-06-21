import type {
  AvatarFrameState,
  AvatarIntent,
  InterruptionType,
  LipSignal,
  RemiTurnState,
  RemiTurnStateReason,
} from "@/types/avatar";

export type CanonicalAvatarPhase =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "reacting";

export type CanonicalAvatarPhaseReason =
  | "connecting"
  | "disconnected"
  | "idle_ready"
  | "open_mic_idle"
  | "user_voice"
  | "user_hold"
  | "awaiting_commit"
  | "awaiting_model"
  | "assistant_text_streaming"
  | "assistant_audio_prepare"
  | "assistant_audio_active"
  | "assistant_audio_tail"
  | "user_interrupt";

export type CanonicalAvatarConnection = "connecting" | "open" | "closed";

export type CanonicalAvatarState = {
  derivedAtMs: number;
  phase: CanonicalAvatarPhase;
  phaseReason: CanonicalAvatarPhaseReason;
  connection: CanonicalAvatarConnection;
  turn: {
    serverState: RemiTurnState | null;
    reason: RemiTurnStateReason | null;
    previewText: string | null;
    interruptionType: InterruptionType | null;
    sinceAtMs: number | null;
  };
  user: {
    recording: boolean;
    duplexEnabled: boolean;
    speaking: boolean;
    awaitingCommit: boolean;
  };
  assistant: {
    waiting: boolean;
    streaming: boolean;
    playbackActive: boolean;
    playbackTailActive: boolean;
    textOnly: boolean;
  };
  affect: {
    emotion: string;
    intent: AvatarIntent | null;
    frame: AvatarFrameState | null;
  };
  speech: {
    envelope: number;
    active: boolean;
    viseme: string | null;
    mouthLevel: number;
  };
  timers?: {
    speakingTailUntilMs: number | null;
    reactingUntilMs: number | null;
  };
};

export type AdaptRemiRuntimeStateInput = {
  nowMs: number;
  connection: CanonicalAvatarConnection;
  turnState: RemiTurnState | null;
  turnReason: RemiTurnStateReason | null;
  turnPreviewText: string | null;
  turnInterruptionType: InterruptionType | null;
  turnSinceAtMs: number | null;
  recording: boolean;
  duplexEnabled: boolean;
  userSpeaking: boolean;
  awaitingCommit: boolean;
  waiting: boolean;
  typing: boolean;
  streamingText: string;
  voiceActive: boolean;
  emotion: string | null;
  avatarIntent: AvatarIntent | null;
  avatarFrame: AvatarFrameState | null;
  lipSignal?: LipSignal | null;
};

const FRESH_LIP_SYNC_MAX_AGE_MS = 220;
const PREPARE_TO_TEXT_ONLY_MS = 360;

export const AUDIO_ACTIVE_TAIL_MS = 320;
export const USER_INTERRUPT_REACT_MS = 260;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function resolveEmotion(
  emotion: string | null,
  avatarIntent: AvatarIntent | null,
  avatarFrame: AvatarFrameState | null,
): string {
  const raw = avatarFrame?.emotion ?? avatarIntent?.emotion ?? emotion ?? "neutral";
  const normalized = String(raw).trim().toLowerCase();
  return normalized || "neutral";
}

function resolveSpeech(
  input: AdaptRemiRuntimeStateInput,
): CanonicalAvatarState["speech"] {
  const lipSignalEnvelope = clamp01(input.lipSignal?.envelope ?? 0);
  const lipSignalActive = Boolean(input.lipSignal?.active) || lipSignalEnvelope > 0.02;
  const lipViseme = input.lipSignal?.viseme?.name ?? null;

  const lipSync = input.avatarFrame?.lipSync ?? null;
  const lipSyncAtMs = input.avatarFrame?.lipSyncAtMs ?? lipSync?.time ?? null;
  const lipSyncFresh =
    lipSync != null &&
    lipSyncAtMs != null &&
    input.nowMs - lipSyncAtMs <= FRESH_LIP_SYNC_MAX_AGE_MS;
  const lipSyncEnvelope = lipSyncFresh ? clamp01(lipSync?.weight ?? 0) : 0;
  const lipSyncViseme = lipSyncFresh ? lipSync?.viseme ?? null : null;

  const envelope = Math.max(lipSignalEnvelope, lipSyncEnvelope, input.voiceActive ? 0.18 : 0);

  return {
    envelope,
    active: lipSignalActive || lipSyncFresh || input.voiceActive || envelope > 0.04,
    viseme: lipViseme ?? lipSyncViseme ?? null,
    mouthLevel: envelope,
  };
}

function nextTailUntilMs(
  input: AdaptRemiRuntimeStateInput,
  prevState: CanonicalAvatarState | null | undefined,
): number | null {
  const prevTailUntilMs = prevState?.timers?.speakingTailUntilMs ?? null;

  if (input.connection !== "open") return null;
  if (input.voiceActive) return null;
  if (input.turnState !== "assistant_speaking") {
    if (prevTailUntilMs != null && input.nowMs <= prevTailUntilMs) {
      return prevTailUntilMs;
    }
    return null;
  }

  if (
    prevState?.assistant.playbackActive ||
    prevState?.phaseReason === "assistant_audio_active"
  ) {
    return (prevState?.derivedAtMs ?? input.nowMs) + AUDIO_ACTIVE_TAIL_MS;
  }

  if (prevTailUntilMs != null && input.nowMs <= prevTailUntilMs) {
    return prevTailUntilMs;
  }

  return null;
}

function nextReactingUntilMs(
  input: AdaptRemiRuntimeStateInput,
  prevState: CanonicalAvatarState | null | undefined,
): number | null {
  const prevReactingUntilMs = prevState?.timers?.reactingUntilMs ?? null;

  if (input.connection !== "open") return null;
  if (input.userSpeaking || input.turnState === "listening_active") return null;

  if (input.turnState === "interrupted_by_user") {
    return Math.max(prevReactingUntilMs ?? 0, input.nowMs + USER_INTERRUPT_REACT_MS);
  }

  if (prevReactingUntilMs != null && input.nowMs <= prevReactingUntilMs) {
    return prevReactingUntilMs;
  }

  return null;
}

export function adaptRemiRuntimeState(
  input: AdaptRemiRuntimeStateInput,
  prevState?: CanonicalAvatarState | null,
): CanonicalAvatarState {
  const affectEmotion = resolveEmotion(
    input.emotion,
    input.avatarIntent,
    input.avatarFrame,
  );
  const speech = resolveSpeech(input);
  const streamingText = String(input.streamingText ?? "").trim();
  const assistantStreaming = input.typing || streamingText.length > 0;
  const awaitingAssistantReply =
    streamingText.length === 0 && (input.waiting || input.typing);
  const speakingTailUntilMs = nextTailUntilMs(input, prevState);
  const reactingUntilMs = nextReactingUntilMs(input, prevState);
  const playbackTailActive =
    speakingTailUntilMs != null && input.nowMs <= speakingTailUntilMs;
  const assistantTextOnly =
    !input.voiceActive &&
    !playbackTailActive &&
    assistantStreaming &&
    (input.turnState === "assistant_entering" ||
      (input.turnState === "assistant_speaking" && input.turnReason === "tts_prepare") ||
      (input.turnState === "confirmed_end" &&
        input.turnSinceAtMs != null &&
        input.nowMs - input.turnSinceAtMs >= PREPARE_TO_TEXT_ONLY_MS));

  let phase: CanonicalAvatarPhase = "idle";
  let phaseReason: CanonicalAvatarPhaseReason = "idle_ready";

  if (input.connection !== "open") {
    phase = "idle";
    phaseReason = input.connection === "connecting" ? "connecting" : "disconnected";
  } else if (input.userSpeaking || input.turnState === "listening_active") {
    phase = "listening";
    phaseReason = "user_voice";
  } else if (input.turnState === "listening_hold") {
    phase = "listening";
    phaseReason = "user_hold";
  } else if (reactingUntilMs != null && input.nowMs <= reactingUntilMs) {
    phase = "reacting";
    phaseReason = "user_interrupt";
  } else if (awaitingAssistantReply) {
    phase = "thinking";
    phaseReason = "awaiting_model";
  } else if (input.voiceActive) {
    phase = "speaking";
    phaseReason = "assistant_audio_active";
  } else if (playbackTailActive) {
    phase = "speaking";
    phaseReason = "assistant_audio_tail";
  } else if (input.turnState === "assistant_entering") {
    if (assistantTextOnly) {
      phase = "thinking";
      phaseReason = "assistant_text_streaming";
    } else {
      phase = "speaking";
      phaseReason = "assistant_audio_prepare";
    }
  } else if (input.awaitingCommit) {
    phase = "listening";
    phaseReason = "awaiting_commit";
  } else if (input.recording) {
    phase = "listening";
    phaseReason = "open_mic_idle";
  } else if (input.waiting || assistantStreaming) {
    phase = "thinking";
    phaseReason = assistantStreaming ? "assistant_text_streaming" : "awaiting_model";
  }

  const playbackActive = input.connection === "open" ? input.voiceActive : false;

  return {
    derivedAtMs: input.nowMs,
    phase,
    phaseReason,
    connection: input.connection,
    turn: {
      serverState: input.turnState,
      reason: input.turnReason,
      previewText: input.turnPreviewText,
      interruptionType: input.turnInterruptionType,
      sinceAtMs: input.turnSinceAtMs,
    },
    user: {
      recording: input.recording,
      duplexEnabled: input.duplexEnabled,
      speaking: input.userSpeaking,
      awaitingCommit: input.awaitingCommit,
    },
    assistant: {
      waiting: input.waiting,
      streaming: assistantStreaming,
      playbackActive,
      playbackTailActive:
        input.connection === "open" && playbackTailActive && !playbackActive,
      textOnly: assistantTextOnly,
    },
    affect: {
      emotion: affectEmotion,
      intent: input.avatarIntent,
      frame: input.avatarFrame,
    },
    speech,
    timers: {
      speakingTailUntilMs,
      reactingUntilMs,
    },
  };
}
