"use client";

import { useCallback, useState } from "react";

export type InputBarProps = {
  onSend: (text: string) => void;
  onMicToggle: () => void;
  disabled: boolean;
  micDisabled: boolean;
  recording: boolean;
  placeholder: string;
};

export function InputBar({
  onSend,
  onMicToggle,
  disabled,
  micDisabled,
  recording,
  placeholder,
}: InputBarProps) {
  const [value, setValue] = useState("");

  const submit = useCallback(() => {
    const t = value.trim();
    if (!t || disabled) return;
    onSend(t);
    setValue("");
  }, [value, disabled, onSend]);

  return (
    <div className="flex w-full flex-col gap-2 rounded-2xl border border-white/15 bg-white/[0.08] p-1.5 shadow-inner backdrop-blur-xl dark:bg-black/35 sm:flex-row sm:items-center sm:gap-2.5 sm:pl-3">
      <div className="flex min-h-[2.5rem] min-w-0 flex-1 items-center gap-2 sm:min-h-0 sm:gap-2.5">
        <button
          type="button"
          title="语音输入"
          disabled={micDisabled}
          onClick={onMicToggle}
          className={
            recording
              ? "remi-mic-pulse flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-transparent bg-[var(--remi-danger)] text-base text-white disabled:cursor-default disabled:opacity-40"
              : "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--remi-border)] bg-[var(--remi-surface)] text-[var(--remi-accent)] transition hover:bg-[var(--remi-border)]/40 disabled:cursor-default disabled:opacity-40"
          }
          aria-pressed={recording}
        >
          <span className="sr-only">{recording ? "停止录音" : "开始语音"}</span>
          <span aria-hidden>{recording ? "■" : "🎤"}</span>
        </button>
        <input
          className="min-h-0 min-w-0 flex-1 border-0 bg-transparent py-2 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--remi-dim)] disabled:opacity-60"
          type="text"
          placeholder={placeholder}
          autoComplete="off"
          value={value}
          disabled={disabled}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={submit}
        title="发送"
        className="flex h-10 w-full shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--remi-accent)] to-[var(--remi-accent-dim)] text-lg font-semibold text-[#042f2e] shadow-md shadow-teal-500/15 transition hover:opacity-95 disabled:cursor-default disabled:opacity-40 sm:h-10 sm:w-10"
      >
        <span aria-hidden>↑</span>
      </button>
    </div>
  );
}
