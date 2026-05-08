"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useRemiChat, type RemiConnectionPhase } from "@/hooks/useRemiChat";
import type { ChatMessage } from "@/types/chat";

interface MiniChatProps {
  onClose: () => void;
}

/* ── Connection status helpers ── */

function connectionStatusText(
  phase: RemiConnectionPhase,
  reconnectInSec: number | null,
): string {
  switch (phase) {
    case "connecting":
      return "接続中…";
    case "open":
      return "オンライン";
    case "closed":
      if (reconnectInSec != null && reconnectInSec > 0) {
        return `切断・${reconnectInSec}秒後に再接続`;
      }
      if (reconnectInSec === 0) return "再接続中…";
      return "オフライン";
  }
}

function connectionDotColor(phase: RemiConnectionPhase): string {
  switch (phase) {
    case "connecting":
      return "var(--jp-ink-48)";
    case "open":
      return "#34c759";
    case "closed":
      return "#ff3b30";
  }
}

export function MiniChat({ onClose }: MiniChatProps) {
  const {
    connectionPhase,
    reconnectInSec,
    connected,
    messages: chatMessages,
    streamingText,
    typing,
    waiting,
    sendText,
  } = useRemiChat();

  const [input, setInput] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /* Filter to user/rem messages for the mini chat view */
  const visibleMessages = useMemo(
    () => chatMessages.filter((m: ChatMessage) => m.role === "user" || m.role === "rem"),
    [chatMessages],
  );

  const isBusy = typing || waiting;

  /* auto-scroll when messages or streaming text change */
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visibleMessages, streamingText]);

  /* focus input on mount */
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const send = () => {
    const text = input.trim();
    if (!text || !connected) return;
    sendText(text);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  const statusText = connectionStatusText(connectionPhase, reconnectInSec);
  const dotColor = connectionDotColor(connectionPhase);

  return (
    <div
      className="flex flex-col overflow-hidden rounded-[var(--jp-radius-lg)] border border-[var(--jp-hairline)] bg-[var(--jp-canvas)]"
      style={{
        width: 380,
        height: 400,
        fontFamily: "var(--jp-font-text)",
      }}
    >
      {/* ---- header ---- */}
      <div className="flex items-center justify-between border-b border-[var(--jp-hairline)] px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className="text-[15px] font-semibold text-[var(--jp-ink)]"
            style={{
              fontFamily: "var(--jp-font-display)",
              letterSpacing: "-0.224px",
            }}
          >
            与 Remi 对话练习
          </span>
          <span className="flex items-center gap-1.5 text-[11px] text-[var(--jp-ink-48)]">
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: dotColor }}
              aria-hidden
            />
            {statusText}
          </span>
        </div>
        <button
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--jp-ink-48)] transition-colors hover:bg-[var(--jp-parchment)]"
          aria-label="关闭对话面板"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          >
            <path d="M1 1l12 12M13 1L1 13" />
          </svg>
        </button>
      </div>

      {/* ---- message list ---- */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {visibleMessages.map((msg: ChatMessage) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[75%] rounded-[var(--jp-radius-lg)] px-3.5 py-2.5 text-[14px] leading-[1.43] ${
                msg.role === "user"
                  ? "bg-[var(--jp-parchment)] text-[var(--jp-ink)]"
                  : "bg-[#e8f0fe] text-[var(--jp-ink)]"
              }`}
            >
              {msg.text}
            </div>
          </div>
        ))}

        {/* streaming response in progress */}
        {streamingText && (
          <div className="flex justify-start">
            <div className="max-w-[75%] rounded-[var(--jp-radius-lg)] bg-[#e8f0fe] px-3.5 py-2.5 text-[14px] leading-[1.43] text-[var(--jp-ink)]">
              {streamingText}
            </div>
          </div>
        )}

        {/* thinking/waiting indicator (only when no streaming text yet) */}
        {isBusy && !streamingText && (
          <div className="flex justify-start">
            <div className="max-w-[75%] rounded-[var(--jp-radius-lg)] bg-[#e8f0fe] px-3.5 py-2.5 text-[14px] leading-[1.43] text-[var(--jp-ink-48)]">
              <span className="inline-flex gap-1">
                <span className="animate-pulse">·</span>
                <span className="animate-pulse" style={{ animationDelay: "150ms" }}>·</span>
                <span className="animate-pulse" style={{ animationDelay: "300ms" }}>·</span>
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ---- input bar ---- */}
      <div className="border-t border-[var(--jp-hairline)] px-3 py-2.5">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={connected ? "メッセージを入力…" : "接続待ち…"}
            disabled={!connected}
            className="flex-1 rounded-[var(--jp-radius-pill)] border border-[var(--jp-hairline)] bg-[var(--jp-parchment)] px-4 py-2 text-[14px] text-[var(--jp-ink)] outline-none placeholder:text-[var(--jp-ink-48)] focus:border-[var(--jp-primary)] disabled:opacity-50"
            style={{ fontFamily: "var(--jp-font-text)" }}
          />
          <button
            onClick={send}
            disabled={!input.trim() || !connected}
            className="flex h-[36px] items-center justify-center rounded-[var(--jp-radius-pill)] bg-[var(--jp-primary)] px-4 text-[14px] font-medium text-white transition-opacity disabled:opacity-40"
          >
            送信
          </button>
        </div>
      </div>
    </div>
  );
}
