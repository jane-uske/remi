"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/types/chat";
import { MessageBubble } from "@/components/MessageBubble";
import type { ChatWindowStatusModel } from "@/runtime/remiRuntimeSelectors";

export type ChatWindowProps = {
  messages: ChatMessage[];
  hasMoreHistory: boolean;
  loadingMoreHistory: boolean;
  onLoadMore: () => void;
  listMutation: "idle" | "replace" | "prepend" | "append";
  listMutationNonce: number;
  sttPartialText: string;
  streamingText: string;
  statusModel: ChatWindowStatusModel;
};

export function ChatWindow({
  messages,
  hasMoreHistory,
  loadingMoreHistory,
  onLoadMore,
  listMutation,
  listMutationNonce,
  sttPartialText,
  streamingText,
  statusModel,
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
    shouldStickRef.current = true;
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
      shouldStickRef.current = true;
      didInitialScrollRef.current = true;
      pendingPrependHeightRef.current = null;
      return;
    }
  }, [listMutation, listMutationNonce]);

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
    const addedMessage = messages.length !== prevMessagesLenRef.current;
    prevMessagesLenRef.current = messages.length;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const latestMessage = messages[messages.length - 1];
    const forceStickToBottom = addedMessage && latestMessage?.role === "user";
    if (!shouldStickRef.current && !forceStickToBottom) return;
    if (forceStickToBottom) {
      shouldStickRef.current = true;
    }
    const behavior: ScrollBehavior = addedMessage ? "smooth" : "auto";
    scroller.scrollTo({ top: scroller.scrollHeight, behavior });
  }, [
    messages,
    sttPartialText,
    streamingText,
    statusModel.badgeLabel,
    statusModel.responseBusy,
  ]);

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

  const statusLabel = statusModel.badgeLabel;
  const responseBusy = statusModel.responseBusy;

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
        className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4 outline-none sm:px-5 sm:py-5 focus-visible:ring-2 focus-visible:ring-[var(--remi-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
      >
        {loadingMoreHistory ? (
          <div className="flex justify-center px-1 pb-1">
            <div className="rounded-full border border-[#0f7287]/35 bg-black/20 px-2.5 py-1 text-[11px] text-[#92bfca] backdrop-blur-md">
              正在加载更早的记录…
            </div>
          </div>
        ) : null}
        {statusLabel ? (
          <div className="flex justify-start px-1 pb-1">
            <div
              role="status"
              className="rounded-full border border-[#0f7287]/35 bg-black/20 px-2.5 py-1 text-[11px] text-[#9fd1db] backdrop-blur-md"
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
