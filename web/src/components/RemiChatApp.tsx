"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { AvatarDevtoolsPanel } from "@/components/AvatarDevtoolsPanel";
import { ChatWindow } from "@/components/ChatWindow";
import { InputBar } from "@/components/InputBar";
import { VoiceIndicator } from "@/components/VoiceIndicator";
import { useRemiChat, type RemiConnectionPhase } from "@/hooks/useRemiChat";
import { getEmotionLabel } from "@/lib/emotionLabels";
import type { RemiState, RemiTurnState } from "@/types/avatar";

const Remi3DAvatar = dynamic(
  () => import("@/components/Remi3DAvatar").then((m) => m.Remi3DAvatar),
  {
    ssr: false,
    loading: () => (
      <div
        className="flex min-h-[240px] w-full flex-1 items-center justify-center rounded-2xl border border-white/10 bg-black/20 text-sm text-[var(--remi-dim)] backdrop-blur-md"
        aria-hidden
      >
        3D 加载中…
      </div>
    ),
  },
);

function remiConnectionStatusText(
  phase: RemiConnectionPhase,
  reconnectInSec: number | null,
): string {
  switch (phase) {
    case "connecting":
      return "正在连接服务器…";
    case "open":
      return "已连接";
    case "closed":
      if (reconnectInSec != null && reconnectInSec > 0) {
        return `已断开，约 ${reconnectInSec} 秒后重连`;
      }
      if (reconnectInSec === 0) {
        return "正在重新连接…";
      }
      return "已断开";
  }
}

function remiConnectionDotClass(
  phase: RemiConnectionPhase,
  reconnectInSec: number | null,
): string {
  const base = "h-2 w-2 shrink-0 rounded-full";
  switch (phase) {
    case "connecting":
      return `${base} bg-sky-400`;
    case "open":
      return `${base} bg-[var(--remi-accent)]`;
    case "closed":
      if (reconnectInSec != null) {
        return `${base} bg-amber-400`;
      }
      return `${base} bg-[var(--remi-dot-off)]`;
  }
}

function remiStateFromTurnState(
  turnState: RemiTurnState,
  voiceActive: boolean,
  busy: boolean,
): RemiState {
  switch (turnState) {
    case "listening_active":
    case "listening_hold":
      return "listening";
    case "assistant_speaking":
      return "speaking";
    case "likely_end":
    case "confirmed_end":
    case "assistant_entering":
    case "interrupted_by_user":
      return busy ? "thinking" : "idle";
    default:
      return voiceActive ? "speaking" : "idle";
  }
}

export function RemiChatApp() {
  const {
    emotion,
    avatarFrame,
    avatarIntent,
    connected,
    connectionPhase,
    reconnectInSec,
    messages,
    turnState,
    sttPartialText,
    streamingText,
    typing,
    listeningHint,
    thinkingHint,
    waiting,
    avatarAction,
    inputPlaceholder,
    recording,
    userSpeaking,
    voiceActive,
    lipSignalRef,
    hasMic,
    sendText,
    toggleMic,
  } = useRemiChat();
  const [showDevtools, setShowDevtools] = useState(false);
  const remiState: RemiState =
    userSpeaking || recording
      ? "listening"
      : remiStateFromTurnState(turnState, voiceActive, typing || waiting);

  const inputDisabled = !connected || recording;
  const micDisabled = !connected || !hasMic;

  const connectionStatusLabel = remiConnectionStatusText(
    connectionPhase,
    reconnectInSec,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const query = new URLSearchParams(window.location.search);
    const enabled =
      query.get("remDevtools") === "1" ||
      query.get("avatarDevtools") === "1" ||
      process.env.NEXT_PUBLIC_REM_DEVTOOLS === "1";
    setShowDevtools(enabled);
  }, []);

  return (
    <div className="remi-app-shell relative flex h-svh min-h-0 w-full flex-col overflow-hidden bg-transparent text-[var(--foreground)]">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row">
        <section className="remi-stage relative flex min-h-[30vh] min-w-0 flex-[1.15] flex-col lg:min-h-0 lg:flex-1">
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            <Remi3DAvatar
              emotion={emotion}
              remiState={remiState}
              turnState={turnState}
              avatarIntent={avatarIntent}
              avatarFrame={avatarFrame}
              actionSignal={avatarAction}
              lipSignalRef={lipSignalRef}
              variant="stage"
              className="min-h-0 min-w-0 flex-1"
            />
            <div className="pointer-events-none absolute left-4 top-[calc(4.25rem+env(safe-area-inset-top))] sm:left-6">
              <div className="pointer-events-auto">
                <VoiceIndicator active={voiceActive} />
              </div>
            </div>
          </div>
        </section>

        <aside className="remi-chat-panel remi-glass-edge flex min-h-0 w-full min-w-0 flex-1 flex-col border-t lg:w-[min(100%,clamp(320px,42vw,440px))] lg:max-w-[min(100%,440px)] lg:flex-none lg:border-l lg:border-t-0 lg:pt-14">
          <ChatWindow
            messages={messages}
            sttPartialText={sttPartialText}
            streamingText={streamingText}
            listeningHint={listeningHint}
            thinkingHint={thinkingHint}
            turnState={turnState}
          />
          <div className="shrink-0 border-t border-white/10 bg-transparent p-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4 dark:border-white/5">
            <InputBar
              onSend={sendText}
              onMicToggle={toggleMic}
              disabled={inputDisabled}
              micDisabled={micDisabled}
              recording={recording}
              placeholder={inputPlaceholder}
            />
          </div>
        </aside>
      </div>

      <header className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-2 bg-transparent px-3 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:gap-4 sm:px-6">
        <div className="pointer-events-auto flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--remi-accent)] to-[var(--remi-accent-dim)] text-sm font-bold text-[#042f2e] shadow-lg shadow-teal-500/25 ring-1 ring-white/20">
            R
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-semibold tracking-tight text-[var(--foreground)]">
              Remi
            </h1>
            <p className="text-[11px] text-[var(--remi-dim)]">
              AI 陪伴
              <span className="font-medium text-[var(--remi-accent)]">
                {" "}
                · {getEmotionLabel(emotion)}
              </span>
            </p>
          </div>
        </div>
        <div
          className="pointer-events-auto flex min-w-0 max-w-[min(100%,min(14rem,45vw))] shrink items-center gap-2 rounded-full bg-transparent px-2 py-1.5 text-xs text-[var(--remi-dim)] sm:max-w-none sm:px-3"
          aria-live="polite"
          aria-atomic="true"
        >
          <span
            className={remiConnectionDotClass(connectionPhase, reconnectInSec)}
            aria-hidden
          />
          <span className="truncate">{connectionStatusLabel}</span>
        </div>
      </header>

      {showDevtools ? (
        <AvatarDevtoolsPanel
          title="Avatar DevTools"
          className="max-h-[80vh] w-[min(92vw,28rem)]"
          draggable
          onClose={() => setShowDevtools(false)}
        />
      ) : null}
    </div>
  );
}
