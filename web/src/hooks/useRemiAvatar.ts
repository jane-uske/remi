"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AvatarActionCommand,
  AvatarFrameState,
  AvatarIntentBeat,
  AvatarIntent,
  InterruptionType,
  LipSignal,
  RemiTurnState,
  RemiTurnStateReason,
} from "@/types/avatar";
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
import type { RemiConnectionPhase } from "@/hooks/useRemiChat";

export type UseRemiAvatarParams = {
  connectionPhase: RemiConnectionPhase;
  turnState: RemiTurnState;
  turnStateMetaRef: React.MutableRefObject<{
    state: RemiTurnState;
    reason: RemiTurnStateReason;
    sinceAtMs: number;
    generationId: number | null;
    preview: string | null;
    interruptionType: InterruptionType | null;
  }>;
  sttPredictionPreview: string | null;
  interruptionType: InterruptionType | null;
  recording: boolean;
  duplex: boolean;
  userSpeaking: boolean;
  awaitingSpeechCommit: boolean;
  waiting: boolean;
  typing: boolean;
  streamingText: string;
  voiceActive: boolean;
  sttPartialText: string;
  lipSignalRef: React.MutableRefObject<LipSignal>;
};

export type UseRemiAvatarReturn = {
  emotion: string;
  avatarFrame: AvatarFrameState | null;
  avatarAction: { action: AvatarActionCommand; nonce: number } | null;
  avatarIntentOverride: AvatarIntent | null;
  runtimeClock: number;
  avatarBeatTimersRef: React.MutableRefObject<ReturnType<typeof setTimeout>[]>;
  runtimeStateRef: React.MutableRefObject<CanonicalAvatarState | null>;
  runtimeLogKeyRef: React.MutableRefObject<string>;
  lastIntentKeyRef: React.MutableRefObject<string>;
  derivedAvatarIntent: AvatarIntent;
  runtimeState: ReturnType<typeof adaptRemiRuntimeState>;
  avatarRenderModel: ReturnType<typeof buildAvatarRenderModel>;
  listeningHint: ReturnType<typeof selectListeningHint>;
  thinkingHint: ReturnType<typeof selectThinkingHint>;
  setEmotion: React.Dispatch<React.SetStateAction<string>>;
  setAvatarFrame: React.Dispatch<React.SetStateAction<AvatarFrameState | null>>;
  setAvatarAction: React.Dispatch<
    React.SetStateAction<{ action: AvatarActionCommand; nonce: number } | null>
  >;
  setAvatarIntentOverride: React.Dispatch<React.SetStateAction<AvatarIntent | null>>;
  triggerIntentGestureAction: (intent: AvatarIntent | null) => void;
  mergeIntentBeat: (base: AvatarIntent, beat: AvatarIntentBeat) => AvatarIntent;
  clearAvatarIntentSchedule: () => void;
};

export function useRemiAvatar(params: UseRemiAvatarParams): UseRemiAvatarReturn {
  const [emotion, setEmotion] = useState("neutral");
  const [avatarFrame, setAvatarFrame] = useState<AvatarFrameState | null>(null);
  const [avatarAction, setAvatarAction] = useState<{
    action: AvatarActionCommand;
    nonce: number;
  } | null>(null);
  const [avatarIntentOverride, setAvatarIntentOverride] = useState<AvatarIntent | null>(null);
  const [runtimeClock, setRuntimeClock] = useState(0);

  const avatarBeatTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const runtimeStateRef = useRef<CanonicalAvatarState | null>(null);
  const runtimeLogKeyRef = useRef("");
  const lastIntentKeyRef = useRef("");

  const clearAvatarIntentSchedule = useCallback(() => {
    for (const timer of avatarBeatTimersRef.current) clearTimeout(timer);
    avatarBeatTimersRef.current = [];
  }, []);

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

  const derivedAvatarIntent = useMemo<AvatarIntent>(
    () =>
      deriveAvatarIntent({
        emotion,
        action: avatarAction?.action ?? null,
        face: avatarFrame?.face ?? null,
        turnState: params.turnState,
        source: "server",
        reason: avatarAction?.action.action ?? params.turnState,
      }),
    [avatarAction, avatarFrame, emotion, params.turnState],
  );

  const avatarIntent = avatarIntentOverride ?? derivedAvatarIntent;
  const runtimeNowMs = Date.now() + runtimeClock * 0;

  const runtimeState = useMemo(
    () =>
      adaptRemiRuntimeState(
        {
          nowMs: runtimeNowMs,
          connection: params.connectionPhase,
          turnState: params.turnState,
          turnReason: params.turnStateMetaRef.current.reason,
          turnPreviewText: params.sttPredictionPreview,
          turnInterruptionType: params.interruptionType,
          turnSinceAtMs: params.turnStateMetaRef.current.sinceAtMs,
          recording: params.recording,
          duplexEnabled: params.duplex,
          userSpeaking: params.userSpeaking,
          awaitingCommit: params.awaitingSpeechCommit,
          waiting: params.waiting,
          typing: params.typing,
          streamingText: params.streamingText,
          voiceActive: params.voiceActive,
          emotion,
          avatarIntent,
          avatarFrame,
          lipSignal: params.lipSignalRef.current,
        },
        runtimeStateRef.current,
      ),
    [
      avatarFrame,
      avatarIntent,
      params.awaitingSpeechCommit,
      params.connectionPhase,
      params.duplex,
      emotion,
      params.recording,
      runtimeNowMs,
      params.streamingText,
      params.sttPredictionPreview,
      params.interruptionType,
      params.turnState,
      params.typing,
      params.userSpeaking,
      params.voiceActive,
      params.waiting,
      params.lipSignalRef,
    ],
  );

  const avatarRenderModel = useMemo(
    () => buildAvatarRenderModel(runtimeState),
    [runtimeState],
  );

  const listeningHint = useMemo(
    () => selectListeningHint(runtimeState, params.sttPartialText),
    [runtimeState, params.sttPartialText],
  );

  const thinkingHint = useMemo(
    () => selectThinkingHint(runtimeState),
    [runtimeState],
  );

  // avatar intent devtools log
  useEffect(() => {
    const key = JSON.stringify(avatarIntent);
    if (key === lastIntentKeyRef.current) return;
    lastIntentKeyRef.current = key;
    pushAvatarDevtoolsLog("intent", "avatar intent updated", avatarIntent);
  }, [avatarIntent]);

  // runtimeState sync to ref
  useEffect(() => {
    runtimeStateRef.current = runtimeState;
  }, [runtimeState]);

  // Action expiry timer
  useEffect(() => {
    if (!avatarAction) return;
    const timer = setTimeout(() => {
      setAvatarAction((current) => (current?.nonce === avatarAction.nonce ? null : current));
    }, Math.max(200, avatarAction.action.duration + 80));
    return () => clearTimeout(timer);
  }, [avatarAction]);

  // runtimeClock timer for tail/reacting windows
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

  // publishAvatarRuntimeSnapshot
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

  // devtools runtime state log
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

  // lip interval
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
      const envelope = Math.max(0, Math.min(1, params.lipSignalRef.current.envelope ?? 0));
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
    params.lipSignalRef,
    runtimeState.assistant.playbackActive,
    runtimeState.assistant.playbackTailActive,
    runtimeState.user.recording,
  ]);

  return {
    emotion,
    avatarFrame,
    avatarAction,
    avatarIntentOverride,
    runtimeClock,
    avatarBeatTimersRef,
    runtimeStateRef,
    runtimeLogKeyRef,
    lastIntentKeyRef,
    derivedAvatarIntent,
    runtimeState,
    avatarRenderModel,
    listeningHint,
    thinkingHint,
    setEmotion,
    setAvatarFrame,
    setAvatarAction,
    setAvatarIntentOverride,
    triggerIntentGestureAction,
    mergeIntentBeat,
    clearAvatarIntentSchedule,
  };
}
