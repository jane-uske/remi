"use client";

import { useCallback, useRef, useState } from "react";
import type { ChatMessage } from "@/types/chat";
import type { RemiTurnState } from "@/types/avatar";
import {
  arrayBufferToBase64,
  encodePcmAudioFrame,
  measurePcmFrame,
  uid,
} from "@/hooks/useRemiChatHelpers";
import { pushAvatarDevtoolsLog } from "@/lib/rem3d/devtoolsStore";
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

const USER_SPEAKING_END_DEBOUNCE_MS = 260;
const DUPLEX_AWAITING_COMMIT_TIMEOUT_MS = 5000;
const MIC_TX_LOG_INTERVAL_MS = 900;
const CLIENT_MIC_PRE_GATE_ENABLED =
  process.env.NEXT_PUBLIC_REMI_CLIENT_MIC_PRE_GATE === "1";

export type UseRemiVoiceParams = {
  wsRef: React.MutableRefObject<WebSocket | null>;
  turnStateRef: React.MutableRefObject<RemiTurnState>;
  clearGenerationState: () => void;
  clearPendingChatEnd: () => void;
  clearQueue: () => void;
  unlockPlayback: () => Promise<void>;
  appendLiveMessage: (msg: ChatMessage) => void;
  setSttPartialText: React.Dispatch<React.SetStateAction<string>>;
};

export type UseRemiVoiceReturn = {
  recording: boolean;
  duplex: boolean;
  userSpeaking: boolean;
  awaitingSpeechCommit: boolean;
  inputPlaceholder: string;
  // refs
  pcmRef: React.MutableRefObject<PcmCapture | null>;
  recordingRef: React.MutableRefObject<boolean>;
  duplexRef: React.MutableRefObject<boolean>;
  userSpeakingRef: React.MutableRefObject<boolean>;
  awaitingSpeechCommitRef: React.MutableRefObject<boolean>;
  resumeDuplexAfterReconnectRef: React.MutableRefObject<boolean>;
  startingDuplexRef: React.MutableRefObject<boolean>;
  userSpeakingEndTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  awaitingSpeechCommitTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  // callbacks
  startDuplex: () => Promise<void>;
  stopVoiceSession: (options?: { preserveAutoResume?: boolean }) => void;
  toggleMic: () => void;
  handleMicCaptureFault: (detail: PcmCaptureErrorDetail) => void;
  setAwaitingSpeechCommitState: (next: boolean) => void;
  clearUserSpeakingEndTimer: () => void;
  clearAwaitingSpeechCommitTimer: () => void;
  syncInputPlaceholder: (
    overrides?: Partial<{
      recording: boolean;
      userSpeaking: boolean;
      awaitingSpeechCommit: boolean;
    }>,
  ) => void;
  setInputPlaceholder: React.Dispatch<React.SetStateAction<string>>;
  setUserSpeaking: React.Dispatch<React.SetStateAction<boolean>>;
};

export function useRemiVoice(params: UseRemiVoiceParams): UseRemiVoiceReturn {
  const [recording, setRecording] = useState(false);
  const [duplex, setDuplex] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [awaitingSpeechCommit, setAwaitingSpeechCommit] = useState(false);
  const [inputPlaceholder, setInputPlaceholder] = useState("说点什么…");

  const pcmRef = useRef<PcmCapture | null>(null);
  const recordingRef = useRef(false);
  const duplexRef = useRef(false);
  const userSpeakingRef = useRef(false);
  const awaitingSpeechCommitRef = useRef(false);
  const resumeDuplexAfterReconnectRef = useRef(false);
  const startingDuplexRef = useRef(false);
  const userSpeakingEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const awaitingSpeechCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastMicFaultAtRef = useRef(0);
  const micTxStartedAtRef = useRef(0);
  const micTxFramesRef = useRef(0);
  const micTxBytesRef = useRef(0);
  const micTxLastRmsRef = useRef(0);
  const micTxLastPeakRef = useRef(0);
  const micTxMaxRmsRef = useRef(0);
  const micTxLastLogAtRef = useRef(0);
  const micTxGateRef = useRef<MicTxGate | null>(null);

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

  const handleMicCaptureFault = useCallback(
    (detail: PcmCaptureErrorDetail) => {
      const now = Date.now();
      pushAvatarDevtoolsLog("system", "mic capture fault", detail);
      if (now - lastMicFaultAtRef.current < 1500) return;
      lastMicFaultAtRef.current = now;
      startingDuplexRef.current = false;
      resumeDuplexAfterReconnectRef.current = false;
      const ws = params.wsRef.current;
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
      params.setSttPartialText("");
      params.clearGenerationState();
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
      params.appendLiveMessage({
        id: uid(),
        role: "error",
        text: getMicCaptureFaultMessage(detail),
      });
    },
    [
      params,
      clearUserSpeakingEndTimer,
      setAwaitingSpeechCommitState,
      syncInputPlaceholder,
    ],
  );

  const startDuplex = useCallback(async () => {
    const ws = params.wsRef.current;
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
    params.clearQueue();
    params.clearPendingChatEnd();
    params.setSttPartialText("");
    void params.unlockPlayback();

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
            assistantSpeaking: params.turnStateRef.current === "assistant_speaking",
          });
          if (gateResult?.opened) {
            pushAvatarDevtoolsLog("system", "mic tx gate open", {
              bufferedFrames: gateResult.framesToSend.length,
              assistantSpeaking: params.turnStateRef.current === "assistant_speaking",
              rms: Number(gateResult.analysis.rms.toFixed(4)),
              zcr: Number(gateResult.analysis.zcr.toFixed(4)),
              activeRatio: Number(gateResult.analysis.activeRatio.toFixed(4)),
            });
          } else if (gateResult?.closed) {
            pushAvatarDevtoolsLog("system", "mic tx gate close", {
              assistantSpeaking: params.turnStateRef.current === "assistant_speaking",
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
                ws.send(frame);
              } catch {
                // Compatibility fallback for servers that only parse JSON audio_stream.
                ws.send(
                  JSON.stringify({
                    type: "audio_stream",
                    audio: arrayBufferToBase64(chunk),
                    sampleRate: pcmSampleRate,
                  }),
                );
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
      ws.send(JSON.stringify({ type: "duplex_start", sampleRate: capture.sampleRate }));
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
        params.appendLiveMessage({
          id: uid(),
          role: "error",
          text: getMicAccessErrorMessage(error),
        });
      }
    } finally {
      startingDuplexRef.current = false;
    }
  }, [
    params,
    handleMicCaptureFault,
    setAwaitingSpeechCommitState,
    syncInputPlaceholder,
  ]);

  const stopVoiceSession = useCallback(
    (options?: { preserveAutoResume?: boolean }) => {
      const ws = params.wsRef.current;
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
        ws.send(JSON.stringify({ type: "duplex_stop" }));
      }
      params.setSttPartialText("");
      params.clearGenerationState();
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
    },
    [
      params,
      clearUserSpeakingEndTimer,
      setAwaitingSpeechCommitState,
      syncInputPlaceholder,
    ],
  );

  const toggleMic = useCallback(() => {
    if (recordingRef.current) {
      stopVoiceSession();
    } else {
      params.clearGenerationState();
      void startDuplex();
    }
  }, [params, startDuplex, stopVoiceSession]);

  return {
    recording,
    duplex,
    userSpeaking,
    awaitingSpeechCommit,
    inputPlaceholder,
    pcmRef,
    recordingRef,
    duplexRef,
    userSpeakingRef,
    awaitingSpeechCommitRef,
    resumeDuplexAfterReconnectRef,
    startingDuplexRef,
    userSpeakingEndTimerRef,
    awaitingSpeechCommitTimerRef,
    startDuplex,
    stopVoiceSession,
    toggleMic,
    handleMicCaptureFault,
    setAwaitingSpeechCommitState,
    clearUserSpeakingEndTimer,
    clearAwaitingSpeechCommitTimer,
    syncInputPlaceholder,
    setInputPlaceholder,
    setUserSpeaking,
  };
}
