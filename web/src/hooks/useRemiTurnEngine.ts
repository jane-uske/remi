"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  InterruptionType,
  RemiTurnState,
  RemiTurnStateReason,
} from "@/types/avatar";
import { parseGenerationId } from "@/hooks/useRemiChatProtocol";
import {
  mergeAvatarRuntimeSnapshot,
  pushAvatarDevtoolsLog,
} from "@/lib/rem3d/devtoolsStore";
import { shouldFinalizeDeferredChatEnd } from "@/hooks/useRemiChatTurnState";

export type UseRemiTurnEngineReturn = {
  turnState: RemiTurnState;
  sttPredictionPreview: string | null;
  interruptionType: InterruptionType | null;
  turnStateRef: React.MutableRefObject<RemiTurnState>;
  turnStateMetaRef: React.MutableRefObject<{
    state: RemiTurnState;
    reason: RemiTurnStateReason;
    sinceAtMs: number;
    generationId: number | null;
    preview: string | null;
    interruptionType: InterruptionType | null;
  }>;
  sttPredictionPreviewRef: React.MutableRefObject<string | null>;
  interruptionTypeRef: React.MutableRefObject<InterruptionType | null>;
  activeGenerationRef: React.MutableRefObject<number | null>;
  blockedGenerationsRef: React.MutableRefObject<Set<number>>;
  playedGenerationIdsRef: React.MutableRefObject<Set<number>>;
  loggedVoiceGenerationsRef: React.MutableRefObject<Set<number>>;
  pendingChatEndRef: React.MutableRefObject<{
    generationId: number | null;
    awaitingPlaybackDrain: boolean;
    awaitingTtsEnd: boolean;
  } | null>;
  pendingChatEndTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  setSttPredictionPreview: React.Dispatch<React.SetStateAction<string | null>>;
  setInterruptionType: React.Dispatch<React.SetStateAction<InterruptionType | null>>;
  commitTurnState: (
    nextState: RemiTurnState,
    reason: RemiTurnStateReason,
    extras?: {
      preview?: string | null;
      interruptionType?: InterruptionType | null;
      generationId?: number | null;
      kind?: "ws" | "system";
    },
  ) => void;
  clearPendingChatEnd: (generationId?: number | null) => void;
  clearGenerationState: () => void;
  finalizePendingChatEnd: (generationId?: number | null) => void;
  blockGeneration: (id: number) => void;
  rememberPlayedGeneration: (id: number | null) => void;
  rememberLoggedVoiceGeneration: (id: number | null) => boolean;
  allowServerGeneration: (
    type: string,
    rawGenerationId: unknown,
    clearQueue: () => void,
    resetStreaming: () => void,
  ) => boolean;
};

export function useRemiTurnEngine(voiceActive: boolean): UseRemiTurnEngineReturn {
  const [turnState, setTurnState] = useState<RemiTurnState>("confirmed_end");
  const [sttPredictionPreview, setSttPredictionPreview] = useState<string | null>(null);
  const [interruptionType, setInterruptionType] = useState<InterruptionType | null>(null);

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
  const activeGenerationRef = useRef<number | null>(null);
  const blockedGenerationsRef = useRef<Set<number>>(new Set());
  const playedGenerationIdsRef = useRef<Set<number>>(new Set());
  const loggedVoiceGenerationsRef = useRef<Set<number>>(new Set());
  const pendingChatEndRef = useRef<{
    generationId: number | null;
    awaitingPlaybackDrain: boolean;
    awaitingTtsEnd: boolean;
  } | null>(null);
  const pendingChatEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      const nextSinceAtMs = prevMeta.state === nextState ? prevMeta.sinceAtMs : now;

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

  const rememberPlayedGeneration = useCallback((id: number | null) => {
    if (id == null) return;
    const seen = playedGenerationIdsRef.current;
    seen.add(id);
    if (seen.size > 48) {
      const oldest = seen.values().next();
      if (!oldest.done) seen.delete(oldest.value);
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

  const allowServerGeneration = useCallback(
    (
      type: string,
      rawGenerationId: unknown,
      clearQueue: () => void,
      resetStreaming: () => void,
    ): boolean => {
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
    [],
  );

  // voiceActive drain effect
  useEffect(() => {
    if (
      !shouldFinalizeDeferredChatEnd({
        awaitingPlaybackDrain: pendingChatEndRef.current?.awaitingPlaybackDrain ?? false,
        awaitingTtsEnd: pendingChatEndRef.current?.awaitingTtsEnd ?? false,
        voiceActive,
      })
    ) {
      return;
    }
    finalizePendingChatEnd();
  }, [finalizePendingChatEnd, voiceActive]);

  return {
    turnState,
    sttPredictionPreview,
    interruptionType,
    turnStateRef,
    turnStateMetaRef,
    sttPredictionPreviewRef,
    interruptionTypeRef,
    activeGenerationRef,
    blockedGenerationsRef,
    playedGenerationIdsRef,
    loggedVoiceGenerationsRef,
    pendingChatEndRef,
    pendingChatEndTimerRef,
    setSttPredictionPreview,
    setInterruptionType,
    commitTurnState,
    clearPendingChatEnd,
    clearGenerationState,
    finalizePendingChatEnd,
    blockGeneration,
    rememberPlayedGeneration,
    rememberLoggedVoiceGeneration,
    allowServerGeneration,
  };
}
