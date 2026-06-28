"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceStyleControl = {
  open: boolean;
  onToggle: () => void;
  activeLabel: string;
};

export type InputBarProps = {
  onSend: (text: string, image?: string) => void;
  onMicToggle: () => void;
  disabled: boolean;
  micDisabled: boolean;
  recording: boolean;
  placeholder: string;
  variant?: "unified" | "legacy";
  voiceStyleControl?: VoiceStyleControl;
  /** Remi 是否正在回复（生成 / 播放 TTS）。用于把发送按钮切成停止键。 */
  isReplying?: boolean;
  /** 点击停止键 → 打断当前回复（不发新消息）。 */
  onStop?: () => void;
};

const MAX_IMAGE_SIZE = 4 * 1024 * 1024; // 4 MB

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function MicIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
      <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
    </svg>
  );
}

function SendIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z" />
    </svg>
  );
}

function StopIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <rect x="6" y="6" width="12" height="12" rx="2.5" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className={className}
      aria-hidden
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function ArrowUpIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function ImageIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path
        fillRule="evenodd"
        d="M1 5.25A2.25 2.25 0 013.25 3h13.5A2.25 2.25 0 0119 5.25v9.5A2.25 2.25 0 0116.75 17H3.25A2.25 2.25 0 011 14.75v-9.5zm1.5 5.81V14.75c0 .414.336.75.75.75h13.5a.75.75 0 00.75-.75v-2.06l-2.22-2.22a.75.75 0 00-1.06 0L9.06 15.56l-2.22-2.22a.75.75 0 00-1.06 0L2.5 11.06zm12-1.06a.75.75 0 00-1.06 0L9.06 14.38l-2.22-2.22a.75.75 0 00-1.06 0L2.5 15.44V5.25c0-.414.336-.75.75-.75h13.5c.414 0 .75.336.75.75v4.94l-2.5-2.5zM5.5 7a1 1 0 11-2 0 1 1 0 012 0z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function AttachmentChip({
  imagePreview,
  onClear,
}: {
  imagePreview: string;
  onClear: () => void;
}) {
  return (
    <div className="remi-composer-attachment flex w-full items-center gap-2 border-b border-[color:var(--remi-input-shell-border)] px-2 py-1.5">
      <img
        src={imagePreview}
        alt="待发送图片"
        className="remi-composer-attachment-thumb h-10 w-10 shrink-0 border border-white/10 object-cover"
      />
      <span className="min-w-0 flex-1 truncate text-xs text-[var(--remi-input-muted)]">
        待发送图片
      </span>
      <button
        type="button"
        onClick={onClear}
        className="remi-composer-tertiary-btn h-8 w-8 text-[var(--remi-input-muted)] hover:text-[var(--remi-input-text)]"
        title="移除图片"
      >
        <span className="sr-only">移除图片</span>
        <span aria-hidden>✕</span>
      </button>
    </div>
  );
}

function VoiceStyleMenuButton({
  voiceStyleControl,
}: {
  voiceStyleControl: VoiceStyleControl;
}) {
  return (
    <button
      type="button"
      title="音色风格"
      data-composer-action="voice-style"
      aria-pressed={voiceStyleControl.open}
      onClick={voiceStyleControl.onToggle}
      className="remi-composer-menu-btn shrink-0"
    >
      <span className="sr-only">音色风格：{voiceStyleControl.activeLabel}</span>
      <span aria-hidden>{voiceStyleControl.activeLabel}</span>
      <ChevronDownIcon className="h-3.5 w-3.5 opacity-70" />
    </button>
  );
}

export function InputBar({
  onSend,
  onMicToggle,
  disabled,
  micDisabled,
  recording,
  placeholder,
  variant = "legacy",
  voiceStyleControl,
  isReplying,
  onStop,
}: InputBarProps) {
  const [value, setValue] = useState("");
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const canSend = (value.trim().length > 0 || imagePreview != null) && !disabled;
  // 回复进行中且输入框为空 → 发送按钮变「停止」，点击纯打断当前回复；
  // 输入框有内容时仍是发送（sendText 自带打断，不必先停）。
  const showStop = Boolean(isReplying) && onStop != null && !canSend;

  const clearImage = useCallback(() => {
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const submit = useCallback(() => {
    const t = value.trim();
    if ((!t && !imagePreview) || disabled) return;
    onSend(t || "看看这张图", imagePreview ?? undefined);
    setValue("");
    clearImage();
  }, [value, imagePreview, disabled, onSend, clearImage]);

  const handleFile = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    if (file.size > MAX_IMAGE_SIZE) {
      alert("图片太大了，最多支持 4MB");
      return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setImagePreview(dataUrl);
    } catch {
      // ignore read errors
    }
  }, []);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void handleFile(file);
    },
    [handleFile],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) void handleFile(file);
          return;
        }
      }
    },
    [handleFile],
  );

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    const minHeight = variant === "unified" ? 24 : 40;
    const maxHeight = variant === "unified" ? 120 : 108;
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${Math.max(nextHeight, minHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [value, variant]);

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // Focusing the composer must not scroll the conversation. By default the
  // browser brings a newly-focused input into view, which nudges the message
  // list / chat card up a notch on click. Intercept the first focusing click,
  // suppress the default focus, and focus with preventScroll instead. We only
  // do this when the textarea isn't already focused, so click-to-position the
  // caret keeps working once you're typing.
  const handleTextareaMouseDown = useCallback(
    (e: React.MouseEvent<HTMLTextAreaElement>) => {
      const textarea = textareaRef.current;
      if (textarea && document.activeElement !== textarea) {
        e.preventDefault();
        textarea.focus({ preventScroll: true });
      }
    },
    [],
  );

  const chatgptMicButtonClass = recording
    ? "remi-mic-pulse remi-composer-icon-btn shrink-0 bg-[var(--remi-danger)] text-white opacity-100"
    : "remi-composer-icon-btn shrink-0 disabled:cursor-default disabled:opacity-30";

  const legacyMicButtonClass = recording
    ? "remi-mic-pulse flex h-10 min-w-[4.5rem] shrink-0 items-center justify-center rounded-full border border-transparent bg-[var(--remi-danger)] px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-white disabled:cursor-default disabled:opacity-40"
    : "flex h-10 min-w-[4.5rem] shrink-0 items-center justify-center rounded-full border border-[color:var(--remi-mic-button-border)] bg-[var(--remi-mic-button-bg)] px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--remi-input-text)] transition hover:bg-[var(--remi-mic-button-hover)] disabled:cursor-default disabled:opacity-40";

  const textareaClass =
    variant === "unified"
      ? "block max-h-[7.5rem] w-full resize-none border-0 bg-transparent px-0 py-0 text-[16px] leading-[1.5] text-[var(--remi-input-text)] outline-none placeholder:text-[var(--remi-input-placeholder)] disabled:opacity-60 md:text-[15px]"
      : "h-10 min-h-10 max-h-[6.75rem] w-full resize-none overflow-y-auto border-0 bg-transparent px-1 py-0 text-[16px] leading-10 text-[var(--remi-input-text)] outline-none placeholder:text-[var(--remi-input-placeholder)] disabled:opacity-60 md:text-[15px]";

  const hiddenFileInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept="image/*"
      className="hidden"
      onChange={handleFileSelect}
    />
  );

  if (variant === "unified") {
    return (
      <div className="flex w-full flex-col">
        <div
          className="remi-input-composer remi-input-composer--unified flex w-full flex-col border backdrop-blur-2xl"
          data-composer-rows={imagePreview ? "stacked" : "single"}
        >
          {imagePreview ? (
            <AttachmentChip imagePreview={imagePreview} onClear={clearImage} />
          ) : null}

          {/* Row 1 — textarea spans the full width so text never wraps prematurely */}
          <div className="remi-composer-text-row px-4 pt-3 pb-1.5">
            <textarea
              ref={textareaRef}
              aria-label="消息输入"
              className={textareaClass}
              placeholder={placeholder}
              autoComplete="off"
              value={value}
              disabled={disabled}
              rows={1}
              onMouseDown={handleTextareaMouseDown}
              onChange={(e) => setValue(e.target.value)}
              onPaste={handlePaste}
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

          {/* Row 2 — controls: attach on the left, voice / mic / send on the right */}
          <div className="remi-composer-action-row flex w-full items-center gap-1 px-3 pb-2.5 sm:gap-1.5">
            <button
              type="button"
              title="附带图片"
              data-composer-action="attach"
              disabled={disabled}
              onClick={openFilePicker}
              className="remi-composer-icon-btn shrink-0 disabled:cursor-default disabled:opacity-30"
            >
              <span className="sr-only">附带图片</span>
              <PlusIcon className="h-[1.15rem] w-[1.15rem]" />
            </button>
            {hiddenFileInput}

            <div className="min-w-0 flex-1" />

            {voiceStyleControl ? (
              <VoiceStyleMenuButton voiceStyleControl={voiceStyleControl} />
            ) : null}

            <button
              type="button"
              title={recording ? "停止录音" : "语音输入"}
              disabled={micDisabled}
              onClick={onMicToggle}
              className={chatgptMicButtonClass}
              aria-pressed={recording}
            >
              <span className="sr-only">
                {recording ? "停止录音" : "开始语音"}
              </span>
              {recording ? (
                <span
                  className="h-2.5 w-2.5 rounded-[2px] bg-white"
                  aria-hidden
                />
              ) : (
                <MicIcon className="h-[1.125rem] w-[1.125rem]" />
              )}
            </button>

            <button
              type="button"
              disabled={showStop ? false : disabled || !canSend}
              onClick={showStop ? () => onStop?.() : submit}
              title={showStop ? "停止" : "发送"}
              aria-label={showStop ? "停止" : "发送"}
              data-ready={showStop || canSend ? "true" : "false"}
              data-mode={showStop ? "stop" : "send"}
              className="remi-input-send flex shrink-0 items-center justify-center rounded-full transition active:scale-[0.97] disabled:cursor-default"
            >
              {showStop ? (
                <StopIcon className="h-3.5 w-3.5" />
              ) : (
                <ArrowUpIcon className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-2">
      {imagePreview && (
        <div className="relative mx-1 inline-flex w-fit">
          <img
            src={imagePreview}
            alt="待发送图片"
            className="h-16 max-w-[8rem] rounded-xl border border-white/12 object-cover shadow-[0_8px_24px_rgba(0,0,0,0.2)]"
          />
          <button
            type="button"
            onClick={clearImage}
            className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--remi-danger,#e53e3e)] text-[10px] text-white shadow-sm transition hover:scale-110"
            title="移除图片"
          >
            ✕
          </button>
        </div>
      )}

      <div
        data-input-layout="single-row"
        className="remi-input-composer flex w-full items-center gap-1.5 rounded-[1.35rem] border border-[color:var(--remi-input-shell-border)] bg-[var(--remi-input-shell-bg)] p-1.5 shadow-[var(--remi-input-shell-shadow)] backdrop-blur-2xl md:gap-2 md:rounded-[1.5rem] md:p-2"
      >
        <button
          type="button"
          title={recording ? "停止录音" : "语音输入"}
          disabled={micDisabled}
          onClick={onMicToggle}
          className={legacyMicButtonClass}
          aria-pressed={recording}
        >
          <span className="sr-only">{recording ? "停止录音" : "开始语音"}</span>
          <span aria-hidden>{recording ? "stop" : "mic"}</span>
        </button>

        <button
          type="button"
          title="附带图片"
          disabled={disabled}
          onClick={openFilePicker}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[var(--remi-input-text)] opacity-60 transition hover:opacity-100 disabled:cursor-default disabled:opacity-30"
        >
          <span className="sr-only">附带图片</span>
          <ImageIcon className="h-5 w-5" />
        </button>
        {hiddenFileInput}

        <div className="min-w-0 flex-1 flex">
          <textarea
            ref={textareaRef}
            aria-label="消息输入"
            className={textareaClass}
            placeholder={placeholder}
            autoComplete="off"
            value={value}
            disabled={disabled}
            rows={1}
            onMouseDown={handleTextareaMouseDown}
            onChange={(e) => setValue(e.target.value)}
            onPaste={handlePaste}
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
          disabled={showStop ? false : disabled || !canSend}
          onClick={showStop ? () => onStop?.() : submit}
          title={showStop ? "停止" : "发送"}
          data-ready={showStop || canSend ? "true" : "false"}
          data-mode={showStop ? "stop" : "send"}
          className="remi-input-send flex h-10 min-w-[4.5rem] shrink-0 items-center justify-center gap-1 rounded-full px-3 text-[var(--remi-send-button-fg)] shadow-[var(--remi-send-button-shadow)] transition hover:brightness-110 disabled:cursor-default disabled:opacity-40"
        >
          <span className="sr-only">{showStop ? "停止" : "发送"}</span>
          {showStop ? (
            <StopIcon className="h-[1.05rem] w-[1.05rem]" />
          ) : (
            <>
              <SendIcon className="h-[1.05rem] w-[1.05rem] md:hidden" />
              <span
                aria-hidden
                className="hidden text-[11px] font-semibold uppercase tracking-[0.12em] md:inline"
              >
                send
              </span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}