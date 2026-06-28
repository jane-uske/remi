"use client";

import type {
  AvatarActionCommand,
  AvatarFrameState,
  AvatarIntent,
  AvatarIntentBeat,
  TtsLipSyncPatch,
} from "@/types/avatar";
import { mergeAvatarRuntimeSnapshot, pushAvatarDevtoolsLog } from "@/lib/rem3d/devtoolsStore";
import {
  shouldAwaitPlaybackDrain,
  shouldFinalizeDeferredChatEnd,
} from "./useRemiChatTurnState";
import {
  isListeningFallbackText,
  dedupeChatMessagesById,
  mergeSttPartialText,
  resolveLegacyMessageStorageKey,
  uid,
} from "./useRemiChatHelpers";
import {
  parseGenerationId,
  parseServerHistoryPage,
  parseServerTurnState,
} from "./useRemiChatProtocol";
import type { ChatMessage } from "@/types/chat";
import { stripEmotionTags, stripTrailingEmotionWord } from "@/lib/chat/stripEmotionTags";

// ── Video progress ────────────────────────────────────────

/** Stable id for the single live "video generating…" bar message. */
const VIDEO_PROGRESS_ID = "video-progress";

function clampPercent(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n)));
}

// ── Ref shorthand ─────────────────────────────────────────

type Ref<T> = { current: T };

// ── Sub-context types ─────────────────────────────────────

export interface AvatarCallbacks {
  setEmotion: (v: string) => void;
  setAvatarFrame: (fn: (prev: AvatarFrameState | null) => AvatarFrameState | null) => void;
  setAvatarAction: (v: { action: AvatarActionCommand; nonce: number } | null) => void;
  setAvatarIntentOverride: (v: AvatarIntent | null) => void;
  clearAvatarIntentSchedule: () => void;
  triggerIntentGestureAction: (intent: AvatarIntent | null) => void;
  mergeIntentBeat: (base: AvatarIntent, beat: AvatarIntentBeat) => AvatarIntent;
  avatarBeatTimersRef: Ref<ReturnType<typeof setTimeout>[]>;
}

interface TurnEngineCtx {
  activeGenerationRef: Ref<number | null>;
  playedGenerationIdsRef: Ref<Set<number>>;
  pendingChatEndRef: Ref<{
    generationId: number | null;
    awaitingPlaybackDrain: boolean;
    awaitingTtsEnd: boolean;
  } | null>;
  pendingChatEndTimerRef: Ref<ReturnType<typeof setTimeout> | null>;
  sttPredictionPreviewRef: Ref<string | null>;
  interruptionTypeRef: Ref<string | null>;
  commitTurnState: (
    state: string,
    reason: string,
    meta?: Record<string, unknown>,
  ) => void;
  clearPendingChatEnd: (generationId?: number | null) => void;
  finalizePendingChatEnd: (generationId: number | null) => void;
  blockGeneration: (id: number) => void;
  rememberPlayedGeneration: (id: number | null) => void;
  rememberLoggedVoiceGeneration: (id: number | null) => boolean;
  setSttPredictionPreview: (v: string | null) => void;
  setInterruptionType: (v: string | null) => void;
}

interface VoiceCtx {
  duplexRef: Ref<boolean>;
  recordingRef: Ref<boolean>;
  userSpeakingRef: Ref<boolean>;
  userSpeakingEndTimerRef: Ref<ReturnType<typeof setTimeout> | null>;
  clearUserSpeakingEndTimer: () => void;
  setUserSpeaking: (v: boolean) => void;
  setAwaitingSpeechCommitState: (v: boolean) => void;
  setInputPlaceholder: (v: string) => void;
  syncInputPlaceholder: (state: {
    recording: boolean;
    userSpeaking: boolean;
    awaitingSpeechCommit?: boolean;
  }) => void;
}

interface MessagesCtx {
  historySourceRef: Ref<string>;
  historyCursorRef: Ref<{ id: string; createdAt: string } | null>;
  historyLoadingMoreRef: Ref<boolean>;
  historyMessages: ChatMessage[];
  persistedMessagesRef: Ref<ChatMessage[]>;
  setHistoryMessages: (
    v: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[]),
  ) => void;
  setHistoryHasMore: (v: boolean) => void;
  setHistoryLoadingMore: (v: boolean) => void;
  setLiveMessages: (
    v: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[]),
  ) => void;
  appendLiveMessage: (msg: ChatMessage) => void;
  appendUserTranscript: (text: string) => void;
  markHistoryMutation: (kind: string) => void;
}

// ── Main context ──────────────────────────────────────────

export interface MessageDispatchCtx {
  streamingBufRef: Ref<string>;
  appendStreaming: (chunk: string) => void;
  resetStreaming: () => void;

  waitingRef: Ref<boolean>;
  setWaiting: (v: boolean) => void;
  setTyping: (v: boolean) => void;
  setSttPartialText: (v: string | ((prev: string) => string)) => void;
  setPersonaPreset: (v: string | null) => void;
  setPersonaPack: (v: { packId: string; name: string; displayName: string } | null) => void;
  setNsfwEnabled: (v: boolean) => void;

  pendingDevCommandRef: Ref<{ kind: string; scope?: string } | null>;
  setDevStatus: (v: { tone: string; message: string }) => void;
  describeResetScope: (scope: "session" | "relationship" | "all") => string;
  messageStorageKey: string;

  voiceActive: boolean;
  markServerTtsStreaming: (streaming: boolean) => void;
  clearQueue: () => void;
  enqueueBase64: (data: string, generationId: number | null) => void;
  enqueuePcmChunk: (
    data: string,
    sampleRate: number,
    generationId: number | null,
  ) => void;
  applyTtsLipSyncPatch: (patch: TtsLipSyncPatch) => void;

  allowServerGeneration: (
    type: string,
    rawGenerationId: unknown,
  ) => boolean;

  turnEngine: TurnEngineCtx;
  voice: VoiceCtx;
  msgs: MessagesCtx;
  avatarCallbacksRef: Ref<AvatarCallbacks>;
}

// ── Handler implementations ───────────────────────────────

function handleHistoryPage(
  ctx: MessageDispatchCtx,
  data: Record<string, unknown>,
) {
  const { mode, messages: pageMessages, nextCursor, hasMore } =
    parseServerHistoryPage(data);

  const shouldAdoptServerHistory =
    mode === "prepend" ||
    pageMessages.length > 0 ||
    ctx.msgs.historyMessages.length === 0;

  if (shouldAdoptServerHistory) {
    ctx.msgs.historySourceRef.current = "server";
    ctx.msgs.historyCursorRef.current =
      nextCursor && nextCursor.id && nextCursor.createdAt
        ? nextCursor
        : null;
    ctx.msgs.setHistoryHasMore(hasMore);
  }
  ctx.msgs.historyLoadingMoreRef.current = false;
  ctx.msgs.setHistoryLoadingMore(false);

  if (mode === "replace") {
    if (shouldAdoptServerHistory) {
      const deduped = dedupeChatMessagesById(pageMessages);
      const historyIds = new Set(deduped.map((message) => message.id));
      ctx.msgs.setHistoryMessages(deduped);
      ctx.msgs.setLiveMessages((live) =>
        live.filter((message) => !historyIds.has(message.id)),
      );
      ctx.msgs.markHistoryMutation("replace");
    }
  } else if (pageMessages.length > 0) {
    ctx.msgs.setHistoryMessages((current) => {
      const seenIds = new Set(current.map((m) => m.id));
      const older = dedupeChatMessagesById(pageMessages).filter(
        (m) => !seenIds.has(m.id),
      );
      return older.length > 0 ? [...older, ...current] : current;
    });
    ctx.msgs.markHistoryMutation("prepend");
  }
}

function handleChatEnd(
  ctx: MessageDispatchCtx,
  data: Record<string, unknown>,
) {
  const av = ctx.avatarCallbacksRef.current;
  if (!ctx.allowServerGeneration("chat_end", data.generationId)) return;
  const text = stripTrailingEmotionWord(
    stripEmotionTags(ctx.streamingBufRef.current).trimEnd(),
    data.emotion as string | null | undefined,
  );
  ctx.resetStreaming();
  if (!ctx.voice.duplexRef.current) {
    ctx.waitingRef.current = false;
    ctx.setWaiting(false);
  }
  ctx.setSttPartialText("");
  ctx.voice.setInputPlaceholder("说点什么…");
  if (text) {
    ctx.msgs.appendLiveMessage({
      id: uid(),
      role: "rem",
      text,
      createdAt: new Date().toISOString(),
    });
  }
  const endGenerationId = parseGenerationId(data.generationId);
  if (
    endGenerationId != null &&
    ctx.turnEngine.activeGenerationRef.current === endGenerationId
  ) {
    ctx.turnEngine.activeGenerationRef.current = null;
  }
  if (data.emotion != null) av.setEmotion(String(data.emotion));
  const awaitingPlaybackDrain = shouldAwaitPlaybackDrain({
    voiceActive: ctx.voiceActive,
    playbackSeenForGeneration:
      endGenerationId != null &&
      ctx.turnEngine.playedGenerationIdsRef.current.has(endGenerationId),
  });
  const awaitingTtsEnd = Boolean(data.ttsPending);
  ctx.markServerTtsStreaming(awaitingTtsEnd);
  ctx.turnEngine.pendingChatEndRef.current = {
    generationId: endGenerationId,
    awaitingPlaybackDrain,
    awaitingTtsEnd,
  };
  if (!awaitingPlaybackDrain) {
    if (ctx.turnEngine.pendingChatEndTimerRef.current) {
      clearTimeout(ctx.turnEngine.pendingChatEndTimerRef.current);
    }
    ctx.turnEngine.pendingChatEndTimerRef.current = setTimeout(() => {
      if (!ctx.turnEngine.pendingChatEndRef.current) return;
      if (
        ctx.turnEngine.pendingChatEndRef.current.generationId !==
        endGenerationId
      )
        return;
      if (ctx.turnEngine.pendingChatEndRef.current.awaitingPlaybackDrain)
        return;
      if (ctx.turnEngine.pendingChatEndRef.current.awaitingTtsEnd)
        return;
      ctx.turnEngine.finalizePendingChatEnd(endGenerationId);
    }, 220);
  }
}

function handleTtsEnd(
  ctx: MessageDispatchCtx,
  data: Record<string, unknown>,
) {
  if (!ctx.allowServerGeneration("tts_end", data.generationId)) return;
  const generationId = parseGenerationId(data.generationId);
  const pending = ctx.turnEngine.pendingChatEndRef.current;
  if (!pending || pending.generationId !== generationId) return;

  pending.awaitingTtsEnd = false;
  ctx.markServerTtsStreaming(false);

  if (!pending.awaitingPlaybackDrain) {
    ctx.turnEngine.finalizePendingChatEnd(generationId);
    return;
  }

  if (
    shouldFinalizeDeferredChatEnd({
      awaitingPlaybackDrain: true,
      awaitingTtsEnd: false,
      voiceActive: ctx.voiceActive,
    })
  ) {
    ctx.turnEngine.finalizePendingChatEnd(generationId);
  }
}

function handleVoice(
  ctx: MessageDispatchCtx,
  data: Record<string, unknown>,
) {
  if (!ctx.allowServerGeneration("voice", data.generationId)) return;
  if (typeof data.audio !== "string") return;
  const generationId = parseGenerationId(data.generationId);
  ctx.markServerTtsStreaming(true);
  ctx.turnEngine.rememberPlayedGeneration(generationId);
  if (
    ctx.turnEngine.pendingChatEndRef.current?.generationId === generationId
  ) {
    ctx.turnEngine.pendingChatEndRef.current = {
      generationId,
      awaitingPlaybackDrain: true,
      awaitingTtsEnd:
        ctx.turnEngine.pendingChatEndRef.current.awaitingTtsEnd,
    };
    if (ctx.turnEngine.pendingChatEndTimerRef.current) {
      clearTimeout(ctx.turnEngine.pendingChatEndTimerRef.current);
      ctx.turnEngine.pendingChatEndTimerRef.current = null;
    }
  }
  ctx.turnEngine.commitTurnState("assistant_speaking", "playback_start", {
    generationId,
    kind: "ws",
  });
  ctx.enqueueBase64(data.audio, generationId);
  if (ctx.turnEngine.rememberLoggedVoiceGeneration(generationId)) {
    pushAvatarDevtoolsLog("ws", "voice start", {
      generationId,
      transport: "voice",
    });
  }
}

function handleVoicePcmChunk(
  ctx: MessageDispatchCtx,
  data: Record<string, unknown>,
) {
  if (!ctx.allowServerGeneration("voice_pcm_chunk", data.generationId))
    return;
  if (typeof data.audio !== "string") return;
  const rate = Number(data.sampleRate);
  const generationId = parseGenerationId(data.generationId);
  ctx.markServerTtsStreaming(true);
  ctx.turnEngine.rememberPlayedGeneration(generationId);
  if (
    ctx.turnEngine.pendingChatEndRef.current?.generationId === generationId
  ) {
    ctx.turnEngine.pendingChatEndRef.current = {
      generationId,
      awaitingPlaybackDrain: true,
      awaitingTtsEnd:
        ctx.turnEngine.pendingChatEndRef.current.awaitingTtsEnd,
    };
    if (ctx.turnEngine.pendingChatEndTimerRef.current) {
      clearTimeout(ctx.turnEngine.pendingChatEndTimerRef.current);
      ctx.turnEngine.pendingChatEndTimerRef.current = null;
    }
  }
  ctx.turnEngine.commitTurnState("assistant_speaking", "playback_start", {
    generationId,
    kind: "ws",
  });
  ctx.enqueuePcmChunk(
    data.audio,
    Number.isFinite(rate) && rate > 0 ? rate : 24000,
    generationId,
  );
  if (ctx.turnEngine.rememberLoggedVoiceGeneration(generationId)) {
    pushAvatarDevtoolsLog("ws", "voice start", {
      generationId,
      transport: "voice_pcm_chunk",
      sampleRate: Number.isFinite(rate) && rate > 0 ? rate : 24000,
    });
  }
}

function handleAvatarIntent(
  ctx: MessageDispatchCtx,
  data: Record<string, unknown>,
) {
  const av = ctx.avatarCallbacksRef.current;
  const intent =
    data.intent && typeof data.intent === "object"
      ? (data.intent as AvatarIntent)
      : null;
  const beats = Array.isArray(data.beats)
    ? (data.beats as AvatarIntentBeat[])
    : [];
  av.clearAvatarIntentSchedule();
  if (!intent) return;
  av.setAvatarIntentOverride(intent);
  av.triggerIntentGestureAction(intent);
  pushAvatarDevtoolsLog("ws", "avatar_intent", {
    intent,
    beats: beats.length,
  });
  let endAt = Date.now() + Math.max(260, intent.holdMs);
  for (const beat of beats) {
    const merged = av.mergeIntentBeat(intent, beat);
    const timer = setTimeout(() => {
      av.setAvatarIntentOverride(merged);
      av.triggerIntentGestureAction(merged);
    }, Math.max(0, beat.delayMs));
    av.avatarBeatTimersRef.current.push(timer);
    endAt = Math.max(
      endAt,
      Date.now() + Math.max(0, beat.delayMs) + Math.max(260, merged.holdMs),
    );
  }
  const resetTimer = setTimeout(() => {
    av.setAvatarIntentOverride(intent);
  }, Math.max(0, endAt - Date.now()));
  av.avatarBeatTimersRef.current.push(resetTimer);
}

function handleSttFinal(
  ctx: MessageDispatchCtx,
  data: Record<string, unknown>,
) {
  const content = String(data.content ?? "");
  ctx.turnEngine.activeGenerationRef.current = null;
  ctx.voice.clearUserSpeakingEndTimer();
  ctx.voice.userSpeakingRef.current = false;
  ctx.voice.setUserSpeaking(false);
  ctx.voice.setAwaitingSpeechCommitState(false);
  ctx.setSttPartialText("");
  ctx.msgs.appendUserTranscript(content);
  ctx.voice.setInputPlaceholder("说点什么…");
  if (!ctx.voice.duplexRef.current) {
    ctx.waitingRef.current = true;
    ctx.setWaiting(true);
  }
  ctx.setTyping(true);
  ctx.turnEngine.commitTurnState("confirmed_end", "confirmed_end", {
    kind: "ws",
  });
}

function handleTtsLipSync(
  ctx: MessageDispatchCtx,
  data: Record<string, unknown>,
) {
  if (!ctx.allowServerGeneration("tts_lip_sync", data.generationId)) return;
  const generationId = parseGenerationId(data.generationId);
  if (generationId == null || !Array.isArray(data.cues)) return;
  const source =
    data.source === "provider_viseme"
      ? "provider_viseme"
      : "provider_word_boundary_derived";
  const mode = data.mode === "replace" ? "replace" : "append";
  ctx.applyTtsLipSyncPatch({
    generationId,
    source,
    mode,
    complete: data.complete === true,
    cues: data.cues as TtsLipSyncPatch["cues"],
  });
  pushAvatarDevtoolsLog("ws", "tts_lip_sync", {
    generationId,
    source,
    mode,
    complete: data.complete === true,
    cueCount: data.cues.length,
  });
}

function handleAvatarFrame(
  ctx: MessageDispatchCtx,
  data: Record<string, unknown>,
) {
  const av = ctx.avatarCallbacksRef.current;
  const frame = data.frame as
    | {
        action?: AvatarActionCommand;
        emotion?: string;
        face?: AvatarFrameState["face"];
        lipSync?: AvatarFrameState["lipSync"];
      }
    | undefined;
  const receivedAtMs = Date.now();
  if (frame?.emotion) av.setEmotion(String(frame.emotion));
  if (frame?.face || frame?.lipSync || frame?.emotion) {
    av.setAvatarFrame((prev) => ({
      emotion:
        (frame?.emotion as AvatarFrameState["emotion"]) ?? prev?.emotion,
      face: frame?.face ?? prev?.face,
      lipSync: frame?.lipSync ?? prev?.lipSync,
      lipSyncAtMs: frame?.lipSync ? receivedAtMs : prev?.lipSyncAtMs,
    }));
  }
  if (frame?.action) {
    av.setAvatarAction({
      action: frame.action,
      nonce: Date.now() + Math.floor(Math.random() * 1000),
    });
  }
  pushAvatarDevtoolsLog("ws", "avatar_frame", {
    hasEmotion: !!frame?.emotion,
    hasAction: !!frame?.action,
    hasFace: !!frame?.face,
    hasLipSync: !!frame?.lipSync,
    action: frame?.action?.action,
  });
}

function handleInterrupt(
  ctx: MessageDispatchCtx,
  data: Record<string, unknown>,
) {
  const av = ctx.avatarCallbacksRef.current;
  const interruptedGeneration = parseGenerationId(data.generationId);
  ctx.markServerTtsStreaming(false);
  ctx.turnEngine.clearPendingChatEnd(interruptedGeneration);
  if (interruptedGeneration != null) {
    ctx.turnEngine.blockGeneration(interruptedGeneration);
  } else {
    ctx.turnEngine.activeGenerationRef.current = null;
  }
  ctx.setSttPartialText("");
  ctx.clearQueue();
  av.clearAvatarIntentSchedule();
  av.setAvatarIntentOverride(null);
  ctx.turnEngine.sttPredictionPreviewRef.current = null;
  ctx.turnEngine.setSttPredictionPreview(null);
  ctx.resetStreaming();
  ctx.setTyping(false);
  ctx.turnEngine.interruptionTypeRef.current = "unknown";
  ctx.turnEngine.setInterruptionType("unknown");
  ctx.turnEngine.commitTurnState("interrupted_by_user", "user_interrupt", {
    interruptionType: "unknown",
    generationId: interruptedGeneration,
    kind: "ws",
  });
  pushAvatarDevtoolsLog("ws", "interrupt", {
    generationId: interruptedGeneration,
  });
}

function handleError(
  ctx: MessageDispatchCtx,
  data: Record<string, unknown>,
) {
  if (ctx.pendingDevCommandRef.current) {
    ctx.pendingDevCommandRef.current = null;
    ctx.setDevStatus({
      tone: "error",
      message: String(data.content ?? "开发操作失败"),
    });
  }
  ctx.msgs.historyLoadingMoreRef.current = false;
  ctx.msgs.setHistoryLoadingMore(false);
  ctx.turnEngine.clearPendingChatEnd();
  ctx.voice.clearUserSpeakingEndTimer();
  ctx.voice.userSpeakingRef.current = false;
  ctx.voice.setUserSpeaking(false);
  ctx.voice.setAwaitingSpeechCommitState(false);
  ctx.setTyping(false);
  ctx.setSttPartialText("");
  ctx.resetStreaming();
  ctx.waitingRef.current = false;
  ctx.setWaiting(false);
  ctx.voice.setInputPlaceholder("说点什么…");
  ctx.msgs.appendLiveMessage({
    id: uid(),
    role: "error",
    text: String(data.content ?? "错误"),
  });
}

function handleDevStateChange(
  ctx: MessageDispatchCtx,
  data: Record<string, unknown>,
) {
  const av = ctx.avatarCallbacksRef.current;
  ctx.pendingDevCommandRef.current = null;

  if (data.type === "dev_preset_applied") {
    const personaPresetVal =
      typeof data.personaPreset === "string" && data.personaPreset.trim()
        ? data.personaPreset.trim()
        : "";
    const relationshipPreset =
      typeof data.relationshipPreset === "string" &&
      data.relationshipPreset.trim()
        ? data.relationshipPreset.trim()
        : "";
    const parts = [
      personaPresetVal ? `人格：${personaPresetVal}` : "",
      relationshipPreset ? `关系：${relationshipPreset}` : "",
    ].filter(Boolean);
    ctx.setDevStatus({
      tone: "success",
      message:
        parts.length > 0
          ? `预设已应用 (${parts.join(" / ")})`
          : "预设已应用",
    });
  } else if (data.type === "dev_tts_voice_applied") {
    const voiceType =
      typeof data.voiceType === "string" && data.voiceType.trim()
        ? data.voiceType.trim()
        : "";
    ctx.setDevStatus({
      tone: "success",
      message: voiceType
        ? `Volc 音色已切到 ${voiceType}`
        : "Volc 音色已恢复环境默认",
    });
  } else {
    const scope =
      data.scope === "all" ||
      data.scope === "relationship" ||
      data.scope === "session"
        ? (data.scope as "session" | "relationship" | "all")
        : "session";
    ctx.setDevStatus({
      tone: "success",
      message: `${ctx.describeResetScope(scope)}已完成`,
    });
  }

  ctx.turnEngine.clearPendingChatEnd();
  ctx.voice.clearUserSpeakingEndTimer();
  ctx.voice.userSpeakingRef.current = false;
  ctx.voice.setUserSpeaking(false);
  ctx.voice.setAwaitingSpeechCommitState(false);
  ctx.setTyping(false);
  ctx.setSttPartialText("");
  ctx.resetStreaming();
  ctx.waitingRef.current = false;
  ctx.setWaiting(false);
  ctx.clearQueue();
  av.clearAvatarIntentSchedule();
  av.setAvatarIntentOverride(null);
  ctx.turnEngine.sttPredictionPreviewRef.current = null;
  ctx.turnEngine.setSttPredictionPreview(null);
  ctx.turnEngine.interruptionTypeRef.current = null;
  ctx.turnEngine.setInterruptionType(null);
  ctx.turnEngine.commitTurnState("confirmed_end", "confirmed_end", {
    kind: "system",
  });
  ctx.msgs.historySourceRef.current = "fallback";
  ctx.msgs.historyCursorRef.current = null;
  ctx.msgs.historyLoadingMoreRef.current = false;
  ctx.msgs.setHistoryLoadingMore(false);
  ctx.msgs.setHistoryHasMore(false);
  ctx.msgs.persistedMessagesRef.current = [];
  ctx.msgs.setHistoryMessages([]);
  ctx.msgs.setLiveMessages([]);
  ctx.msgs.markHistoryMutation("replace");
  try {
    localStorage.removeItem(ctx.messageStorageKey);
    localStorage.removeItem(
      resolveLegacyMessageStorageKey(ctx.messageStorageKey),
    );
  } catch {
    /* noop */
  }
}

// ── Main dispatch ─────────────────────────────────────────

export function createMessageDispatch(
  ctx: MessageDispatchCtx,
): (ev: MessageEvent) => void {
  return (ev: MessageEvent) => {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(ev.data as string) as Record<string, unknown>;
    } catch {
      return;
    }

    const t = data.type as string;
    const av = ctx.avatarCallbacksRef.current;

    switch (t) {
      case "turn_state": {
        const nextTurnState = parseServerTurnState(data);
        if (nextTurnState) {
          ctx.turnEngine.commitTurnState(
            nextTurnState.state,
            nextTurnState.reason,
            {
              preview: nextTurnState.preview,
              interruptionType: nextTurnState.interruptionType,
              generationId: nextTurnState.generationId,
              kind: "ws",
            },
          );
          if (ctx.voice.recordingRef.current) {
            if (nextTurnState.state === "listening_active") {
              ctx.voice.setAwaitingSpeechCommitState(false);
            } else if (
              !ctx.voice.userSpeakingRef.current &&
              (nextTurnState.state === "listening_hold" ||
                nextTurnState.state === "likely_end" ||
                nextTurnState.state === "confirmed_end")
            ) {
              ctx.voice.setAwaitingSpeechCommitState(true);
              ctx.voice.syncInputPlaceholder({
                recording: true,
                userSpeaking: false,
                awaitingSpeechCommit: true,
              });
            }
          }
        }
        break;
      }

      case "emotion":
        if (data.emotion != null) {
          const nextEmotion = String(data.emotion);
          av.setEmotion(nextEmotion);
          pushAvatarDevtoolsLog("ws", "emotion", { emotion: nextEmotion });
        }
        break;

      case "history_page":
        handleHistoryPage(ctx, data);
        break;

      case "chat_chunk":
        if (!ctx.allowServerGeneration("chat_chunk", data.generationId))
          break;
        if (!ctx.streamingBufRef.current) {
          ctx.turnEngine.commitTurnState(
            "assistant_entering",
            "tts_prepare",
            {
              generationId: parseGenerationId(data.generationId),
              kind: "ws",
            },
          );
        }
        ctx.voice.setAwaitingSpeechCommitState(false);
        ctx.setSttPartialText("");
        ctx.setTyping(false);
        ctx.appendStreaming(String(data.content ?? ""));
        break;

      case "chat_end":
        handleChatEnd(ctx, data);
        break;

      case "tts_end":
        handleTtsEnd(ctx, data);
        break;

      case "voice":
        handleVoice(ctx, data);
        break;

      case "voice_chunk":
      case "voice_pcm_chunk":
        handleVoicePcmChunk(ctx, data);
        break;

      case "tts_lip_sync":
        handleTtsLipSync(ctx, data);
        break;

      case "avatar_frame":
        handleAvatarFrame(ctx, data);
        break;

      case "avatar_intent":
        handleAvatarIntent(ctx, data);
        break;

      case "stt_prediction": {
        const preview =
          typeof data.preview === "string" && data.preview.trim()
            ? data.preview.trim()
            : null;
        ctx.turnEngine.sttPredictionPreviewRef.current = preview;
        ctx.turnEngine.setSttPredictionPreview(preview);
        mergeAvatarRuntimeSnapshot({
          ts: Date.now(),
          sttPredictionPreview: preview,
        });
        pushAvatarDevtoolsLog("ws", "stt prediction", {
          status: data.status,
          preview,
        });
        break;
      }

      case "interrupt":
        handleInterrupt(ctx, data);
        break;

      case "vad_start":
        ctx.voice.clearUserSpeakingEndTimer();
        ctx.voice.setAwaitingSpeechCommitState(false);
        ctx.setSttPartialText((prev: string) =>
          isListeningFallbackText(prev) ? "" : prev,
        );
        ctx.voice.userSpeakingRef.current = true;
        ctx.voice.setUserSpeaking(true);
        ctx.voice.syncInputPlaceholder({
          recording: ctx.voice.recordingRef.current,
          userSpeaking: true,
          awaitingSpeechCommit: false,
        });
        ctx.turnEngine.commitTurnState("listening_active", "speech_start", {
          kind: "ws",
        });
        break;

      case "vad_end":
        ctx.voice.clearUserSpeakingEndTimer();
        ctx.voice.userSpeakingEndTimerRef.current = setTimeout(() => {
          ctx.voice.userSpeakingEndTimerRef.current = null;
          ctx.voice.userSpeakingRef.current = false;
          ctx.voice.setUserSpeaking(false);
          if (ctx.voice.recordingRef.current) {
            ctx.voice.syncInputPlaceholder({
              recording: true,
              userSpeaking: false,
            });
          }
        }, 260);
        ctx.turnEngine.commitTurnState("listening_hold", "semantic_hold", {
          kind: "ws",
        });
        break;

      case "stt_partial": {
        const partial = String(data.content ?? "").trim();
        if (!partial) break;
        ctx.setSttPartialText((prev: string) =>
          mergeSttPartialText(prev, partial),
        );
        break;
      }

      case "stt_final":
        handleSttFinal(ctx, data);
        break;

      case "error":
        handleError(ctx, data);
        break;

      case "persona_preset_state": {
        const presetId =
          typeof data.presetId === "string" && data.presetId.trim()
            ? data.presetId.trim()
            : null;
        ctx.setPersonaPreset(presetId);
        break;
      }

      case "persona_pack_state": {
        const packId =
          typeof data.packId === "string" && data.packId.trim()
            ? data.packId.trim()
            : null;
        if (!packId) {
          ctx.setPersonaPack(null);
          break;
        }
        const name =
          typeof data.name === "string" && data.name.trim()
            ? data.name.trim()
            : packId;
        const displayName =
          typeof data.displayName === "string" && data.displayName.trim()
            ? data.displayName.trim()
            : name;
        ctx.setPersonaPack({ packId, name, displayName });
        break;
      }

      case "nsfw_mode_state":
        ctx.setNsfwEnabled(Boolean(data.enabled));
        break;

      case "dev_preset_applied":
      case "dev_tts_voice_applied":
      case "dev_state_reset":
        handleDevStateChange(ctx, data);
        break;

      // ── Video generation async results ────────────────────────────
      case "video_progress": {
        const percent = clampPercent(data.percent);
        const label = typeof data.label === "string" ? data.label : "";
        // Upsert a single live "bar" message so progress updates in place
        // rather than spamming the chat with one bubble per tick.
        ctx.msgs.setLiveMessages((prev) => {
          const text = `[videoprogress:${percent}|${label}]`;
          const idx = prev.findIndex((m) => m.id === VIDEO_PROGRESS_ID);
          if (idx === -1) {
            return [
              ...prev,
              {
                id: VIDEO_PROGRESS_ID,
                role: "rem" as const,
                text,
                createdAt: new Date().toISOString(),
              },
            ];
          }
          const next = prev.slice();
          next[idx] = { ...next[idx], text };
          return next;
        });
        break;
      }
      case "video_cancelled": {
        ctx.msgs.setLiveMessages((prev) =>
          prev.filter((m) => m.id !== VIDEO_PROGRESS_ID),
        );
        break;
      }
      case "video_ready": {
        const reply = typeof data.reply === "string" ? data.reply : "";
        ctx.msgs.setLiveMessages((prev) => {
          const cleared = prev.filter((m) => m.id !== VIDEO_PROGRESS_ID);
          if (!reply) return cleared;
          return [
            ...cleared,
            {
              id: `video-${Date.now()}`,
              role: "rem" as const,
              text: reply,
              createdAt: new Date().toISOString(),
            },
          ];
        });
        break;
      }
      case "video_error": {
        const errMsg = typeof data.error === "string" ? data.error : "视频生成失败了";
        ctx.msgs.setLiveMessages((prev) => [
          ...prev.filter((m) => m.id !== VIDEO_PROGRESS_ID),
          {
            id: `video-err-${Date.now()}`,
            role: "rem" as const,
            text: errMsg,
            createdAt: new Date().toISOString(),
          },
        ]);
        break;
      }

      default:
        break;
    }
  };
}
