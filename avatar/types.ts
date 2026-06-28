export type Emotion = "neutral" | "happy" | "curious" | "shy" | "sad" | "concerned" | "playful" | "thoughtful";

export interface FaceParams {
  eyeOpenL: number;
  eyeOpenR: number;
  eyeSquintL: number;
  eyeSquintR: number;
  browUpL: number;
  browUpR: number;
  browDownL: number;
  browDownR: number;
  mouthSmile: number;
  mouthFrown: number;
  mouthOpen: number;
  mouthPucker: number;
  cheekPuff: number;
}

export type Viseme =
  | "sil"
  | "aa"
  | "ee"
  | "ih"
  | "oh"
  | "oo"
  | "ss"
  | "sh"
  | "ff"
  | "th"
  | "nn"
  | "rr"
  | "dd"
  | "kk"
  | "pp"
  | "ch";

export interface LipSyncFrame {
  time: number;
  viseme: Viseme;
  weight: number;
}

export type TtsLipSyncSource = "provider_viseme" | "provider_word_boundary_derived";
export type TtsLipSyncMode = "replace" | "append";

export interface TtsLipCue {
  offsetMs: number;
  durationMs: number;
  viseme: Viseme;
  weight: number;
  charStart?: number;
  charEnd?: number;
  token?: string;
}

export interface ActionCommand {
  action: string;
  intensity: number;
  duration: number;
}

export type AvatarIntentGesture =
  | "none"
  | "happy_hop"
  | "nod"
  | "shake_head"
  | "wave"
  | "tilt_head"
  | "shrug"
  | "lean_in"
  | "recoil"
  | "shrink_in";

export type AvatarIntentFacialAccent =
  | "none"
  | "brow_furrow"
  | "brow_raise"
  | "soft_smile"
  | "sad_mouth";

export type AvatarIntentSource = "llm" | "rule" | "debug" | "server";

export interface AvatarIntent {
  emotion: Emotion;
  gesture: AvatarIntentGesture;
  gestureIntensity: 0 | 1 | 2 | 3;
  facialAccent: AvatarIntentFacialAccent;
  energy: 0 | 1 | 2 | 3;
  holdMs: number;
  source: AvatarIntentSource;
  reason?: string;
}

export interface AvatarIntentBeat {
  delayMs: number;
  emotion?: Emotion;
  gesture?: AvatarIntentGesture;
  facialAccent?: AvatarIntentFacialAccent;
  gestureIntensity?: 0 | 1 | 2 | 3;
  energy?: 0 | 1 | 2 | 3;
  holdMs?: number;
  reason?: string;
}

export type RemiTurnState =
  | "listening_active"
  | "listening_hold"
  | "likely_end"
  | "confirmed_end"
  | "assistant_entering"
  | "assistant_speaking"
  | "interrupted_by_user";

export type RemiTurnStateReason =
  | "speech_start"
  | "partial_growth"
  | "semantic_hold"
  | "likely_end"
  | "confirmed_end"
  | "tts_prepare"
  | "playback_start"
  | "user_interrupt";

export type InterruptionType =
  | "continuation"
  | "correction"
  | "topic_switch"
  | "emotional_interrupt"
  | "unknown";

export type ExpressionBlendMode = "overwrite" | "add" | "multiply";

export interface AvatarFrame {
  face?: Partial<FaceParams>;
  lipSync?: LipSyncFrame;
  action?: ActionCommand;
  emotion?: Emotion;
  blendMode?: ExpressionBlendMode;
}

export type AvatarPhase = "idle" | "speaking";

export type AvatarCommand =
  | {
      kind: "set_emotion";
      emotion: Emotion;
      transitionMs?: number;
    }
  | {
      kind: "play_action";
      action: ActionCommand;
    }
  | {
      kind: "set_phase";
      phase: AvatarPhase;
      reason?: "tts_start" | "tts_end" | "interrupt" | "startup";
    };

export type RemiServerMessage =
  | {
      type: "emotion";
      emotion: Emotion;
    }
  | {
      type: "history_page";
      mode: "replace" | "prepend";
      messages: Array<{
        id: string;
        role: "user" | "assistant";
        content: string;
        createdAt: string;
      }>;
      hasMore: boolean;
      nextCursor: {
        id: string;
        createdAt: string;
      } | null;
    }
  | {
      type: "chat_chunk";
      content: string;
      generationId: number;
    }
  | {
      type: "chat_end";
      emotion?: Emotion;
      content?: string;
      generationId: number;
      ttsPending?: boolean;
    }
  | {
      type: "tts_end";
      generationId: number;
    }
  | {
      type: "voice";
      audio: string;
      generationId?: number;
    }
  | {
      type: "voice_pcm_chunk";
      audio: string;
      sampleRate: number;
      channels: 1;
      bitsPerSample: 16;
      generationId: number;
    }
  | {
      type: "tts_lip_sync";
      generationId: number;
      source: TtsLipSyncSource;
      mode: TtsLipSyncMode;
      complete: boolean;
      cues: TtsLipCue[];
    }
  | {
      type: "interrupt";
      generationId?: number;
    }
  | {
      type: "stt_partial";
      content: string;
    }
  | {
      type: "stt_prediction";
      status: "finished";
      preview: string;
    }
  | {
      type: "turn_state";
      state: RemiTurnState;
      reason: RemiTurnStateReason;
      generationId?: number;
      preview?: string;
      interruptionType?: InterruptionType;
    }
  | {
      type: "stt_final";
      content: string;
    }
  | {
      type: "vad_start";
    }
  | {
      type: "vad_end";
    }
  | {
      type: "avatar_frame";
      frame: AvatarFrame;
    }
  | {
      type: "avatar_command";
      command: AvatarCommand;
    }
  | {
      type: "avatar_state";
      phase: AvatarPhase;
    }
  | {
      type: "avatar_intent";
      intent: AvatarIntent;
      beats?: AvatarIntentBeat[];
    }
  | {
      type: "dev_preset_applied";
      personaPreset: string | null;
      relationshipPreset: string | null;
      resetScope: "session" | "relationship" | "all";
    }
  | {
      type: "dev_tts_voice_applied";
      voiceType: string | null;
      source: "runtime_override" | "env_default";
    }
  | {
      type: "dev_state_reset";
      scope: "session" | "relationship" | "all";
    }
  | {
      type: "nsfw_mode_state";
      enabled: boolean;
    }
  | {
      type: "persona_preset_state";
      presetId: string;
    }
  | {
      type: "persona_pack_state";
      packId: string;
      name: string;
      displayName: string;
      voice: {
        provider?: string;
        voiceId?: string;
        mlxInstruct?: string;
        mlxSpeaker?: string;
      } | null;
      avatar: {
        kind?: "live2d" | "vrm" | "portrait";
        modelId?: string;
        url?: string;
      } | null;
      memoryScope: "per_pack" | "shared";
    }
  | {
      type: "voice_style_ack";
      voiceStyleId?: string | null;
      speedModifier?: string | null;
      pitchModifier?: string | null;
      ttsEnabled?: boolean;
      source?: string;
      ignored?: boolean;
      activePersonaPackId?: string;
    }
  | {
      // Ack for the WS `set_voice_engine` override (realtime voice shell).
      // `engine` is the id that actually took effect; `fellBack` is true when it
      // differs from `requested` (unknown id / non-brain authority → legacy).
      type: "voice_engine_ack";
      engine: string;
      requested: string;
      fellBack: boolean;
    }
  | {
      type: "error";
      content: string;
    };

export type RemiServerMessageType = RemiServerMessage["type"];
