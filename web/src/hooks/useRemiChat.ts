"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage } from "@/types/chat";
import type {
  AvatarActionCommand,
  AvatarFrameState,
  AvatarIntentBeat,
  AvatarIntent,
  InterruptionType,
  RemiTurnState,
  RemiTurnStateReason,
  TtsLipSyncPatch,
} from "@/types/avatar";
import { useAudioBase64Queue } from "@/hooks/useAudioBase64Queue";
import { useRemiWebAuth } from "@/components/RemiAuthProvider";
import {
  shouldAwaitPlaybackDrain,
  shouldFinalizeDeferredChatEnd,
} from "./useRemiChatTurnState";
import {
  arrayBufferToBase64,
  encodePcmAudioFrame,
  INITIAL_BROWSER_IDENTITY,
  isListeningFallbackText,
  loadPersistedMessages,
  mergeSttPartialText,
  mergeTranscriptTexts,
  MESSAGE_STORAGE_MAX,
  measurePcmFrame,
  REM_WS_RECONNECT_DELAY_MS,
  resolveLegacyMessageStorageKey,
  resolveMessageStorageKey,
  resolveWsTargetLabel,
  type BrowserIdentityState,
  uid,
} from "./useRemiChatHelpers";
import {
  parseGenerationId,
  parseServerHistoryPage,
  parseServerTurnState,
} from "./useRemiChatProtocol";
import { resolveDuplexInputPlaceholder } from "@/lib/duplex_ui_state";
import { MicTxGate } from "@/lib/micTxGate";
import {
  startPcmCapture,
  type PcmCapture,
  type PcmCaptureErrorDetail,
} from "@/lib/pcmCapture";
import {
  getMicAccessErrorMessage,
  getMicCaptureFaultMessage,
} from "@/lib/micCaptureErrors";
import { getRemWsUrl } from "@/lib/wsUrl";
import { deriveAvatarIntent } from "@/lib/rem3d/avatarIntent";
import {
  mergeAvatarRuntimeSnapshot,
  publishAvatarRuntimeSnapshot,
  pushAvatarDevtoolsLog,
} from "@/lib/rem3d/devtoolsStore";
import { buildAvatarRenderModel } from "@/runtime/avatarRenderModel";
import {
  adaptRemiRuntimeState,
  type CanonicalAvatarState,
} from "@/runtime/remiRuntimeAdapter";
import {
  selectListeningHint,
  selectThinkingHint,
  toLegacyRemState,
} from "@/runtime/remiRuntimeSelectors";
import {
  createInitialRemiRuntimeState,
  RemiRuntimeClient,
  selectRemiAvatarRuntimeModel,
  toClientContextPayload,
  type RemiAvatarRuntimeModel,
  type RemiRuntimeState,
  type RemiRuntimeTransport,
} from "../../../runtime";

/** 长时间停留在 CONNECTING 则判定失败（避免 UI 永远「正在连接」） */
const WS_CONNECT_TIMEOUT_MS = 12_000;

export type RemiConnectionPhase = "connecting" | "open" | "closed";

const INITIAL_HISTORY_DISPLAY_LIMIT = 15;
const USER_SPEAKING_END_DEBOUNCE_MS = 260;
const DUPLEX_AWAITING_COMMIT_TIMEOUT_MS = 5000;
const STT_USER_MERGE_WINDOW_MS = 2200;
const MIC_TX_LOG_INTERVAL_MS = 900;
const CHAT_END_PLAYBACK_GRACE_MS = 220;
const CLIENT_MIC_PRE_GATE_ENABLED = process.env.NEXT_PUBLIC_REMI_CLIENT_MIC_PRE_GATE === "1";
const REMI_RUNTIME_SHADOW_ENABLED = process.env.NEXT_PUBLIC_REMI_RUNTIME_SHADOW === "1";

const WEB_RUNTIME_SHADOW_CAPABILITIES = {
  textInput: true,
  audioInput: true,
  audioOutput: true,
  streamingAudio: true,
  avatar2d: true,
  avatar3d: true,
  lipSync: true,
  worldEvents: false,
  backgroundPresence: false,
  notifications: false,
} as const;

type HistoryCursor = {
  id: string;
  createdAt: string;
};

type HistoryListMutation = "idle" | "replace" | "prepend" | "append";
type DevCommandKind = "apply" | "reset" | "voice";
type DevStatusTone = "idle" | "pending" | "success" | "error";

type DevStatus = {
  tone: DevStatusTone;
  message: string;
};

export function useRemiChat() {
  const [emotion, setEmotion] = useState("neutral");
  const [connected, setConnected] = useState(false);
  const [connectionPhase, setConnectionPhase] =
    useState<RemiConnectionPhase>("connecting");
  const [reconnectDeadline, setReconnectDeadline] = useState<number | null>(null);
  /** 仅用于在重连倒计时期间驱动按秒刷新（deadline 派生秒数） */
  const [, bumpReconnectTick] = useState(0);
  const [connLabel, setConnLabel] = useState("连接中…");
  const [historyMessages, setHistoryMessages] = useState<ChatMessage[]>([]);
  const [liveMessages, setLiveMessages] = useState<ChatMessage[]>([]);
  const [messagesHydrated, setMessagesHydrated] = useState(false);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [historyMutationNonce, setHistoryMutationNonce] = useState(0);
  const [historyMutation, setHistoryMutation] = useState<HistoryListMutation>("idle");
  const [devStatus, setDevStatus] = useState<DevStatus>({
    tone: "idle",
    message: "",
  });
  const [runtimeClock, setRuntimeClock] = useState(0);
  const [sdkRuntimeState, setSdkRuntimeState] = useState<RemiRuntimeState>(
    () => createInitialRemiRuntimeState(),
  );
  const [streamingText, setStreamingText] = useState("");
  const [sttPartialText, setSttPartialText] = useState("");
  const [typing, setTyping] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [turnState, setTurnState] = useState<RemiTurnState>("confirmed_end");
  const [sttPredictionPreview, setSttPredictionPreview] = useState<string | null>(null);
  const [interruptionType, setInterruptionType] = useState<InterruptionType | null>(null);
  const [avatarAction, setAvatarAction] = useState<{
    action: AvatarActionCommand;
    nonce: number;
  } | null>(null);
  const [avatarFrame, setAvatarFrame] = useState<AvatarFrameState | null>(null);
  const [avatarIntentOverride, setAvatarIntentOverride] = useState<AvatarIntent | null>(null);
  const [inputPlaceholder, setInputPlaceholder] = useState("说点什么…");
  const [recording, setRecording] = useState(false);
  const [duplex, setDuplex] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [awaitingSpeechCommit, setAwaitingSpeechCommit] = useState(false);
  const [personaPreset, setPersonaPreset] = useState<string | null>(null);
  const remiAuth = useRemiWebAuth();
  const messageStorageKey = useMemo(
    () =>
      resolveMessageStorageKey({
        currentUserId: remiAuth.currentUserId,
        isDefaultDevUser: remiAuth.isDefaultDevUser,
      }),
    [remiAuth.currentUserId, remiAuth.isDefaultDevUser],
  );
  const [browserIdentity, setBrowserIdentity] =
    useState<BrowserIdentityState>(INITIAL_BROWSER_IDENTITY);
  const { isDefaultDevUser, currentUserId, wsTargetLabel } = browserIdentity;
  const messages = useMemo(
    () => [...historyMessages, ...liveMessages],
    [historyMessages, liveMessages],
  );

  const wsRef = useRef<RemiRuntimeClient | null>(null);
  const waitingRef = useRef(false);
  const duplexRef = useRef(false);
  const pcmRef = useRef<PcmCapture | null>(null);
  const recordingRef = useRef(false);
  const userSpeakingRef = useRef(false);
  const awaitingSpeechCommitRef = useRef(false);
  const resumeDuplexAfterReconnectRef = useRef(false);
  const userSpeakingEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const awaitingSpeechCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastUserTranscriptAtRef = useRef(0);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamingBufRef = useRef("");
  const mountedRef = useRef(true);
  const activeGenerationRef = useRef<number | null>(null);
  const blockedGenerationsRef = useRef<Set<number>>(new Set());
  const loggedVoiceGenerationsRef = useRef<Set<number>>(new Set());
  const playedGenerationIdsRef = useRef<Set<number>>(new Set());
  const pendingChatEndRef = useRef<{
    generationId: number | null;
    awaitingPlaybackDrain: boolean;
  } | null>(null);
  const pendingChatEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const turnStateRef = useRef<RemiTurnState>("confirmed_end");
  const turnStateMetaRef = useRef<{
    state: RemiTurnState;
    reason: RemiTurnStateReason;
    sinceAtMs: number;
    generationId: number | null;
    preview: string | null;
    interruptionType: InterruptionType | null;
  }>({
    state: "confirmed_end",
    reason: "confirmed_end",
    sinceAtMs: Date.now(),
    generationId: null,
    preview: null,
    interruptionType: null,
  });
  const sttPredictionPreviewRef = useRef<string | null>(null);
  const interruptionTypeRef = useRef<InterruptionType | null>(null);
  const micTxStartedAtRef = useRef(0);
  const micTxFramesRef = useRef(0);
  const micTxBytesRef = useRef(0);
  const micTxLastRmsRef = useRef(0);
  const micTxLastPeakRef = useRef(0);
  const micTxMaxRmsRef = useRef(0);
  const micTxLastLogAtRef = useRef(0);
  const micTxGateRef = useRef<MicTxGate | null>(null);
  const lastMicFaultAtRef = useRef(0);
  const startingDuplexRef = useRef(false);
  const runtimeStateRef = useRef<CanonicalAvatarState | null>(null);
  const runtimeLogKeyRef = useRef("");
  /** 连接超时主动 close 时，onclose 不再刷「已断开」系统提示（避免与超时错误重复） */
  const suppressDisconnectSysMsgRef = useRef(false);
  const avatarBeatTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const persistedMessagesRef = useRef<ChatMessage[]>([]);
  const historyCursorRef = useRef<HistoryCursor | null>(null);
  const historyLoadingMoreRef = useRef(false);
  const historySourceRef = useRef<"fallback" | "server">("fallback");
  const pendingDevCommandRef = useRef<{
    kind: DevCommandKind;
    scope?: "session" | "relationship" | "all";
  } | null>(null);

  const describeResetScope = useCallback(
    (scope: "session" | "relationship" | "all" = "session") => {
      if (scope === "relationship") return "重置关系层";
      if (scope === "all") return "全部清空";
      return "只清本轮会话";
    },
    [],
  );

  const commitTurnState = useCallback(
    (
      nextState: RemiTurnState,
      reason: RemiTurnStateReason,
      extras?: {
        preview?: string | null;
        interruptionType?: InterruptionType | null;
        generationId?: number | null;
        kind?: "ws" | "system";
      },
    ) => {
      const prevMeta = turnStateMetaRef.current;
      const nextPreview =
        extras?.preview !== undefined ? extras.preview : sttPredictionPreviewRef.current;
      const nextInterruptionType =
        extras?.interruptionType !== undefined
          ? extras.interruptionType
          : interruptionTypeRef.current;
      const nextGenerationId =
        extras?.generationId !== undefined ? extras.generationId ?? null : prevMeta.generationId;
      const now = Date.now();
      const nextSinceAtMs =
        prevMeta.state === nextState ? prevMeta.sinceAtMs : now;

      if (
        prevMeta.state === nextState &&
        prevMeta.reason === reason &&
        prevMeta.generationId === nextGenerationId &&
        prevMeta.preview === nextPreview &&
        prevMeta.interruptionType === nextInterruptionType
      ) {
        return;
      }

      const prev = turnStateRef.current;
      turnStateRef.current = nextState;
      turnStateMetaRef.current = {
        state: nextState,
        reason,
        sinceAtMs: nextSinceAtMs,
        generationId: nextGenerationId,
        preview: nextPreview,
        interruptionType: nextInterruptionType,
      };
      setTurnState(nextState);
      if (extras?.preview !== undefined) {
        sttPredictionPreviewRef.current = extras.preview;
        setSttPredictionPreview(extras.preview);
      }
      if (extras?.interruptionType !== undefined) {
        interruptionTypeRef.current = extras.interruptionType;
        setInterruptionType(extras.interruptionType);
      }
      pushAvatarDevtoolsLog(extras?.kind ?? "ws", "turn state", {
        from: prev,
        to: nextState,
        reason,
        enteredAtMs: nextSinceAtMs,
        dwellMs: prev === nextState ? now - prevMeta.sinceAtMs : now - prevMeta.sinceAtMs,
        generationId: nextGenerationId,
        preview: nextPreview,
        interruptionType: nextInterruptionType,
      });
      mergeAvatarRuntimeSnapshot({
        ts: now,
        turnState: nextState,
        turnReason: reason,
        turnStateAtMs: nextSinceAtMs,
        sttPredictionPreview: nextPreview,
        interruptionType: nextInterruptionType,
      });
    },
    [],
  );

  const clearPendingChatEnd = useCallback((generationId?: number | null) => {
    const targetGeneration = generationId ?? pendingChatEndRef.current?.generationId ?? null;
    pendingChatEndRef.current = null;
    if (pendingChatEndTimerRef.current) {
      clearTimeout(pendingChatEndTimerRef.current);
      pendingChatEndTimerRef.current = null;
    }
    if (targetGeneration != null) {
      playedGenerationIdsRef.current.delete(targetGeneration);
    }
  }, []);

  const clearGenerationState = useCallback(() => {
    activeGenerationRef.current = null;
    blockedGenerationsRef.current.clear();
    playedGenerationIdsRef.current.clear();
    clearPendingChatEnd();
  }, [clearPendingChatEnd]);
  const hasAnnouncedConnectedRef = useRef(false);

  const clearUserSpeakingEndTimer = useCallback(() => {
    if (userSpeakingEndTimerRef.current) {
      clearTimeout(userSpeakingEndTimerRef.current);
      userSpeakingEndTimerRef.current = null;
    }
  }, []);

  const clearAwaitingSpeechCommitTimer = useCallback(() => {
    if (awaitingSpeechCommitTimerRef.current) {
      clearTimeout(awaitingSpeechCommitTimerRef.current);
      awaitingSpeechCommitTimerRef.current = null;
    }
  }, []);

  const syncInputPlaceholder = useCallback(
    (
      overrides?: Partial<{
        recording: boolean;
        userSpeaking: boolean;
        awaitingSpeechCommit: boolean;
      }>,
    ) => {
      setInputPlaceholder(
        resolveDuplexInputPlaceholder({
          recording: overrides?.recording ?? recordingRef.current,
          userSpeaking: overrides?.userSpeaking ?? userSpeakingRef.current,
          awaitingSpeechCommit:
            overrides?.awaitingSpeechCommit ?? awaitingSpeechCommitRef.current,
        }),
      );
    },
    [],
  );

  const setAwaitingSpeechCommitState = useCallback(
    (next: boolean) => {
      awaitingSpeechCommitRef.current = next;
      setAwaitingSpeechCommit(next);
      clearAwaitingSpeechCommitTimer();
      if (!next) return;
      awaitingSpeechCommitTimerRef.current = setTimeout(() => {
        awaitingSpeechCommitTimerRef.current = null;
        awaitingSpeechCommitRef.current = false;
        setAwaitingSpeechCommit(false);
        if (recordingRef.current && !userSpeakingRef.current) {
          syncInputPlaceholder({
            recording: true,
            userSpeaking: false,
            awaitingSpeechCommit: false,
          });
        }
      }, DUPLEX_AWAITING_COMMIT_TIMEOUT_MS);
    },
    [clearAwaitingSpeechCommitTimer, syncInputPlaceholder],
  );

  const clearAvatarIntentSchedule = useCallback(() => {
    for (const timer of avatarBeatTimersRef.current) clearTimeout(timer);
    avatarBeatTimersRef.current = [];
  }, []);

  const markHistoryMutation = useCallback((kind: HistoryListMutation) => {
    setHistoryMutation(kind);
    setHistoryMutationNonce((n) => n + 1);
  }, []);

  const appendLiveMessage = useCallback((message: ChatMessage) => {
    markHistoryMutation("append");
    setLiveMessages((current) => [...current, message]);
  }, [markHistoryMutation]);

  const handleMicCaptureFault = useCallback(
    (detail: PcmCaptureErrorDetail) => {
      const now = Date.now();
      pushAvatarDevtoolsLog("system", "mic capture fault", detail);
      if (now - lastMicFaultAtRef.current < 1500) return;
      lastMicFaultAtRef.current = now;
      startingDuplexRef.current = false;
      resumeDuplexAfterReconnectRef.current = false;
      const ws = wsRef.current;
      if (pcmRef.current) {
        const capture = pcmRef.current;
        pcmRef.current = null;
        capture.stop();
      }
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.stopDuplex();
        } catch {
          /* ignore */
        }
      }
      setSttPartialText("");
      clearGenerationState();
      duplexRef.current = false;
      setDuplex(false);
      setRecording(false);
      recordingRef.current = false;
      clearUserSpeakingEndTimer();
      userSpeakingRef.current = false;
      setUserSpeaking(false);
      setAwaitingSpeechCommitState(false);
      syncInputPlaceholder({
        recording: false,
        userSpeaking: false,
        awaitingSpeechCommit: false,
      });
      appendLiveMessage({
        id: uid(),
        role: "error",
        text: getMicCaptureFaultMessage(detail),
      });
    },
    [
      appendLiveMessage,
      clearGenerationState,
      clearUserSpeakingEndTimer,
      setAwaitingSpeechCommitState,
      syncInputPlaceholder,
    ],
  );

  const triggerIntentGestureAction = useCallback((intent: AvatarIntent | null) => {
    if (!intent) return;
    switch (intent.gesture) {
      case "nod":
      case "shake_head":
      case "wave":
      case "tilt_head":
      case "shrug":
        setAvatarAction({
          action: {
            action: intent.gesture,
            intensity: 0.45 + intent.gestureIntensity * 0.18,
            duration: Math.max(260, intent.holdMs),
          },
          nonce: Date.now() + Math.floor(Math.random() * 1000),
        });
        break;
      default:
        break;
    }
  }, []);

  const mergeIntentBeat = useCallback(
    (base: AvatarIntent, beat: AvatarIntentBeat): AvatarIntent => ({
      emotion: beat.emotion ?? base.emotion,
      gesture: beat.gesture ?? base.gesture,
      gestureIntensity: beat.gestureIntensity ?? base.gestureIntensity,
      facialAccent: beat.facialAccent ?? base.facialAccent,
      energy: beat.energy ?? base.energy,
      holdMs: beat.holdMs ?? base.holdMs,
      source: base.source,
      reason: beat.reason ?? base.reason,
    }),
    [],
  );

  const appendUserTranscript = useCallback((content: string) => {
    const trimmed = content.trim();
    if (!trimmed) return;
    const now = Date.now();
    setLiveMessages((prev) => {
      const last = prev[prev.length - 1];
      if (
        last?.role === "user" &&
        now - lastUserTranscriptAtRef.current <= STT_USER_MERGE_WINDOW_MS
      ) {
        const merged = mergeTranscriptTexts(last.text, trimmed);
        if (merged) {
          const next = [...prev];
          next[next.length - 1] = { ...last, text: merged };
          return next;
        }
      }
      return [...prev, { id: uid(), role: "user", text: trimmed, createdAt: new Date(now).toISOString() }];
    });
    markHistoryMutation("append");
    lastUserTranscriptAtRef.current = now;
  }, [markHistoryMutation]);

  const blockGeneration = useCallback((id: number) => {
    const blocked = blockedGenerationsRef.current;
    blocked.add(id);
    if (blocked.size > 128) {
      const oldest = blocked.values().next();
      if (!oldest.done) blocked.delete(oldest.value);
    }
    if (activeGenerationRef.current === id) {
      activeGenerationRef.current = null;
    }
  }, []);

  const rememberLoggedVoiceGeneration = useCallback((id: number | null): boolean => {
    if (id == null) return false;
    const seen = loggedVoiceGenerationsRef.current;
    if (seen.has(id)) return false;
    seen.add(id);
    if (seen.size > 48) {
      const oldest = seen.values().next();
      if (!oldest.done) seen.delete(oldest.value);
    }
    return true;
  }, []);

  const rememberPlayedGeneration = useCallback((id: number | null) => {
    if (id == null) return;
    const seen = playedGenerationIdsRef.current;
    seen.add(id);
    if (seen.size > 48) {
      const oldest = seen.values().next();
      if (!oldest.done) seen.delete(oldest.value);
    }
  }, []);

  const finalizePendingChatEnd = useCallback(
    (generationId?: number | null) => {
      const targetGeneration = generationId ?? pendingChatEndRef.current?.generationId ?? null;
      clearPendingChatEnd(targetGeneration);
      commitTurnState("confirmed_end", "confirmed_end", {
        generationId: targetGeneration,
        kind: "ws",
      });
    },
    [clearPendingChatEnd, commitTurnState],
  );

  const handlePlaybackStart = useCallback((generationId: number | null) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.notifyPlaybackStart(generationId);
  }, []);

  const handlePlaybackEnd = useCallback((generationId: number | null) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.notifyPlaybackEnd(generationId);
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
  } =
    useAudioBase64Queue({
      onPlaybackStart: handlePlaybackStart,
      onPlaybackEnd: handlePlaybackEnd,
    });

  useEffect(() => {
    if (reconnectDeadline == null) return;
    const id = setInterval(() => {
      bumpReconnectTick((n) => n + 1);
    }, 250);
    return () => clearInterval(id);
  }, [reconnectDeadline]);

  const reconnectInSec =
    reconnectDeadline == null
      ? null
      : Math.max(0, Math.ceil((reconnectDeadline - Date.now()) / 1000));

  const hasMic =
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia;

  const derivedAvatarIntent = useMemo<AvatarIntent>(
    () =>
      deriveAvatarIntent({
        emotion,
        action: avatarAction?.action ?? null,
        face: avatarFrame?.face ?? null,
        turnState,
        source: "server",
        reason: avatarAction?.action.action ?? turnState,
      }),
    [avatarAction, avatarFrame, emotion, turnState],
  );
  const avatarIntent = avatarIntentOverride ?? derivedAvatarIntent;
  const runtimeNowMs = Date.now() + runtimeClock * 0;
  const runtimeState = useMemo(
    () =>
      adaptRemiRuntimeState(
        {
          nowMs: runtimeNowMs,
          connection: connectionPhase,
          turnState,
          turnReason: turnStateMetaRef.current.reason,
          turnPreviewText: sttPredictionPreview,
          turnInterruptionType: interruptionType,
          turnSinceAtMs: turnStateMetaRef.current.sinceAtMs,
          recording,
          duplexEnabled: duplex,
          userSpeaking,
          awaitingCommit: awaitingSpeechCommit,
          waiting,
          typing,
          streamingText,
          voiceActive,
          emotion,
          avatarIntent,
          avatarFrame,
          lipSignal: lipSignalRef.current,
        },
        runtimeStateRef.current,
      ),
    [
      avatarFrame,
      avatarIntent,
      awaitingSpeechCommit,
      connectionPhase,
      duplex,
      emotion,
      recording,
      runtimeNowMs,
      streamingText,
      sttPredictionPreview,
      interruptionType,
      turnState,
      typing,
      userSpeaking,
      voiceActive,
      waiting,
      lipSignalRef,
    ],
  );
  const avatarRenderModel = useMemo(
    () => buildAvatarRenderModel(runtimeState),
    [runtimeState],
  );
  const sdkAvatarRuntimeModel = useMemo<RemiAvatarRuntimeModel>(
    () => selectRemiAvatarRuntimeModel(sdkRuntimeState),
    [sdkRuntimeState],
  );
  const listeningHint = useMemo(
    () => selectListeningHint(runtimeState, sttPartialText),
    [runtimeState, sttPartialText],
  );
  const thinkingHint = useMemo(
    () => selectThinkingHint(runtimeState),
    [runtimeState],
  );

  const lastIntentKeyRef = useRef("");

  useEffect(() => {
    const key = JSON.stringify(avatarIntent);
    if (key === lastIntentKeyRef.current) return;
    lastIntentKeyRef.current = key;
    pushAvatarDevtoolsLog("intent", "avatar intent updated", avatarIntent);
  }, [avatarIntent]);

  useEffect(() => {
    runtimeStateRef.current = runtimeState;
  }, [runtimeState]);

  useEffect(() => {
    const expiresAt = Math.max(
      runtimeState.timers?.speakingTailUntilMs ?? 0,
      runtimeState.timers?.reactingUntilMs ?? 0,
    );
    if (!expiresAt || expiresAt <= Date.now()) return;
    const timeout = window.setTimeout(() => {
      setRuntimeClock((tick) => tick + 1);
    }, Math.max(1, expiresAt - Date.now() + 1));
    return () => window.clearTimeout(timeout);
  }, [
    runtimeState.timers?.reactingUntilMs,
    runtimeState.timers?.speakingTailUntilMs,
  ]);

  useEffect(() => {
    const snapshotTs = Date.now();
    publishAvatarRuntimeSnapshot({
      ts: snapshotTs,
      emotion: runtimeState.affect.emotion,
      remState: toLegacyRemState(runtimeState),
      turnState: runtimeState.turn.serverState,
      turnReason: runtimeState.turn.reason,
      turnStateAtMs: runtimeState.turn.sinceAtMs,
      sttPredictionPreview: runtimeState.turn.previewText,
      interruptionType: runtimeState.turn.interruptionType,
      voiceActive: runtimeState.assistant.playbackActive,
      lipEnvelope: runtimeState.speech.envelope,
      expressionWeights: avatarFrame?.face ?? {},
      activeAction: avatarAction?.action ?? null,
      activeCue: avatarIntent?.gesture ?? null,
      runtimeState: runtimeState.phase,
      intent: avatarIntent,
      runtimePhase: runtimeState.phase,
      runtimePhaseReason: runtimeState.phaseReason,
      connection: runtimeState.connection,
      userRecording: runtimeState.user.recording,
      userSpeaking: runtimeState.user.speaking,
      assistantStreaming:
        runtimeState.assistant.streaming || runtimeState.assistant.waiting,
      assistantPlaybackActive: runtimeState.assistant.playbackActive,
      assistantPlaybackTailActive: runtimeState.assistant.playbackTailActive,
      mouthLevel: runtimeState.speech.mouthLevel,
      renderModel: {
        presenceLabel: avatarRenderModel.presenceLabel,
        companionLine: avatarRenderModel.companionLine,
        mouthOpen: avatarRenderModel.mouthOpen,
        blink: avatarRenderModel.blink,
        smile: avatarRenderModel.smile,
        gazeX: avatarRenderModel.gazeX,
        gazeY: avatarRenderModel.gazeY,
        headYaw: avatarRenderModel.headYaw,
        headPitch: avatarRenderModel.headPitch,
        breath: avatarRenderModel.breath,
        posture: avatarRenderModel.posture,
      },
    });
  }, [avatarAction, avatarFrame, avatarIntent, avatarRenderModel, runtimeState]);

  useEffect(() => {
    const key = [
      runtimeState.phase,
      runtimeState.phaseReason,
      runtimeState.connection,
      runtimeState.turn.serverState ?? "none",
      runtimeState.user.recording ? "1" : "0",
      runtimeState.user.speaking ? "1" : "0",
      runtimeState.assistant.playbackActive ? "1" : "0",
      runtimeState.assistant.playbackTailActive ? "1" : "0",
    ].join("|");
    if (key === runtimeLogKeyRef.current) return;
    runtimeLogKeyRef.current = key;
    pushAvatarDevtoolsLog("runtime", "derived runtime state", {
      phase: runtimeState.phase,
      phaseReason: runtimeState.phaseReason,
      connection: runtimeState.connection,
      turnState: runtimeState.turn.serverState,
      turnReason: runtimeState.turn.reason,
      userRecording: runtimeState.user.recording,
      userSpeaking: runtimeState.user.speaking,
      assistantStreaming:
        runtimeState.assistant.streaming || runtimeState.assistant.waiting,
      assistantPlaybackActive: runtimeState.assistant.playbackActive,
      assistantPlaybackTailActive: runtimeState.assistant.playbackTailActive,
      mouthLevel: runtimeState.speech.mouthLevel,
    });
  }, [runtimeState]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (
      !runtimeState.user.recording &&
      !runtimeState.assistant.playbackActive &&
      !runtimeState.assistant.playbackTailActive
    ) {
      return;
    }
    const interval = window.setInterval(() => {
      const envelope = Math.max(0, Math.min(1, lipSignalRef.current.envelope ?? 0));
      mergeAvatarRuntimeSnapshot({
        ts: Date.now(),
        lipEnvelope: envelope,
        mouthLevel: envelope,
        assistantPlaybackActive: runtimeStateRef.current?.assistant.playbackActive ?? false,
        assistantPlaybackTailActive:
          runtimeStateRef.current?.assistant.playbackTailActive ?? false,
      });
    }, 120);
    return () => window.clearInterval(interval);
  }, [
    lipSignalRef,
    runtimeState.assistant.playbackActive,
    runtimeState.assistant.playbackTailActive,
    runtimeState.user.recording,
  ]);

  useEffect(() => {
    if (!avatarAction) return;
    const timer = setTimeout(() => {
      setAvatarAction((current) => (current?.nonce === avatarAction.nonce ? null : current));
    }, Math.max(200, avatarAction.action.duration + 80));
    return () => clearTimeout(timer);
  }, [avatarAction]);

  useEffect(() => {
    if (!shouldFinalizeDeferredChatEnd({
      awaitingPlaybackDrain: pendingChatEndRef.current?.awaitingPlaybackDrain ?? false,
      voiceActive,
    })) {
      return;
    }
    finalizePendingChatEnd();
  }, [finalizePendingChatEnd, voiceActive]);

  /* ── Streaming text helpers ── */

  const appendStreaming = useCallback((chunk: string) => {
    streamingBufRef.current += chunk;
    setStreamingText(streamingBufRef.current);
  }, []);

  const resetStreaming = useCallback(() => {
    streamingBufRef.current = "";
    setStreamingText("");
  }, []);

  const allowServerGeneration = useCallback(
    (type: string, rawGenerationId: unknown): boolean => {
      const id = parseGenerationId(rawGenerationId);
      if (id == null) return true; // Backward-compatible path for older servers.

      if (blockedGenerationsRef.current.has(id)) {
        return false;
      }

      const active = activeGenerationRef.current;
      if (active == null) {
        activeGenerationRef.current = id;
        return true;
      }
      if (active === id) return true;

      // Allow rollover only on token start; otherwise old/new chunks might interleave.
      if (type === "chat_chunk") {
        clearQueue();
        resetStreaming();
        activeGenerationRef.current = id;
        return true;
      }
      return false;
    },
    [clearQueue, parseGenerationId, resetStreaming],
  );

  /* ── Full-duplex voice（须在 WebSocket 回调之前定义）── */

  const startDuplex = useCallback(async () => {
    const ws = wsRef.current;
    if (
      !ws ||
      ws.readyState !== WebSocket.OPEN ||
      startingDuplexRef.current ||
      pcmRef.current ||
      recordingRef.current ||
      duplexRef.current
    ) {
      return;
    }
    startingDuplexRef.current = true;
    // Local pre-barge-in: stop any queued/playing TTS immediately.
    clearQueue();
    clearPendingChatEnd();
    setSttPartialText("");
    void unlockPlayback();

    let stream: MediaStream | null = null;
    let captureInitFault = false;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      let pcmSampleRate = 16000;
      micTxStartedAtRef.current = Date.now();
      micTxFramesRef.current = 0;
      micTxBytesRef.current = 0;
      micTxLastRmsRef.current = 0;
      micTxLastPeakRef.current = 0;
      micTxMaxRmsRef.current = 0;
      micTxLastLogAtRef.current = 0;
      micTxGateRef.current = CLIENT_MIC_PRE_GATE_ENABLED ? new MicTxGate() : null;
      const capture = await startPcmCapture(
        stream,
        (pcm16) => {
          const gate = micTxGateRef.current;
          const gateResult = gate?.feed(pcm16, {
            assistantSpeaking: turnStateRef.current === "assistant_speaking",
          });
          if (gateResult?.opened) {
            pushAvatarDevtoolsLog("system", "mic tx gate open", {
              bufferedFrames: gateResult.framesToSend.length,
              assistantSpeaking: turnStateRef.current === "assistant_speaking",
              rms: Number(gateResult.analysis.rms.toFixed(4)),
              zcr: Number(gateResult.analysis.zcr.toFixed(4)),
              activeRatio: Number(gateResult.analysis.activeRatio.toFixed(4)),
            });
          } else if (gateResult?.closed) {
            pushAvatarDevtoolsLog("system", "mic tx gate close", {
              assistantSpeaking: turnStateRef.current === "assistant_speaking",
              rms: Number(gateResult.analysis.rms.toFixed(4)),
              zcr: Number(gateResult.analysis.zcr.toFixed(4)),
              activeRatio: Number(gateResult.analysis.activeRatio.toFixed(4)),
            });
          }
          const framesToSend = gateResult?.framesToSend ?? [pcm16];
          for (const chunk of framesToSend) {
            const metrics = measurePcmFrame(chunk);
            micTxFramesRef.current += 1;
            micTxBytesRef.current += chunk.byteLength;
            micTxLastRmsRef.current = metrics.rms;
            micTxLastPeakRef.current = metrics.peak;
            micTxMaxRmsRef.current = Math.max(micTxMaxRmsRef.current, metrics.rms);
            const now = Date.now();
            if (now - micTxLastLogAtRef.current >= MIC_TX_LOG_INTERVAL_MS) {
              micTxLastLogAtRef.current = now;
              pushAvatarDevtoolsLog("system", "mic tx", {
                frames: micTxFramesRef.current,
                bytes: micTxBytesRef.current,
                rms: Number(metrics.rms.toFixed(4)),
                peak: Number(metrics.peak.toFixed(4)),
                maxRms: Number(micTxMaxRmsRef.current.toFixed(4)),
                wsOpen: ws.readyState === WebSocket.OPEN,
                preGate: gate != null,
                gateOpen: gate?.isTransmitting() ?? true,
              });
            }
            if (ws.readyState === WebSocket.OPEN) {
              const frame = encodePcmAudioFrame(chunk, pcmSampleRate);
              try {
                ws.sendAudioFrame(frame);
              } catch {
                // Compatibility fallback for servers that only parse JSON audio_stream.
                ws.sendAudioStreamBase64(arrayBufferToBase64(chunk), pcmSampleRate);
              }
            }
          }
        },
        {
          onStateChange: (state) => {
            pushAvatarDevtoolsLog("system", "mic context state", { state });
          },
          onError: (detail) => {
            captureInitFault = true;
            handleMicCaptureFault(detail);
          },
        },
      );
      pcmSampleRate = capture.sampleRate;

      pcmRef.current = capture;
      ws.startDuplex(capture.sampleRate);
      pushAvatarDevtoolsLog("system", "duplex capture start", {
        sampleRate: capture.sampleRate,
      });

      duplexRef.current = true;
      setDuplex(true);
      setRecording(true);
      recordingRef.current = true;
      setAwaitingSpeechCommitState(false);
      syncInputPlaceholder({
        recording: true,
        userSpeaking: false,
        awaitingSpeechCommit: false,
      });
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      resumeDuplexAfterReconnectRef.current = false;
      duplexRef.current = false;
      setDuplex(false);
      setRecording(false);
      recordingRef.current = false;
      setAwaitingSpeechCommitState(false);
      syncInputPlaceholder({
        recording: false,
        userSpeaking: false,
        awaitingSpeechCommit: false,
      });
      if (!captureInitFault) {
        appendLiveMessage({
          id: uid(),
          role: "error",
          text: getMicAccessErrorMessage(error),
        });
      }
    } finally {
      startingDuplexRef.current = false;
    }
  }, [
    appendLiveMessage,
    clearPendingChatEnd,
    clearQueue,
    handleMicCaptureFault,
    setAwaitingSpeechCommitState,
    syncInputPlaceholder,
    unlockPlayback,
  ]);

  const stopVoiceSession = useCallback((options?: { preserveAutoResume?: boolean }) => {
    const ws = wsRef.current;
    const startedAt = micTxStartedAtRef.current;
    if (startedAt > 0) {
      pushAvatarDevtoolsLog("system", "duplex capture stop", {
        durationMs: Date.now() - startedAt,
        frames: micTxFramesRef.current,
        bytes: micTxBytesRef.current,
        lastRms: Number(micTxLastRmsRef.current.toFixed(4)),
        lastPeak: Number(micTxLastPeakRef.current.toFixed(4)),
        maxRms: Number(micTxMaxRmsRef.current.toFixed(4)),
        preserveAutoResume: options?.preserveAutoResume ?? false,
      });
    }
    micTxStartedAtRef.current = 0;
    startingDuplexRef.current = false;
    if (pcmRef.current) {
      pcmRef.current.stop();
      pcmRef.current = null;
    }
    micTxGateRef.current = null;
    resumeDuplexAfterReconnectRef.current = options?.preserveAutoResume ?? false;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.stopDuplex();
    }
    setSttPartialText("");
    clearGenerationState();
    duplexRef.current = false;
    setDuplex(false);
    setRecording(false);
    recordingRef.current = false;
    clearUserSpeakingEndTimer();
    userSpeakingRef.current = false;
    setUserSpeaking(false);
    setAwaitingSpeechCommitState(false);
    syncInputPlaceholder({
      recording: false,
      userSpeaking: false,
      awaitingSpeechCommit: false,
    });
  }, [
    clearGenerationState,
    clearUserSpeakingEndTimer,
    setAwaitingSpeechCommitState,
    syncInputPlaceholder,
  ]);

  const toggleMic = useCallback(() => {
    if (recordingRef.current) {
      stopVoiceSession();
    } else {
      activeGenerationRef.current = null;
      void startDuplex();
    }
  }, [startDuplex, stopVoiceSession]);

  /* ── WebSocket connection ── */

  const connectRef = useRef<() => void>(() => {});

  connectRef.current = () => {
    if (remiAuth.clerkEnabled && (!remiAuth.ready || !remiAuth.signedIn)) {
      return;
    }
    void (async () => {
      const sessionToken = await remiAuth.getSessionToken();
    if (reconnectRef.current) {
      clearTimeout(reconnectRef.current);
      reconnectRef.current = null;
    }
    setReconnectDeadline(null);
    setConnectionPhase("connecting");
    setConnLabel("连接中…");
      const url = getRemWsUrl(sessionToken);
    if (!url) {
      setConnectionPhase("closed");
      setConnLabel("无法解析 WS 地址");
      pushAvatarDevtoolsLog("system", "ws unavailable", {
        reason: "empty-url",
      });
      appendLiveMessage({
        id: uid(),
        role: "error",
        text: "WebSocket 地址为空（仅应在浏览器环境连接）",
      });
      return;
    }

    const clientContext = toClientContextPayload({
      surface: "web",
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      locale: navigator.language,
      capabilities: WEB_RUNTIME_SHADOW_CAPABILITIES,
    });
    const ws = new RemiRuntimeClient({
      url,
      clientContext,
      createTransport: (targetUrl) => new WebSocket(targetUrl) as unknown as RemiRuntimeTransport,
      onRuntimeEvent: (event, state) => {
        setSdkRuntimeState(state);
        if (REMI_RUNTIME_SHADOW_ENABLED) {
          pushAvatarDevtoolsLog("runtime", `shadow:${event.type}`, {
            connection: state.connection,
            phase: state.phase,
            phaseReason: state.phaseReason,
            generationId: state.assistant.activeGenerationId ?? state.turn.generationId,
            streamingTextLength: state.assistant.streamingText.length,
            finalTextLength: state.assistant.finalText.length,
            audioActive: state.assistant.audioActive,
            lipSyncCueCount: state.speech.lipSyncCues.length,
            error: state.error,
          });
        }
      },
    });
    pushAvatarDevtoolsLog("system", "ws connecting", { url });
    clearGenerationState();
    wsRef.current = ws;

    const connectTimer = window.setTimeout(() => {
      if (ws.readyState === WebSocket.CONNECTING) {
        suppressDisconnectSysMsgRef.current = true;
        setConnLabel("连接超时");
        appendLiveMessage({
          id: uid(),
          role: "error",
          text:
            "连接服务器超时。请确认已在仓库根目录运行「npm run dev」（默认端口 3000），或设置 NEXT_PUBLIC_WS_URL=ws://你的后端:端口/ws",
        });
        ws.close();
      }
    }, WS_CONNECT_TIMEOUT_MS);

    ws.onopen = () => {
      window.clearTimeout(connectTimer);
      setConnected(true);
      setConnectionPhase("open");
      setReconnectDeadline(null);
      setConnLabel("在线");
      pushAvatarDevtoolsLog("system", "ws open", { url });
      if (REMI_RUNTIME_SHADOW_ENABLED) {
        pushAvatarDevtoolsLog("runtime", "shadow:client_context", {
          surface: clientContext.surface,
          timeZone: clientContext.timeZone,
          locale: clientContext.locale,
          capabilities: clientContext.capabilities,
        });
      }
      if (!hasAnnouncedConnectedRef.current) {
        hasAnnouncedConnectedRef.current = true;
        appendLiveMessage({ id: uid(), role: "sys", text: "已连接，和 Remi 聊聊吧" });
      }
      if (
        resumeDuplexAfterReconnectRef.current &&
        !recordingRef.current &&
        !pcmRef.current &&
        !startingDuplexRef.current
      ) {
        void startDuplex();
      }
    };

    ws.onmessage = (ev) => {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(ev.data as string) as Record<string, unknown>;
      } catch {
        return;
      }

      const t = data.type as string;

      switch (t) {
        case "turn_state": {
          const nextTurnState = parseServerTurnState(data);
          if (nextTurnState) {
            commitTurnState(nextTurnState.state, nextTurnState.reason, {
              preview: nextTurnState.preview,
              interruptionType: nextTurnState.interruptionType,
              generationId: nextTurnState.generationId,
              kind: "ws",
            });
            if (recordingRef.current) {
              if (nextTurnState.state === "listening_active") {
                setAwaitingSpeechCommitState(false);
              } else if (
                !userSpeakingRef.current &&
                (nextTurnState.state === "listening_hold" ||
                  nextTurnState.state === "likely_end" ||
                  nextTurnState.state === "confirmed_end")
              ) {
                setAwaitingSpeechCommitState(true);
                syncInputPlaceholder({
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
            setEmotion(nextEmotion);
            pushAvatarDevtoolsLog("ws", "emotion", { emotion: nextEmotion });
          }
          break;

        case "history_page": {
          const { mode, messages: pageMessages, nextCursor, hasMore } =
            parseServerHistoryPage(data);

          const shouldAdoptServerHistory =
            mode === "prepend" || pageMessages.length > 0 || historyMessages.length === 0;

          if (shouldAdoptServerHistory) {
            historySourceRef.current = "server";
            historyCursorRef.current =
              nextCursor && nextCursor.id && nextCursor.createdAt ? nextCursor : null;
            setHistoryHasMore(hasMore);
          }
          historyLoadingMoreRef.current = false;
          setHistoryLoadingMore(false);

          if (mode === "replace") {
            if (shouldAdoptServerHistory) {
              setHistoryMessages(pageMessages);
              markHistoryMutation("replace");
            }
          } else if (pageMessages.length > 0) {
            setHistoryMessages((current) => {
              const seenIds = new Set(current.map((message) => message.id));
              const older = pageMessages.filter((message) => !seenIds.has(message.id));
              return older.length > 0 ? [...older, ...current] : current;
            });
            markHistoryMutation("prepend");
          }
          break;
        }

        case "chat_chunk":
          if (!allowServerGeneration("chat_chunk", data.generationId)) break;
          if (!streamingBufRef.current) {
            commitTurnState("assistant_entering", "tts_prepare", {
              generationId: parseGenerationId(data.generationId),
              kind: "ws",
            });
          }
          setAwaitingSpeechCommitState(false);
          setSttPartialText("");
          setTyping(false);
          appendStreaming(String(data.content ?? ""));
          break;

        case "chat_end": {
          if (!allowServerGeneration("chat_end", data.generationId)) break;
          const text = streamingBufRef.current;
          resetStreaming();
          if (!duplexRef.current) {
            waitingRef.current = false;
            setWaiting(false);
          }
          setSttPartialText("");
          setInputPlaceholder("说点什么…");
          if (text) {
            appendLiveMessage({
              id: uid(),
              role: "rem",
              text,
              createdAt: new Date().toISOString(),
            });
          }
          const endGenerationId = parseGenerationId(data.generationId);
          if (endGenerationId != null && activeGenerationRef.current === endGenerationId) {
            activeGenerationRef.current = null;
          }
          if (data.emotion != null) setEmotion(String(data.emotion));
          const awaitingPlaybackDrain = shouldAwaitPlaybackDrain({
            voiceActive,
            playbackSeenForGeneration:
              endGenerationId != null && playedGenerationIdsRef.current.has(endGenerationId),
          });
          pendingChatEndRef.current = {
            generationId: endGenerationId,
            awaitingPlaybackDrain,
          };
          if (!awaitingPlaybackDrain) {
            if (pendingChatEndTimerRef.current) {
              clearTimeout(pendingChatEndTimerRef.current);
            }
            pendingChatEndTimerRef.current = setTimeout(() => {
              if (!pendingChatEndRef.current) return;
              if (pendingChatEndRef.current.generationId !== endGenerationId) return;
              if (pendingChatEndRef.current.awaitingPlaybackDrain) return;
              finalizePendingChatEnd(endGenerationId);
            }, CHAT_END_PLAYBACK_GRACE_MS);
          }
          break;
        }

        case "voice":
          if (!allowServerGeneration("voice", data.generationId)) break;
          if (typeof data.audio === "string") {
            const generationId = parseGenerationId(data.generationId);
            rememberPlayedGeneration(generationId);
            if (pendingChatEndRef.current?.generationId === generationId) {
              pendingChatEndRef.current = {
                generationId,
                awaitingPlaybackDrain: true,
              };
              if (pendingChatEndTimerRef.current) {
                clearTimeout(pendingChatEndTimerRef.current);
                pendingChatEndTimerRef.current = null;
              }
            }
            commitTurnState("assistant_speaking", "playback_start", {
              generationId,
              kind: "ws",
            });
            enqueueBase64(data.audio, generationId);
            if (rememberLoggedVoiceGeneration(generationId)) {
              pushAvatarDevtoolsLog("ws", "voice start", {
                generationId,
                transport: "voice",
              });
            }
          }
          break;

        case "voice_chunk":
        case "voice_pcm_chunk": {
          if (!allowServerGeneration("voice_pcm_chunk", data.generationId)) break;
          if (typeof data.audio === "string") {
            const rate = Number(data.sampleRate);
            const generationId = parseGenerationId(data.generationId);
            rememberPlayedGeneration(generationId);
            if (pendingChatEndRef.current?.generationId === generationId) {
              pendingChatEndRef.current = {
                generationId,
                awaitingPlaybackDrain: true,
              };
              if (pendingChatEndTimerRef.current) {
                clearTimeout(pendingChatEndTimerRef.current);
                pendingChatEndTimerRef.current = null;
              }
            }
            commitTurnState("assistant_speaking", "playback_start", {
              generationId,
              kind: "ws",
            });
            enqueuePcmChunk(
              data.audio,
              Number.isFinite(rate) && rate > 0 ? rate : 24000,
              generationId,
            );
            if (rememberLoggedVoiceGeneration(generationId)) {
              pushAvatarDevtoolsLog("ws", "voice start", {
                generationId,
                transport: "voice_pcm_chunk",
                sampleRate: Number.isFinite(rate) && rate > 0 ? rate : 24000,
              });
            }
          }
          break;
        }

        case "tts_lip_sync": {
          if (!allowServerGeneration("tts_lip_sync", data.generationId)) break;
          const generationId = parseGenerationId(data.generationId);
          if (generationId == null || !Array.isArray(data.cues)) break;
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
          break;
        }

        case "avatar_frame": {
          const frame = data.frame as
            | {
                action?: AvatarActionCommand;
                emotion?: string;
                face?: AvatarFrameState["face"];
                lipSync?: AvatarFrameState["lipSync"];
              }
            | undefined;
          const receivedAtMs = Date.now();
          if (frame?.emotion) setEmotion(String(frame.emotion));
          if (frame?.face || frame?.lipSync || frame?.emotion) {
            setAvatarFrame((prev) => ({
              emotion: (frame?.emotion as AvatarFrameState["emotion"]) ?? prev?.emotion,
              face: frame?.face ?? prev?.face,
              lipSync: frame?.lipSync ?? prev?.lipSync,
              lipSyncAtMs: frame?.lipSync ? receivedAtMs : prev?.lipSyncAtMs,
            }));
          }
          if (frame?.action) {
            setAvatarAction({
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
          break;
        }

        case "avatar_intent": {
          const intent =
            data.intent && typeof data.intent === "object"
              ? (data.intent as AvatarIntent)
              : null;
          const beats = Array.isArray(data.beats)
            ? (data.beats as AvatarIntentBeat[])
            : [];
          clearAvatarIntentSchedule();
          if (intent) {
            setAvatarIntentOverride(intent);
            triggerIntentGestureAction(intent);
            pushAvatarDevtoolsLog("ws", "avatar_intent", {
              intent,
              beats: beats.length,
            });
            let endAt = Date.now() + Math.max(260, intent.holdMs);
            for (const beat of beats) {
              const merged = mergeIntentBeat(intent, beat);
              const timer = setTimeout(() => {
                setAvatarIntentOverride(merged);
                triggerIntentGestureAction(merged);
              }, Math.max(0, beat.delayMs));
              avatarBeatTimersRef.current.push(timer);
              endAt = Math.max(
                endAt,
                Date.now() + Math.max(0, beat.delayMs) + Math.max(260, merged.holdMs),
              );
            }
            const resetTimer = setTimeout(() => {
              setAvatarIntentOverride(intent);
            }, Math.max(0, endAt - Date.now()));
            avatarBeatTimersRef.current.push(resetTimer);
          }
          break;
        }

        case "stt_prediction": {
          const preview =
            typeof data.preview === "string" && data.preview.trim()
              ? data.preview.trim()
              : null;
          sttPredictionPreviewRef.current = preview;
          setSttPredictionPreview(preview);
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
          const interruptedGeneration = parseGenerationId(data.generationId);
          clearPendingChatEnd(interruptedGeneration);
          if (interruptedGeneration != null) {
            blockGeneration(interruptedGeneration);
          } else {
            activeGenerationRef.current = null;
          }
          setSttPartialText("");
          clearQueue();
          clearAvatarIntentSchedule();
          setAvatarIntentOverride(null);
          sttPredictionPreviewRef.current = null;
          setSttPredictionPreview(null);
          resetStreaming();
          setTyping(false);
          interruptionTypeRef.current = "unknown";
          setInterruptionType("unknown");
          commitTurnState("interrupted_by_user", "user_interrupt", {
            interruptionType: "unknown",
            generationId: interruptedGeneration,
            kind: "ws",
          });
          pushAvatarDevtoolsLog("ws", "interrupt", {
            generationId: interruptedGeneration,
          });
          break;
        }

        case "vad_start":
          clearUserSpeakingEndTimer();
          setAwaitingSpeechCommitState(false);
          setSttPartialText((prev) => (isListeningFallbackText(prev) ? "" : prev));
          userSpeakingRef.current = true;
          setUserSpeaking(true);
          syncInputPlaceholder({
            recording: recordingRef.current,
            userSpeaking: true,
            awaitingSpeechCommit: false,
          });
          commitTurnState("listening_active", "speech_start", {
            kind: "ws",
          });
          break;

        case "vad_end":
          clearUserSpeakingEndTimer();
          userSpeakingEndTimerRef.current = setTimeout(() => {
            userSpeakingEndTimerRef.current = null;
            userSpeakingRef.current = false;
            setUserSpeaking(false);
            if (recordingRef.current) {
              syncInputPlaceholder({
                recording: true,
                userSpeaking: false,
              });
            }
          }, USER_SPEAKING_END_DEBOUNCE_MS);
          commitTurnState("listening_hold", "semantic_hold", {
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
          const content = String(data.content ?? "");
          activeGenerationRef.current = null;
          clearUserSpeakingEndTimer();
          userSpeakingRef.current = false;
          setUserSpeaking(false);
          setAwaitingSpeechCommitState(false);
          setSttPartialText("");
          appendUserTranscript(content);
          setInputPlaceholder("说点什么…");
          if (!duplexRef.current) {
            waitingRef.current = true;
            setWaiting(true);
          }
          setTyping(true);
          commitTurnState("confirmed_end", "confirmed_end", {
            kind: "ws",
          });
          break;
        }

        case "error": {
          const pendingDevCommand = pendingDevCommandRef.current;
          if (pendingDevCommand) {
            pendingDevCommandRef.current = null;
            setDevStatus({
              tone: "error",
              message: String(data.content ?? "开发操作失败"),
            });
          }
          historyLoadingMoreRef.current = false;
          setHistoryLoadingMore(false);
          clearPendingChatEnd();
          clearUserSpeakingEndTimer();
          userSpeakingRef.current = false;
          setUserSpeaking(false);
          setAwaitingSpeechCommitState(false);
          setTyping(false);
          setSttPartialText("");
          resetStreaming();
          waitingRef.current = false;
          setWaiting(false);
          setInputPlaceholder("说点什么…");
          appendLiveMessage({
            id: uid(),
            role: "error",
            text: String(data.content ?? "错误"),
          });
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
          pendingDevCommandRef.current = null;
          if (data.type === "dev_preset_applied") {
            const personaPreset =
              typeof data.personaPreset === "string" && data.personaPreset.trim()
                ? data.personaPreset.trim()
                : "";
            const relationshipPreset =
              typeof data.relationshipPreset === "string" &&
              data.relationshipPreset.trim()
                ? data.relationshipPreset.trim()
                : "";
            const parts = [
              personaPreset ? `人格：${personaPreset}` : "",
              relationshipPreset ? `关系：${relationshipPreset}` : "",
            ].filter(Boolean);
            setDevStatus({
              tone: "success",
              message:
                parts.length > 0 ? `预设已应用 (${parts.join(" / ")})` : "预设已应用",
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
              data.scope === "all" || data.scope === "relationship" || data.scope === "session"
                ? data.scope
                : "session";
            setDevStatus({
              tone: "success",
              message: `${describeResetScope(scope)}已完成`,
            });
          }
          clearPendingChatEnd();
          clearUserSpeakingEndTimer();
          userSpeakingRef.current = false;
          setUserSpeaking(false);
          setAwaitingSpeechCommitState(false);
          setTyping(false);
          setSttPartialText("");
          resetStreaming();
          waitingRef.current = false;
          setWaiting(false);
          clearQueue();
          clearAvatarIntentSchedule();
          setAvatarIntentOverride(null);
          sttPredictionPreviewRef.current = null;
          setSttPredictionPreview(null);
          interruptionTypeRef.current = null;
          setInterruptionType(null);
          commitTurnState("confirmed_end", "confirmed_end", { kind: "system" });
          historySourceRef.current = "fallback";
          historyCursorRef.current = null;
          historyLoadingMoreRef.current = false;
          setHistoryLoadingMore(false);
          setHistoryHasMore(false);
          persistedMessagesRef.current = [];
          setHistoryMessages([]);
          setLiveMessages([]);
          markHistoryMutation("replace");
          try {
            localStorage.removeItem(messageStorageKey);
            localStorage.removeItem(resolveLegacyMessageStorageKey(messageStorageKey));
          } catch {
            /* noop */
          }
          break;
        }

        default:
          break;
      }
    };

    ws.onclose = () => {
      window.clearTimeout(connectTimer);
      if (!mountedRef.current) return;
      if (pendingDevCommandRef.current) {
        pendingDevCommandRef.current = null;
        setDevStatus({
          tone: "error",
          message: "连接已断开，未确认刚才的开发操作是否成功",
        });
      }
      const shouldResumeDuplex = recordingRef.current || duplexRef.current;
      stopVoiceSession({ preserveAutoResume: shouldResumeDuplex });

      setConnected(false);
      setConnectionPhase("closed");
      setReconnectDeadline(Date.now() + REM_WS_RECONNECT_DELAY_MS);
      setConnLabel("已断开");
      historyLoadingMoreRef.current = false;
      setHistoryLoadingMore(false);
      waitingRef.current = false;
      setWaiting(false);
      clearGenerationState();
      clearAvatarIntentSchedule();
      setAvatarIntentOverride(null);
      setSttPartialText("");
      sttPredictionPreviewRef.current = null;
      setSttPredictionPreview(null);
      interruptionTypeRef.current = null;
      setInterruptionType(null);
      resetStreaming();
      setTyping(false);
      const quiet = suppressDisconnectSysMsgRef.current;
      suppressDisconnectSysMsgRef.current = false;
      pushAvatarDevtoolsLog("system", "ws closed", {
        quiet,
        reconnectInMs: REM_WS_RECONNECT_DELAY_MS,
      });
      if (!quiet) {
        markHistoryMutation("append");
        setLiveMessages((m) => {
          const last = m[m.length - 1];
          if (last?.role === "sys" && last.text === "连接已断开，3 秒后重连…") {
            return m;
          }
          return [...m, { id: uid(), role: "sys", text: "连接已断开，3 秒后重连…" }];
        });
      }
      reconnectRef.current = setTimeout(() => {
        if (mountedRef.current) connectRef.current?.();
      }, REM_WS_RECONNECT_DELAY_MS);
    };

    ws.onerror = () => {
      window.clearTimeout(connectTimer);
      pushAvatarDevtoolsLog("system", "ws error");
    };
    ws.connect();
    })();
  };

  useEffect(() => {
    setBrowserIdentity({
      isDefaultDevUser: remiAuth.isDefaultDevUser,
      currentUserId: remiAuth.currentUserId,
      wsTargetLabel: resolveWsTargetLabel(getRemWsUrl()),
    });
  }, [remiAuth.currentUserId, remiAuth.isDefaultDevUser]);

  useEffect(() => {
    // connectRef 已使用 ref pattern，总是读取最新闭包，因此依赖必须保持为空 —
    // 否则任何 useCallback 身份变化或 voiceActive 翻转都会触发 cleanup，主动 close WS，
    // 导致用户看到假的「连接已断开，3 秒后重连…」。
    mountedRef.current = true;
    connectRef.current?.();
    return () => {
      mountedRef.current = false;
      clearAvatarIntentSchedule();
      clearUserSpeakingEndTimer();
      clearAwaitingSpeechCommitTimer();
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!mountedRef.current) return;
    if (remiAuth.clerkEnabled && !remiAuth.ready) return;
    if (remiAuth.clerkEnabled && !remiAuth.signedIn) {
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current);
        reconnectRef.current = null;
      }
      wsRef.current?.close();
      return;
    }
    if (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED) {
      connectRef.current?.();
    }
  }, [
    remiAuth.clerkEnabled,
    remiAuth.currentUserId,
    remiAuth.ready,
    remiAuth.signedIn,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const persisted = loadPersistedMessages(messageStorageKey);
    persistedMessagesRef.current = persisted;
    const initialHistory = persisted.slice(-INITIAL_HISTORY_DISPLAY_LIMIT);
    historySourceRef.current = "fallback";
    historyCursorRef.current = null;
    historyLoadingMoreRef.current = false;
    setHistoryLoadingMore(false);
    setHistoryHasMore(persisted.length > initialHistory.length);
    setHistoryMessages(initialHistory);
    setLiveMessages([]);
    markHistoryMutation("replace");
    setMessagesHydrated(true);
  }, [markHistoryMutation, messageStorageKey]);

  useEffect(() => {
    if (!messagesHydrated || typeof window === "undefined") return;
    const visibleLive = liveMessages.filter((m) => m.role === "user" || m.role === "rem");
    const baseHistory =
      historySourceRef.current === "fallback"
        ? persistedMessagesRef.current
        : historyMessages.filter((m) => m.role === "user" || m.role === "rem");
    const persist = [...baseHistory, ...visibleLive]
      .filter((message, index, all) => all.findIndex((item) => item.id === message.id) === index)
      .slice(-MESSAGE_STORAGE_MAX);
    persistedMessagesRef.current = persist;
    try {
      localStorage.setItem(messageStorageKey, JSON.stringify(persist));
    } catch {
      /* quota or private mode */
    }
  }, [historyMessages, liveMessages, messagesHydrated, messageStorageKey]);

  /* ── Text chat ── */

  const sendText = useCallback(
    (text: string) => {
      const ws = wsRef.current;
      const trimmed = text.trim();
      if (!trimmed || !ws || ws.readyState !== WebSocket.OPEN) return;
      // Sending a new user text should immediately stop current/queued playback.
      clearQueue();
      clearPendingChatEnd();
      void unlockPlayback();
      const interruptedGeneration = activeGenerationRef.current;
      if (interruptedGeneration != null) {
        blockGeneration(interruptedGeneration);
      } else {
        activeGenerationRef.current = null;
      }
      clearAvatarIntentSchedule();
      setAvatarIntentOverride(null);
      setSttPartialText("");
      setAwaitingSpeechCommitState(false);
      sttPredictionPreviewRef.current = null;
      setSttPredictionPreview(null);
      interruptionTypeRef.current = null;
      setInterruptionType(null);
      commitTurnState("confirmed_end", "confirmed_end", {
        preview: null,
        interruptionType: null,
        generationId: interruptedGeneration,
        kind: "system",
      });
      appendLiveMessage({
        id: uid(),
        role: "user",
        text: trimmed,
        createdAt: new Date().toISOString(),
      });
      pushAvatarDevtoolsLog("system", "chat send", {
        interruptedGeneration,
        contentLength: trimmed.length,
      });
      ws.sendText(trimmed);
      waitingRef.current = true;
      setWaiting(true);
      setTyping(true);
      resetStreaming();
    },
    [
      appendLiveMessage,
      blockGeneration,
      clearAvatarIntentSchedule,
      clearPendingChatEnd,
      clearQueue,
      commitTurnState,
      resetStreaming,
      setAwaitingSpeechCommitState,
      unlockPlayback,
    ],
  );

  const loadMoreHistory = useCallback(() => {
    if (historyLoadingMoreRef.current) return;
    if (historySourceRef.current === "server") {
      if (!historyHasMore || !historyCursorRef.current) return;
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      historyLoadingMoreRef.current = true;
      setHistoryLoadingMore(true);
      ws.send(JSON.stringify({ type: "history_more", cursor: historyCursorRef.current }));
      return;
    }

    const persisted = persistedMessagesRef.current;
    if (persisted.length <= historyMessages.length) {
      setHistoryHasMore(false);
      return;
    }
    historyLoadingMoreRef.current = true;
    setHistoryLoadingMore(true);
    const nextCount = Math.min(persisted.length, historyMessages.length + INITIAL_HISTORY_DISPLAY_LIMIT);
    const nextHistory = persisted.slice(-nextCount);
    setHistoryMessages(nextHistory);
    setHistoryHasMore(persisted.length > nextCount);
    setHistoryLoadingMore(false);
    historyLoadingMoreRef.current = false;
    markHistoryMutation("prepend");
  }, [historyHasMore, historyMessages.length, markHistoryMutation]);

  const applyDevPreset = useCallback(
    (options: {
      personaPreset?: string;
      relationshipPreset?: string;
    }) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      pendingDevCommandRef.current = { kind: "apply" };
      setDevStatus({
        tone: "pending",
        message: "正在应用当前人格 / 关系预设…",
      });
      ws.send(
        JSON.stringify({
          type: "dev_apply_preset",
          personaPreset: options.personaPreset,
          relationshipPreset: options.relationshipPreset,
        }),
      );
    },
    [],
  );

  const resetDevState = useCallback(
    (scope: "session" | "relationship" | "all" = "session") => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      pendingDevCommandRef.current = { kind: "reset", scope };
      setDevStatus({
        tone: "pending",
        message: `正在执行${describeResetScope(scope)}…`,
      });
      ws.send(JSON.stringify({ type: "dev_reset_state", scope }));
    },
    [describeResetScope],
  );

  const applyDevVolcVoiceType = useCallback((voiceType?: string | null) => {
    const ws = wsRef.current;
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
  }, []);

  const requestPersonaPreset = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "get_persona_preset" }));
  }, []);

  const updatePersonaPreset = useCallback((presetId: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "set_persona_preset", presetId }));
  }, []);

  return {
    emotion,
    turnState,
    sttPredictionPreview,
    interruptionType,
    avatarFrame,
    avatarIntent,
    connected,
    connectionPhase,
    reconnectInSec,
    connLabel,
    messages,
    historyHasMore,
    historyLoadingMore,
    historyMutation,
    historyMutationNonce,
    streamingText,
    sttPartialText,
    typing,
    thinkingHint,
    waiting,
    runtimeState,
    sdkRuntimeState,
    sdkAvatarRuntimeModel,
    avatarRenderModel,
    avatarAction,
    inputPlaceholder,
    recording,
    duplex,
    personaPreset,
    userSpeaking,
    awaitingSpeechCommit,
    listeningHint,
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
    toggleMic,
    /** 显式结束语音会话（与再点麦克风等效） */
    stopVoice: stopVoiceSession,
    setInputPlaceholder,
  };
}
