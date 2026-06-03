"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type {
  AvatarActionCommand,
  AvatarFrameState,
  AvatarIntentBeat,
  AvatarIntent,
} from "@/types/avatar";
import { useAudioBase64Queue } from "@/hooks/useAudioBase64Queue";
import { useRemiWebAuth } from "@/components/RemiAuthProvider";
import { resolveMessageStorageKey, uid } from "./useRemiChatHelpers";
import { stripEmotionTags } from "@/lib/chat/stripEmotionTags";
import { pushAvatarDevtoolsLog } from "@/lib/rem3d/devtoolsStore";
import { useRemiConnection } from "./useRemiConnection";
import { useRemiMessages } from "./useRemiMessages";
import { useRemiTurnEngine } from "./useRemiTurnEngine";
import { useRemiVoice } from "./useRemiVoice";
import { useRemiAvatar } from "./useRemiAvatar";
import { createMessageDispatch } from "./useRemiChatMessageDispatch";

export type RemiConnectionPhase = "connecting" | "open" | "closed";

type DevCommandKind = "apply" | "reset" | "voice";
type DevStatusTone = "idle" | "pending" | "success" | "error";

type DevStatus = {
  tone: DevStatusTone;
  message: string;
};

export function useRemiChat() {
  const remiAuth = useRemiWebAuth();

  const messageStorageKey = useMemo(
    () =>
      resolveMessageStorageKey({
        currentUserId: remiAuth.currentUserId,
        isDefaultDevUser: remiAuth.isDefaultDevUser,
      }),
    [remiAuth.currentUserId, remiAuth.isDefaultDevUser],
  );

  /* ── Composition-layer-owned state ── */
  const [streamingText, setStreamingText] = useState("");
  const [sttPartialText, setSttPartialText] = useState("");
  const [typing, setTyping] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [personaPreset, setPersonaPreset] = useState<string | null>(null);
  const [devStatus, setDevStatus] = useState<DevStatus>({ tone: "idle", message: "" });

  const waitingRef = useRef(false);
  const streamingBufRef = useRef("");
  const pendingDevCommandRef = useRef<{
    kind: DevCommandKind;
    scope?: "session" | "relationship" | "all";
  } | null>(null);

  // wsRef is owned by the composition layer and shared with both connection and voice layers.
  const wsRef = useRef<WebSocket | null>(null);

  /* ── Messages layer ── */
  const msgs = useRemiMessages(messageStorageKey);

  /* ── Audio queue ── */
  // Declare playback callbacks using wsRef (stable ref, always contains current ws).
  const handlePlaybackStart = useCallback((generationId: number | null) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const payload: Record<string, unknown> = { type: "playback_start" };
    if (typeof generationId === "number") payload.generationId = generationId;
    ws.send(JSON.stringify(payload));
  }, []);

  const handlePlaybackEnd = useCallback((generationId: number | null) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const payload: Record<string, unknown> = { type: "playback_end" };
    if (typeof generationId === "number") payload.generationId = generationId;
    ws.send(JSON.stringify(payload));
  }, []);

  const {
    enqueueBase64,
    enqueuePcmChunk,
    clearQueue,
    unlockPlayback,
    voiceActive,
    lipEnvelopeRef,
    lipSignalRef,
    applyTtsLipSyncPatch,
  } = useAudioBase64Queue({
    onPlaybackStart: handlePlaybackStart,
    onPlaybackEnd: handlePlaybackEnd,
  });

  // Now voiceActive is known.
  /* ── Turn engine (receives real voiceActive for the drain effect) ── */
  const turnEngine = useRemiTurnEngine(voiceActive);

  /* ── Streaming helpers ── */
  const appendStreaming = useCallback((chunk: string) => {
    streamingBufRef.current += chunk;
    // Keep the raw buffer intact; strip emotion markup only for display.
    setStreamingText(stripEmotionTags(streamingBufRef.current));
  }, []);

  const resetStreaming = useCallback(() => {
    streamingBufRef.current = "";
    setStreamingText("");
  }, []);

  const setWaitingState = useCallback((v: boolean) => {
    waitingRef.current = v;
    setWaiting(v);
  }, []);

  /* ── allowServerGeneration (bridges turn engine + streaming) ── */
  const allowServerGeneration = useCallback(
    (type: string, rawGenerationId: unknown): boolean => {
      return turnEngine.allowServerGeneration(type, rawGenerationId, clearQueue, resetStreaming);
    },
    [turnEngine, clearQueue, resetStreaming],
  );

  /* ── Voice layer ── */
  const voice = useRemiVoice({
    wsRef,
    turnStateRef: turnEngine.turnStateRef,
    clearGenerationState: turnEngine.clearGenerationState,
    clearPendingChatEnd: turnEngine.clearPendingChatEnd,
    clearQueue,
    unlockPlayback,
    appendLiveMessage: msgs.appendLiveMessage,
    setSttPartialText,
  });

  /* ── Dev helpers ── */
  const describeResetScope = useCallback(
    (scope: "session" | "relationship" | "all" = "session") => {
      if (scope === "relationship") return "重置关系层";
      if (scope === "all") return "全部清空";
      return "只清本轮会话";
    },
    [],
  );

  /* ── onMessage handler ── */
  const onMessageRef = useRef<(ev: MessageEvent) => void>(() => {});

  // Avatar layer — declared before onMessage so onMessage can close over avatarCallbacksRef
  const avatarCallbacksRef = useRef({
    setEmotion: (_v: string) => {},
    setAvatarFrame: (_fn: (prev: AvatarFrameState | null) => AvatarFrameState | null) => {},
    setAvatarAction: (_v: { action: AvatarActionCommand; nonce: number } | null) => {},
    setAvatarIntentOverride: (_v: AvatarIntent | null) => {},
    clearAvatarIntentSchedule: () => {},
    triggerIntentGestureAction: (_intent: AvatarIntent | null) => {},
    mergeIntentBeat: (_base: AvatarIntent, _beat: AvatarIntentBeat): AvatarIntent => _base,
    avatarBeatTimersRef: { current: [] as ReturnType<typeof setTimeout>[] },
  });

  /* ── Avatar layer ── */
  const avatar = useRemiAvatar({
    connectionPhase: "connecting", // will be overridden by connection layer's value via re-render
    turnState: turnEngine.turnState,
    turnStateMetaRef: turnEngine.turnStateMetaRef,
    sttPredictionPreview: turnEngine.sttPredictionPreview,
    interruptionType: turnEngine.interruptionType,
    recording: voice.recording,
    duplex: voice.duplex,
    userSpeaking: voice.userSpeaking,
    awaitingSpeechCommit: voice.awaitingSpeechCommit,
    waiting,
    typing,
    streamingText,
    voiceActive,
    sttPartialText,
    lipSignalRef,
  });

  // Keep avatarCallbacksRef in sync with the latest avatar callbacks each render.
  avatarCallbacksRef.current = {
    setEmotion: avatar.setEmotion,
    setAvatarFrame: avatar.setAvatarFrame as (fn: (prev: AvatarFrameState | null) => AvatarFrameState | null) => void,
    setAvatarAction: avatar.setAvatarAction as (v: { action: AvatarActionCommand; nonce: number } | null) => void,
    setAvatarIntentOverride: avatar.setAvatarIntentOverride,
    clearAvatarIntentSchedule: avatar.clearAvatarIntentSchedule,
    triggerIntentGestureAction: avatar.triggerIntentGestureAction,
    mergeIntentBeat: avatar.mergeIntentBeat,
    avatarBeatTimersRef: avatar.avatarBeatTimersRef,
  };

  /* ── onMessage via dispatch module ── */
  const onMessageImpl = createMessageDispatch({
    streamingBufRef,
    appendStreaming,
    resetStreaming,
    waitingRef,
    setWaiting,
    setTyping,
    setSttPartialText,
    setPersonaPreset,
    pendingDevCommandRef: pendingDevCommandRef as React.MutableRefObject<{ kind: string; scope?: string } | null>,
    setDevStatus: setDevStatus as (v: { tone: string; message: string }) => void,
    describeResetScope,
    messageStorageKey,
    voiceActive,
    clearQueue,
    enqueueBase64,
    enqueuePcmChunk,
    applyTtsLipSyncPatch,
    allowServerGeneration,
    turnEngine: {
      activeGenerationRef: turnEngine.activeGenerationRef,
      playedGenerationIdsRef: turnEngine.playedGenerationIdsRef,
      pendingChatEndRef: turnEngine.pendingChatEndRef,
      pendingChatEndTimerRef: turnEngine.pendingChatEndTimerRef,
      sttPredictionPreviewRef: turnEngine.sttPredictionPreviewRef,
      interruptionTypeRef: turnEngine.interruptionTypeRef,
      commitTurnState: turnEngine.commitTurnState as (state: string, reason: string, meta?: Record<string, unknown>) => void,
      clearPendingChatEnd: turnEngine.clearPendingChatEnd,
      finalizePendingChatEnd: turnEngine.finalizePendingChatEnd,
      blockGeneration: turnEngine.blockGeneration,
      rememberPlayedGeneration: turnEngine.rememberPlayedGeneration,
      rememberLoggedVoiceGeneration: turnEngine.rememberLoggedVoiceGeneration,
      setSttPredictionPreview: turnEngine.setSttPredictionPreview,
      setInterruptionType: turnEngine.setInterruptionType as (v: string | null) => void,
    },
    voice: {
      duplexRef: voice.duplexRef,
      recordingRef: voice.recordingRef,
      userSpeakingRef: voice.userSpeakingRef,
      userSpeakingEndTimerRef: voice.userSpeakingEndTimerRef,
      clearUserSpeakingEndTimer: voice.clearUserSpeakingEndTimer,
      setUserSpeaking: voice.setUserSpeaking,
      setAwaitingSpeechCommitState: voice.setAwaitingSpeechCommitState,
      setInputPlaceholder: voice.setInputPlaceholder,
      syncInputPlaceholder: voice.syncInputPlaceholder,
    },
    msgs: {
      historySourceRef: msgs.historySourceRef,
      historyCursorRef: msgs.historyCursorRef,
      historyLoadingMoreRef: msgs.historyLoadingMoreRef,
      historyMessages: msgs.historyMessages,
      persistedMessagesRef: msgs.persistedMessagesRef,
      setHistoryMessages: msgs.setHistoryMessages,
      setHistoryHasMore: msgs.setHistoryHasMore,
      setHistoryLoadingMore: msgs.setHistoryLoadingMore,
      setLiveMessages: msgs.setLiveMessages,
      appendLiveMessage: msgs.appendLiveMessage,
      appendUserTranscript: msgs.appendUserTranscript,
      markHistoryMutation: msgs.markHistoryMutation as (kind: string) => void,
    },
    avatarCallbacksRef,
  });

  // Update onMessageRef every render so connection always calls the latest closure.
  onMessageRef.current = onMessageImpl;

  // Stable wrapper that delegates to the ref.
  const onMessageStable = useCallback((ev: MessageEvent) => {
    onMessageRef.current(ev);
  }, []);

  /* ── Connection layer ── */
  const conn = useRemiConnection({
    onOpenExtras: () => {
      // duplex resume is handled inside useRemiConnection directly
    },
    onCloseExtras: () => {},
    onErrorExtras: () => {},
    onMessage: onMessageStable,
    appendLiveMessage: msgs.appendLiveMessage as (msg: { id: string; role: string; text: string }) => void,
    clearGenerationState: turnEngine.clearGenerationState,
    clearAvatarIntentSchedule: avatar.clearAvatarIntentSchedule,
    stopVoiceSession: voice.stopVoiceSession,
    resetStreaming,
    setSttPartialText,
    setSttPredictionPreview: turnEngine.setSttPredictionPreview,
    setInterruptionType: turnEngine.setInterruptionType,
    setAvatarIntentOverride: avatar.setAvatarIntentOverride,
    setTyping,
    setWaitingState,
    markHistoryMutation: msgs.markHistoryMutation,
    setLiveMessages: msgs.setLiveMessages,
    setHistoryLoadingMoreState: msgs.setHistoryLoadingMoreState,
    setDevStatus,
    pendingDevCommandRef: pendingDevCommandRef as React.MutableRefObject<{ kind: string; scope?: string } | null>,
    recordingRef: voice.recordingRef,
    duplexRef: voice.duplexRef,
    pcmRef: voice.pcmRef as React.MutableRefObject<unknown>,
    startingDuplexRef: voice.startingDuplexRef,
    resumeDuplexAfterReconnectRef: voice.resumeDuplexAfterReconnectRef,
    sttPredictionPreviewRef: turnEngine.sttPredictionPreviewRef,
    interruptionTypeRef: turnEngine.interruptionTypeRef,
    startDuplex: voice.startDuplex,
    wsRef,
  });

  /* ── Text chat ── */
  const sendText = useCallback(
    (text: string) => {
      const ws = conn.wsRef.current;
      const trimmed = text.trim();
      if (!trimmed || !ws || ws.readyState !== WebSocket.OPEN) return;
      clearQueue();
      turnEngine.clearPendingChatEnd();
      void unlockPlayback();
      const interruptedGeneration = turnEngine.activeGenerationRef.current;
      if (interruptedGeneration != null) {
        turnEngine.blockGeneration(interruptedGeneration);
      } else {
        turnEngine.activeGenerationRef.current = null;
      }
      avatar.clearAvatarIntentSchedule();
      avatar.setAvatarIntentOverride(null);
      setSttPartialText("");
      voice.setAwaitingSpeechCommitState(false);
      turnEngine.sttPredictionPreviewRef.current = null;
      turnEngine.setSttPredictionPreview(null);
      turnEngine.interruptionTypeRef.current = null;
      turnEngine.setInterruptionType(null);
      turnEngine.commitTurnState("confirmed_end", "confirmed_end", {
        preview: null,
        interruptionType: null,
        generationId: interruptedGeneration,
        kind: "system",
      });
      msgs.appendLiveMessage({
        id: uid(),
        role: "user",
        text: trimmed,
        createdAt: new Date().toISOString(),
      });
      pushAvatarDevtoolsLog("system", "chat send", {
        interruptedGeneration,
        contentLength: trimmed.length,
      });
      ws.send(JSON.stringify({ type: "chat", content: trimmed }));
      waitingRef.current = true;
      setWaiting(true);
      setTyping(true);
      resetStreaming();
    },
    [
      avatar,
      clearQueue,
      conn.wsRef,
      msgs,
      resetStreaming,
      turnEngine,
      unlockPlayback,
      voice,
    ],
  );

  const loadMoreHistory = useCallback(() => {
    msgs.loadMoreHistory({
      wsRef: conn.wsRef,
      historyHasMore: msgs.historyHasMore,
      historyMessages: msgs.historyMessages,
    });
  }, [conn.wsRef, msgs]);

  const applyDevPreset = useCallback(
    (options: { personaPreset?: string; relationshipPreset?: string }) => {
      const ws = conn.wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      pendingDevCommandRef.current = { kind: "apply" };
      setDevStatus({ tone: "pending", message: "正在应用当前人格 / 关系预设…" });
      ws.send(
        JSON.stringify({
          type: "dev_apply_preset",
          personaPreset: options.personaPreset,
          relationshipPreset: options.relationshipPreset,
        }),
      );
    },
    [conn.wsRef],
  );

  const resetDevState = useCallback(
    (scope: "session" | "relationship" | "all" = "session") => {
      const ws = conn.wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      pendingDevCommandRef.current = { kind: "reset", scope };
      setDevStatus({ tone: "pending", message: `正在执行${describeResetScope(scope)}…` });
      ws.send(JSON.stringify({ type: "dev_reset_state", scope }));
    },
    [conn.wsRef, describeResetScope],
  );

  const applyDevVolcVoiceType = useCallback(
    (voiceType?: string | null) => {
      const ws = conn.wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      pendingDevCommandRef.current = { kind: "voice" };
      setDevStatus({
        tone: "pending",
        message: voiceType?.trim()
          ? `正在切换 Volc 音色到 ${voiceType.trim()}…`
          : "正在恢复环境默认 Volc 音色…",
      });
      ws.send(
        JSON.stringify({
          type: "dev_set_tts_voice",
          voiceType: voiceType?.trim() || "__env_default__",
        }),
      );
    },
    [conn.wsRef],
  );

  const requestPersonaPreset = useCallback(() => {
    const ws = conn.wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "get_persona_preset" }));
  }, [conn.wsRef]);

  const updatePersonaPreset = useCallback(
    (presetId: string) => {
      const ws = conn.wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: "set_persona_preset", presetId }));
    },
    [conn.wsRef],
  );

  /* ── Derived values ── */
  const { isDefaultDevUser, currentUserId, wsTargetLabel } = conn.browserIdentity;

  const reconnectInSec =
    conn.reconnectDeadline == null
      ? null
      : Math.max(0, Math.ceil((conn.reconnectDeadline - Date.now()) / 1000));

  const hasMic =
    typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

  const combinedMessages = useMemo(
    () => [...msgs.historyMessages, ...msgs.liveMessages],
    [msgs.historyMessages, msgs.liveMessages],
  );

  const avatarIntent = avatar.avatarIntentOverride ?? avatar.derivedAvatarIntent;

  return {
    emotion: avatar.emotion,
    turnState: turnEngine.turnState,
    sttPredictionPreview: turnEngine.sttPredictionPreview,
    interruptionType: turnEngine.interruptionType,
    avatarFrame: avatar.avatarFrame,
    avatarIntent,
    connected: conn.connected,
    connectionPhase: conn.connectionPhase,
    reconnectInSec,
    connLabel: conn.connLabel,
    messages: combinedMessages,
    historyHasMore: msgs.historyHasMore,
    historyLoadingMore: msgs.historyLoadingMore,
    historyMutation: msgs.historyMutation,
    historyMutationNonce: msgs.historyMutationNonce,
    streamingText,
    sttPartialText,
    typing,
    thinkingHint: avatar.thinkingHint,
    waiting,
    runtimeState: avatar.runtimeState,
    avatarRenderModel: avatar.avatarRenderModel,
    avatarAction: avatar.avatarAction,
    inputPlaceholder: voice.inputPlaceholder,
    recording: voice.recording,
    duplex: voice.duplex,
    personaPreset,
    userSpeaking: voice.userSpeaking,
    awaitingSpeechCommit: voice.awaitingSpeechCommit,
    listeningHint: avatar.listeningHint,
    voiceActive,
    /** TTS 音量包络 0–1，供 3D 口型同步 */
    lipEnvelopeRef,
    /** 统一口型信号，后续可接 viseme。 */
    lipSignalRef,
    hasMic,
    isDefaultDevUser,
    currentUserId,
    wsTargetLabel,
    sendText,
    requestPersonaPreset,
    updatePersonaPreset,
    loadMoreHistory,
    applyDevPreset,
    applyDevVolcVoiceType,
    resetDevState,
    devStatus,
    devCommandPending: devStatus.tone === "pending",
    toggleMic: voice.toggleMic,
    /** 显式结束语音会话（与再点麦克风等效） */
    stopVoice: voice.stopVoiceSession,
    setInputPlaceholder: voice.setInputPlaceholder,
  };
}
