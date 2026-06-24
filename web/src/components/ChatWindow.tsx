"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/types/chat";
import type { ConversationPerformanceModel } from "@/lib/presence/conversationPerformanceModel";
import { MessageBubble } from "@/components/MessageBubble";
import type { ChatWindowStatusModel } from "@/runtime/remiRuntimeSelectors";
import {
  documentScrollTarget,
  elementScrollTarget,
  isNearBottom,
  type ScrollTarget,
} from "@/lib/scroll/scrollTarget";

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
  performanceModel?: ConversationPerformanceModel | null;
  /** True from send until the first assistant token is rendered. */
  awaitingAssistantReply?: boolean;
  immersive?: boolean;
  /**
   * When true, messages flow in the document and the window/document is the
   * scroller (mobile immersive chat). When false (default), ChatWindow uses
   * its own inner overflow-y:auto scroller (desktop / NSFW).
   */
  documentScroll?: boolean;
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
  performanceModel = null,
  awaitingAssistantReply = false,
  immersive = false,
  documentScroll = false,
}: ChatWindowProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const prevStreamingRef = useRef("");
  const prevMessagesLenRef = useRef(messages.length);
  const shouldStickRef = useRef(true);
  const didInitialScrollRef = useRef(false);
  const pendingPrependHeightRef = useRef<number | null>(null);
  const lastHandledMutationRef = useRef(0);
  const [streamStatus, setStreamStatus] = useState("");
  const [visibleStreamingText, setVisibleStreamingText] = useState(
    performanceModel?.chatSync.displayStreamingText ?? streamingText,
  );
  const [showTailSettle, setShowTailSettle] = useState(false);

  const effectivePhase = performanceModel?.phase ?? null;
  const effectiveStatusLabel =
    performanceModel?.chatSync.statusLabel ?? statusModel.badgeLabel;
  const effectivePartialText =
    performanceModel?.chatSync.displayPartialText ?? sttPartialText;
  const targetStreamingText =
    performanceModel?.chatSync.displayStreamingText ?? streamingText;
  const bubbleTone = performanceModel?.chatSync.bubbleTone ?? "idle";
  const revealCadenceMs = performanceModel?.chatSync.revealCadenceMs ?? 24;
  const emphasisStrength = performanceModel?.chatSync.emphasisStrength ?? 0;
  const showPreparingBubble =
    targetStreamingText.length === 0 &&
    (awaitingAssistantReply ||
      Boolean(performanceModel?.chatSync.showPreparingBubble));
  const showThinkingPulse = Boolean(performanceModel?.chatSync.showThinkingPulse);
  const showListeningPulse = Boolean(performanceModel?.chatSync.showListeningPulse);
  const showYieldClamp = Boolean(performanceModel?.chatSync.showYieldClamp);

  const getTarget = (): ScrollTarget | null => {
    if (documentScroll) return documentScrollTarget();
    const el = scrollerRef.current;
    return el ? elementScrollTarget(el) : null;
  };

  useLayoutEffect(() => {
    if (didInitialScrollRef.current) return;
    const target = getTarget();
    if (!target) return;
    target.scrollToBottom("auto");
    shouldStickRef.current = true;
    didInitialScrollRef.current = true;
    // In document mode the page height isn't final until the avatar canvas /
    // fonts lay out; re-pin once on the next frame so we land at the bottom.
    if (documentScroll) {
      requestAnimationFrame(() => {
        if (shouldStickRef.current) target.scrollToBottom("auto");
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  useLayoutEffect(() => {
    if (listMutationNonce === 0 || listMutationNonce === lastHandledMutationRef.current) return;
    lastHandledMutationRef.current = listMutationNonce;
    const target = getTarget();
    if (!target) return;

    if (listMutation === "prepend") {
      const previousHeight = pendingPrependHeightRef.current;
      if (previousHeight != null) {
        const delta = target.getScrollHeight() - previousHeight;
        target.setScrollTop(target.getScrollTop() + delta);
      }
      pendingPrependHeightRef.current = null;
      return;
    }

    if (listMutation === "replace") {
      target.scrollToBottom("auto");
      shouldStickRef.current = true;
      didInitialScrollRef.current = true;
      pendingPrependHeightRef.current = null;
      return;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listMutation, listMutationNonce]);

  const handleScroll = () => {
    const target = getTarget();
    if (!target) return;
    shouldStickRef.current = isNearBottom(
      target.getScrollHeight(),
      target.getScrollTop(),
      target.getClientHeight(),
    );
    if (!hasMoreHistory || loadingMoreHistory) return;
    if (target.getScrollTop() > 48) return;
    pendingPrependHeightRef.current = target.getScrollHeight();
    onLoadMore();
  };

  // In document mode the scroll events fire on window, not the inner div.
  // Route them through the latest handleScroll without re-binding per render.
  const handleScrollRef = useRef(handleScroll);
  handleScrollRef.current = handleScroll;
  useEffect(() => {
    if (!documentScroll) return;
    const fn = () => handleScrollRef.current();
    window.addEventListener("scroll", fn, { passive: true });
    return () => window.removeEventListener("scroll", fn);
  }, [documentScroll]);

  // When the scroll mode flips (e.g. the narrow breakpoint resolves after the
  // first client render, switching element-scroll → document-scroll), re-pin to
  // the bottom in the new coordinate space so we don't get stuck mid-history.
  const didModeInitRef = useRef(false);
  useEffect(() => {
    if (!didModeInitRef.current) {
      didModeInitRef.current = true;
      return; // initial mount is already handled by the layout effect above
    }
    const target = getTarget();
    if (!target) return;
    shouldStickRef.current = true;
    requestAnimationFrame(() => target.scrollToBottom("auto"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentScroll]);

  useEffect(() => {
    if (!targetStreamingText) {
      setVisibleStreamingText("");
      return;
    }

    setVisibleStreamingText((current) => {
      if (!current) return targetStreamingText;
      if (!targetStreamingText.startsWith(current)) return targetStreamingText;
      if (current.length > targetStreamingText.length) return targetStreamingText;
      return current;
    });
  }, [targetStreamingText]);

  useEffect(() => {
    if (!targetStreamingText || visibleStreamingText === targetStreamingText) return;
    const step = performanceModel?.languageBeat.boundary === "emphasis" ? 2 : 1;
    const timer = window.setInterval(() => {
      setVisibleStreamingText((current) => {
        if (!targetStreamingText.startsWith(current)) return targetStreamingText;
        if (current.length >= targetStreamingText.length) return targetStreamingText;
        return targetStreamingText.slice(
          0,
          Math.min(targetStreamingText.length, current.length + step),
        );
      });
    }, revealCadenceMs);
    return () => window.clearInterval(timer);
  }, [
    performanceModel?.languageBeat.boundary,
    revealCadenceMs,
    targetStreamingText,
    visibleStreamingText,
  ]);

  useEffect(() => {
    if (effectivePhase !== "speaking_tail" || !performanceModel?.chatSync.tailHoldMs) {
      setShowTailSettle(false);
      return;
    }
    setShowTailSettle(true);
    const timer = window.setTimeout(() => {
      setShowTailSettle(false);
    }, performanceModel.chatSync.tailHoldMs);
    return () => window.clearTimeout(timer);
  }, [effectivePhase, performanceModel?.chatSync.tailHoldMs]);

  useEffect(() => {
    const addedMessage = messages.length !== prevMessagesLenRef.current;
    prevMessagesLenRef.current = messages.length;
    const target = getTarget();
    if (!target) return;
    const latestMessage = messages[messages.length - 1];
    const forceStickToBottom = addedMessage && latestMessage?.role === "user";
    if (!shouldStickRef.current && !forceStickToBottom) return;
    if (forceStickToBottom) {
      shouldStickRef.current = true;
    }
    const behavior: ScrollBehavior = addedMessage ? "smooth" : "auto";
    target.scrollToBottom(behavior);
  }, [
    messages,
    effectivePartialText,
    visibleStreamingText,
    effectiveStatusLabel,
    statusModel.responseBusy,
  ]);

  useEffect(() => {
    const next = visibleStreamingText;
    const prev = prevStreamingRef.current;
    prevStreamingRef.current = next;
    if (!prev && next) {
      setStreamStatus("Remi 正在回复…");
    } else if (prev && !next) {
      setStreamStatus("");
    }
  }, [visibleStreamingText]);

  const displayPhase =
    awaitingAssistantReply && targetStreamingText.length === 0
      ? "thinking"
      : effectivePhase;
  const statusLabel = awaitingAssistantReply
    ? "Remi 正在回复"
    : effectiveStatusLabel;
  const responseBusy = statusModel.responseBusy || awaitingAssistantReply;
  const statusClass =
    displayPhase === "thinking"
      ? "border-amber-300/30 bg-amber-500/10 text-amber-50"
      : displayPhase === "speaking_prepare"
        ? "border-cyan-300/30 bg-cyan-500/10 text-cyan-50"
        : displayPhase === "speaking_tail"
          ? "border-emerald-300/30 bg-emerald-500/10 text-emerald-50"
          : displayPhase === "yield"
            ? "border-rose-300/30 bg-rose-500/10 text-rose-50"
            : showListeningPulse
              ? "border-sky-300/30 bg-sky-500/10 text-sky-50"
              : "border-[#3b1a6e]/35 bg-black/20 text-[#c4b5fd]";
  const statusMotionClass =
    awaitingAssistantReply || showThinkingPulse || showListeningPulse
      ? "animate-pulse"
      : "";
  const streamingBubbleStyle =
    emphasisStrength > 0
      ? {
          transform: `translateY(${-Math.round(emphasisStrength * 2)}px) scale(${(
            1 + emphasisStrength * 0.018
          ).toFixed(3)})`,
        }
      : undefined;
  const phaseCue =
    performanceModel?.phaseCueText ??
    (effectivePhase === "thinking"
      ? "Remi 正在回复"
      : effectivePhase === "speaking_prepare"
        ? "Remi 正在起句"
        : effectivePhase === "speaking_active"
          ? "Remi 正在顺着这句说"
          : effectivePhase === "speaking_tail"
            ? "Remi 在收住这句"
            : effectivePhase === "yield"
              ? "Remi 先停一下，让你接话"
              : effectivePhase === "listening"
                ? "Remi 正在跟着你听"
                : effectivePhase === "open_mic_idle"
                  ? "Remi 在线，等你继续"
                  : null);
  const phaseCueClass =
    effectivePhase === "thinking"
      ? "border-amber-300/25 bg-amber-500/10 text-amber-50"
      : effectivePhase === "speaking_prepare"
        ? "border-cyan-300/30 bg-cyan-500/12 text-cyan-50"
        : effectivePhase === "speaking_tail"
          ? "border-emerald-300/30 bg-emerald-500/12 text-emerald-50"
          : effectivePhase === "yield"
            ? "border-rose-300/30 bg-rose-500/12 text-rose-50"
            : "border-sky-300/25 bg-sky-500/10 text-sky-50";

  return (
    <section
      className="flex min-h-0 flex-col bg-transparent md:flex-1"
      data-chat-presence-phase={effectivePhase ?? ""}
      data-chat-attention-target={performanceModel?.attentionTarget ?? ""}
      data-chat-language-channel={performanceModel?.languageBeat.channel ?? "none"}
    >
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
        onScroll={documentScroll ? undefined : handleScroll}
        className={
          documentScroll
            ? "pointer-events-auto flex flex-col gap-1.5 px-3 pb-3 pt-2 outline-none [overflow-anchor:none] focus-visible:ring-2 focus-visible:ring-[var(--remi-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
            : `remi-chat-scroll-fade pointer-events-auto flex flex-col gap-1.5 overflow-y-auto px-3 pb-3 pt-2 outline-none md:flex-1 md:gap-2 md:px-4 md:pb-4 md:pt-4 focus-visible:ring-2 focus-visible:ring-[var(--remi-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent ${
                immersive
                  ? "max-h-none min-h-0 flex-1"
                  : "max-h-[min(34svh,19rem)] min-[480px]:max-h-[min(36svh,20rem)] md:max-h-none"
              }`
        }
      >
        {loadingMoreHistory ? (
          <div className="flex justify-center px-1 pb-1">
            <div className="rounded-full border border-[#3b1a6e]/25 bg-black/16 px-2.5 py-1 text-[10px] text-[#c4b5fd] backdrop-blur-md">
              正在加载更早的记录…
            </div>
          </div>
        ) : null}
        {statusLabel ? (
          <div className="flex justify-start px-1 pb-1">
            <div
              role="status"
              data-chat-status-phase={effectivePhase ?? ""}
              className={`rounded-full border px-2.5 py-1 text-[10px] backdrop-blur-md ${statusClass} ${statusMotionClass}`}
            >
              {statusLabel}
            </div>
          </div>
        ) : null}
        {phaseCue && !showPreparingBubble ? (
          <div className="flex justify-start px-1">
            <div
              data-chat-stream-phase={
                effectivePhase === "yield"
                  ? "yield"
                  : effectivePhase === "speaking_prepare"
                    ? "preparing"
                    : effectivePhase === "speaking_active"
                      ? "speaking_active"
                    : effectivePhase === "speaking_tail"
                      ? "settling"
                  : effectivePhase ?? "idle"
              }
              className={`rounded-[1rem] border px-2.5 py-1.5 text-[11px] font-medium backdrop-blur-md transition-all ${phaseCueClass} ${showThinkingPulse || showListeningPulse || showYieldClamp ? "animate-pulse" : ""}`}
            >
              {phaseCue}
            </div>
          </div>
        ) : null}
        {messages.map((m) => (
          <MessageBubble key={m.id} role={m.role} wide={immersive} imageUrl={m.imageUrl}>
            {m.text}
          </MessageBubble>
        ))}
        {effectivePartialText ? (
          <MessageBubble role="partial" wide={immersive}>
            {effectivePartialText}
          </MessageBubble>
        ) : null}
        {showPreparingBubble ? (
          <div
            data-chat-stream-phase={
              displayPhase === "speaking_prepare" ? "preparing" : "thinking"
            }
            className="remi-thinking-bubble"
          >
            <MessageBubble role="rem" wide={immersive}>
              <span className="inline-flex items-center gap-1">
                {displayPhase === "speaking_prepare" ? "正在起句" : "正在回复"}
                <span
                  className="inline-flex items-center gap-0.5 pl-0.5"
                  aria-hidden="true"
                >
                  <span className="remi-typing-dot inline-block h-1 w-1 rounded-full bg-current opacity-70" />
                  <span className="remi-typing-dot inline-block h-1 w-1 rounded-full bg-current opacity-70" />
                  <span className="remi-typing-dot inline-block h-1 w-1 rounded-full bg-current opacity-70" />
                </span>
              </span>
            </MessageBubble>
          </div>
        ) : null}
        {visibleStreamingText ? (
          <div
            data-chat-stream-phase={bubbleTone}
            className="transition-transform duration-150"
            style={streamingBubbleStyle}
          >
            <MessageBubble role="rem" wide={immersive}>
              {visibleStreamingText}
            </MessageBubble>
          </div>
        ) : null}
        {!visibleStreamingText && showTailSettle ? (
          <div data-chat-stream-phase="settling" className="opacity-80">
            <MessageBubble role="rem" wide={immersive}>
              …
            </MessageBubble>
          </div>
        ) : null}
      </div>
    </section>
  );
}
