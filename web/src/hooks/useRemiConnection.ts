"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRemiWebAuth } from "@/components/RemiAuthProvider";
import type { RemiConnectionPhase } from "@/hooks/useRemiChat";
import {
  buildClientContextPayload,
  INITIAL_BROWSER_IDENTITY,
  REM_WS_RECONNECT_DELAY_MS,
  resolveWsTargetLabel,
  type BrowserIdentityState,
  uid,
} from "@/hooks/useRemiChatHelpers";
import { pushAvatarDevtoolsLog } from "@/lib/rem3d/devtoolsStore";
import { getRemWsUrl } from "@/lib/wsUrl";

/** 长时间停留在 CONNECTING 则判定失败（避免 UI 永远「正在连接」） */
const WS_CONNECT_TIMEOUT_MS = 12_000;

export type UseRemiConnectionParams = {
  /** Called after ws.onopen state updates, before duplex resume */
  onOpenExtras: (ws: WebSocket) => void;
  /** Called after ws.onclose state updates */
  onCloseExtras: () => void;
  /** Called on ws.onerror (after log) */
  onErrorExtras: () => void;
  /** The actual ws.onmessage handler */
  onMessage: (ev: MessageEvent) => void;
  /** Append a live message (from messages layer) */
  appendLiveMessage: (msg: { id: string; role: string; text: string }) => void;
  /** clearGenerationState */
  clearGenerationState: () => void;
  /** clearAvatarIntentSchedule */
  clearAvatarIntentSchedule: () => void;
  /** stopVoiceSession */
  stopVoiceSession: (opts?: { preserveAutoResume?: boolean }) => void;
  /** resetStreaming */
  resetStreaming: () => void;
  /** setSttPartialText */
  setSttPartialText: (v: string | ((prev: string) => string)) => void;
  /** setSttPredictionPreview */
  setSttPredictionPreview: (v: string | null) => void;
  /** setInterruptionType */
  setInterruptionType: (v: import("@/types/avatar").InterruptionType | null) => void;
  /** setAvatarIntentOverride */
  setAvatarIntentOverride: (v: import("@/types/avatar").AvatarIntent | null) => void;
  /** setTyping */
  setTyping: (v: boolean) => void;
  /** setWaiting + ref */
  setWaitingState: (v: boolean) => void;
  /** markHistoryMutation */
  markHistoryMutation: (kind: "idle" | "replace" | "prepend" | "append") => void;
  /** setLiveMessages */
  setLiveMessages: (fn: (prev: import("@/types/chat").ChatMessage[]) => import("@/types/chat").ChatMessage[]) => void;
  /** setHistoryLoadingMore + ref */
  setHistoryLoadingMoreState: (v: boolean) => void;
  /** setDevStatus */
  setDevStatus: (v: { tone: "idle" | "pending" | "success" | "error"; message: string }) => void;
  /** pendingDevCommandRef */
  pendingDevCommandRef: React.MutableRefObject<{ kind: string; scope?: string } | null>;
  /** recordingRef */
  recordingRef: React.MutableRefObject<boolean>;
  /** duplexRef */
  duplexRef: React.MutableRefObject<boolean>;
  /** pcmRef */
  pcmRef: React.MutableRefObject<unknown>;
  /** startingDuplexRef */
  startingDuplexRef: React.MutableRefObject<boolean>;
  /** resumeDuplexAfterReconnectRef */
  resumeDuplexAfterReconnectRef: React.MutableRefObject<boolean>;
  /** sttPredictionPreviewRef */
  sttPredictionPreviewRef: React.MutableRefObject<string | null>;
  /** interruptionTypeRef */
  interruptionTypeRef: React.MutableRefObject<import("@/types/avatar").InterruptionType | null>;
  /** startDuplex */
  startDuplex: () => Promise<void>;
  /** Optional external wsRef — if provided, connection uses it instead of creating its own */
  wsRef?: React.MutableRefObject<WebSocket | null>;
};

export type UseRemiConnectionReturn = {
  connected: boolean;
  connectionPhase: RemiConnectionPhase;
  reconnectDeadline: number | null;
  connLabel: string;
  browserIdentity: BrowserIdentityState;
  wsRef: React.MutableRefObject<WebSocket | null>;
  reconnectRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  mountedRef: React.MutableRefObject<boolean>;
  suppressDisconnectSysMsgRef: React.MutableRefObject<boolean>;
  hasAnnouncedConnectedRef: React.MutableRefObject<boolean>;
  connectRef: React.MutableRefObject<() => void>;
};

export function useRemiConnection(params: UseRemiConnectionParams): UseRemiConnectionReturn {
  const [connected, setConnected] = useState(false);
  const [connectionPhase, setConnectionPhase] = useState<RemiConnectionPhase>("connecting");
  const [reconnectDeadline, setReconnectDeadline] = useState<number | null>(null);
  const [, bumpReconnectTick] = useState(0);
  const [connLabel, setConnLabel] = useState("连接中…");
  const [browserIdentity, setBrowserIdentity] =
    useState<BrowserIdentityState>(INITIAL_BROWSER_IDENTITY);

  const internalWsRef = useRef<WebSocket | null>(null);
  // If an external wsRef is provided, use it; otherwise fall back to internal.
  const wsRef = params.wsRef ?? internalWsRef;
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const suppressDisconnectSysMsgRef = useRef(false);
  const hasAnnouncedConnectedRef = useRef(false);
  const connectRef = useRef<() => void>(() => {});

  const remiAuth = useRemiWebAuth();

  // Countdown ticker effect
  useEffect(() => {
    if (reconnectDeadline == null) return;
    const id = setInterval(() => {
      bumpReconnectTick((n) => n + 1);
    }, 250);
    return () => clearInterval(id);
  }, [reconnectDeadline]);

  // browserIdentity sync effect
  useEffect(() => {
    setBrowserIdentity({
      isDefaultDevUser: remiAuth.isDefaultDevUser,
      currentUserId: remiAuth.currentUserId,
      wsTargetLabel: resolveWsTargetLabel(getRemWsUrl()),
    });
  }, [remiAuth.currentUserId, remiAuth.isDefaultDevUser]);

  // We assign connectRef.current inside the effect scope below (not a useCallback),
  // preserving the pattern from the original file.
  connectRef.current = () => {
    if (remiAuth.clerkEnabled && (!remiAuth.ready || !remiAuth.signedIn)) {
      return;
    }
    void (async () => {
      const sessionToken = await remiAuth.getSessionToken();
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current);
        reconnectRef.current = null;
      }
      setReconnectDeadline(null);
      setConnectionPhase("connecting");
      setConnLabel("连接中…");
      const url = getRemWsUrl(sessionToken);
      if (!url) {
        setConnectionPhase("closed");
        setConnLabel("无法解析 WS 地址");
        pushAvatarDevtoolsLog("system", "ws unavailable", {
          reason: "empty-url",
        });
        params.appendLiveMessage({
          id: uid(),
          role: "error",
          text: "WebSocket 地址为空（仅应在浏览器环境连接）",
        });
        return;
      }

      const ws = new WebSocket(url);
      pushAvatarDevtoolsLog("system", "ws connecting", { url });
      params.clearGenerationState();
      wsRef.current = ws;

      const connectTimer = window.setTimeout(() => {
        if (ws.readyState === WebSocket.CONNECTING) {
          suppressDisconnectSysMsgRef.current = true;
          setConnLabel("连接超时");
          params.appendLiveMessage({
            id: uid(),
            role: "error",
            text:
              "连接服务器超时。请确认已在仓库根目录运行「npm run dev」（默认端口 3000），或设置 NEXT_PUBLIC_WS_URL=ws://你的后端:端口/ws",
          });
          ws.close();
        }
      }, WS_CONNECT_TIMEOUT_MS);

      ws.onopen = () => {
        window.clearTimeout(connectTimer);
        setConnected(true);
        setConnectionPhase("open");
        setReconnectDeadline(null);
        setConnLabel("在线");
        ws.send(JSON.stringify(buildClientContextPayload()));
        pushAvatarDevtoolsLog("system", "ws open", { url });
        if (!hasAnnouncedConnectedRef.current) {
          hasAnnouncedConnectedRef.current = true;
          params.appendLiveMessage({ id: uid(), role: "sys", text: "已连接，和 Remi 聊聊吧" });
        }
        params.onOpenExtras(ws);
        if (
          params.resumeDuplexAfterReconnectRef.current &&
          !params.recordingRef.current &&
          !params.pcmRef.current &&
          !params.startingDuplexRef.current
        ) {
          void params.startDuplex();
        }
      };

      ws.onmessage = params.onMessage;

      ws.onclose = () => {
        window.clearTimeout(connectTimer);
        if (!mountedRef.current) return;
        if (params.pendingDevCommandRef.current) {
          params.pendingDevCommandRef.current = null;
          params.setDevStatus({
            tone: "error",
            message: "连接已断开，未确认刚才的开发操作是否成功",
          });
        }
        const shouldResumeDuplex = params.recordingRef.current || params.duplexRef.current;
        params.stopVoiceSession({ preserveAutoResume: shouldResumeDuplex });

        setConnected(false);
        setConnectionPhase("closed");
        setReconnectDeadline(Date.now() + REM_WS_RECONNECT_DELAY_MS);
        setConnLabel("已断开");
        params.setHistoryLoadingMoreState(false);
        params.setWaitingState(false);
        params.clearGenerationState();
        params.clearAvatarIntentSchedule();
        params.setAvatarIntentOverride(null);
        params.setSttPartialText("");
        params.sttPredictionPreviewRef.current = null;
        params.setSttPredictionPreview(null);
        params.interruptionTypeRef.current = null;
        params.setInterruptionType(null);
        params.resetStreaming();
        params.setTyping(false);
        const quiet = suppressDisconnectSysMsgRef.current;
        suppressDisconnectSysMsgRef.current = false;
        pushAvatarDevtoolsLog("system", "ws closed", {
          quiet,
          reconnectInMs: REM_WS_RECONNECT_DELAY_MS,
        });
        if (!quiet) {
          params.markHistoryMutation("append");
          params.setLiveMessages((m) => {
            const last = m[m.length - 1];
            if (last?.role === "sys" && last.text === "连接已断开，3 秒后重连…") {
              return m;
            }
            return [...m, { id: uid(), role: "sys", text: "连接已断开，3 秒后重连…" }];
          });
        }
        params.onCloseExtras();
        reconnectRef.current = setTimeout(() => {
          if (mountedRef.current) connectRef.current?.();
        }, REM_WS_RECONNECT_DELAY_MS);
      };

      ws.onerror = () => {
        window.clearTimeout(connectTimer);
        pushAvatarDevtoolsLog("system", "ws error");
        params.onErrorExtras();
      };
    })();
  };

  // Mount/connect effect
  useEffect(() => {
    mountedRef.current = true;
    connectRef.current?.();
    return () => {
      mountedRef.current = false;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Clerk auth watch effect
  useEffect(() => {
    if (!mountedRef.current) return;
    if (remiAuth.clerkEnabled && !remiAuth.ready) return;
    if (remiAuth.clerkEnabled && !remiAuth.signedIn) {
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current);
        reconnectRef.current = null;
      }
      wsRef.current?.close();
      return;
    }
    if (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED) {
      connectRef.current?.();
    }
  }, [
    remiAuth.clerkEnabled,
    remiAuth.currentUserId,
    remiAuth.ready,
    remiAuth.signedIn,
  ]);

  return {
    connected,
    connectionPhase,
    reconnectDeadline,
    connLabel,
    browserIdentity,
    wsRef,
    reconnectRef,
    mountedRef,
    suppressDisconnectSysMsgRef,
    hasAnnouncedConnectedRef,
    connectRef,
  };
}
