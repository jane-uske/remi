"use client";

import { useCallback, useState } from "react";

/* ──────────────────────────────────────────────────────────────────────────
 * Voice style picker — small floating panel near the input bar.
 *
 * Lets the user choose a voice style preset (e.g. 御姐, 萝莉) and adjust
 * speed/pitch. Changes are sent via WS `set_voice_style` message and take
 * effect on the next TTS synthesis (per-session, resets on page refresh).
 *
 * MLX TTS only — the picker is hidden when the TTS provider is not mlx
 * (the parent should gate visibility accordingly).
 * ──────────────────────────────────────────────────────────────────────── */

const PRESETS = [
  { id: "default", label: "默认", emoji: "🎙️" },
  { id: "yujie", label: "御姐", emoji: "👩‍💼" },
  { id: "luoli", label: "萝莉", emoji: "🧸" },
  { id: "wenrou", label: "温柔", emoji: "🌸" },
  { id: "yuanqi", label: "元气", emoji: "⚡" },
  { id: "lengku", label: "冷酷", emoji: "🧊" },
  { id: "wumei", label: "妩媚", emoji: "💋" },
] as const;

const SPEED_LEVELS = [
  { value: null, label: "正常" },
  { value: "，语速偏慢", label: "慢" },
  { value: "，语速偏快", label: "快" },
] as const;

const PITCH_LEVELS = [
  { value: null, label: "正常" },
  { value: "，语调偏低沉", label: "低沉" },
  { value: "，语调偏高", label: "偏高" },
] as const;

export type VoiceStylePickerProps = {
  open: boolean;
  onClose: () => void;
  setVoiceStyle: (opts: {
    voiceStyleId?: string | null;
    speedModifier?: string | null;
    pitchModifier?: string | null;
  }) => void;
};

export function VoiceStylePicker({ open, onClose, setVoiceStyle }: VoiceStylePickerProps) {
  const [activePreset, setActivePreset] = useState("default");
  const [speedIdx, setSpeedIdx] = useState(0);
  const [pitchIdx, setPitchIdx] = useState(0);

  const selectPreset = useCallback(
    (id: string) => {
      setActivePreset(id);
      setVoiceStyle({ voiceStyleId: id === "default" ? null : id });
    },
    [setVoiceStyle],
  );

  const selectSpeed = useCallback(
    (idx: number) => {
      setSpeedIdx(idx);
      setVoiceStyle({ speedModifier: SPEED_LEVELS[idx].value });
    },
    [setVoiceStyle],
  );

  const selectPitch = useCallback(
    (idx: number) => {
      setPitchIdx(idx);
      setVoiceStyle({ pitchModifier: PITCH_LEVELS[idx].value });
    },
    [setVoiceStyle],
  );

  if (!open) return null;

  return (
    <div
      className="absolute bottom-full left-0 right-0 z-50 mb-2 animate-in fade-in slide-in-from-bottom-2 duration-200"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mx-auto w-[min(94vw,28rem)] rounded-2xl border border-white/10 bg-black/80 p-3 shadow-2xl shadow-black/40 backdrop-blur-xl">
        {/* Header */}
        <div className="mb-2.5 flex items-center justify-between">
          <span className="text-xs font-medium text-white/60">🎵 音色风格</span>
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded-full text-white/40 transition hover:bg-white/10 hover:text-white/70"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        {/* Preset pills */}
        <div className="mb-3 flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => selectPreset(p.id)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                activePreset === p.id
                  ? "bg-white/20 text-white shadow-sm"
                  : "bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/70"
              }`}
            >
              {p.emoji} {p.label}
            </button>
          ))}
        </div>

        {/* Speed + Pitch row */}
        <div className="flex gap-4">
          <div className="flex-1">
            <span className="mb-1 block text-[10px] text-white/40">语速</span>
            <div className="flex gap-1">
              {SPEED_LEVELS.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => selectSpeed(i)}
                  className={`flex-1 rounded-lg px-2 py-1 text-[11px] transition ${
                    speedIdx === i
                      ? "bg-white/15 text-white"
                      : "bg-white/5 text-white/40 hover:bg-white/10"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1">
            <span className="mb-1 block text-[10px] text-white/40">音调</span>
            <div className="flex gap-1">
              {PITCH_LEVELS.map((p, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => selectPitch(i)}
                  className={`flex-1 rounded-lg px-2 py-1 text-[11px] transition ${
                    pitchIdx === i
                      ? "bg-white/15 text-white"
                      : "bg-white/5 text-white/40 hover:bg-white/10"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
