"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { ChatMessage } from "@/types/chat";
import type {
  AvatarActionCommand,
  AvatarFrameState,
  AvatarIntentBeat,
  AvatarIntent,
  TtsLipSyncPatch,
} from "@/types/avatar";
import { useAudioBase64Queue } from "@/hooks/useAudioBase64Queue";
import { useRemiWebAuth } from "@/components/RemiAuthProvider";
import { shouldAwaitPlaybackDrain } from "./useRemiChatTurnState";
import {
  isListeningFallbackText,
  mergeSttPartialText,
  resolveLegacyMessageStorageKey,
  resolveMessageStorageKey,
  uid,
} from "./useRemiChatHelpers";
import {
  parseGenerationId,
  parseServerHistoryPage,
  parseServerTurnState,
} from "./useRemiChatProtocol";
import { mergeAvatarRuntimeSnapshot, pushAvatarDevtoolsLog } from "@/lib/rem3d/devtoolsStore";
import { useRemiConnection } from "./useRemiConnection";
import { useRemiMessages } from "./useRemiMessages";
import { useRemiTurnEngine } from "./useRemiTurnEngine";
import { useRemiVoice } from "./useRemiVoice";
import { useRemiAvatar } from "./useRemiAvatar";

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
    setStreamingText(streamingBufRef.current);
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
  // NOTE: onMessage is declared after all sub-hooks so it can reference them by closure.
  // It is passed to useRemiConnection via an onMessageRef so connection always uses the
  // latest version without needing to be re-created.
  const onMessageRef = useRef<(ev: MessageEvent) => void>(() => {});

  // Avatar layer — declared before onMessage so onMessage can close over avatarCallbacksRef
  // We use a ref-of-callbacks approach so avatar is accessible inside onMessage.
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

  /* ── Case handlers (extracted from onMessageImpl switch) ── */
  type AvatarCallbacks = typeof avatarCallbacksRef.current;

  function handleHistoryPage(data: Record<string, unknown>) {
    const { mode, messages: pageMessages, nextCursor, hasMore } =
      parseServerHistoryPage(data);

    const shouldAdoptServerHistory =
      mode === "prepend" || pageMessages.length > 0 || msgs.historyMessages.length === 0;

    if (shouldAdoptServerHistory) {
      msgs.historySourceRef.current = "server";
      msgs.historyCursorRef.current =
        nextCursor && nextCursor.id && nextCursor.createdAt ? nextCursor : null;
      msgs.setHistoryHasMore(hasMore);
    }
    msgs.historyLoadingMoreRef.current = false;
    msgs.setHistoryLoadingMore(false);

    if (mode === "replace") {
      if (shouldAdoptServerHistory) {
        msgs.setHistoryMessages(pageMessages);
        msgs.markHistoryMutation("replace");
      }
    } else if (pageMessages.length > 0) {
      msgs.setHistoryMessages((current) => {
        const seenIds = new Set(current.map((m) => m.id));
        const older = pageMessages.filter((m) => !seenIds.has(m.id));
        return older.length > 0 ? [...older, ...current] : current;
      });
      msgs.markHistoryMutation("prepend");
    }
  }

  function handleChatEnd(data: Record<string, unknown>, av: AvatarCallbacks) {
    if (!allowServerGeneration("chat_end", data.generationId)) return;
    const text = streamingBufRef.current;
    resetStreaming();
    if (!voice.duplexRef.current) {
      waitingRef.current = false;
      setWaiting(false);
    }
    setSttPartialText("");
    voice.setInputPlaceholder("说点什么…");
    if (text) {
      msgs.appendLiveMessage({
        id: uid(),
        role: "rem",
        text,
        createdAt: new Date().toISOString(),
      });
    }
    const endGenerationId = parseGenerationId(data.generationId);
    if (
      endGenerationId != null &&
      turnEngine.activeGenerationRef.current === endGenerationId
    ) {
      turnEngine.activeGenerationRef.current = null;
    }
    if (data.emotion != null) av.setEmotion(String(data.emotion));
    const awaitingPlaybackDrain = shouldAwaitPlaybackDrain({
      voiceActive,
      playbackSeenForGeneration:
        endGenerationId != null &&
        turnEngine.playedGenerationIdsRef.current.has(endGenerationId),
    });
    turnEngine.pendingChatEndRef.current = {
      generationId: endGenerationId,
      awaitingPlaybackDrain,
    };
    if (!awaitingPlaybackDrain) {
      if (turnEngine.pendingChatEndTimerRef.current) {
        clearTimeout(turnEngine.pendingChatEndTimerRef.current);
      }
      turnEngine.pendingChatEndTimerRef.current = setTimeout(() => {
        if (!turnEngine.pendingChatEndRef.current) return;
        if (turnEngine.pendingChatEndRef.current.generationId !== endGenerationId) return;
        if (turnEngine.pendingChatEndRef.current.awaitingPlaybackDrain) return;
        turnEngine.finalizePendingChatEnd(endGenerationId);
      }, 220 /* CHAT_END_PLAYBACK_GRACE_MS */);
    }
  }

  function handleVoice(data: Record<string, unknown>) {
    if (!allowServerGeneration("voice", data.generationId)) return;
    if (typeof data.audio !== "string") return;
    const generationId = parseGenerationId(data.generationId);
    turnEngine.rememberPlayedGeneration(generationId);
    if (turnEngine.pendingChatEndRef.current?.generationId === generationId) {
      turnEngine.pendingChatEndRef.current = {
        generationId,
        awaitingPlaybackDrain: true,
      };
      if (turnEngine.pendingChatEndTimerRef.current) {
        clearTimeout(turnEngine.pendingChatEndTimerRef.current);
        turnEngine.pendingChatEndTimerRef.current = null;
      }
    }
    turnEngine.commitTurnState("assistant_speaking", "playback_start", {
      generationId,
      kind: "ws",
    });
    enqueueBase64(data.audio, generationId);
    if (turnEngine.rememberLoggedVoiceGeneration(generationId)) {
      pushAvatarDevtoolsLog("ws", "voice start", {
        generationId,
        transport: "voice",
      });
    }
  }

  function handleVoicePcmChunk(data: Record<string, unknown>) {
    if (!allowServerGeneration("voice_pcm_chunk", data.generationId)) return;
    if (typeof data.audio !== "string") return;
    const rate = Number(data.sampleRate);
    const generationId = parseGenerationId(data.generationId);
    turnEngine.rememberPlayedGeneration(generationId);
    if (turnEngine.pendingChatEndRef.current?.generationId === generationId) {
      turnEngine.pendingChatEndRef.current = {
        generationId,
        awaitingPlaybackDrain: true,
      };
      if (turnEngine.pendingChatEndTimerRef.current) {
        clearTimeout(turnEngine.pendingChatEndTimerRef.current);
        turnEngine.pendingChatEndTimerRef.current = null;
      }
    }
    turnEngine.commitTurnState("assistant_speaking", "playback_start", {
      generationId,
      kind: "ws",
    });
    enqueuePcmChunk(
      data.audio,
      Number.isFinite(rate) && rate > 0 ? rate : 24000,
      generationId,
    );
    if (turnEngine.rememberLoggedVoiceGeneration(generationId)) {
      pushAvatarDevtoolsLog("ws", "voice start", {
        generationId,
        transport: "voice_pcm_chunk",
        sampleRate: Number.isFinite(rate) && rate > 0 ? rate : 24000,
      });
    }
  }

  function handleAvatarIntent(data: Record<string, unknown>, av: AvatarCallbacks) {
    const intent =
      data.intent && typeof data.intent === "object"
        ? (data.intent as AvatarIntent)
        : null;
    const beats = Array.isArray(data.beats) ? (data.beats as AvatarIntentBeat[]) : [];
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

  function handleSttFinal(data: Record<string, unknown>) {
    const content = String(data.content ?? "");
    turnEngine.activeGenerationRef.current = null;
    voice.clearUserSpeakingEndTimer();
    voice.userSpeakingRef.current = false;
    voice.setUserSpeaking(false);
    voice.setAwaitingSpeechCommitState(false);
    setSttPartialText("");
    msgs.appendUserTranscript(content);
    voice.setInputPlaceholder("说点什么…");
    if (!voice.duplexRef.current) {
      waitingRef.current = true;
      setWaiting(true);
    }
    setTyping(true);
    turnEngine.commitTurnState("confirmed_end", "confirmed_end", {
      kind: "ws",
    });
  }

  function handleTtsLipSync(data: Record<string, unknown>) {
    if (!allowServerGeneration("tts_lip_sync", data.generationId)) return;
    const generationId = parseGenerationId(data.generationId);
    if (generationId == null || !Array.isArray(data.cues)) return;
    const source =
      data.source === "provider_viseme"
        ? "provider_viseme"
        : "provider_word_boundary_derived";
    const mode = data.mode === "replace" ? "replace" : "append";
    applyTtsLipSyncPatch({
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

  function handleAvatarFrame(data: Record<string, unknown>, av: AvatarCallbacks) {
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
        emotion: (frame?.emotion as AvatarFrameState["emotion"]) ?? prev?.emotion,
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

  function handleInterrupt(data: Record<string, unknown>, av: AvatarCallbacks) {
    const interruptedGeneration = parseGenerationId(data.generationId);
    turnEngine.clearPendingChatEnd(interruptedGeneration);
    if (interruptedGeneration != null) {
      turnEngine.blockGeneration(interruptedGeneration);
    } else {
      turnEngine.activeGenerationRef.current = null;
    }
    setSttPartialText("");
    clearQueue();
    av.clearAvatarIntentSchedule();
    av.setAvatarIntentOverride(null);
    turnEngine.sttPredictionPreviewRef.current = null;
    turnEngine.setSttPredictionPreview(null);
    resetStreaming();
    setTyping(false);
    turnEngine.interruptionTypeRef.current = "unknown";
    turnEngine.setInterruptionType("unknown");
    turnEngine.commitTurnState("interrupted_by_user", "user_interrupt", {
      interruptionType: "unknown",
      generationId: interruptedGeneration,
      kind: "ws",
    });
    pushAvatarDevtoolsLog("ws", "interrupt", {
      generationId: interruptedGeneration,
    });
  }

  function handleError(data: Record<string, unknown>) {
    const pendingDevCommand = pendingDevCommandRef.current;
    if (pendingDevCommand) {
      pendingDevCommandRef.current = null;
      setDevStatus({
        tone: "error",
        message: String(data.content ?? "开发操作失败"),
      });
    }
    msgs.historyLoadingMoreRef.current = false;
    msgs.setHistoryLoadingMore(false);
    turnEngine.clearPendingChatEnd();
    voice.clearUserSpeakingEndTimer();
    voice.userSpeakingRef.current = false;
    voice.setUserSpeaking(false);
    voice.setAwaitingSpeechCommitState(false);
    setTyping(false);
    setSttPartialText("");
    resetStreaming();
    waitingRef.current = false;
    setWaiting(false);
    voice.setInputPlaceholder("说点什么…");
    msgs.appendLiveMessage({
      id: uid(),
      role: "error",
      text: String(data.content ?? "错误"),
    });
  }

  function handleDevStateChange(data: Record<string, unknown>, av: AvatarCallbacks) {
    pendingDevCommandRef.current = null;
    if (data.type === "dev_preset_applied") {
      const personaPresetVal =
        typeof data.personaPreset === "string" && data.personaPreset.trim()
          ? data.personaPreset.trim()
          : "";
      const relationshipPreset =
        typeof data.relationshipPreset === "string" && data.relationshipPreset.trim()
          ? data.relationshipPreset.trim()
          : "";
      const parts = [
        personaPresetVal ? `人格：${personaPresetVal}` : "",
        relationshipPreset ? `关系：${relationshipPreset}` : "",
      ].filter(Boolean);
      setDevStatus({
        tone: "success",
        message: parts.length > 0 ? `预设已应用 (${parts.join(" / ")})` : "预设已应用",
      });
    } else if (data.type === "dev_tts_voice_applied") {
      const voiceType =
        typeof data.voiceType === "string" && data.voiceType.trim()
          ? data.voiceType.trim()
          : "";
      setDevStatus({
        tone: "success",
        message: voiceType ? `Volc 音色已切到 ${voiceType}` : "Volc 音色已恢复环境默认",
      });
    } else {
      const scope =
        data.scope === "all" ||
        data.scope === "relationship" ||
        data.scope === "session"
          ? data.scope
          : "session";
      setDevStatus({
        tone: "success",
        message: `${describeResetScope(scope)}已完成`,
      });
    }
    turnEngine.clearPendingChatEnd();
    voice.clearUserSpeakingEndTimer();
    voice.userSpeakingRef.current = false;
    voice.setUserSpeaking(false);
    voice.setAwaitingSpeechCommitState(false);
    setTyping(false);
    setSttPartialText("");
    resetStreaming();
    waitingRef.current = false;
    setWaiting(false);
    clearQueue();
    av.clearAvatarIntentSchedule();
    av.setAvatarIntentOverride(null);
    turnEngine.sttPredictionPreviewRef.current = null;
    turnEngine.setSttPredictionPreview(null);
    turnEngine.interruptionTypeRef.current = null;
    turnEngine.setInterruptionType(null);
    turnEngine.commitTurnState("confirmed_end", "confirmed_end", { kind: "system" });
    msgs.historySourceRef.current = "fallback";
    msgs.historyCursorRef.current = null;
    msgs.historyLoadingMoreRef.current = false;
    msgs.setHistoryLoadingMore(false);
    msgs.setHistoryHasMore(false);
    msgs.persistedMessagesRef.current = [];
    msgs.setHistoryMessages([]);
    msgs.setLiveMessages([]);
    msgs.markHistoryMutation("replace");
    try {
      localStorage.removeItem(messageStorageKey);
      localStorage.removeItem(resolveLegacyMessageStorageKey(messageStorageKey));
    } catch {
      /* noop */
    }
  }

  /* ── onMessage (defined after all hooks) ── */
  // This function is assigned to onMessageRef.current each render.
  // It is NOT a useCallback because it closes over many sub-hook values — it reads from refs
  // and state captured at render time, which is exactly what we want.
  const onMessageImpl = (ev: MessageEvent) => {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(ev.data as string) as Record<string, unknown>;
    } catch {
      return;
    }

    const t = data.type as string;
    // Capture current avatar callbacks via ref to avoid stale closures.
    const av = avatarCallbacksRef.current;

    switch (t) {
      case "turn_state": {
        const nextTurnState = parseServerTurnState(data);
        if (nextTurnState) {
          turnEngine.commitTurnState(nextTurnState.state, nextTurnState.reason, {
            preview: nextTurnState.preview,
            interruptionType: nextTurnState.interruptionType,
            generationId: nextTurnState.generationId,
            kind: "ws",
          });
          if (voice.recordingRef.current) {
            if (nextTurnState.state === "listening_active") {
              voice.setAwaitingSpeechCommitState(false);
            } else if (
              !voice.userSpeakingRef.current &&
              (nextTurnState.state === "listening_hold" ||
                nextTurnState.state === "likely_end" ||
                nextTurnState.state === "confirmed_end")
            ) {
              voice.setAwaitingSpeechCommitState(true);
              voice.syncInputPlaceholder({
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

      case "history_page": {
        handleHistoryPage(data);
        break;
      }

      case "chat_chunk":
        if (!allowServerGeneration("chat_chunk", data.generationId)) break;
        if (!streamingBufRef.current) {
          turnEngine.commitTurnState("assistant_entering", "tts_prepare", {
            generationId: parseGenerationId(data.generationId),
            kind: "ws",
          });
        }
        voice.setAwaitingSpeechCommitState(false);
        setSttPartialText("");
        setTyping(false);
        appendStreaming(String(data.content ?? ""));
        break;

      case "chat_end": {
        handleChatEnd(data, av);
        break;
      }

      case "voice": {
        handleVoice(data);
        break;
      }

      case "voice_chunk":
      case "voice_pcm_chunk": {
        handleVoicePcmChunk(data);
        break;
      }

      case "tts_lip_sync": {
        handleTtsLipSync(data);
        break;
      }

      case "avatar_frame": {
        handleAvatarFrame(data, av);
        break;
      }

      case "avatar_intent": {
        handleAvatarIntent(data, av);
        break;
      }

      case "stt_prediction": {
        const preview =
          typeof data.preview === "string" && data.preview.trim()
            ? data.preview.trim()
            : null;
        turnEngine.sttPredictionPreviewRef.current = preview;
        turnEngine.setSttPredictionPreview(preview);
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

      /* ── Full-duplex events ── */

      case "interrupt": {
        handleInterrupt(data, av);
        break;
      }

      case "vad_start":
        voice.clearUserSpeakingEndTimer();
        voice.setAwaitingSpeechCommitState(false);
        setSttPartialText((prev) => (isListeningFallbackText(prev) ? "" : prev));
        voice.userSpeakingRef.current = true;
        voice.setUserSpeaking(true);
        voice.syncInputPlaceholder({
          recording: voice.recordingRef.current,
          userSpeaking: true,
          awaitingSpeechCommit: false,
        });
        turnEngine.commitTurnState("listening_active", "speech_start", {
          kind: "ws",
        });
        break;

      case "vad_end":
        voice.clearUserSpeakingEndTimer();
        voice.userSpeakingEndTimerRef.current = setTimeout(() => {
          voice.userSpeakingEndTimerRef.current = null;
          voice.userSpeakingRef.current = false;
          voice.setUserSpeaking(false);
          if (voice.recordingRef.current) {
            voice.syncInputPlaceholder({
              recording: true,
              userSpeaking: false,
            });
          }
        }, 260 /* USER_SPEAKING_END_DEBOUNCE_MS */);
        turnEngine.commitTurnState("listening_hold", "semantic_hold", {
          kind: "ws",
        });
        break;

      case "stt_partial": {
        const partial = String(data.content ?? "").trim();
        if (!partial) break;
        setSttPartialText((prev) => mergeSttPartialText(prev, partial));
        break;
      }

      case "stt_final": {
        handleSttFinal(data);
        break;
      }

      case "error": {
        handleError(data);
        break;
      }

      case "persona_preset_state": {
        const presetId =
          typeof data.presetId === "string" && data.presetId.trim()
            ? data.presetId.trim()
            : null;
        setPersonaPreset(presetId);
        break;
      }

      case "dev_preset_applied":
      case "dev_tts_voice_applied":
      case "dev_state_reset": {
        handleDevStateChange(data, av);
        break;
      }

      default:
        break;
    }
  };

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
