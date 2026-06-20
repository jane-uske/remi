"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { base64ToObjectUrl } from "@/lib/audioBase64";
import type { LipSignal, TtsLipSyncPatch } from "@/types/avatar";
import {
  hasPendingPlaybackWork as computePendingPlaybackWork,
  PLAYBACK_END_DEBOUNCE_MS,
} from "@/lib/audio/playbackLifecycle";
import {
  applyTtsLipSyncPatch as mergeTtsLipSyncPatch,
  clearTtsLipSyncState,
  resolveActiveTtsLipViseme,
  type TtsLipSyncTimelineState,
} from "@/lib/audio/ttsLipSyncTimeline";

/**
 * Queue server TTS audio. Supports:
 * - legacy complete clips (`voice`: base64 encoded wav/mp3)
 * - streamed PCM chunks (`voice_pcm_chunk`: base64 encoded pcm16le mono)
 *
 * Routes playback through Web Audio + AnalyserNode so `lipEnvelopeRef` holds
 * 0–1 RMS envelope for lip-sync with the 3D avatar.
 */
export interface AudioQueueOptions {
  /** Called when a server TTS segment actually starts playing on client. */
  onPlaybackStart?: (generationId: number | null) => void;
  /** Called when playback for the current server generation fully drains or is cleared. */
  onPlaybackEnd?: (generationId: number | null) => void;
  /** True while the server may still stream TTS after `chat_end`. */
  getServerTtsStreaming?: () => boolean;
}

const PCM_BATCH_TARGET_MS = 72;

function isBrokenAudioContextState(state: string): boolean {
  return state === "closed" || state === "interrupted";
}

export function useAudioBase64Queue(options?: AudioQueueOptions) {
  const [playing, setPlaying] = useState(false);
  const [audioLocked, setAudioLocked] = useState(false);
  const decodeChainRef = useRef<Promise<void>>(Promise.resolve());
  const playingRef = useRef(false);
  const generationRef = useRef(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const nextStartTimeRef = useRef(0);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playbackNotifiedRef = useRef(false);
  const activeServerGenerationRef = useRef<number | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const analyserReadyRef = useRef(false);
  const envelopeRafRef = useRef(0);
  const fallbackAudioRef = useRef<HTMLAudioElement | null>(null);
  const fallbackSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const stopFallbackRef = useRef<(() => void) | null>(null);
  const audioGraphRetryAfterRef = useRef(0);
  const pcmFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPcmChunksRef = useRef<Float32Array[]>([]);
  const pendingPcmSamplesRef = useRef(0);
  const pendingPcmSampleRateRef = useRef(24000);
  const pendingPcmGenerationRef = useRef<number | null>(null);
  const pendingPcmServerGenerationRef = useRef<number | null>(null);
  /** Updated ~60fps while TTS plays; read by RemVrmViewer for mouth `aa` blend shape */
  const lipEnvelopeRef = useRef(0);
  const lipSignalRef = useRef<LipSignal>({
    envelope: 0,
    active: false,
    viseme: null,
  });
  const lipTimelineByGenerationRef = useRef<Map<number, TtsLipSyncTimelineState>>(new Map());
  const activeLipTimelineRef = useRef<TtsLipSyncTimelineState | null>(null);
  const activeLipGenerationRef = useRef<number | null>(null);
  const lipPlaybackStartAtMsRef = useRef(0);
  const onPlaybackStartRef = useRef(options?.onPlaybackStart);
  const onPlaybackEndRef = useRef(options?.onPlaybackEnd);
  const getServerTtsStreamingRef = useRef(options?.getServerTtsStreaming);
  const lastEnqueueAtMsRef = useRef(0);

  useEffect(() => {
    onPlaybackStartRef.current = options?.onPlaybackStart;
  }, [options?.onPlaybackStart]);

  useEffect(() => {
    onPlaybackEndRef.current = options?.onPlaybackEnd;
  }, [options?.onPlaybackEnd]);

  useEffect(() => {
    getServerTtsStreamingRef.current = options?.getServerTtsStreaming;
  }, [options?.getServerTtsStreaming]);

  const resetAudioGraph = useCallback(() => {
    const ctx = audioContextRef.current;
    audioContextRef.current = null;
    analyserRef.current = null;
    analyserReadyRef.current = false;
    nextStartTimeRef.current = 0;
    activeSourcesRef.current.clear();
    playingRef.current = false;
    playbackNotifiedRef.current = false;
    activeServerGenerationRef.current = null;
    if (ctx) {
      ctx.onstatechange = null;
      if (ctx.state !== "closed") {
        void ctx.close().catch(() => {});
      }
    }
  }, []);

  const hasPendingPlaybackWork = useCallback(() => {
    const ctx = audioContextRef.current;
    const scheduledAheadMs = ctx
      ? Math.max(0, (nextStartTimeRef.current - ctx.currentTime) * 1000)
      : 0;
    return computePendingPlaybackWork({
      playing: playingRef.current,
      activeSources: activeSourcesRef.current.size,
      pendingPcmSamples: pendingPcmSamplesRef.current,
      hasFlushTimer: pcmFlushTimerRef.current != null,
      scheduledAheadMs,
      serverTtsStreaming: getServerTtsStreamingRef.current?.() === true,
      msSinceLastEnqueue:
        lastEnqueueAtMsRef.current > 0
          ? Date.now() - lastEnqueueAtMsRef.current
          : Number.POSITIVE_INFINITY,
      debounceMs: PLAYBACK_END_DEBOUNCE_MS,
    });
  }, []);

  const sync = useCallback(() => {
    setPlaying(hasPendingPlaybackWork());
  }, [hasPendingPlaybackWork]);

  const touchEnqueueActivity = useCallback(() => {
    lastEnqueueAtMsRef.current = Date.now();
    sync();
  }, [sync]);

  const updateLipSignal = useCallback((patch: Partial<LipSignal>) => {
    Object.assign(lipSignalRef.current, patch);
    lipEnvelopeRef.current = lipSignalRef.current.envelope;
  }, []);

  const stopEnvelopeLoop = useCallback(() => {
    if (envelopeRafRef.current) {
      cancelAnimationFrame(envelopeRafRef.current);
      envelopeRafRef.current = 0;
    }
    updateLipSignal({
      envelope: 0,
      active: false,
      viseme: null,
    });
  }, [updateLipSignal]);

  const activateLipTimeline = useCallback(
    (generationId: number | null, playbackStartAtMs: number) => {
      activeLipGenerationRef.current = generationId;
      activeLipTimelineRef.current =
        generationId == null
          ? null
          : lipTimelineByGenerationRef.current.get(generationId) ?? null;
      lipPlaybackStartAtMsRef.current = playbackStartAtMs;
    },
    [],
  );

  const notifyPlaybackEnd = useCallback(() => {
    const generationId = activeServerGenerationRef.current;
    if (!playbackNotifiedRef.current && generationId == null) return;
    playbackNotifiedRef.current = false;
    activeServerGenerationRef.current = null;
    onPlaybackEndRef.current?.(generationId);
  }, []);

  const runEnvelopeLoop = useCallback(() => {
    const analyser = analyserRef.current;
    const buf = analyser ? new Float32Array(analyser.fftSize) : null;
    const tick = () => {
      if (!playingRef.current) {
        updateLipSignal({
          envelope: 0,
          active: false,
          viseme: null,
        });
        return;
      }
      let level = 0;
      if (analyserRef.current && buf) {
        analyserRef.current.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = buf[i];
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        level = Math.min(1, Math.pow(rms * 7.2, 0.82));
      }
      const elapsedMs =
        lipPlaybackStartAtMsRef.current > 0
          ? performance.now() - lipPlaybackStartAtMsRef.current
          : 0;
      const activeViseme = resolveActiveTtsLipViseme(
        activeLipTimelineRef.current,
        elapsedMs,
      );
      updateLipSignal({
        envelope: level,
        active: true,
        viseme: activeViseme,
      });
      envelopeRafRef.current = requestAnimationFrame(tick);
    };
    envelopeRafRef.current = requestAnimationFrame(tick);
  }, [updateLipSignal]);

  const ensureAudioGraph = useCallback(async (): Promise<AudioContext | null> => {
    if (typeof window === "undefined") return null;
    if (Date.now() < audioGraphRetryAfterRef.current) return null;
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;

    let ctx = audioContextRef.current;
    if (ctx && isBrokenAudioContextState(String(ctx.state))) {
      audioGraphRetryAfterRef.current = Date.now() + 1500;
      resetAudioGraph();
      ctx = null;
    }
    if (!ctx) {
      let freshCtx: AudioContext;
      try {
        freshCtx = new Ctx();
      } catch {
        audioGraphRetryAfterRef.current = Date.now() + 1500;
        return null;
      }
      freshCtx.onstatechange = () => {
        if (audioContextRef.current !== freshCtx) return;
        if (isBrokenAudioContextState(String(freshCtx.state))) {
          audioGraphRetryAfterRef.current = Date.now() + 1500;
          resetAudioGraph();
        }
      };
      audioContextRef.current = freshCtx;
      ctx = freshCtx;
    }
    if (ctx.state !== "running") {
      try {
        await ctx.resume();
      } catch {
        audioGraphRetryAfterRef.current = Date.now() + 1500;
        if (isBrokenAudioContextState(String(ctx.state))) {
          resetAudioGraph();
        }
        return null;
      }
    }
    if (ctx.state !== "running") {
      setAudioLocked(true);
      return null;
    }
    if (isBrokenAudioContextState(String(ctx.state))) {
      audioGraphRetryAfterRef.current = Date.now() + 1500;
      resetAudioGraph();
      return null;
    }
    setAudioLocked(false);

    if (!analyserReadyRef.current) {
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.45;
      analyser.connect(ctx.destination);
      analyserRef.current = analyser;
      analyserReadyRef.current = true;
    }
    return ctx;
  }, [resetAudioGraph]);

  const unlockPlayback = useCallback(async (): Promise<void> => {
    const ctx = await ensureAudioGraph();
    if (!ctx) return;
    if (ctx.state !== "running") {
      try {
        await ctx.resume();
      } catch {
        /* ignore */
      }
    }
  }, [ensureAudioGraph]);

  const clearPendingPcm = useCallback(() => {
    if (pcmFlushTimerRef.current) {
      clearTimeout(pcmFlushTimerRef.current);
      pcmFlushTimerRef.current = null;
    }
    pendingPcmChunksRef.current = [];
    pendingPcmSamplesRef.current = 0;
    pendingPcmSampleRateRef.current = 24000;
    pendingPcmGenerationRef.current = null;
    pendingPcmServerGenerationRef.current = null;
  }, []);

  const queuedAheadMs = useCallback(() => {
    const ctx = audioContextRef.current;
    if (!ctx) return 0;
    return Math.max(0, (nextStartTimeRef.current - ctx.currentTime) * 1000);
  }, []);

  const scheduleIdleCheck = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    const runCheck = () => {
      if (hasPendingPlaybackWork()) {
        idleTimerRef.current = setTimeout(runCheck, 120);
        sync();
        return;
      }
      playingRef.current = false;
      notifyPlaybackEnd();
      stopEnvelopeLoop();
      sync();
    };
    const ctx = audioContextRef.current;
    const remainMs = ctx
      ? Math.max(40, (nextStartTimeRef.current - ctx.currentTime) * 1000 + 40)
      : 40;
    idleTimerRef.current = setTimeout(runCheck, remainMs);
  }, [hasPendingPlaybackWork, notifyPlaybackEnd, stopEnvelopeLoop, sync]);

  const scheduleAudioBuffer = useCallback(
    async (
      buffer: AudioBuffer,
      generationAtCall: number,
      serverGenerationId: number | null,
    ) => {
      const ctx = await ensureAudioGraph();
      if (!ctx) return;
      if (generationRef.current !== generationAtCall) return;
      const analyser = analyserRef.current;
      if (!analyser) return;

      const now = ctx.currentTime;
      const startAt = Math.max(now + 0.01, nextStartTimeRef.current || now + 0.01);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(analyser);
      source.onended = () => {
        activeSourcesRef.current.delete(source);
      };
      activeSourcesRef.current.add(source);
      source.start(startAt);
      nextStartTimeRef.current = startAt + buffer.duration;

      if (!playingRef.current) {
        playingRef.current = true;
        activateLipTimeline(
          serverGenerationId,
          performance.now() + Math.max(0, (startAt - now) * 1000),
        );
        updateLipSignal({
          active: true,
        });
        stopEnvelopeLoop();
        runEnvelopeLoop();
        sync();
      }
      if (!playbackNotifiedRef.current) {
        playbackNotifiedRef.current = true;
        activeServerGenerationRef.current = serverGenerationId;
        onPlaybackStartRef.current?.(serverGenerationId);
      }
      scheduleIdleCheck();
    },
    [
      activateLipTimeline,
      ensureAudioGraph,
      runEnvelopeLoop,
      scheduleIdleCheck,
      stopEnvelopeLoop,
      sync,
      updateLipSignal,
    ],
  );

  const enqueuePcmChunk = useCallback(
    (pcmBase64: string, sampleRate = 24000, serverGenerationId: number | null = null) => {
      touchEnqueueActivity();
      const generationAtCall = generationRef.current;
      const floats = pcm16Base64ToFloat32(pcmBase64);
      if (!floats) return;
      const ctxRate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 24000;

      const flushPending = () => {
        if (pendingPcmSamplesRef.current <= 0 || generationRef.current !== generationAtCall) {
          clearPendingPcm();
          return;
        }
        const chunks = pendingPcmChunksRef.current;
        const totalSamples = pendingPcmSamplesRef.current;
        const rate = pendingPcmSampleRateRef.current;
        const serverGeneration = pendingPcmServerGenerationRef.current;
        clearPendingPcm();
        void (async () => {
          const ctx = await ensureAudioGraph();
          if (!ctx) {
            if (generationRef.current !== generationAtCall) return;
            pendingPcmChunksRef.current = [
              ...chunks,
              ...pendingPcmChunksRef.current,
            ];
            pendingPcmSamplesRef.current += totalSamples;
            pendingPcmSampleRateRef.current = rate;
            pendingPcmGenerationRef.current = generationAtCall;
            pendingPcmServerGenerationRef.current = serverGeneration;
            if (!pcmFlushTimerRef.current) {
              pcmFlushTimerRef.current = setTimeout(() => {
                pcmFlushTimerRef.current = null;
                flushPending();
              }, 160);
            }
            return;
          }
          if (generationRef.current !== generationAtCall) return;
          const buf = ctx.createBuffer(1, totalSamples, rate);
          const channel = buf.getChannelData(0);
          let offset = 0;
          for (const chunk of chunks) {
            channel.set(chunk, offset);
            offset += chunk.length;
          }
          await scheduleAudioBuffer(buf, generationAtCall, serverGeneration);
        })();
      };

      const shouldScheduleImmediately =
        pendingPcmSamplesRef.current === 0 &&
        queuedAheadMs() < 24 &&
        activeSourcesRef.current.size === 0 &&
        !playingRef.current;

      if (shouldScheduleImmediately) {
        const frame = audioContextRef.current?.createBuffer(1, floats.length, ctxRate);
        if (frame) {
          frame.getChannelData(0).set(floats);
          void scheduleAudioBuffer(frame, generationAtCall, serverGenerationId);
          return;
        }
      }

      if (
        pendingPcmSamplesRef.current > 0 &&
        (pendingPcmGenerationRef.current !== generationAtCall ||
          pendingPcmSampleRateRef.current !== ctxRate)
      ) {
        flushPending();
      }

      pendingPcmChunksRef.current.push(floats);
      pendingPcmSamplesRef.current += floats.length;
      pendingPcmSampleRateRef.current = ctxRate;
      pendingPcmGenerationRef.current = generationAtCall;
      pendingPcmServerGenerationRef.current = serverGenerationId;

      const bufferedMs = (pendingPcmSamplesRef.current / ctxRate) * 1000;
      if (bufferedMs >= PCM_BATCH_TARGET_MS || queuedAheadMs() < 12) {
        flushPending();
        return;
      }

      if (!pcmFlushTimerRef.current) {
        pcmFlushTimerRef.current = setTimeout(() => {
          pcmFlushTimerRef.current = null;
          flushPending();
        }, Math.max(12, PCM_BATCH_TARGET_MS - bufferedMs));
      }
    },
    [clearPendingPcm, ensureAudioGraph, queuedAheadMs, scheduleAudioBuffer, touchEnqueueActivity],
  );

  const decodeBase64ToAudioBuffer = useCallback(
    async (
      base64: string,
      generationAtCall: number,
      serverGenerationId: number | null,
    ): Promise<boolean> => {
      const ctx = await ensureAudioGraph();
      if (!ctx) return false;
      if (generationRef.current !== generationAtCall) return true;
      const bytes = base64ToUint8Array(base64);
      if (!bytes) return false;

      const sourceBuffer = new Uint8Array(bytes).buffer;

      let decoded: AudioBuffer;
      try {
        decoded = await decodeAudioBuffer(ctx, sourceBuffer);
      } catch {
        return false;
      }

      if (generationRef.current !== generationAtCall) return true;
      await scheduleAudioBuffer(decoded, generationAtCall, serverGenerationId);
      return true;
    },
    [ensureAudioGraph, scheduleAudioBuffer],
  );

  const playBase64Fallback = useCallback(
    (base64: string, generationAtCall: number, serverGenerationId: number | null) => {
      if (typeof window === "undefined") return Promise.resolve();
      return (async () => {
        const url = base64ToObjectUrl(base64);
        if (!url) return;
        if (generationRef.current !== generationAtCall) {
          URL.revokeObjectURL(url);
          return;
        }

        await new Promise<void>((resolve) => {
          const audio = new Audio(url);
          audio.preload = "auto";
          audio.muted = false;
          audio.volume = 1;
          audio.setAttribute("playsinline", "");
          fallbackAudioRef.current = audio;
          let finishTimer: ReturnType<typeof setTimeout> | null = null;

          const clearFinishTimer = () => {
            if (finishTimer) {
              clearTimeout(finishTimer);
              finishTimer = null;
            }
          };

          const armFinishTimer = () => {
            clearFinishTimer();
            const duration = Number(audio.duration);
            if (!Number.isFinite(duration) || duration <= 0) return;
            finishTimer = setTimeout(() => {
              finish();
            }, duration * 1000 + 320);
          };

          const cleanup = () => {
            if (fallbackAudioRef.current === audio) fallbackAudioRef.current = null;
            if (stopFallbackRef.current === stop) stopFallbackRef.current = null;
            clearFinishTimer();
            audio.onended = null;
            audio.onerror = null;
            audio.onplaying = null;
            audio.onloadedmetadata = null;
            audio.ondurationchange = null;
            try {
              fallbackSourceRef.current?.disconnect();
            } catch {
              /* ignore */
            }
            fallbackSourceRef.current = null;
            URL.revokeObjectURL(url);
          };

          const finish = () => {
            cleanup();
            if (generationRef.current === generationAtCall) {
              playingRef.current = false;
              notifyPlaybackEnd();
              stopEnvelopeLoop();
              sync();
            }
            resolve();
          };

          const stop = () => {
            cleanup();
            resolve();
          };

          stopFallbackRef.current = stop;

          audio.onplaying = () => {
            playingRef.current = true;
            activateLipTimeline(serverGenerationId, performance.now());
            updateLipSignal({ active: true });
            stopEnvelopeLoop();
            runEnvelopeLoop();
            armFinishTimer();
            sync();
            if (!playbackNotifiedRef.current) {
              playbackNotifiedRef.current = true;
              activeServerGenerationRef.current = serverGenerationId;
              onPlaybackStartRef.current?.(serverGenerationId);
            }
          };
          audio.onloadedmetadata = armFinishTimer;
          audio.ondurationchange = armFinishTimer;
          audio.onended = finish;
          audio.onerror = finish;

          void audio.play().catch(() => {
            finish();
          });
        });
      })();
    },
    [activateLipTimeline, runEnvelopeLoop, stopEnvelopeLoop, sync, updateLipSignal],
  );

  const enqueueBase64 = useCallback(
    (base64: string, serverGenerationId: number | null = null) => {
      touchEnqueueActivity();
      const generationAtCall = generationRef.current;
      decodeChainRef.current = decodeChainRef.current
        .catch(() => {})
        .then(async () => {
          if (generationRef.current !== generationAtCall) return;
          const scheduled = await decodeBase64ToAudioBuffer(
            base64,
            generationAtCall,
            serverGenerationId,
          );
          if (!scheduled) {
            await playBase64Fallback(base64, generationAtCall, serverGenerationId);
          }
        });
    },
    [decodeBase64ToAudioBuffer, playBase64Fallback, touchEnqueueActivity],
  );

  /** Stop current playback and discard all queued audio (used on interrupt). */
  const clearQueue = useCallback(() => {
    generationRef.current += 1;
    lastEnqueueAtMsRef.current = 0;
    clearPendingPcm();

    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }

    for (const src of activeSourcesRef.current) {
      try {
        src.onended = null;
        src.stop();
      } catch {
        /* ignore */
      }
    }
    activeSourcesRef.current.clear();
    const fallback = fallbackAudioRef.current;
    if (fallback) {
      stopFallbackRef.current?.();
      fallback.onended = null;
      fallback.onerror = null;
      fallback.onplaying = null;
      fallback.pause();
      try {
        fallback.src = "";
      } catch {
        /* ignore */
      }
      fallbackAudioRef.current = null;
      stopFallbackRef.current = null;
    }
    try {
      fallbackSourceRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    fallbackSourceRef.current = null;
    nextStartTimeRef.current = 0;
    lipTimelineByGenerationRef.current.clear();
    activeLipTimelineRef.current = clearTtsLipSyncState(activeLipTimelineRef.current);
    activeLipGenerationRef.current = null;
    lipPlaybackStartAtMsRef.current = 0;
    notifyPlaybackEnd();

    stopEnvelopeLoop();
    playingRef.current = false;
    sync();
  }, [clearPendingPcm, notifyPlaybackEnd, stopEnvelopeLoop, sync]);

  const applyTtsLipSyncPatch = useCallback((patch: TtsLipSyncPatch) => {
    const previous =
      lipTimelineByGenerationRef.current.get(patch.generationId) ?? null;
    const next = mergeTtsLipSyncPatch(previous, patch);
    lipTimelineByGenerationRef.current.set(patch.generationId, next);
    if (activeLipGenerationRef.current === patch.generationId) {
      activeLipTimelineRef.current = next;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearPendingPcm();
      stopEnvelopeLoop();
      resetAudioGraph();
    };
  }, [clearPendingPcm, resetAudioGraph, stopEnvelopeLoop]);

  return {
    enqueueBase64,
    enqueuePcmChunk,
    clearQueue,
    unlockPlayback,
    audioLocked,
    voiceActive: playing,
    lipEnvelopeRef,
    lipSignalRef,
    applyTtsLipSyncPatch,
  };
}

function base64ToUint8Array(base64: string): Uint8Array | null {
  try {
    const bin = atob(base64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function pcm16Base64ToFloat32(base64: string): Float32Array | null {
  const bytes = base64ToUint8Array(base64);
  if (!bytes || bytes.byteLength < 2) return null;
  const sampleCount = Math.floor(bytes.byteLength / 2);
  const out = new Float32Array(sampleCount);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < sampleCount; i++) {
    const s = view.getInt16(i * 2, true);
    out[i] = s < 0 ? s / 0x8000 : s / 0x7fff;
  }
  return out;
}

function decodeAudioBuffer(ctx: AudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    const finishReject = (error: unknown) => {
      reject(error instanceof Error ? error : new Error("decodeAudioData failed"));
    };

    try {
      const maybePromise = ctx.decodeAudioData(
        data,
        (buffer) => resolve(buffer),
        (error) => finishReject(error),
      );
      if (maybePromise && typeof maybePromise.then === "function") {
        maybePromise.then(resolve).catch(finishReject);
      }
    } catch (error) {
      finishReject(error);
    }
  });
}
