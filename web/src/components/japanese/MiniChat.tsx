"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface Message {
  id: string;
  role: "user" | "remi";
  text: string;
}

interface MiniChatProps {
  onClose: () => void;
}

export function MiniChat({ onClose }: MiniChatProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "remi",
      text: "こんにちは！一緒に日本語を練習しましょう。何か話したいことはありますか？",
    },
  ]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /* auto-scroll when messages change */
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  /* focus input on mount */
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const send = useCallback(() => {
    const text = input.trim();
    if (!text || pending) return;

    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: "user",
      text,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setPending(true);

    /* mock response after 500ms */
    setTimeout(() => {
      const remiMsg: Message = {
        id: `r-${Date.now()}`,
        role: "remi",
        text: "Remi: 让我想想...",
      };
      setMessages((prev) => [...prev, remiMsg]);
      setPending(false);
    }, 500);
  }, [input, pending]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

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
        <span
          className="text-[15px] font-semibold text-[var(--jp-ink)]"
          style={{
            fontFamily: "var(--jp-font-display)",
            letterSpacing: "-0.224px",
          }}
        >
          与 Remi 对话练习
        </span>
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
        {messages.map((msg) => (
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

        {pending && (
          <div className="flex justify-start">
            <div className="max-w-[75%] rounded-[var(--jp-radius-lg)] bg-[#e8f0fe] px-3.5 py-2.5 text-[14px] leading-[1.43] text-[var(--jp-ink-48)]">
              ...
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
            placeholder="输入消息..."
            className="flex-1 rounded-[var(--jp-radius-pill)] border border-[var(--jp-hairline)] bg-[var(--jp-parchment)] px-4 py-2 text-[14px] text-[var(--jp-ink)] outline-none placeholder:text-[var(--jp-ink-48)] focus:border-[var(--jp-primary)]"
            style={{ fontFamily: "var(--jp-font-text)" }}
          />
          <button
            onClick={send}
            disabled={!input.trim() || pending}
            className="flex h-[36px] items-center justify-center rounded-[var(--jp-radius-pill)] bg-[var(--jp-primary)] px-4 text-[14px] font-medium text-white transition-opacity disabled:opacity-40"
          >
            发送
          </button>
        </div>
      </div>
    </div>
  );
}
