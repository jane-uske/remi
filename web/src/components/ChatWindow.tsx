"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/types/chat";
import type { RemiTurnState } from "@/types/avatar";
import { MessageBubble } from "@/components/MessageBubble";

export type ChatWindowProps = {
  messages: ChatMessage[];
  hasMoreHistory: boolean;
  loadingMoreHistory: boolean;
  onLoadMore: () => void;
  listMutation: "idle" | "replace" | "prepend" | "append";
  listMutationNonce: number;
  sttPartialText: string;
  streamingText: string;
  listeningHint: boolean;
  /** STT 结束或发送消息后、首 token 到达前 */
  thinkingHint: boolean;
  turnState: RemiTurnState;
};

function getTurnStateLabel(turnState: RemiTurnState): string | null {
  switch (turnState) {
    case "listening_active":
      return "听着";
    case "listening_hold":
      return "还在听";
    case "likely_end":
      return "准备回应";
    case "confirmed_end":
      return "准备回复";
    case "assistant_entering":
      return "开口中";
    case "interrupted_by_user":
      return "被打断";
    case "assistant_speaking":
    default:
      return null;
  }
}

export function ChatWindow({
  messages,
  hasMoreHistory,
  loadingMoreHistory,
  onLoadMore,
  listMutation,
  listMutationNonce,
  sttPartialText,
  streamingText,
  listeningHint,
  thinkingHint,
  turnState,
}: ChatWindowProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const prevStreamingRef = useRef("");
  const prevMessagesLenRef = useRef(messages.length);
  const shouldStickRef = useRef(true);
  const didInitialScrollRef = useRef(false);
  const pendingPrependHeightRef = useRef<number | null>(null);
  const lastHandledMutationRef = useRef(0);
  const [streamStatus, setStreamStatus] = useState("");

  useLayoutEffect(() => {
    if (didInitialScrollRef.current) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    scroller.scrollTop = scroller.scrollHeight;
    didInitialScrollRef.current = true;
  }, [messages.length]);

  useLayoutEffect(() => {
    if (listMutationNonce === 0 || listMutationNonce === lastHandledMutationRef.current) return;
    lastHandledMutationRef.current = listMutationNonce;
    const scroller = scrollerRef.current;
    if (!scroller) return;

    if (listMutation === "prepend") {
      const previousHeight = pendingPrependHeightRef.current;
      if (previousHeight != null) {
        const delta = scroller.scrollHeight - previousHeight;
        scroller.scrollTop += delta;
      }
      pendingPrependHeightRef.current = null;
      return;
    }

    if (listMutation === "replace") {
      scroller.scrollTop = scroller.scrollHeight;
      didInitialScrollRef.current = true;
      pendingPrependHeightRef.current = null;
      return;
    }
  }, [listMutation, listMutationNonce]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const distanceToBottom =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    shouldStickRef.current = distanceToBottom < 72;
  });

  const handleScroll = () => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const distanceToBottom =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    shouldStickRef.current = distanceToBottom < 72;
    if (!hasMoreHistory || loadingMoreHistory) return;
    if (scroller.scrollTop > 48) return;
    pendingPrependHeightRef.current = scroller.scrollHeight;
    onLoadMore();
  };

  useEffect(() => {
    if (!shouldStickRef.current) return;
    const addedMessage = messages.length !== prevMessagesLenRef.current;
    prevMessagesLenRef.current = messages.length;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const behavior: ScrollBehavior = addedMessage ? "smooth" : "auto";
    scroller.scrollTo({ top: scroller.scrollHeight, behavior });
  }, [messages, sttPartialText, streamingText, listeningHint, thinkingHint]);

  useEffect(() => {
    const next = streamingText;
    const prev = prevStreamingRef.current;
    prevStreamingRef.current = next;
    if (!prev && next) {
      setStreamStatus("Remi 正在回复…");
    } else if (prev && !next) {
      setStreamStatus("");
    }
  }, [streamingText]);

  const statusLabel = getTurnStateLabel(turnState);
  const responseBusy =
    Boolean(streamingText) ||
    (thinkingHint &&
      turnState !== "listening_active" &&
      turnState !== "listening_hold") ||
    turnState === "likely_end" ||
    turnState === "confirmed_end" ||
    turnState === "assistant_entering" ||
    turnState === "interrupted_by_user";

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-transparent">
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {streamStatus}
      </div>
      <div
        ref={scrollerRef}
        role="log"
        aria-label="对话消息"
        aria-live="off"
        aria-busy={responseBusy}
        tabIndex={0}
        onScroll={handleScroll}
        className="flex flex-1 flex-col gap-2 overflow-y-auto px-3 py-3 outline-none min-[480px]:px-4 min-[480px]:py-4 sm:px-5 sm:py-5 focus-visible:ring-2 focus-visible:ring-[var(--remi-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
      >
        {loadingMoreHistory ? (
          <div className="flex justify-center px-1 pb-1">
            <div className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-[var(--remi-dim)] backdrop-blur-md">
              正在加载更早的记录…
            </div>
          </div>
        ) : null}
        {statusLabel ? (
          <div className="flex justify-start px-1 pb-1">
            <div
              role="status"
              className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-[var(--remi-dim)] backdrop-blur-md"
            >
              {statusLabel}
            </div>
          </div>
        ) : null}
        {messages.map((m) => (
          <MessageBubble key={m.id} role={m.role}>
            {m.text}
          </MessageBubble>
        ))}
        {sttPartialText ? (
          <MessageBubble role="partial">{sttPartialText}</MessageBubble>
        ) : null}
        {streamingText ? (
          <MessageBubble role="rem">{streamingText}</MessageBubble>
        ) : null}
      </div>
    </section>
  );
}
