"use client";

import { useMemo } from "react";

import { getEmotionLabel } from "@/lib/emotionLabels";

const ASSET_MAP: Record<string, string> = {
  neutral: "/avatar/assets/neutral.svg",
  happy: "/avatar/assets/happy.svg",
  curious: "/avatar/assets/curious.svg",
  shy: "/avatar/assets/shy.svg",
  sad: "/avatar/assets/sad.svg",
};

export type AvatarProps = {
  emotion: string;
};

export function Avatar({ emotion }: AvatarProps) {
  const key = useMemo(() => {
    const raw = String(emotion ?? "").trim();
    return ASSET_MAP[raw] ? raw : "neutral";
  }, [emotion]);

  const src = ASSET_MAP[key];

  return (
    <div className="flex min-w-0 items-center gap-3.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="Rem Avatar"
        className="h-[84px] w-[84px] shrink-0 rounded-[14px] border border-[var(--remi-border)] bg-[var(--remi-input)] object-cover"
      />
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-xs text-[var(--remi-dim)]">当前情绪</span>
        <span className="break-words text-sm font-semibold text-[var(--remi-accent)]">
          {getEmotionLabel(key)}
        </span>
      </div>
    </div>
  );
}
