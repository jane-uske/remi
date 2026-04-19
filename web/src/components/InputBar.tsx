"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const submit = useCallback(() => {
    const t = value.trim();
    if (!t || disabled) return;
    onSend(t);
    setValue("");
  }, [value, disabled, onSend]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    const nextHeight = Math.min(textarea.scrollHeight, 108);
    textarea.style.height = `${Math.max(nextHeight, 40)}px`;
    textarea.style.overflowY = textarea.scrollHeight > 108 ? "auto" : "hidden";
  }, [value]);

  return (
    <div
      data-input-layout="single-row"
      className="flex w-full items-center gap-2 rounded-[1.2rem] border border-[color:var(--remi-input-shell-border)] bg-[var(--remi-input-shell-bg)] p-1.5 shadow-[var(--remi-input-shell-shadow)] backdrop-blur-2xl md:rounded-[1.5rem] md:p-2"
    >
      <button
        type="button"
        title="语音输入"
        disabled={micDisabled}
        onClick={onMicToggle}
        className={
          recording
            ? "remi-mic-pulse flex h-10 min-w-[4.5rem] shrink-0 items-center justify-center rounded-full border border-transparent bg-[var(--remi-danger)] px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-white disabled:cursor-default disabled:opacity-40"
            : "flex h-10 min-w-[4.5rem] shrink-0 items-center justify-center rounded-full border border-[color:var(--remi-mic-button-border)] bg-[var(--remi-mic-button-bg)] px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--remi-input-text)] transition hover:bg-[var(--remi-mic-button-hover)] disabled:cursor-default disabled:opacity-40"
        }
        aria-pressed={recording}
      >
        <span className="sr-only">{recording ? "停止录音" : "开始语音"}</span>
        <span aria-hidden>{recording ? "stop" : "mic"}</span>
      </button>

      <div className="min-w-0 flex-1 flex">
        <textarea
          ref={textareaRef}
          aria-label="消息输入"
          className="h-10 min-h-10 max-h-[6.75rem] w-full resize-none overflow-y-auto border-0 bg-transparent px-1 py-0 text-[16px] leading-10 text-[var(--remi-input-text)] outline-none placeholder:text-[var(--remi-input-placeholder)] disabled:opacity-60 md:text-[15px]"
          placeholder={placeholder}
          autoComplete="off"
          value={value}
          disabled={disabled}
          rows={1}
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
      </div>

      <button
        type="button"
        disabled={disabled}
        onClick={submit}
        title="发送"
        className="flex h-10 min-w-[4.5rem] shrink-0 items-center justify-center rounded-full bg-[var(--remi-send-button-bg)] px-3 text-[12px] font-semibold uppercase tracking-[0.14em] text-[var(--remi-send-button-fg)] shadow-[var(--remi-send-button-shadow)] transition hover:opacity-95 disabled:cursor-default disabled:opacity-40"
      >
        <span aria-hidden>send</span>
      </button>
    </div>
  );
}
