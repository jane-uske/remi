"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/types/chat";
import {
  loadPersistedMessages,
  MESSAGE_STORAGE_MAX,
  resolveLegacyMessageStorageKey,
  uid,
} from "@/hooks/useRemiChatHelpers";

const INITIAL_HISTORY_DISPLAY_LIMIT = 15;
const STT_USER_MERGE_WINDOW_MS = 2200;

type HistoryListMutation = "idle" | "replace" | "prepend" | "append";

type HistoryCursor = {
  id: string;
  createdAt: string;
};

export type UseRemiMessagesReturn = {
  historyMessages: ChatMessage[];
  liveMessages: ChatMessage[];
  messagesHydrated: boolean;
  historyHasMore: boolean;
  historyLoadingMore: boolean;
  historyMutationNonce: number;
  historyMutation: HistoryListMutation;
  persistedMessagesRef: React.MutableRefObject<ChatMessage[]>;
  historyCursorRef: React.MutableRefObject<HistoryCursor | null>;
  historyLoadingMoreRef: React.MutableRefObject<boolean>;
  historySourceRef: React.MutableRefObject<"fallback" | "server">;
  lastUserTranscriptAtRef: React.MutableRefObject<number>;
  appendLiveMessage: (message: ChatMessage) => void;
  appendUserTranscript: (content: string) => void;
  markHistoryMutation: (kind: HistoryListMutation) => void;
  loadMoreHistory: (options: {
    wsRef: React.MutableRefObject<WebSocket | null>;
    historyHasMore: boolean;
    historyMessages: ChatMessage[];
  }) => void;
  setHistoryMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setLiveMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setHistoryHasMore: React.Dispatch<React.SetStateAction<boolean>>;
  setHistoryLoadingMore: React.Dispatch<React.SetStateAction<boolean>>;
  setHistoryLoadingMoreState: (v: boolean) => void;
};

export function useRemiMessages(messageStorageKey: string): UseRemiMessagesReturn {
  const [historyMessages, setHistoryMessages] = useState<ChatMessage[]>([]);
  const [liveMessages, setLiveMessages] = useState<ChatMessage[]>([]);
  const [messagesHydrated, setMessagesHydrated] = useState(false);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [historyMutationNonce, setHistoryMutationNonce] = useState(0);
  const [historyMutation, setHistoryMutation] = useState<HistoryListMutation>("idle");

  const persistedMessagesRef = useRef<ChatMessage[]>([]);
  const historyCursorRef = useRef<HistoryCursor | null>(null);
  const historyLoadingMoreRef = useRef(false);
  const historySourceRef = useRef<"fallback" | "server">("fallback");
  const lastUserTranscriptAtRef = useRef(0);

  const markHistoryMutation = useCallback((kind: HistoryListMutation) => {
    setHistoryMutation(kind);
    setHistoryMutationNonce((n) => n + 1);
  }, []);

  const appendLiveMessage = useCallback(
    (message: ChatMessage) => {
      markHistoryMutation("append");
      setLiveMessages((current) => [...current, message]);
    },
    [markHistoryMutation],
  );

  const appendUserTranscript = useCallback(
    (content: string) => {
      const trimmed = content.trim();
      if (!trimmed) return;
      const now = Date.now();
      setLiveMessages((prev) => {
        const last = prev[prev.length - 1];
        if (
          last?.role === "user" &&
          now - lastUserTranscriptAtRef.current <= STT_USER_MERGE_WINDOW_MS
        ) {
          // Import mergeTranscriptTexts inline to avoid circular deps
          const a = last.text.trim();
          const b = trimmed;
          if (a && b) {
            const normalize = (text: string) =>
              text.replace(/\s+/g, "").replace(/[，。！？,.!?、；;:"""'`~·\-]/g, "");
            const na = normalize(a);
            const nb = normalize(b);
            let merged: string | null = null;
            if (na && nb) {
              if (na === nb) merged = b.length >= a.length ? b : a;
              else if (nb.startsWith(na)) merged = b;
              else if (na.startsWith(nb)) merged = a;
            }
            if (merged) {
              const next = [...prev];
              next[next.length - 1] = { ...last, text: merged };
              lastUserTranscriptAtRef.current = now;
              return next;
            }
          }
        }
        return [
          ...prev,
          { id: uid(), role: "user", text: trimmed, createdAt: new Date(now).toISOString() },
        ];
      });
      markHistoryMutation("append");
      lastUserTranscriptAtRef.current = now;
    },
    [markHistoryMutation],
  );

  // localStorage hydrate
  useEffect(() => {
    if (typeof window === "undefined") return;
    const persisted = loadPersistedMessages(messageStorageKey);
    persistedMessagesRef.current = persisted;
    const initialHistory = persisted.slice(-INITIAL_HISTORY_DISPLAY_LIMIT);
    historySourceRef.current = "fallback";
    historyCursorRef.current = null;
    historyLoadingMoreRef.current = false;
    setHistoryLoadingMore(false);
    setHistoryHasMore(persisted.length > initialHistory.length);
    setHistoryMessages(initialHistory);
    setLiveMessages([]);
    markHistoryMutation("replace");
    setMessagesHydrated(true);
  }, [markHistoryMutation, messageStorageKey]);

  // localStorage persist
  useEffect(() => {
    if (!messagesHydrated || typeof window === "undefined") return;
    const visibleLive = liveMessages.filter((m) => m.role === "user" || m.role === "rem");
    const baseHistory =
      historySourceRef.current === "fallback"
        ? persistedMessagesRef.current
        : historyMessages.filter((m) => m.role === "user" || m.role === "rem");
    const persist = [...baseHistory, ...visibleLive]
      .filter((message, index, all) => all.findIndex((item) => item.id === message.id) === index)
      .slice(-MESSAGE_STORAGE_MAX);
    persistedMessagesRef.current = persist;
    try {
      localStorage.setItem(messageStorageKey, JSON.stringify(persist));
    } catch {
      /* quota or private mode */
    }
  }, [historyMessages, liveMessages, messagesHydrated, messageStorageKey]);

  const setHistoryLoadingMoreState = useCallback((v: boolean) => {
    historyLoadingMoreRef.current = v;
    setHistoryLoadingMore(v);
  }, []);

  const loadMoreHistory = useCallback(
    (options: {
      wsRef: React.MutableRefObject<WebSocket | null>;
      historyHasMore: boolean;
      historyMessages: ChatMessage[];
    }) => {
      if (historyLoadingMoreRef.current) return;
      if (historySourceRef.current === "server") {
        if (!options.historyHasMore || !historyCursorRef.current) return;
        const ws = options.wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        historyLoadingMoreRef.current = true;
        setHistoryLoadingMore(true);
        ws.send(JSON.stringify({ type: "history_more", cursor: historyCursorRef.current }));
        return;
      }

      const persisted = persistedMessagesRef.current;
      if (persisted.length <= options.historyMessages.length) {
        setHistoryHasMore(false);
        return;
      }
      historyLoadingMoreRef.current = true;
      setHistoryLoadingMore(true);
      const nextCount = Math.min(
        persisted.length,
        options.historyMessages.length + INITIAL_HISTORY_DISPLAY_LIMIT,
      );
      const nextHistory = persisted.slice(-nextCount);
      setHistoryMessages(nextHistory);
      setHistoryHasMore(persisted.length > nextCount);
      setHistoryLoadingMore(false);
      historyLoadingMoreRef.current = false;
      markHistoryMutation("prepend");
    },
    [markHistoryMutation],
  );

  return {
    historyMessages,
    liveMessages,
    messagesHydrated,
    historyHasMore,
    historyLoadingMore,
    historyMutationNonce,
    historyMutation,
    persistedMessagesRef,
    historyCursorRef,
    historyLoadingMoreRef,
    historySourceRef,
    lastUserTranscriptAtRef,
    appendLiveMessage,
    appendUserTranscript,
    markHistoryMutation,
    loadMoreHistory,
    setHistoryMessages,
    setLiveMessages,
    setHistoryHasMore,
    setHistoryLoadingMore,
    setHistoryLoadingMoreState,
  };
}
