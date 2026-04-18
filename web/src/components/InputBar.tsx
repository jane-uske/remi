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
    <div className="flex w-full flex-col rounded-[1.75rem] border border-[#0d7286]/35 bg-[rgba(6,91,111,0.9)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_18px_40px_rgba(0,0,0,0.18)] backdrop-blur-xl">
      <textarea
        className="min-h-[7rem] w-full resize-none border-0 bg-transparent text-[15px] leading-7 text-[#eefcff] outline-none placeholder:text-[#9dc7cf] disabled:opacity-60"
        placeholder={placeholder}
        autoComplete="off"
        value={value}
        disabled={disabled}
        rows={4}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (
            e.key === "Enter" &&
            !e.shiftKey &&
            !e.nativeEvent.isComposing
          ) {
            e.preventDefault();
            submit();
          }
        }}
      />

      <div className="mt-3 flex min-h-[2.75rem] min-w-0 items-center justify-between gap-3">
        <button
          type="button"
          title="语音输入"
          disabled={micDisabled}
          onClick={onMicToggle}
          className={
            recording
              ? "remi-mic-pulse flex h-11 min-w-[4.5rem] shrink-0 items-center justify-center rounded-full border border-transparent bg-[var(--remi-danger)] px-4 text-xs font-semibold uppercase tracking-[0.18em] text-white disabled:cursor-default disabled:opacity-40"
              : "flex h-11 min-w-[4.5rem] shrink-0 items-center justify-center rounded-full border border-white/15 bg-black/20 px-4 text-xs font-semibold uppercase tracking-[0.18em] text-[#c7edf3] transition hover:bg-black/28 disabled:cursor-default disabled:opacity-40"
          }
          aria-pressed={recording}
        >
          <span className="sr-only">{recording ? "停止录音" : "开始语音"}</span>
          <span aria-hidden>{recording ? "stop" : "mic"}</span>
        </button>

        <div className="min-w-0 flex-1 text-[11px] uppercase tracking-[0.22em] text-[#9dc7cf]">
          Shift + Enter 换行
        </div>

        <button
          type="button"
          disabled={disabled}
          onClick={submit}
          title="发送"
          className="flex h-11 min-w-[5.25rem] shrink-0 items-center justify-center rounded-full bg-[linear-gradient(180deg,#b9eff8,#68bfd2)] px-4 text-sm font-semibold uppercase tracking-[0.16em] text-[#083846] shadow-[0_10px_24px_rgba(80,196,220,0.25)] transition hover:opacity-95 disabled:cursor-default disabled:opacity-40"
        >
          <span aria-hidden>send</span>
        </button>
      </div>
    </div>
  );
}
