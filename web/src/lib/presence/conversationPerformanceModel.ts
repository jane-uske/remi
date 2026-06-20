import type { AvatarRenderModel, PortraitMotionPhase } from "@/runtime/avatarRenderModel";
import type { CanonicalAvatarState } from "@/runtime/remiRuntimeAdapter";
import type { VoiceIndicatorModel } from "@/runtime/remiRuntimeSelectors";

export type ConversationPresencePhase = PortraitMotionPhase;
export type ConversationAttentionTarget = "user" | "inner" | "front";
export type ConversationLanguageChannel = "none" | "assistant" | "user";
export type ConversationLanguageBoundary =
  | "none"
  | "comma"
  | "terminal"
  | "emphasis";
export type ConversationBubbleTone =
  | "idle"
  | "attentive"
  | "thinking"
  | "preparing"
  | "speaking"
  | "settling"
  | "yield";

export type ConversationPresenceFixture = {
  enabled: boolean;
  phase: ConversationPresencePhase;
  assistantText: string;
  nonce: number;
  startedAtMs?: number;
};

export type ConversationPerformanceModel = {
  source: "runtime" | "fixture";
  phase: ConversationPresencePhase;
  phaseStartedAtMs: number | null;
  phaseCueText: string | null;
  attentionTarget: ConversationAttentionTarget;
  energyLevel: number;
  languageBeat: {
    channel: ConversationLanguageChannel;
    text: string;
    textLength: number;
    tokenCount: number;
    clauseIndex: number;
    boundary: ConversationLanguageBoundary;
    emphasis: number;
    progress: number;
    cadenceMs: number;
    seed: number;
  };
  chatSync: {
    statusLabel: string | null;
    bubbleTone: ConversationBubbleTone;
    showPreparingBubble: boolean;
    showThinkingPulse: boolean;
    showListeningPulse: boolean;
    showYieldClamp: boolean;
    revealCadenceMs: number;
    tailHoldMs: number;
    emphasisStrength: number;
    displayStreamingText: string;
    displayPartialText: string;
  };
  avatarSync: {
    mouthFloor: number;
    gazeBiasX: number;
    gazeBiasY: number;
    headImpulse: number;
    bodyImpulse: number;
    yieldClamp: number;
    attentivePulse: number;
  };
};

export type BuildConversationPerformanceModelInput = {
  runtimeState?: CanonicalAvatarState | null;
  renderModel?: AvatarRenderModel | null;
  streamingText?: string;
  sttPartialText?: string;
  fixture?: ConversationPresenceFixture | null;
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function sanitizeText(value: string | null | undefined): string {
  return String(value ?? "").replace(/\s+$/u, "");
}

function resolveRuntimePhase(
  runtimeState?: CanonicalAvatarState | null,
): ConversationPresencePhase {
  switch (runtimeState?.phaseReason) {
    case "user_voice":
    case "user_hold":
      return "listening";
    case "open_mic_idle":
      return "open_mic_idle";
    case "awaiting_model":
    case "assistant_text_streaming":
      return "thinking";
    case "assistant_audio_prepare":
      return "speaking_prepare";
    case "assistant_audio_active":
      return "speaking_active";
    case "assistant_audio_tail":
      return "speaking_tail";
    case "user_interrupt":
      return "yield";
    default:
      break;
  }

  switch (runtimeState?.phase) {
    case "listening":
      return "listening";
    case "thinking":
      return "thinking";
    case "speaking":
      return "speaking_active";
    case "reacting":
      return "yield";
    default:
      return "idle";
  }
}

function resolvePhase(
  runtimeState?: CanonicalAvatarState | null,
  renderModel?: AvatarRenderModel | null,
  fixture?: ConversationPresenceFixture | null,
): ConversationPresencePhase {
  if (fixture?.enabled) return fixture.phase;
  if (renderModel?.motionPhase) return renderModel.motionPhase;
  return resolveRuntimePhase(runtimeState);
}

function resolveAttentionTarget(
  phase: ConversationPresencePhase,
): ConversationAttentionTarget {
  switch (phase) {
    case "listening":
    case "open_mic_idle":
    case "yield":
      return "user";
    case "thinking":
      return "inner";
    default:
      return "front";
  }
}

function resolveAssistantText(
  phase: ConversationPresencePhase,
  streamingText: string,
  fixture?: ConversationPresenceFixture | null,
): string {
  if (phase === "yield") return "";
  if (fixture?.enabled) {
    if (phase === "speaking_prepare") return "";
    return sanitizeText(fixture.assistantText);
  }
  return sanitizeText(streamingText);
}

function lastBoundary(text: string): ConversationLanguageBoundary {
  const trimmed = text.trim();
  if (!trimmed) return "none";
  const lastChar = trimmed[trimmed.length - 1] ?? "";
  if (/[!！?？]/u.test(lastChar)) return "emphasis";
  if (/[,，、]/u.test(lastChar)) return "comma";
  if (/[.。;；:：]/u.test(lastChar)) return "terminal";
  return "none";
}

function countTokens(text: string): number {
  if (!text) return 0;
  const matches = text.match(/[\u4e00-\u9fff]|[A-Za-z0-9']+/gu);
  return matches?.length ?? 0;
}

function countClauses(text: string): number {
  if (!text) return 0;
  const matches = text.match(/[,，、.。!?！？;；:：\n]/gu);
  return matches?.length ?? 0;
}

function resolveCadenceMs(
  phase: ConversationPresencePhase,
  channel: ConversationLanguageChannel,
  boundary: ConversationLanguageBoundary,
): number {
  if (channel === "assistant") {
    let base =
      phase === "speaking_prepare"
        ? 30
        : phase === "speaking_tail"
          ? 34
          : phase === "thinking"
            ? 28
            : 22;
    if (boundary === "comma") base += 4;
    if (boundary === "terminal") base += 6;
    if (boundary === "emphasis") base -= 2;
    return base;
  }
  if (channel === "user") return phase === "listening" ? 30 : 36;
  return phase === "thinking" ? 40 : 46;
}

function resolveEnergyLevel(
  phase: ConversationPresencePhase,
  boundary: ConversationLanguageBoundary,
  progress: number,
): number {
  let base = 0.2;
  switch (phase) {
    case "listening":
      base = 0.34;
      break;
    case "open_mic_idle":
      base = 0.28;
      break;
    case "thinking":
      base = 0.24;
      break;
    case "speaking_prepare":
      base = 0.48;
      break;
    case "speaking_active":
      base = 0.62;
      break;
    case "speaking_tail":
      base = 0.3;
      break;
    case "yield":
      base = 0.14;
      break;
    default:
      base = 0.22;
      break;
  }

  const emphasisBoost =
    boundary === "emphasis" ? 0.12 : boundary === "terminal" ? 0.06 : 0;
  return clamp01(base + emphasisBoost + progress * 0.08);
}

function resolveStatusLabel(
  phase: ConversationPresencePhase,
  assistantText: string,
  partialText: string,
): string | null {
  switch (phase) {
    case "listening":
      return partialText ? "在跟着你" : "听着";
    case "open_mic_idle":
      return "在线等你";
    case "thinking":
      return assistantText ? "在组织这句" : "准备回复";
    case "speaking_prepare":
      return "开口中";
    case "speaking_active":
      return assistantText ? "说着" : "开口中";
    case "speaking_tail":
      return "收尾中";
    case "yield":
      return "先让给你";
    default:
      return null;
  }
}

function resolvePhaseCueText(
  phase: ConversationPresencePhase,
): string | null {
  switch (phase) {
    case "listening":
      return "Remi 正在跟着你听";
    case "open_mic_idle":
      return "Remi 在线，等你继续";
    case "thinking":
      return "Remi 正在组织这句回复";
    case "speaking_prepare":
      return "Remi 正在起句";
    case "speaking_active":
      return "Remi 正在顺着这句说";
    case "speaking_tail":
      return "Remi 在收住这句";
    case "yield":
      return "Remi 先停一下，让你接话";
    default:
      return null;
  }
}

function resolveBubbleTone(
  phase: ConversationPresencePhase,
): ConversationBubbleTone {
  switch (phase) {
    case "listening":
    case "open_mic_idle":
      return "attentive";
    case "thinking":
      return "thinking";
    case "speaking_prepare":
      return "preparing";
    case "speaking_active":
      return "speaking";
    case "speaking_tail":
      return "settling";
    case "yield":
      return "yield";
    default:
      return "idle";
  }
}

function buildAvatarSync(
  phase: ConversationPresencePhase,
  emphasis: number,
  progress: number,
  partialText: string,
): ConversationPerformanceModel["avatarSync"] {
  switch (phase) {
    case "listening":
      return {
        mouthFloor: 0,
        gazeBiasX: 0.08,
        gazeBiasY: 0.04,
        headImpulse: 0.14,
        bodyImpulse: 0.08,
        yieldClamp: 0,
        attentivePulse: partialText ? 0.16 : 0.1,
      };
    case "open_mic_idle":
      return {
        mouthFloor: 0,
        gazeBiasX: 0.04,
        gazeBiasY: 0.02,
        headImpulse: 0.08,
        bodyImpulse: 0.05,
        yieldClamp: 0,
        attentivePulse: 0.08,
      };
    case "thinking":
      return {
        mouthFloor: 0.01,
        gazeBiasX: -0.08,
        gazeBiasY: -0.2,
        headImpulse: -0.08,
        bodyImpulse: -0.04,
        yieldClamp: 0,
        attentivePulse: 0,
      };
    case "speaking_prepare":
      return {
        mouthFloor: 0.18,
        gazeBiasX: 0.1,
        gazeBiasY: 0.03,
        headImpulse: 0.56,
        bodyImpulse: 0.42,
        yieldClamp: 0,
        attentivePulse: 0,
      };
    case "speaking_active":
      return {
        mouthFloor: 0.1 + emphasis * 0.14,
        gazeBiasX: 0.05 + progress * 0.05,
        gazeBiasY: 0.01,
        headImpulse: 0.26 + emphasis * 0.28,
        bodyImpulse: 0.24 + emphasis * 0.34,
        yieldClamp: 0,
        attentivePulse: 0,
      };
    case "speaking_tail":
      return {
        mouthFloor: 0.03,
        gazeBiasX: -0.02,
        gazeBiasY: -0.08,
        headImpulse: -0.12,
        bodyImpulse: -0.08,
        yieldClamp: 0,
        attentivePulse: 0,
      };
    case "yield":
      return {
        mouthFloor: 0,
        gazeBiasX: -0.12,
        gazeBiasY: -0.24,
        headImpulse: -0.46,
        bodyImpulse: -0.3,
        yieldClamp: 1,
        attentivePulse: 0,
      };
    default:
      return {
        mouthFloor: 0,
        gazeBiasX: 0,
        gazeBiasY: 0,
        headImpulse: 0.04,
        bodyImpulse: 0.02,
        yieldClamp: 0,
        attentivePulse: 0,
      };
  }
}

export function selectVoiceIndicatorFromPerformanceModel(
  performanceModel: ConversationPerformanceModel,
  runtimeState?: CanonicalAvatarState | null,
): VoiceIndicatorModel {
  const active =
    performanceModel.phase === "speaking_active" ||
    performanceModel.phase === "speaking_prepare" ||
    performanceModel.phase === "speaking_tail" ||
    Boolean(runtimeState?.assistant.playbackActive) ||
    Boolean(runtimeState?.assistant.playbackTailActive);

  const label =
    performanceModel.chatSync.statusLabel ??
    (active
      ? "说着"
      : performanceModel.phase === "listening"
        ? "听着"
        : performanceModel.phase === "thinking"
          ? "思考"
          : "在线");

  return { active, label };
}

export function createDefaultConversationPresenceFixture(): ConversationPresenceFixture {
  return {
    enabled: false,
    phase: "speaking_active",
    assistantText: "我在这里，我们继续。",
    nonce: 0,
    startedAtMs: 0,
  };
}

export function buildConversationPerformanceModel(
  input: BuildConversationPerformanceModelInput,
): ConversationPerformanceModel {
  const phase = resolvePhase(input.runtimeState, input.renderModel, input.fixture);
  const partialText = sanitizeText(input.sttPartialText);
  const assistantText = resolveAssistantText(
    phase,
    sanitizeText(input.streamingText),
    input.fixture,
  );
  const attentionTarget = resolveAttentionTarget(phase);
  const phaseStartedAtMs = input.fixture?.enabled
    ? (input.fixture.startedAtMs ?? input.runtimeState?.derivedAtMs ?? null)
    : (input.runtimeState?.turn.sinceAtMs ?? input.runtimeState?.derivedAtMs ?? null);
  const channel: ConversationLanguageChannel = assistantText
    ? "assistant"
    : partialText
      ? "user"
      : "none";
  const beatText = channel === "assistant" ? assistantText : partialText;
  const boundary = lastBoundary(beatText);
  const tokenCount = countTokens(beatText);
  const clauseIndex = countClauses(beatText);
  const progress = clamp01(beatText.length / 18);
  const emphasis =
    boundary === "emphasis"
      ? 0.58
      : boundary === "terminal"
        ? 0.26
        : boundary === "comma"
          ? 0.18
          : 0;
  const cadenceMs = resolveCadenceMs(phase, channel, boundary);
  const energyLevel = resolveEnergyLevel(phase, boundary, progress);
  const avatarSync = buildAvatarSync(phase, emphasis, progress, partialText);

  return {
    source: input.fixture?.enabled ? "fixture" : "runtime",
    phase,
    phaseStartedAtMs,
    phaseCueText: resolvePhaseCueText(phase),
    attentionTarget,
    energyLevel,
    languageBeat: {
      channel,
      text: beatText,
      textLength: beatText.length,
      tokenCount,
      clauseIndex,
      boundary,
      emphasis,
      progress,
      cadenceMs,
      seed: tokenCount * 0.71 + clauseIndex * 1.13 + emphasis * 7,
    },
    chatSync: {
      statusLabel: resolveStatusLabel(phase, assistantText, partialText),
      bubbleTone: resolveBubbleTone(phase),
      showPreparingBubble: phase === "speaking_prepare" && assistantText.length === 0,
      showThinkingPulse: phase === "thinking",
      showListeningPulse: phase === "listening" || phase === "open_mic_idle",
      showYieldClamp: phase === "yield",
      revealCadenceMs: cadenceMs,
      tailHoldMs: phase === "speaking_tail" ? 220 : 0,
      emphasisStrength: emphasis,
      displayStreamingText: assistantText,
      displayPartialText: partialText,
    },
    avatarSync,
  };
}
