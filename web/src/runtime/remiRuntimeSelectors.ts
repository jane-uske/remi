import type { CanonicalAvatarState } from "./remiRuntimeAdapter";

export type ChatWindowStatusModel = {
  badgeLabel: string | null;
  responseBusy: boolean;
};

export type VoiceIndicatorModel = {
  active: boolean;
  label: string;
};

export function getRuntimePresenceLabel(state: CanonicalAvatarState): string {
  switch (state.phase) {
    case "listening":
      return "在听";
    case "thinking":
      return "思考中";
    case "speaking":
      return "说话中";
    case "reacting":
      return "在接话";
    default:
      return "在这里";
  }
}

export function getRuntimeCompanionLine(state: CanonicalAvatarState): string {
  if (state.connection === "connecting") {
    return "我正在重新接上，不会把这段对话丢掉。";
  }
  if (state.connection === "closed") {
    return "我会尽快重新接上，不会把这段对话丢在这里。";
  }

  switch (state.phaseReason) {
    case "user_voice":
      return "我在听，你慢慢说。";
    case "user_hold":
      return "我先不抢话，等你把这句落稳。";
    case "awaiting_commit":
      return "我收到了，等最后这点声音落下来。";
    case "assistant_audio_prepare":
      return "我接上了，马上开口。";
    case "assistant_audio_active":
    case "assistant_audio_tail":
      return "我在这里，不会让对话掉下去。";
    case "assistant_text_streaming":
    case "awaiting_model":
      return "让我想一下，我马上接上。";
    case "user_interrupt":
      return "听到了，我先让给你。";
    case "open_mic_idle":
      return "我在线，等你继续。";
    default:
      break;
  }

  switch (state.affect.emotion) {
    case "happy":
      return "今天有什么想和我分享的？";
    case "sad":
      return "不想硬撑的话，也可以先跟我说。";
    case "curious":
      return "今天发生了什么新鲜事？";
    default:
      return "我会一直在这里接着聊。";
  }
}

export function selectListeningHint(
  state: CanonicalAvatarState,
  sttPartialText: string,
): boolean {
  return state.phaseReason === "user_voice" && String(sttPartialText).trim().length === 0;
}

export function selectThinkingHint(state: CanonicalAvatarState): boolean {
  return state.phase === "thinking" && state.phaseReason === "awaiting_model";
}

export function selectChatWindowStatus(
  state: CanonicalAvatarState,
): ChatWindowStatusModel {
  let badgeLabel: string | null = null;

  switch (state.phaseReason) {
    case "user_voice":
      badgeLabel = "听着";
      break;
    case "user_hold":
    case "open_mic_idle":
    case "awaiting_commit":
      badgeLabel = "还在听";
      break;
    case "user_interrupt":
      badgeLabel = "被打断";
      break;
    case "assistant_audio_prepare":
      badgeLabel = "开口中";
      break;
    default:
      break;
  }

  if (state.phase === "thinking") {
    badgeLabel =
      state.turn.serverState === "likely_end" ? "Remi 正在回应" : "Remi 正在回复";
  }

  if (state.connection !== "open") {
    return {
      badgeLabel,
      responseBusy: false,
    };
  }

  return {
    badgeLabel,
    responseBusy:
      state.phase === "thinking" ||
      state.phase === "reacting" ||
      state.phaseReason === "assistant_audio_prepare" ||
      state.turn.serverState === "likely_end" ||
      state.turn.serverState === "confirmed_end" ||
      state.turn.serverState === "assistant_entering" ||
      state.turn.serverState === "interrupted_by_user",
  };
}

export function selectVoiceIndicatorModel(
  state: CanonicalAvatarState,
): VoiceIndicatorModel {
  const active =
    state.assistant.playbackActive || state.assistant.playbackTailActive;

  return {
    active,
    label: active ? "speaking" : "voice",
  };
}

export function toLegacyRemState(state: CanonicalAvatarState) {
  switch (state.phase) {
    case "listening":
      return "listening" as const;
    case "thinking":
      return "thinking" as const;
    case "speaking":
      return "speaking" as const;
    case "reacting":
      return "listening" as const;
    default:
      return "idle" as const;
  }
}
