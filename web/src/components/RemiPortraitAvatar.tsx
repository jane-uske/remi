"use client";

import {
  startTransition,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
} from "react";
import { getEmotionLabel } from "@/lib/emotionLabels";
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
  ribbon: string;
  iris: string;
  eyeSpark: string;
  blush: string;
};

const THEMES: Record<string, PortraitTheme> = {
  neutral: {
    auraStart: "#65d5f0",
    auraEnd: "#287d97",
    ribbon: "#7fcbe5",
    iris: "#8696d5",
    eyeSpark: "#dff7ff",
    blush: "#f8c5cb",
  },
  happy: {
    auraStart: "#f7a6cf",
    auraEnd: "#db6f8f",
    ribbon: "#f7b5dc",
    iris: "#8696d5",
    eyeSpark: "#fff4ce",
    blush: "#ffcad6",
  },
  curious: {
    auraStart: "#8cb9ff",
    auraEnd: "#4d7fd6",
    ribbon: "#8fbaf8",
    iris: "#8195f1",
    eyeSpark: "#eef5ff",
    blush: "#f8c9d5",
  },
  shy: {
    auraStart: "#d7b2ff",
    auraEnd: "#9c6ff0",
    ribbon: "#d8baf7",
    iris: "#8f83e5",
    eyeSpark: "#fbecff",
    blush: "#ffcadb",
  },
  sad: {
    auraStart: "#95bfd0",
    auraEnd: "#5c7f90",
    ribbon: "#9cb7d8",
    iris: "#7485bc",
    eyeSpark: "#ebf5fb",
    blush: "#eac2ce",
  },
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function eyebrowPath(emotion: string, side: "left" | "right"): string {
  const right = side === "right";

  switch (emotion) {
    case "happy":
      return right
        ? "M 242 186 Q 260 172 277 185"
        : "M 141 185 Q 158 172 176 186";
    case "curious":
      return right
        ? "M 242 186 Q 261 168 278 182"
        : "M 141 186 Q 158 169 176 183";
    case "shy":
      return right
        ? "M 243 188 Q 261 184 278 189"
        : "M 141 189 Q 158 184 176 188";
    case "sad":
      return right
        ? "M 243 188 Q 260 196 278 190"
        : "M 141 190 Q 158 196 176 188";
    default:
      return right
        ? "M 242 187 Q 260 178 278 186"
        : "M 141 186 Q 159 178 176 187";
  }
}

function mouthPath(emotion: string, mouthLevel: number): string {
  if (mouthLevel > 0.3) {
    const openHeight = 8 + mouthLevel * 18;
    return `M 180 286 Q 209 ${286 + openHeight} 238 286 Q 209 ${283 - mouthLevel * 4} 180 286`;
  }

  switch (emotion) {
    case "happy":
      return "M 182 284 Q 209 297 236 284";
    case "sad":
      return "M 184 291 Q 209 281 234 291";
    case "shy":
      return "M 187 286 Q 209 293 231 286";
    case "curious":
      return "M 188 285 Q 209 291 230 285";
    default:
      return "M 186 286 Q 209 291 232 286";
  }
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
      const nextEnvelope = clamp01(lipSignalRef.current.envelope);
      const nextActive = lipSignalRef.current.active || nextEnvelope > 0.02;
      const prev = liveLipRef.current;

      if (
        Math.abs(prev.envelope - nextEnvelope) > 0.02 ||
        prev.active !== nextActive
      ) {
        const nextState = {
          envelope: nextEnvelope,
          active: nextActive,
          sampledAtMs: Date.now(),
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
  const gaze = portraitDisplay.gaze;
  const eyeScale = portraitDisplay.eyeScale;
  const mouthLevel = clamp01(
    Math.max(
      portraitDisplay.mouthLevel,
      liveLip.active ? liveLip.envelope * 0.92 : 0,
    ),
  );
  const motion = portraitDisplay.motion;
  const companionLine = portraitDisplay.companionLine;
  const presenceLabel = portraitDisplay.presenceLabel;
  const breathOffset = portraitDisplay.breathOffset;
  const eyebrowEmotion = effectiveEmotion;
  const emotionLabel = getEmotionLabel(effectiveEmotion);
  const runtimePhase = runtimeState?.phase ?? null;

  const hairGradientId = useId().replace(/:/g, "");
  const auraGradientId = useId().replace(/:/g, "");
  const irisGradientId = useId().replace(/:/g, "");

  return (
    <section
      aria-label="Remi portrait"
      className={`remi-anime-stage relative flex min-h-[23rem] w-full min-w-0 flex-1 items-end justify-center overflow-visible ${className}`}
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

      <div className="pointer-events-none absolute left-2 top-2 max-w-[14rem] rounded-[1.4rem] border border-white/10 bg-[rgba(8,12,16,0.36)] px-4 py-3 text-[12px] leading-6 text-[#d6f0f4] shadow-[0_14px_30px_rgba(0,0,0,0.18)] backdrop-blur-md sm:left-5 sm:top-5">
        {companionLine}
      </div>

      <div className="pointer-events-none absolute right-2 top-2 flex flex-wrap justify-end gap-2 sm:right-5 sm:top-5">
        <span className="rounded-full border border-white/10 bg-[rgba(6,16,20,0.44)] px-3 py-1 text-xs text-[#dff8fd] backdrop-blur-md">
          {emotionLabel}
        </span>
        <span className="rounded-full border border-white/10 bg-[rgba(6,16,20,0.44)] px-3 py-1 text-xs text-[#bbdce3] backdrop-blur-md">
          {presenceLabel}
        </span>
      </div>

      <div
        className="pointer-events-none absolute bottom-2 h-16 w-[min(78%,30rem)] rounded-[50%] blur-2xl"
        style={{
          background: `radial-gradient(circle, ${theme.auraStart}44 0%, ${theme.auraEnd}16 54%, transparent 78%)`,
        }}
      />

      <div
        className="relative w-full max-w-[26rem] origin-bottom transition-transform duration-500 ease-out sm:max-w-[29rem] lg:max-w-[33rem]"
        style={{ transform: motion }}
      >
        <svg
          viewBox="0 0 420 640"
          className="remi-portrait-figure h-full w-full drop-shadow-[0_36px_48px_rgba(5,10,20,0.42)]"
          style={
            {
              "--remi-breath-offset": `${breathOffset}px`,
            } as CSSProperties
          }
          role="img"
          aria-hidden="true"
          data-runtime-phase={runtimePhase ?? undefined}
        >
          <defs>
            <linearGradient id={hairGradientId} x1="0%" x2="0%" y1="0%" y2="100%">
              <stop offset="0%" stopColor="#8f827b" />
              <stop offset="100%" stopColor="#5f5654" />
            </linearGradient>
            <radialGradient id={auraGradientId} cx="50%" cy="42%" r="60%">
              <stop offset="0%" stopColor={theme.auraStart} stopOpacity="0.88" />
              <stop offset="48%" stopColor={theme.auraEnd} stopOpacity="0.26" />
              <stop offset="100%" stopColor={theme.auraEnd} stopOpacity="0" />
            </radialGradient>
            <linearGradient id={irisGradientId} x1="0%" x2="0%" y1="0%" y2="100%">
              <stop offset="0%" stopColor={theme.eyeSpark} />
              <stop offset="35%" stopColor={theme.iris} />
              <stop offset="100%" stopColor="#46517a" />
            </linearGradient>
          </defs>

          <ellipse
            cx="210"
            cy="528"
            rx="146"
            ry="28"
            fill={`url(#${auraGradientId})`}
          />
          <ellipse cx="212" cy="608" rx="120" ry="18" fill="#081118" fillOpacity="0.4" />

          <path
            d="M186 500 L196 620 L222 620 L234 500 Z"
            fill="#ffe4d9"
          />
          <path
            d="M146 605 H196 V628 H140 Z"
            fill="#1d2330"
          />
          <path
            d="M226 605 H278 V628 H220 Z"
            fill="#1d2330"
          />

          <path
            d="M146 448 C 181 432 239 432 274 448 L 306 554 C 267 577 152 577 114 554 Z"
            fill="#5274a8"
          />
          <path
            d="M166 456 C 187 446 231 446 254 456 L 282 548 C 254 560 165 560 138 548 Z"
            fill="#3d5f93"
            fillOpacity="0.65"
          />

          <path
            d="M142 336 C 160 314 257 314 276 336 L 290 490 C 255 506 165 506 130 490 Z"
            fill="#fff1dc"
          />
          <path
            d="M160 342 C 182 326 237 326 258 342 L 246 390 C 229 398 190 398 174 390 Z"
            fill="#2c3d59"
          />
          <path
            d="M176 356 C 190 345 228 345 242 356 L 226 395 C 219 402 198 402 191 395 Z"
            fill="#324867"
          />
          <path
            d="M183 392 L 209 420 L 236 392"
            fill="none"
            stroke={theme.ribbon}
            strokeLinecap="round"
            strokeWidth="10"
          />
          <path
            d="M206 392 L 196 454"
            fill="none"
            stroke={theme.ribbon}
            strokeLinecap="round"
            strokeWidth="8"
          />
          <path
            d="M212 392 L 226 454"
            fill="none"
            stroke={theme.ribbon}
            strokeLinecap="round"
            strokeWidth="8"
          />

          <path
            d="M128 346 C 108 384 103 453 111 517 C 115 548 132 553 140 529 C 147 507 147 445 157 393 Z"
            fill="#fff1dc"
          />
          <path
            d="M292 346 C 312 384 317 453 309 517 C 305 548 288 553 280 529 C 273 507 273 445 263 393 Z"
            fill="#fff1dc"
          />

          <rect x="196" y="286" width="28" height="34" rx="12" fill="#ffe4d9" />

          <path
            d="M125 202 C 120 126 154 82 212 82 C 278 82 308 130 298 210 C 290 278 264 332 212 336 C 156 340 130 286 125 202 Z"
            fill={`url(#${hairGradientId})`}
          />
          <path
            d="M117 224 C 88 266 82 351 95 462 C 103 535 122 594 138 592 C 149 590 150 556 144 500 C 136 426 142 312 167 246 Z"
            fill={`url(#${hairGradientId})`}
          />
          <path
            d="M304 224 C 333 266 339 351 326 462 C 318 535 299 594 283 592 C 272 590 271 556 277 500 C 285 426 279 312 254 246 Z"
            fill={`url(#${hairGradientId})`}
          />

          <circle cx="132" cy="194" r="18" fill={theme.ribbon} fillOpacity="0.9" />
          <circle cx="288" cy="194" r="18" fill={theme.ribbon} fillOpacity="0.9" />
          <circle cx="132" cy="194" r="9" fill="#cf667c" fillOpacity="0.75" />
          <circle cx="288" cy="194" r="9" fill="#cf667c" fillOpacity="0.75" />

          <ellipse cx="210" cy="212" rx="78" ry="96" fill="#ffe9de" />
          <path
            d="M133 180 C 146 118 272 108 290 180 C 258 164 240 162 212 162 C 186 162 156 165 133 180 Z"
            fill={`url(#${hairGradientId})`}
          />
          <path
            d="M148 166 C 176 132 240 130 272 166 C 248 198 226 210 210 210 C 188 210 161 196 148 166 Z"
            fill={`url(#${hairGradientId})`}
          />

          <circle cx="162" cy="254" r="18" fill={theme.blush} fillOpacity="0.26" />
          <circle cx="258" cy="254" r="18" fill={theme.blush} fillOpacity="0.26" />

          <path
            d={eyebrowPath(eyebrowEmotion, "left")}
            fill="none"
            stroke="#4a3a43"
            strokeLinecap="round"
            strokeWidth="5"
          />
          <path
            d={eyebrowPath(eyebrowEmotion, "right")}
            fill="none"
            stroke="#4a3a43"
            strokeLinecap="round"
            strokeWidth="5"
          />

          <ellipse cx="160" cy="224" rx="25" ry={17 * eyeScale} fill="#fff" />
          <ellipse cx="258" cy="224" rx="25" ry={17 * eyeScale} fill="#fff" />
          <ellipse
            cx={160 + gaze.x}
            cy={224 + gaze.y}
            rx="13"
            ry="17"
            fill={`url(#${irisGradientId})`}
          />
          <ellipse
            cx={258 + gaze.x}
            cy={224 + gaze.y}
            rx="13"
            ry="17"
            fill={`url(#${irisGradientId})`}
          />
          <circle cx={160 + gaze.x} cy={230 + gaze.y} r="6" fill="#3a4567" />
          <circle cx={258 + gaze.x} cy={230 + gaze.y} r="6" fill="#3a4567" />
          <circle cx={166 + gaze.x} cy={214 + gaze.y} r="3.8" fill="#fff" />
          <circle cx={264 + gaze.x} cy={214 + gaze.y} r="3.8" fill="#fff" />
          <circle cx={155 + gaze.x} cy={237 + gaze.y} r="2.2" fill="#fff" fillOpacity="0.7" />
          <circle cx={253 + gaze.x} cy={237 + gaze.y} r="2.2" fill="#fff" fillOpacity="0.7" />

          <path
            d="M209 236 C 202 251 201 264 210 270"
            fill="none"
            stroke="#d6918a"
            strokeLinecap="round"
            strokeWidth="3"
            strokeOpacity="0.65"
          />

          <path
            d={mouthPath(effectiveEmotion, mouthLevel)}
            fill={mouthLevel > 0.3 ? "#ba5c76" : "none"}
            stroke="#91546c"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={mouthLevel > 0.3 ? 2.5 : 4}
          />
        </svg>
      </div>
    </section>
  );
}
