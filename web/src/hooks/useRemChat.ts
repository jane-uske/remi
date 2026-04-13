"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getRemWsUrl } from "@/lib/wsUrl";
import type { ChatMessage } from "@/types/chat";
import type {
  AvatarActionCommand,
  AvatarFrameState,
  AvatarIntentBeat,
  AvatarIntent,
  InterruptionType,
  RemiTurnState,
  RemiTurnStateReason,
} from "@/types/avatar";
import { useAudioBase64Queue } from "@/hooks/useAudioBase64Queue";
import {
  shouldAwaitPlaybackDrain,
  shouldFinalizeDeferredChatEnd,
} from "./useRemChatTurnState";
import { startPcmCapture, type PcmCapture } from "@/lib/pcmCapture";
import { deriveAvatarIntent } from "@/lib/rem3d/avatarIntent";
import {
  mergeAvatarRuntimeSnapshot,
  pushAvatarDevtoolsLog,
} from "@/lib/rem3d/devtoolsStore";

function uid() {
  return crypto.randomUUID();
}

const AUDIO_FRAME_HEADER_BYTES = 16;

function encodePcmAudioFrame(pcm16: ArrayBuffer, sampleRate: number): ArrayBuffer {
  const payload = new Uint8Array(pcm16);
  const frame = new ArrayBuffer(AUDIO_FRAME_HEADER_BYTES + payload.byteLength);
  const out = new Uint8Array(frame);
  const view = new DataView(frame);

  // Magic: "RAUD" (Rem audio), version 1, codec 1=pcm16le mono
  out[0] = 0x52;
  out[1] = 0x41;
  out[2] = 0x55;
  out[3] = 0x44;
  out[4] = 1;
  out[5] = 1;
  out[6] = 0;
  out[7] = 0;
  view.setUint32(8, sampleRate, true);
  view.setUint32(12, payload.byteLength, true);
  out.set(payload, AUDIO_FRAME_HEADER_BYTES);
  return frame;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function measurePcmFrame(buf: ArrayBuffer): { rms: number; peak: number } {
  const view = new DataView(buf);
  const sampleCount = Math.floor(buf.byteLength / 2);
  if (sampleCount <= 0) return { rms: 0, peak: 0 };
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < sampleCount; i++) {
    const sample = view.getInt16(i * 2, true) / 32768;
    const abs = Math.abs(sample);
    if (abs > peak) peak = abs;
    sum += sample * sample;
  }
  return {
    rms: Math.sqrt(sum / sampleCount),
    peak,
  };
}

/** WebSocket 断线后自动重连的延迟（与 UI 倒计时同源） */
export const REM_WS_RECONNECT_DELAY_MS = 3000;

/** 长时间停留在 CONNECTING 则判定失败（避免 UI 永远「正在连接」） */
const WS_CONNECT_TIMEOUT_MS = 12_000;

export type RemiConnectionPhase = "connecting" | "open" | "closed";

const MESSAGE_STORAGE_KEY = "rem-chat-messages-v1";
const MESSAGE_STORAGE_MAX = 50;
const USER_SPEAKING_END_DEBOUNCE_MS = 260;
const STT_FALLBACK_PREFIX = "录音中";
const STT_USER_MERGE_WINDOW_MS = 2200;
const MIC_TX_LOG_INTERVAL_MS = 900;
const CHAT_END_PLAYBACK_GRACE_MS = 220;

function isListeningFallbackText(text: string): boolean {
  return text.startsWith(STT_FALLBACK_PREFIX);
}

function normalizeTranscriptForMerge(text: string): string {
  return text.replace(/\s+/g, "").replace(/[，。！？,.!?、；;:“”"'`~·\-]/g, "");
}

function mergeTranscriptTexts(prev: string, next: string): string | null {
  const a = prev.trim();
  const b = next.trim();
  if (!a || !b) return null;
  if (a === b) return a;

  const na = normalizeTranscriptForMerge(a);
  const nb = normalizeTranscriptForMerge(b);
  if (!na || !nb) return null;
  if (na === nb) return b.length >= a.length ? b : a;
  if (nb.startsWith(na)) return b;
  if (na.startsWith(nb)) return a;
  return null;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const json = atob(padded);
    const payload = JSON.parse(json) as unknown;
    if (!payload || typeof payload !== "object") return null;
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

function resolveMessageStorageKey(): string {
  if (typeof window === "undefined") return MESSAGE_STORAGE_KEY;
  const token = new URLSearchParams(window.location.search).get("token");
  if (!token) return MESSAGE_STORAGE_KEY;
  const payload = decodeJwtPayload(token);
  const userId = typeof payload?.id === "string" ? payload.id.trim() : "";
  if (!userId) return MESSAGE_STORAGE_KEY;
  return `${MESSAGE_STORAGE_KEY}:${userId}`;
}

function loadPersistedMessages(storageKey: string): ChatMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (m): m is ChatMessage =>
          m != null &&
          typeof m === "object" &&
          typeof (m as ChatMessage).id === "string" &&
          typeof (m as ChatMessage).text === "string" &&
          typeof (m as ChatMessage).role === "string",
      )
      .slice(-MESSAGE_STORAGE_MAX);
  } catch {
    return [];
  }
}

export function useRemiChat() {
  const [emotion, setEmotion] = useState("neutral");
  const [connected, setConnected] = useState(false);
  const [connectionPhase, setConnectionPhase] =
    useState<RemiConnectionPhase>("connecting");
  const [reconnectDeadline, setReconnectDeadline] = useState<number | null>(null);
  /** 仅用于在重连倒计时期间驱动按秒刷新（deadline 派生秒数） */
  const [, bumpReconnectTick] = useState(0);
  const [connLabel, setConnLabel] = useState("连接中…");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesHydrated, setMessagesHydrated] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [sttPartialText, setSttPartialText] = useState("");
  const [typing, setTyping] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [turnState, setTurnState] = useState<RemiTurnState>("confirmed_end");
  const [sttPredictionPreview, setSttPredictionPreview] = useState<string | null>(null);
  const [interruptionType, setInterruptionType] = useState<InterruptionType | null>(null);
  /** 首 token 前：转成更弱的状态提示，不再直接显示“Rem 在想…” */
  const thinkingHint = waiting && streamingText.length === 0;
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
  const messageStorageKey = useMemo(() => resolveMessageStorageKey(), []);

  const wsRef = useRef<WebSocket | null>(null);
  const waitingRef = useRef(false);
  const duplexRef = useRef(false);
  const pcmRef = useRef<PcmCapture | null>(null);
  const recordingRef = useRef(false);
  const resumeDuplexAfterReconnectRef = useRef(false);
  const userSpeakingEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const lastMicFaultAtRef = useRef(0);
  const startingDuplexRef = useRef(false);
  /** 连接超时主动 close 时，onclose 不再刷「已断开」系统提示（避免与超时错误重复） */
  const suppressDisconnectSysMsgRef = useRef(false);
  const avatarBeatTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

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

  const clearAvatarIntentSchedule = useCallback(() => {
    for (const timer of avatarBeatTimersRef.current) clearTimeout(timer);
    avatarBeatTimersRef.current = [];
  }, []);

  const handleMicCaptureFault = useCallback(
    (detail: { reason: string; state?: string; message?: string }) => {
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
          ws.send(JSON.stringify({ type: "duplex_stop" }));
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
      setUserSpeaking(false);
      setInputPlaceholder("说点什么…");
      setMessages((m) => [
        ...m,
        { id: uid(), role: "error", text: "音频设备异常，请重新开启麦克风" },
      ]);
    },
    [clearGenerationState, clearUserSpeakingEndTimer],
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
    setMessages((prev) => {
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
      return [...prev, { id: uid(), role: "user", text: trimmed }];
    });
    lastUserTranscriptAtRef.current = now;
  }, []);

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

  const parseGenerationId = useCallback((raw: unknown): number | null => {
    if (raw == null) return null;
    if (typeof raw === "number" && Number.isFinite(raw)) return Math.floor(raw);
    if (typeof raw === "string") {
      const n = Number(raw);
      if (Number.isFinite(n)) return Math.floor(n);
    }
    return null;
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
    const payload: Record<string, unknown> = { type: "playback_start" };
    if (typeof generationId === "number") {
      payload.generationId = generationId;
    }
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
  } =
    useAudioBase64Queue({
      onPlaybackStart: handlePlaybackStart,
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

  const lastIntentKeyRef = useRef("");

  useEffect(() => {
    const key = JSON.stringify(avatarIntent);
    if (key === lastIntentKeyRef.current) return;
    lastIntentKeyRef.current = key;
    pushAvatarDevtoolsLog("intent", "avatar intent updated", avatarIntent);
  }, [avatarIntent]);

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
      const capture = await startPcmCapture(
        stream,
        (pcm16) => {
          const metrics = measurePcmFrame(pcm16);
          micTxFramesRef.current += 1;
          micTxBytesRef.current += pcm16.byteLength;
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
            });
          }
          if (ws.readyState === WebSocket.OPEN) {
            const frame = encodePcmAudioFrame(pcm16, pcmSampleRate);
            try {
              ws.send(frame);
            } catch {
              // Compatibility fallback for servers that only parse JSON audio_stream.
              ws.send(
                JSON.stringify({
                  type: "audio_stream",
                  audio: arrayBufferToBase64(pcm16),
                  sampleRate: pcmSampleRate,
                }),
              );
            }
          }
        },
        {
          onStateChange: (state) => {
            pushAvatarDevtoolsLog("system", "mic context state", { state });
          },
          onError: (detail) => {
            handleMicCaptureFault(detail);
          },
        },
      );
      pcmSampleRate = capture.sampleRate;

      pcmRef.current = capture;
      ws.send(JSON.stringify({ type: "duplex_start", sampleRate: capture.sampleRate }));
      pushAvatarDevtoolsLog("system", "duplex capture start", {
        sampleRate: capture.sampleRate,
      });

      duplexRef.current = true;
      setDuplex(true);
      setRecording(true);
      recordingRef.current = true;
      setInputPlaceholder("全双工语音 — 随时说话…");
    } catch {
      stream?.getTracks().forEach((track) => track.stop());
      resumeDuplexAfterReconnectRef.current = false;
      duplexRef.current = false;
      setDuplex(false);
      setRecording(false);
      recordingRef.current = false;
      setInputPlaceholder("说点什么…");
      setMessages((m) => [
        ...m,
        { id: uid(), role: "error", text: "无法访问麦克风" },
      ]);
    } finally {
      startingDuplexRef.current = false;
    }
  }, [clearPendingChatEnd, clearQueue, handleMicCaptureFault, unlockPlayback]);

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
    resumeDuplexAfterReconnectRef.current = options?.preserveAutoResume ?? false;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "duplex_stop" }));
    }
    setSttPartialText("");
    clearGenerationState();
    duplexRef.current = false;
    setDuplex(false);
    setRecording(false);
    recordingRef.current = false;
    clearUserSpeakingEndTimer();
    setUserSpeaking(false);
    setInputPlaceholder("说点什么…");
  }, [clearGenerationState, clearUserSpeakingEndTimer]);

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
    if (reconnectRef.current) {
      clearTimeout(reconnectRef.current);
      reconnectRef.current = null;
    }
    setReconnectDeadline(null);
    setConnectionPhase("connecting");
    setConnLabel("连接中…");
    const url = getRemWsUrl();
    if (!url) {
      setConnectionPhase("closed");
      setConnLabel("无法解析 WS 地址");
      pushAvatarDevtoolsLog("system", "ws unavailable", {
        reason: "empty-url",
      });
      setMessages((m) => [
        ...m,
        {
          id: uid(),
          role: "error",
          text: "WebSocket 地址为空（仅应在浏览器环境连接）",
        },
      ]);
      return;
    }

    const ws = new WebSocket(url);
    pushAvatarDevtoolsLog("system", "ws connecting", { url });
    clearGenerationState();
    wsRef.current = ws;

    const connectTimer = window.setTimeout(() => {
      if (ws.readyState === WebSocket.CONNECTING) {
        suppressDisconnectSysMsgRef.current = true;
        setConnLabel("连接超时");
        setMessages((m) => [
          ...m,
          {
            id: uid(),
            role: "error",
            text:
              "连接服务器超时。请确认已在仓库根目录运行「npm run dev」（默认端口 3000），或设置 NEXT_PUBLIC_WS_URL=ws://你的后端:端口/ws",
          },
        ]);
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
      if (!hasAnnouncedConnectedRef.current) {
        hasAnnouncedConnectedRef.current = true;
        setMessages((m) => [
          ...m,
          { id: uid(), role: "sys", text: "已连接，和 Rem 聊聊吧" },
        ]);
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
          const nextState = data.state as RemiTurnState | undefined;
          const reason = data.reason as RemiTurnStateReason | undefined;
          const preview =
            typeof data.preview === "string" && data.preview.trim()
              ? data.preview.trim()
              : null;
          const nextInterruptionType =
            data.interruptionType === "continuation" ||
            data.interruptionType === "correction" ||
            data.interruptionType === "topic_switch" ||
            data.interruptionType === "emotional_interrupt" ||
            data.interruptionType === "unknown"
              ? (data.interruptionType as InterruptionType)
              : null;
          if (nextState && reason) {
            commitTurnState(nextState, reason, {
              preview,
              interruptionType: nextInterruptionType,
              generationId: parseGenerationId(data.generationId),
              kind: "ws",
            });
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

        case "chat_chunk":
          if (!allowServerGeneration("chat_chunk", data.generationId)) break;
          if (!streamingBufRef.current) {
            commitTurnState("assistant_entering", "tts_prepare", {
              generationId: parseGenerationId(data.generationId),
              kind: "ws",
            });
          }
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
            setMessages((m) => [...m, { id: uid(), role: "rem", text }]);
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
          setSttPartialText((prev) => (isListeningFallbackText(prev) ? "" : prev));
          setUserSpeaking(true);
          setInputPlaceholder("正在听…");
          commitTurnState("listening_active", "speech_start", {
            kind: "ws",
          });
          break;

        case "vad_end":
          clearUserSpeakingEndTimer();
          userSpeakingEndTimerRef.current = setTimeout(() => {
            userSpeakingEndTimerRef.current = null;
            setUserSpeaking(false);
            if (recordingRef.current) {
              setInputPlaceholder("全双工语音 — 随时说话…");
            }
          }, USER_SPEAKING_END_DEBOUNCE_MS);
          commitTurnState("listening_hold", "semantic_hold", {
            kind: "ws",
          });
          break;

        case "stt_partial": {
          const partial = String(data.content ?? "").trim();
          if (!partial) break;
          setSttPartialText((prev) => {
            if (isListeningFallbackText(partial)) {
              return isListeningFallbackText(prev) ? "" : prev;
            }
              return partial;
            });
          break;
        }

        case "stt_final": {
          const content = String(data.content ?? "");
          activeGenerationRef.current = null;
          clearUserSpeakingEndTimer();
          setUserSpeaking(false);
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
          clearPendingChatEnd();
          clearUserSpeakingEndTimer();
          setUserSpeaking(false);
          setTyping(false);
          setSttPartialText("");
          resetStreaming();
          waitingRef.current = false;
          setWaiting(false);
          setInputPlaceholder("说点什么…");
          setMessages((m) => [
            ...m,
            { id: uid(), role: "error", text: String(data.content ?? "错误") },
          ]);
          break;
        }

        case "dev_preset_applied":
        case "dev_state_reset": {
          clearPendingChatEnd();
          clearUserSpeakingEndTimer();
          setUserSpeaking(false);
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
          setMessages([]);
          try {
            localStorage.removeItem(messageStorageKey);
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
      const shouldResumeDuplex = recordingRef.current || duplexRef.current;
      stopVoiceSession({ preserveAutoResume: shouldResumeDuplex });

      setConnected(false);
      setConnectionPhase("closed");
      setReconnectDeadline(Date.now() + REM_WS_RECONNECT_DELAY_MS);
      setConnLabel("已断开");
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
        setMessages((m) => {
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
  };

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
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const persisted = loadPersistedMessages(messageStorageKey);
    setMessages((current) => (current.length === 0 ? persisted : [...persisted, ...current]));
    setMessagesHydrated(true);
  }, [messageStorageKey]);

  useEffect(() => {
    if (!messagesHydrated || typeof window === "undefined") return;
    const persist = messages
      .filter((m) => m.role === "user" || m.role === "rem")
      .slice(-MESSAGE_STORAGE_MAX);
    try {
      localStorage.setItem(messageStorageKey, JSON.stringify(persist));
    } catch {
      /* quota or private mode */
    }
  }, [messages, messagesHydrated, messageStorageKey]);

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
      setMessages((m) => [...m, { id: uid(), role: "user", text: trimmed }]);
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
    [blockGeneration, clearAvatarIntentSchedule, clearPendingChatEnd, clearQueue, commitTurnState, resetStreaming, unlockPlayback],
  );

  const applyDevPreset = useCallback(
    (options: {
      personaPreset?: string;
      relationshipPreset?: string;
      resetScope?: "session" | "relationship" | "all";
    }) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(
        JSON.stringify({
          type: "dev_apply_preset",
          personaPreset: options.personaPreset,
          relationshipPreset: options.relationshipPreset,
          resetScope: options.resetScope ?? "session",
        }),
      );
    },
    [],
  );

  const resetDevState = useCallback(
    (scope: "session" | "relationship" | "all" = "session") => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: "dev_reset_state", scope }));
    },
    [],
  );

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
    streamingText,
    sttPartialText,
    typing,
    thinkingHint,
    waiting,
    avatarAction,
    inputPlaceholder,
    recording,
    duplex,
    userSpeaking,
    listeningHint: recording && userSpeaking && !sttPartialText,
    voiceActive,
    /** TTS 音量包络 0–1，供 3D 口型同步 */
    lipEnvelopeRef,
    /** 统一口型信号，后续可接 viseme。 */
    lipSignalRef,
    hasMic,
    sendText,
    applyDevPreset,
    resetDevState,
    toggleMic,
    /** 显式结束语音会话（与再点麦克风等效） */
    stopVoice: stopVoiceSession,
    setInputPlaceholder,
  };
}
