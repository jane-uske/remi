"use client";

import {
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import {
  buildPortraitDisplayModel,
} from "@/lib/portrait/portraitState";
import type { AvatarRenderModel } from "@/runtime/avatarRenderModel";
import type { CanonicalAvatarState } from "@/runtime/remiRuntimeAdapter";
import type {
  AvatarFrameState,
  AvatarIntent,
  LipSignal,
  RemiTurnState,
} from "@/types/avatar";

type RemiPortraitAvatarProps = {
  emotion: string;
  turnState?: RemiTurnState;
  avatarIntent?: AvatarIntent | null;
  avatarFrame?: AvatarFrameState | null;
  voiceActive?: boolean;
  busy?: boolean;
  userSpeaking?: boolean;
  recording?: boolean;
  lipSignalRef: MutableRefObject<LipSignal>;
  runtimeState?: CanonicalAvatarState | null;
  renderModel?: AvatarRenderModel | null;
  className?: string;
};

type PortraitTheme = {
  auraStart: string;
  auraEnd: string;
};

const THEMES: Record<string, PortraitTheme> = {
  neutral: {
    auraStart: "#65d5f0",
    auraEnd: "#287d97",
  },
  happy: {
    auraStart: "#f7a6cf",
    auraEnd: "#db6f8f",
  },
  curious: {
    auraStart: "#8cb9ff",
    auraEnd: "#4d7fd6",
  },
  shy: {
    auraStart: "#d7b2ff",
    auraEnd: "#9c6ff0",
  },
  sad: {
    auraStart: "#95bfd0",
    auraEnd: "#5c7f90",
  },
};

const EMOTION_LABELS: Record<string, string> = {
  neutral: "平静",
  happy: "开心",
  curious: "好奇",
  shy: "害羞",
  sad: "低落",
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function RemiPortraitAvatar({
  emotion,
  turnState = "confirmed_end",
  avatarIntent = null,
  avatarFrame = null,
  voiceActive = false,
  busy = false,
  userSpeaking = false,
  recording = false,
  lipSignalRef,
  runtimeState = null,
  renderModel = null,
  className = "",
}: RemiPortraitAvatarProps) {
  // TODO(phase-3): drop legacy portrait props after all callers provide runtimeState/renderModel.
  const [liveLip, setLiveLip] = useState({
    envelope: 0,
    active: false,
    sampledAtMs: Date.now(),
  });
  const liveLipRef = useRef(liveLip);

  useEffect(() => {
    liveLipRef.current = liveLip;
  }, [liveLip]);

  useEffect(() => {
    let raf = 0;

    const loop = () => {
      const now = Date.now();
      const nextEnvelope = clamp01(lipSignalRef.current.envelope);
      const nextActive = lipSignalRef.current.active || nextEnvelope > 0.02;
      const prev = liveLipRef.current;
      const shouldTick = now - prev.sampledAtMs >= 48;

      if (
        shouldTick ||
        Math.abs(prev.envelope - nextEnvelope) > 0.02 ||
        prev.active !== nextActive
      ) {
        const nextState = {
          envelope: nextEnvelope,
          active: nextActive,
          sampledAtMs: now,
        };
        liveLipRef.current = nextState;
        startTransition(() => {
          setLiveLip(nextState);
        });
      }

      raf = window.requestAnimationFrame(loop);
    };

    raf = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(raf);
  }, [lipSignalRef]);

  const portraitDisplay = useMemo(
    () =>
      buildPortraitDisplayModel({
        renderModel,
        emotion,
        turnState,
        avatarIntent,
        avatarFrame,
        voiceActive,
        busy,
        userSpeaking,
        recording,
        nowMs: liveLip.sampledAtMs,
      }),
    [
      avatarFrame,
      avatarIntent,
      busy,
      emotion,
      liveLip.sampledAtMs,
      recording,
      renderModel,
      turnState,
      userSpeaking,
      voiceActive,
    ],
  );

  const effectiveEmotion = portraitDisplay.emotion;
  const theme = THEMES[effectiveEmotion];
  const motion = portraitDisplay.motion;
  const motionPhase = portraitDisplay.motionPhase;
  const presenceLabel = portraitDisplay.presenceLabel;
  const companionLine = portraitDisplay.companionLine;
  const runtimePhase = runtimeState?.phase ?? null;
  const emotionLabel = EMOTION_LABELS[effectiveEmotion] ?? EMOTION_LABELS.neutral;

  return (
    <section
      aria-label="Remi portrait"
      className={`remi-anime-stage relative flex min-h-[23rem] w-full min-w-0 flex-1 items-end justify-center overflow-hidden ${className}`}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute left-[8%] top-[14%] h-44 w-44 rounded-full blur-3xl"
          style={{ backgroundColor: `${theme.auraStart}33` }}
        />
        <div
          className="absolute right-[10%] top-[26%] h-56 w-56 rounded-full blur-3xl"
          style={{ backgroundColor: `${theme.auraEnd}2a` }}
        />
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-[clamp(7rem,24svh,11.5rem)] z-10 flex justify-center px-4 md:inset-x-auto md:bottom-6 md:left-6 md:justify-start md:px-0">
        <div className="max-w-[22rem] rounded-full border border-white/10 bg-[rgba(7,16,24,0.28)] px-4 py-2 text-center text-[11px] leading-5 text-white/76 shadow-[0_14px_28px_rgba(0,0,0,0.12)] backdrop-blur-md md:max-w-[18rem] md:rounded-[1.2rem] md:text-left">
          {companionLine}
        </div>
      </div>

      <div
        className="pointer-events-none absolute bottom-2 h-16 w-[min(78%,30rem)] rounded-[50%] blur-2xl"
        style={{
          background: `radial-gradient(circle, ${theme.auraStart}44 0%, ${theme.auraEnd}16 54%, transparent 78%)`,
        }}
      />

      <div
        className="relative w-full max-w-[30rem] translate-y-[24%] scale-[1.34] origin-bottom sm:max-w-[34rem] sm:translate-y-[22%] sm:scale-[1.3] md:max-w-[40rem] md:translate-y-[16%] md:scale-[1.2] lg:max-w-[44rem] lg:translate-y-[12%] lg:scale-[1.14]"
      >
        <div
          className="relative origin-bottom transition-transform duration-500 ease-out"
          style={{ transform: motion }}
          data-portrait-style="anime-companion-v2"
          data-motion-phase={motionPhase}
          data-runtime-phase={runtimePhase ?? undefined}
        >
          <span className="sr-only">{emotionLabel}</span>
          <span className="sr-only">{presenceLabel}</span>
          <img
            src="/avatar/assets/remi-selected-portrait.png"
            alt="Remi avatar"
            className="remi-portrait-figure h-full w-full select-none object-contain drop-shadow-[0_34px_42px_rgba(5,10,20,0.28)]"
            draggable={false}
          />
        </div>
      </div>
    </section>
  );
}
