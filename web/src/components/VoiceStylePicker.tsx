"use client";

import { useCallback, useState } from "react";
import {
  readStoredVoiceSpeed,
  readStoredVoicePitch,
  writeStoredVoiceSpeed,
  writeStoredVoicePitch,
} from "@/hooks/useRemiChatHelpers";

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

export const VOICE_STYLE_PRESETS = [
  { id: "default", label: "默认", emoji: "🎙️" },
  { id: "yujie", label: "御姐", emoji: "👩‍💼" },
  { id: "luoli", label: "萝莉", emoji: "🧸" },
  { id: "wenrou", label: "温柔", emoji: "🌸" },
  { id: "yuanqi", label: "元气", emoji: "⚡" },
  { id: "lengku", label: "冷酷", emoji: "🧊" },
  { id: "wumei", label: "妩媚", emoji: "💋" },
] as const;

export function voiceStyleLabelForId(id: string): string {
  return (
    VOICE_STYLE_PRESETS.find((preset) => preset.id === id)?.label ?? "默认"
  );
}

export const SPEED_LEVELS = [
  { value: null, label: "正常" },
  { value: "，语速偏慢", label: "慢" },
  { value: "，语速偏快", label: "快" },
] as const;

export const PITCH_LEVELS = [
  { value: null, label: "正常" },
  { value: "，语调偏低沉", label: "低沉" },
  { value: "，语调偏高", label: "偏高" },
] as const;

export type VoiceStylePickerProps = {
  open: boolean;
  onClose: () => void;
  activePresetId?: string;
  onPresetChange?: (presetId: string) => void;
  setVoiceStyle: (opts: {
    voiceStyleId?: string | null;
    speedModifier?: string | null;
    pitchModifier?: string | null;
    ttsEnabled?: boolean;
  }) => void;
  ttsEnabled?: boolean;
  onTtsEnabledChange?: (enabled: boolean) => void;
};

export function VoiceStylePicker({
  open,
  onClose,
  activePresetId: activePresetIdProp,
  onPresetChange,
  setVoiceStyle,
  ttsEnabled = true,
  onTtsEnabledChange,
}: VoiceStylePickerProps) {
  const [activePresetInternal, setActivePresetInternal] = useState("default");
  const activePreset = activePresetIdProp ?? activePresetInternal;
  const [speedIdx, setSpeedIdx] = useState(() => readStoredVoiceSpeed());
  const [pitchIdx, setPitchIdx] = useState(() => readStoredVoicePitch());

  const selectPreset = useCallback(
    (id: string) => {
      if (activePresetIdProp == null) {
        setActivePresetInternal(id);
      }
      onPresetChange?.(id);
      setVoiceStyle({ voiceStyleId: id === "default" ? null : id });
    },
    [activePresetIdProp, onPresetChange, setVoiceStyle],
  );

  const selectSpeed = useCallback(
    (idx: number) => {
      setSpeedIdx(idx);
      writeStoredVoiceSpeed(idx);
      setVoiceStyle({ speedModifier: SPEED_LEVELS[idx].value });
    },
    [setVoiceStyle],
  );

  const selectPitch = useCallback(
    (idx: number) => {
      setPitchIdx(idx);
      writeStoredVoicePitch(idx);
      setVoiceStyle({ pitchModifier: PITCH_LEVELS[idx].value });
    },
    [setVoiceStyle],
  );

  const selectTtsEnabled = useCallback(
    (enabled: boolean) => {
      onTtsEnabledChange?.(enabled);
      if (!onTtsEnabledChange) {
        setVoiceStyle({ ttsEnabled: enabled });
      }
    },
    [onTtsEnabledChange, setVoiceStyle],
  );

  if (!open) return null;

  return (
    <div
      className="absolute bottom-full left-0 right-0 z-50 mb-2 w-full min-w-0 animate-in fade-in slide-in-from-bottom-2 duration-200"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="remi-voice-style-picker box-border w-full max-w-full border p-3 backdrop-blur-xl">
        <div className="mb-2.5 flex items-center justify-between">
          <span className="text-xs font-medium text-[var(--remi-input-muted)]">
            🎵 音色风格
          </span>
          <button
            type="button"
            onClick={onClose}
            className="remi-voice-style-picker-close flex h-6 w-6 items-center justify-center rounded-full transition"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        <div className="mb-3">
          <span className="mb-1 block text-[10px] text-[var(--remi-input-muted)]">
            声音
          </span>
          <div className="flex min-w-0 gap-1">
            <button
              type="button"
              onClick={() => selectTtsEnabled(true)}
              className={`remi-voice-style-option flex-1 ${
                ttsEnabled ? "remi-voice-style-option--active" : ""
              }`}
            >
              🔊 打开声音
            </button>
            <button
              type="button"
              onClick={() => selectTtsEnabled(false)}
              className={`remi-voice-style-option flex-1 ${
                !ttsEnabled ? "remi-voice-style-option--active" : ""
              }`}
            >
              🔇 关闭声音
            </button>
          </div>
        </div>

        <div className="remi-voice-style-pills mb-3">
          {VOICE_STYLE_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => selectPreset(p.id)}
              className={`remi-voice-style-pill ${
                activePreset === p.id ? "remi-voice-style-pill--active" : ""
              }`}
            >
              {p.emoji} {p.label}
            </button>
          ))}
        </div>

        <div className="remi-voice-style-tuning flex min-w-0 flex-col gap-3 sm:flex-row sm:gap-4">
          <div className="min-w-0 flex-1">
            <span className="mb-1 block text-[10px] text-[var(--remi-input-muted)]">
              语速
            </span>
            <div className="flex min-w-0 gap-1">
              {SPEED_LEVELS.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => selectSpeed(i)}
                  className={`remi-voice-style-option flex-1 ${
                    speedIdx === i ? "remi-voice-style-option--active" : ""
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <span className="mb-1 block text-[10px] text-[var(--remi-input-muted)]">
              音调
            </span>
            <div className="flex min-w-0 gap-1">
              {PITCH_LEVELS.map((p, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => selectPitch(i)}
                  className={`remi-voice-style-option flex-1 ${
                    pitchIdx === i ? "remi-voice-style-option--active" : ""
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
