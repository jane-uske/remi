"use client";

import { useEffect, useMemo, useState } from "react";
import { RemiAccountMenu } from "@/components/RemiAccountMenu";
import { AvatarDevtoolsPanel } from "@/components/AvatarDevtoolsPanel";
import { ChatWindow } from "@/components/ChatWindow";
import { InputBar } from "@/components/InputBar";
import { PresetControlPanel } from "@/components/PresetControlPanel";
import { RemiPortraitAvatar } from "@/components/RemiPortraitAvatar";
import { VoiceIndicator } from "@/components/VoiceIndicator";
import { useRemiWebAuth } from "@/components/RemiAuthProvider";
import { useRemiChat, type RemiConnectionPhase } from "@/hooks/useRemiChat";
import { getEmotionLabel } from "@/lib/emotionLabels";
import {
  selectChatWindowStatus,
  selectVoiceIndicatorModel,
} from "@/runtime/remiRuntimeSelectors";

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

export function RemiChatApp() {
  const remiAuth = useRemiWebAuth();
  const {
    emotion,
    avatarFrame,
    avatarIntent,
    connected,
    connectionPhase,
    reconnectInSec,
    messages,
    historyHasMore,
    historyLoadingMore,
    historyMutation,
    historyMutationNonce,
    sttPartialText,
    streamingText,
    runtimeState,
    avatarRenderModel,
    inputPlaceholder,
    lipSignalRef,
    hasMic,
    isDefaultDevUser,
    currentUserId,
    wsTargetLabel,
    sendText,
    loadMoreHistory,
    applyDevPreset,
    applyDevVolcVoiceType,
    resetDevState,
    devStatus,
    devCommandPending,
    toggleMic,
  } = useRemiChat();
  const [showDevtools, setShowDevtools] = useState(false);

  const chatWindowStatus = useMemo(
    () => selectChatWindowStatus(runtimeState),
    [runtimeState],
  );
  const voiceIndicatorModel = useMemo(
    () => selectVoiceIndicatorModel(runtimeState),
    [runtimeState],
  );

  const inputDisabled = !connected || runtimeState.user.recording;
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

  const heroPrompt = avatarRenderModel.companionLine;

  return (
    <div className="remi-app-shell remi-airi-app relative min-h-svh w-full overflow-hidden text-[var(--foreground)]">
      <header className="relative z-20 bg-[#0a6078] px-4 pb-8 pt-4 shadow-[0_10px_30px_rgba(0,0,0,0.18)] sm:px-6 sm:pt-5">
        <div className="mx-auto flex max-w-[118rem] items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-white/25 bg-[linear-gradient(180deg,rgba(232,252,255,0.98),rgba(201,242,247,0.72))] text-lg font-bold tracking-[0.18em] text-[#0a4353] shadow-[0_12px_26px_rgba(4,33,41,0.2)]">
              R
            </div>
            <div className="min-w-0">
              <div className="truncate text-xl font-semibold tracking-[0.08em] text-white">
                Remi
              </div>
              <div className="truncate text-[11px] uppercase tracking-[0.22em] text-[#caedf4]">
                anime companion · {getEmotionLabel(emotion)}
              </div>
            </div>
          </div>

          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <div
              className="flex min-w-0 max-w-[min(100%,15rem)] shrink items-center gap-2 rounded-full border border-black/15 bg-[rgba(8,63,77,0.82)] px-3 py-2 text-xs text-[#d2eef3] shadow-lg shadow-black/10 backdrop-blur-md sm:max-w-none"
              aria-live="polite"
              aria-atomic="true"
            >
              <span
                className={remiConnectionDotClass(connectionPhase, reconnectInSec)}
                aria-hidden
              />
              <span className="truncate">{connectionStatusLabel}</span>
            </div>

            <RemiAccountMenu
              emotionLabel={getEmotionLabel(emotion)}
              currentUserId={currentUserId}
              isDefaultDevUser={isDefaultDevUser}
              wsTargetLabel={wsTargetLabel}
              canSignOut={remiAuth.canSignOut}
              onSignOut={remiAuth.signOut}
            />
          </div>
        </div>

        <svg
          className="pointer-events-none absolute inset-x-0 -bottom-px h-10 w-full text-[#0a6078] sm:h-12"
          viewBox="0 0 1440 140"
          preserveAspectRatio="none"
          aria-hidden
        >
          <path
            fill="currentColor"
            d="M0,54 C72,92 144,92 216,54 C288,16 360,16 432,54 C504,92 576,92 648,54 C720,16 792,16 864,54 C936,92 1008,92 1080,54 C1152,16 1224,16 1296,54 C1368,92 1420,92 1440,72 L1440,0 L0,0 Z"
          />
        </svg>
      </header>

      <main className="relative z-10 flex min-h-[calc(100svh-5.5rem)] flex-col lg:min-h-[calc(100svh-6.25rem)] lg:flex-row">
        <div className="remi-stage-grid pointer-events-none absolute inset-0 opacity-50" />

        <section className="relative flex min-h-[20rem] flex-1 items-center justify-center overflow-hidden px-3 pb-6 pt-6 sm:px-6 lg:px-10 lg:pb-10 lg:pt-8">
          <div className="pointer-events-none absolute inset-x-[10%] bottom-4 h-20 rounded-[50%] bg-[radial-gradient(circle,rgba(45,212,191,0.18),transparent_72%)] blur-3xl" />

          {isDefaultDevUser ? (
            <div className="absolute left-3 top-3 z-20 max-w-[22rem] sm:left-5 sm:top-5">
              <PresetControlPanel
                connected={connected}
                onApply={applyDevPreset}
                onApplyVolcVoiceType={applyDevVolcVoiceType}
                onReset={resetDevState}
                devStatus={devStatus}
                busy={devCommandPending}
              />
            </div>
          ) : null}

          <div className="absolute bottom-4 left-3 z-20 sm:bottom-5 sm:left-5">
            <VoiceIndicator model={voiceIndicatorModel} />
          </div>

          <RemiPortraitAvatar
            emotion={emotion}
            turnState={runtimeState.turn.serverState ?? "confirmed_end"}
            avatarIntent={avatarIntent}
            avatarFrame={avatarFrame}
            voiceActive={runtimeState.assistant.playbackActive}
            busy={runtimeState.phase === "thinking"}
            userSpeaking={runtimeState.user.speaking}
            recording={runtimeState.user.recording}
            lipSignalRef={lipSignalRef}
            runtimeState={runtimeState}
            renderModel={avatarRenderModel}
            className="min-h-0 min-w-0 flex-1"
          />
        </section>

        <aside className="relative z-20 flex w-full shrink-0 px-3 pb-4 sm:px-5 lg:w-[min(34rem,35vw)] lg:px-0 lg:pb-6 lg:pr-6 lg:pt-7">
          <section className="flex min-h-[24rem] w-full flex-col overflow-hidden rounded-[1.9rem] border border-[#0f7287]/55 bg-[linear-gradient(180deg,rgba(2,66,82,0.96),rgba(3,84,104,0.9))] shadow-[0_30px_90px_rgba(0,0,0,0.32)] backdrop-blur-xl lg:h-[calc(100svh-8.5rem)]">
            <div className="shrink-0 px-4 pt-4 sm:px-5">
              <div className="rounded-[1.35rem] border border-[#0f7287]/35 bg-[rgba(5,83,103,0.84)] px-4 py-3 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <div className="text-[11px] uppercase tracking-[0.22em] text-[#9fd1db]">
                  Remi
                </div>
                <div className="mt-1 text-[15px] font-medium leading-7 text-[#eefcff]">
                  {heroPrompt}
                </div>
              </div>
            </div>

            <ChatWindow
              messages={messages}
              hasMoreHistory={historyHasMore}
              loadingMoreHistory={historyLoadingMore}
              onLoadMore={loadMoreHistory}
              listMutation={historyMutation}
              listMutationNonce={historyMutationNonce}
              sttPartialText={sttPartialText}
              streamingText={streamingText}
              statusModel={chatWindowStatus}
            />

            <div className="sticky bottom-0 z-10 shrink-0 border-t border-[#0f7287]/28 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.04))] px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-5">
              <InputBar
                onSend={sendText}
                onMicToggle={toggleMic}
                disabled={inputDisabled}
                micDisabled={micDisabled}
                recording={runtimeState.user.recording}
                placeholder={inputPlaceholder}
              />
            </div>
          </section>
        </aside>
      </main>

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
