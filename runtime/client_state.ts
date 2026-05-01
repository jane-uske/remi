import type {
  RemiRuntimeEvent,
  RemiRuntimePhase,
  RemiRuntimePhaseReason,
  RemiRuntimeState,
} from "./protocol";

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
      audioActive: false,
      audioSampleRate: null,
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

function phaseFromTurnState(
  event: Extract<RemiRuntimeEvent, { type: "turn_state" }>,
): { phase: RemiRuntimePhase; phaseReason: RemiRuntimePhaseReason } {
  switch (event.state) {
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

function shouldReplaceGeneration(
  currentGenerationId: number | null,
  nextGenerationId: number,
): boolean {
  return currentGenerationId == null || currentGenerationId !== nextGenerationId;
}

export function reduceRemiRuntimeEvent(
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
      const phase = phaseFromTurnState(event);
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
      const reset = shouldReplaceGeneration(
        state.assistant.activeGenerationId,
        event.generationId,
      );
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

    case "text_final": {
      const finalText = event.text || state.assistant.streamingText;
      return {
        ...state,
        phase: state.assistant.audioActive ? "speaking" : "idle",
        phaseReason: state.assistant.audioActive
          ? "assistant_audio_active"
          : "idle_ready",
        assistant: {
          ...state.assistant,
          streamingText: "",
          finalText,
          activeGenerationId: event.generationId,
        },
      };
    }

    case "audio_chunk":
      return {
        ...state,
        phase: "speaking",
        phaseReason: "assistant_audio_active",
        assistant: {
          ...state.assistant,
          audioActive: true,
          audioSampleRate: event.sampleRate,
          activeGenerationId: event.generationId,
        },
      };

    case "playback_start":
      return {
        ...state,
        phase: "speaking",
        phaseReason: "assistant_audio_active",
        turn: {
          ...state.turn,
          serverState: "assistant_speaking",
          reason: "playback_start",
          generationId: event.generationId ?? state.turn.generationId,
        },
        assistant: {
          ...state.assistant,
          audioActive: true,
          activeGenerationId:
            event.generationId ?? state.assistant.activeGenerationId,
        },
      };

    case "playback_end": {
      const generationMatches =
        event.generationId == null ||
        state.assistant.activeGenerationId == null ||
        event.generationId === state.assistant.activeGenerationId;
      if (!generationMatches) return state;
      return {
        ...state,
        phase: state.assistant.streamingText ? "thinking" : "idle",
        phaseReason: state.assistant.streamingText
          ? "assistant_text_streaming"
          : "idle_ready",
        turn: {
          ...state.turn,
          serverState: "confirmed_end",
          reason: "confirmed_end",
          generationId: event.generationId ?? state.turn.generationId,
        },
        assistant: {
          ...state.assistant,
          audioActive: false,
        },
      };
    }

    case "lip_sync": {
      const sameGeneration = state.speech.lipSyncGenerationId === event.generationId;
      const append = event.mode === "append" && sameGeneration;
      return {
        ...state,
        speech: {
          lipSyncCues: append
            ? [...state.speech.lipSyncCues, ...event.cues]
            : event.cues,
          lipSyncGenerationId: event.generationId,
          lipSyncComplete: event.complete,
          lipSyncSource: event.source ?? state.speech.lipSyncSource,
        },
      };
    }

    case "emotion":
      return {
        ...state,
        affect: {
          ...state.affect,
          emotion: String(event.emotion),
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
