"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AvatarActionCommand,
  AvatarFrameState,
  AvatarIntentBeat,
  AvatarIntent,
} from "@/types/avatar";
import { useAudioBase64Queue } from "@/hooks/useAudioBase64Queue";
import { useRemiWebAuth } from "@/components/RemiAuthProvider";
import {
  mergeChatMessageLists,
  readStoredTtsEnabled,
  readStoredVoiceStyle,
  readStoredVoiceSpeed,
  readStoredVoicePitch,
  resolveMessageStorageKey,
  uid,
  writeStoredTtsEnabled,
} from "./useRemiChatHelpers";
import { stripEmotionTags } from "@/lib/chat/stripEmotionTags";
import { SPEED_LEVELS, PITCH_LEVELS } from "@/components/VoiceStylePicker";
import { pushAvatarDevtoolsLog } from "@/lib/rem3d/devtoolsStore";
import { useRemiConnection } from "./useRemiConnection";
import { useRemiMessages } from "./useRemiMessages";
import { useRemiTurnEngine } from "./useRemiTurnEngine";
import { useRemiVoice } from "./useRemiVoice";
import { useRemiAvatar } from "./useRemiAvatar";
import { createMessageDispatch } from "./useRemiChatMessageDispatch";
import { SseChatClient, getTextTransport, getRemHttpBase } from "@/lib/sseChat";

export type RemiConnectionPhase = "connecting" | "open" | "closed";

type DevCommandKind = "apply" | "reset" | "voice";
type DevStatusTone = "idle" | "pending" | "success" | "error";

type DevStatus = {
  tone: DevStatusTone;
  message: string;
};

type PersonaPackState = {
  packId: string;
  name: string;
  displayName: string;
} | null;

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
  const [personaPack, setPersonaPack] = useState<PersonaPackState>(null);
  const [nsfwEnabled, setNsfwEnabled] = useState(false);
  const [ttsEnabled, setTtsEnabledState] = useState(true);
  const [devStatus, setDevStatus] = useState<DevStatus>({ tone: "idle", message: "" });

  const waitingRef = useRef(false);
  const ttsEnabledRef = useRef(true);
  const streamingBufRef = useRef("");
  const pendingDevCommandRef = useRef<{
    kind: DevCommandKind;
    scope?: "session" | "relationship" | "all";
  } | null>(null);

  // wsRef is owned by the composition layer and shared with both connection and voice layers.
  const wsRef = useRef<WebSocket | null>(null);

  // SSE text transport (default). Text turns ride HTTP POST /api/chat so a WS
  // blip never interrupts a text reply; voice/avatar/push/history stay on WS.
  const sseClientRef = useRef<SseChatClient | null>(null);
  const sseSessionTokenRef = useRef<string | null>(null);
  const sseAbortRef = useRef<AbortController | null>(null);
  const getSseClient = useCallback((): SseChatClient => {
    if (!sseClientRef.current) sseClientRef.current = new SseChatClient(getRemHttpBase());
    return sseClientRef.current;
  }, []);

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

  const serverTtsStreamingRef = useRef(false);
  const markServerTtsStreaming = useCallback((streaming: boolean) => {
    serverTtsStreamingRef.current = streaming;
  }, []);

  useEffect(() => {
    const stored = readStoredTtsEnabled();
    ttsEnabledRef.current = stored;
    setTtsEnabledState(stored);
  }, []);

  const {
    enqueueBase64,
    enqueuePcmChunk,
    clearQueue,
    unlockPlayback,
    audioLocked,
    voiceActive,
    lipEnvelopeRef,
    lipSignalRef,
    applyTtsLipSyncPatch,
  } = useAudioBase64Queue({
    onPlaybackStart: handlePlaybackStart,
    onPlaybackEnd: handlePlaybackEnd,
    getServerTtsStreaming: () => serverTtsStreamingRef.current,
  });

  useEffect(() => {
    const unlock = () => {
      void unlockPlayback();
    };
    window.addEventListener("pointerdown", unlock, { capture: true });
    window.addEventListener("keydown", unlock, { capture: true });
    window.addEventListener("touchstart", unlock, { capture: true });
    return () => {
      window.removeEventListener("pointerdown", unlock, { capture: true });
      window.removeEventListener("keydown", unlock, { capture: true });
      window.removeEventListener("touchstart", unlock, { capture: true });
    };
  }, [unlockPlayback]);

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

  const syncTtsEnabledToServer = useCallback(
    (enabled: boolean) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: "set_voice_style", ttsEnabled: enabled }));
    },
    [],
  );

  const syncStoredVoiceStyleToServer = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const styleId = readStoredVoiceStyle();
    const speedIdx = readStoredVoiceSpeed();
    const pitchIdx = readStoredVoicePitch();
    const isDefault =
      styleId === "default" && speedIdx === 0 && pitchIdx === 0;
    if (isDefault) return; // nothing to restore
    const payload: Record<string, unknown> = {
      type: "set_voice_style",
      source: "stored_restore",
    };
    if (styleId !== "default") payload.voiceStyleId = styleId;
    if (speedIdx !== 0) payload.speedModifier = SPEED_LEVELS[speedIdx]?.value ?? null;
    if (pitchIdx !== 0) payload.pitchModifier = PITCH_LEVELS[pitchIdx]?.value ?? null;
    ws.send(JSON.stringify(payload));
  }, []);

  const setTtsEnabled = useCallback(
    (enabled: boolean) => {
      ttsEnabledRef.current = enabled;
      setTtsEnabledState(enabled);
      writeStoredTtsEnabled(enabled);
      if (!enabled) clearQueue();
      syncTtsEnabledToServer(enabled);
    },
    [clearQueue, syncTtsEnabledToServer],
  );

  const enqueueBase64IfAudible = useCallback(
    (audio: string, generationId?: number | null) => {
      if (!ttsEnabledRef.current) return;
      enqueueBase64(audio, generationId);
    },
    [enqueueBase64],
  );

  const enqueuePcmChunkIfAudible = useCallback(
    (audio: string, sampleRate: number, generationId: number | null) => {
      if (!ttsEnabledRef.current) return;
      enqueuePcmChunk(audio, sampleRate, generationId);
    },
    [enqueuePcmChunk],
  );

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
    setPersonaPack,
    setNsfwEnabled,
    pendingDevCommandRef: pendingDevCommandRef as React.MutableRefObject<{ kind: string; scope?: string } | null>,
    setDevStatus: setDevStatus as (v: { tone: string; message: string }) => void,
    describeResetScope,
    messageStorageKey,
    voiceActive,
    markServerTtsStreaming,
    clearQueue,
    enqueueBase64: enqueueBase64IfAudible,
    enqueuePcmChunk: enqueuePcmChunkIfAudible,
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
      syncTtsEnabledToServer(ttsEnabledRef.current);
      syncStoredVoiceStyleToServer();
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
  // 纯打断：用户主动停止 Remi 当前回复，不发送新消息。复用 sendText 的打断步骤
  // （block generation + abort SSE + 回合归位 + 清音频），但不 appendLiveMessage、
  // 不发新请求。供「回复中发送按钮变停止键」用。
  const interruptReply = useCallback(() => {
    markServerTtsStreaming(false);
    // 用户主动停止 → 立即清音频队列（不像发送时 defer 到下一段播放）
    clearQueue({ deferUntilNextPlayback: false });
    turnEngine.clearPendingChatEnd();
    const interruptedGeneration = turnEngine.activeGenerationRef.current;
    if (interruptedGeneration != null) {
      turnEngine.blockGeneration(interruptedGeneration);
    } else {
      turnEngine.activeGenerationRef.current = null;
    }
    avatar.clearAvatarIntentSchedule();
    avatar.setAvatarIntentOverride(null);
    turnEngine.interruptionTypeRef.current = null;
    turnEngine.setInterruptionType(null);
    turnEngine.commitTurnState("confirmed_end", "confirmed_end", {
      preview: null,
      interruptionType: null,
      generationId: interruptedGeneration,
      kind: "system",
    });
    // 取消进行中的 SSE 回合：服务端 req close → 中止上一条 pipeline
    sseAbortRef.current?.abort();
    sseAbortRef.current = null;
    setWaiting(false);
    setTyping(false);
  }, [markServerTtsStreaming, clearQueue, turnEngine, avatar]);

  const sendText = useCallback(
    (text: string, imageOrSituational?: string) => {
      const ws = conn.wsRef.current;
      const trimmed = text.trim();
      // Distinguish image (data:image/...) from situational context
      const isImage =
        typeof imageOrSituational === "string" &&
        imageOrSituational.startsWith("data:image/");
      const image = isImage ? imageOrSituational : undefined;
      const situational = isImage ? undefined : imageOrSituational;
      const transport = getTextTransport();
      // SSE decouples text from WS health, so it only needs content. WS mode
      // still requires an open socket.
      if (!trimmed && !image) return;
      if (transport === "ws" && (!ws || ws.readyState !== WebSocket.OPEN)) return;
      markServerTtsStreaming(false);
      // Deferred interrupt: don't cut Remi off mid-sentence the instant the user
      // sends. Keep her current audio playing and displace it only once the new
      // reply's TTS actually starts — avoids dead air while she's e.g. analysing
      // an image. Falls back to an immediate clear if nothing is currently audible.
      clearQueue({ deferUntilNextPlayback: true });
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
        text: trimmed || "看看这张图",
        imageUrl: image,
        createdAt: new Date().toISOString(),
      });
      pushAvatarDevtoolsLog("system", "chat send", {
        interruptedGeneration,
        contentLength: trimmed.length,
        transport,
      });
      const content = trimmed || "看看这张图";
      const wsChatPayload = {
        type: "chat" as const,
        content,
        // 世界情境（RW-P1-4）：仅 RemiWorld 传入，普通聊天为 undefined 不影响
        ...(situational?.trim() ? { situational: situational.trim() } : {}),
        // 用户附带图片
        ...(image ? { image } : {}),
      };

      if (transport === "sse") {
        // Cancel any in-flight SSE turn (the server aborts the prior pipeline on
        // request close), then stream the new one.
        sseAbortRef.current?.abort();
        const ac = new AbortController();
        sseAbortRef.current = ac;
        let sawReply = false;
        void (async () => {
          let authToken: string | null = null;
          try {
            authToken = await remiAuth.getSessionToken();
          } catch {
            /* anonymous / no token */
          }
          try {
            // Read stored voice style so SSE turn uses the right TTS voice.
            const storedStyle = readStoredVoiceStyle();
            const storedSpeedIdx = readStoredVoiceSpeed();
            const storedPitchIdx = readStoredVoicePitch();

            const result = await getSseClient().send(content, {
              sessionToken: sseSessionTokenRef.current,
              authToken,
              signal: ac.signal,
              ...(situational?.trim() ? { situational: situational.trim() } : {}),
              ...(image ? { image } : {}),
              ...(storedStyle !== "default" ? { voiceStyleId: storedStyle } : {}),
              ...(storedSpeedIdx !== 0 ? { speedModifier: SPEED_LEVELS[storedSpeedIdx]?.value ?? null } : {}),
              ...(storedPitchIdx !== 0 ? { pitchModifier: PITCH_LEVELS[storedPitchIdx]?.value ?? null } : {}),
              onEvent: (event) => {
                if (event.type && event.type !== "session") sawReply = true;
                onMessageRef.current({ data: JSON.stringify(event) } as MessageEvent);
              },
            });
            if (result.sessionToken) sseSessionTokenRef.current = result.sessionToken;
          } catch (err) {
            if (ac.signal.aborted || sawReply) return;
            // SSE failed before any reply — fall back to WS if it's open so the
            // turn isn't silently dropped (honors the no-silent-fallback rule).
            const wsNow = conn.wsRef.current;
            if (wsNow && wsNow.readyState === WebSocket.OPEN) {
              pushAvatarDevtoolsLog("system", "sse send failed, ws fallback", {
                error: (err as Error)?.message,
              });
              wsNow.send(JSON.stringify(wsChatPayload));
            } else {
              onMessageRef.current({
                data: JSON.stringify({ type: "error", content: "消息发送失败，请稍后重试" }),
              } as MessageEvent);
              waitingRef.current = false;
              setWaiting(false);
              setTyping(false);
            }
          }
        })();
      } else {
        ws!.send(JSON.stringify(wsChatPayload));
      }
      waitingRef.current = true;
      setWaiting(true);
      setTyping(true);
      resetStreaming();
    },
    [
      avatar,
      clearQueue,
      conn.wsRef,
      getSseClient,
      markServerTtsStreaming,
      msgs,
      remiAuth,
      resetStreaming,
      turnEngine,
      unlockPlayback,
      voice,
    ],
  );

  /**
   * 世界事件 → 长期记忆（RW-P1-4b）。仅 RemiWorld 调用：种花/点灯/回访等
   * 有情感重量的动作发给后端落 episode。即发即忘，不进对话流、不显示气泡。
   */
  const sendWorldEvent = useCallback(
    (event: "flower_planted" | "lantern_lit" | "revisit") => {
      const ws = conn.wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: "world_event", event }));
    },
    [conn.wsRef],
  );

  /** Set voice style / speed / pitch via WS (UI-driven, per-session). */
  const setVoiceStyle = useCallback(
    (opts: {
      voiceStyleId?: string | null;
      speedModifier?: string | null;
      pitchModifier?: string | null;
      ttsEnabled?: boolean;
    }) => {
      const ws = conn.wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (opts.ttsEnabled !== undefined) {
        setTtsEnabled(opts.ttsEnabled);
        return;
      }
      ws.send(JSON.stringify({ type: "set_voice_style", ...opts }));
    },
    [conn.wsRef, setTtsEnabled],
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

  const requestPersonaPack = useCallback(() => {
    const ws = conn.wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "get_persona_pack" }));
  }, [conn.wsRef]);

  const updatePersonaPack = useCallback(
    (packId: string) => {
      const ws = conn.wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: "set_persona_pack", packId }));
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
    () => mergeChatMessageLists(msgs.historyMessages, msgs.liveMessages),
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
    audioLocked,
    unlockAudio: unlockPlayback,
    recording: voice.recording,
    duplex: voice.duplex,
    personaPreset,
    personaPack,
    nsfwEnabled,
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
    interruptReply,
    sendWorldEvent,
    setVoiceStyle,
    ttsEnabled,
    setTtsEnabled,
    requestPersonaPreset,
    updatePersonaPreset,
    requestPersonaPack,
    updatePersonaPack,
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
