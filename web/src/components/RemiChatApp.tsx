"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RemiAccountMenu } from "@/components/RemiAccountMenu";
import { AvatarDevtoolsPanel } from "@/components/AvatarDevtoolsPanel";
import { CharacterStage } from "@/components/CharacterStage";
import { ChatWindow } from "@/components/ChatWindow";
import { RemiChatComposer } from "@/components/RemiChatComposer";
import { PresetControlPanel } from "@/components/PresetControlPanel";
import { RemiMobileControlRail } from "@/components/RemiMobileControlRail";
import { VoiceIndicator } from "@/components/VoiceIndicator";

import { useRemiWebAuth } from "@/components/RemiAuthProvider";
import { remiChatLayoutForNsfw } from "@/components/remiChatLayout";
import { useVisualViewportCssVars } from "@/lib/mobile/useVisualViewportCssVars";
import { useElementHeightCssVar } from "@/lib/mobile/useElementHeightCssVar";
import { useRemiChat, type RemiConnectionPhase } from "@/hooks/useRemiChat";
import { getEmotionLabel } from "@/lib/emotionLabels";
import {
  buildConversationPerformanceModel,
  createDefaultConversationPresenceFixture,
} from "@/lib/presence/conversationPerformanceModel";
import { selectChatWindowStatus } from "@/runtime/remiRuntimeSelectors";
import { selectVoiceIndicatorFromPerformanceModel } from "@/lib/presence/conversationPerformanceModel";

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

function remiConnectionCompactText(
  phase: RemiConnectionPhase,
  reconnectInSec: number | null,
): string {
  switch (phase) {
    case "connecting":
      return "连接中";
    case "open":
      return "在线";
    case "closed":
      return reconnectInSec != null ? "重连中" : "离线";
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

export function RemiChatApp({
  onBeforeSend,
}: {
  onBeforeSend?: (text: string) => boolean;
} = {}) {
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
    typing,
    waiting,
    runtimeState,
    avatarRenderModel,
    inputPlaceholder,
    audioLocked,
    lipSignalRef,
    hasMic,
    isDefaultDevUser,
    currentUserId,
    wsTargetLabel,
    sendText,
    interruptReply,
    loadMoreHistory,
    applyDevPreset,
    resetDevState,
    devStatus,
    devCommandPending,
    toggleMic,
    unlockAudio,
    nsfwEnabled,
    setVoiceStyle,
    ttsEnabled,
    setTtsEnabled,
  } = useRemiChat();
  const [showDevtools, setShowDevtools] = useState(false);
  const [showPresetPanel, setShowPresetPanel] = useState(false);
  const [showVoiceStylePicker, setShowVoiceStylePicker] = useState(false);
  const [presenceFixture, setPresenceFixture] = useState(
    createDefaultConversationPresenceFixture,
  );

  const chatWindowStatus = useMemo(
    () => selectChatWindowStatus(runtimeState),
    [runtimeState],
  );
  const awaitingAssistantReply = useMemo(
    () =>
      (waiting || typing) && streamingText.trim().length === 0,
    [streamingText, typing, waiting],
  );
  const performanceModel = useMemo(
    () =>
      buildConversationPerformanceModel({
        runtimeState,
        renderModel: avatarRenderModel,
        streamingText,
        sttPartialText,
        fixture: presenceFixture,
      }),
    [
      avatarRenderModel,
      presenceFixture,
      runtimeState,
      sttPartialText,
      streamingText,
    ],
  );
  const voiceIndicatorModel = useMemo(
    () => selectVoiceIndicatorFromPerformanceModel(performanceModel, runtimeState),
    [performanceModel, runtimeState],
  );

  // Text chat rides SSE (HTTP POST /api/chat), which doesn't need WS.
  // Only voice (mic) and recording state gate the input; the WS connection
  // state is irrelevant for text — users can chat immediately on page load.
  const inputDisabled = runtimeState.user.recording;
  const wrappedSendText = useCallback(
    (text: string, image?: string) => {
      if (onBeforeSend && !onBeforeSend(text)) return;
      sendText(text, image);
    },
    [onBeforeSend, sendText],
  );
  const micDisabled = !connected || !hasMic;
  const connectionStatusLabel = remiConnectionStatusText(connectionPhase, reconnectInSec);
  const connectionCompactLabel = remiConnectionCompactText(
    connectionPhase,
    reconnectInSec,
  );
  const emotionLabel = getEmotionLabel(emotion);
  const layout = remiChatLayoutForNsfw(nsfwEnabled);

  // Mobile chat is a top/bottom split: the stage owns the top half and the
  // chat list owns the bottom half with its own inner overflow scroll, while
  // the composer stays in-flow pinned to the bottom. So we use the inner-scroll
  // path everywhere (no document-scroll / fixed-composer immersive mode).
  const documentScroll = false;
  const composerRef = useRef<HTMLDivElement>(null);
  useVisualViewportCssVars();
  useElementHeightCssVar(composerRef, "--remi-composer-height");

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
    <div
      className={layout.appShell}
      data-remi-nsfw={nsfwEnabled ? "1" : "0"}
    >
      <header className={layout.headerShell}>
        {/* header glow removed — body SVG background now shows through */}
        <div className={layout.headerInner}>
          <div className="flex min-w-0 items-center gap-3">
            <RemiAccountMenu
              triggerMode="avatar-only"
              emotionLabel={emotionLabel}
              currentUserId={currentUserId}
              isDefaultDevUser={isDefaultDevUser}
              wsTargetLabel={wsTargetLabel}
              personaPreset={null}
              canSignOut={remiAuth.canSignOut}
              onSignOut={remiAuth.signOut}
              onUpdatePersonaPreset={() => {}}
            />
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <div className="truncate text-lg font-semibold tracking-[0.06em] text-[var(--remi-header-title)] sm:text-xl">
                  Remi
                </div>
                <div
                  className="hidden items-center gap-1.5 rounded-full border border-[color:var(--remi-header-chip-border)] bg-[var(--remi-header-chip-bg)] px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-[var(--remi-header-chip-text)] shadow-lg shadow-black/5 backdrop-blur-md sm:inline-flex"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  <span
                    className={remiConnectionDotClass(
                      connectionPhase,
                      reconnectInSec,
                    )}
                    aria-hidden
                  />
                  <span className="truncate">{connectionCompactLabel}</span>
                </div>
                {nsfwEnabled ? (
                  <div className="inline-flex items-center rounded-full border border-rose-200/20 bg-rose-500/12 px-2.5 py-1 text-[10px] tracking-[0.12em] text-rose-100/90 shadow-lg shadow-black/5 backdrop-blur-md">
                    成人模式
                  </div>
                ) : null}
              </div>
              <div
                className="flex min-w-0 items-center gap-2 truncate text-[10px] uppercase tracking-[0.18em] text-[var(--remi-header-subtitle)] sm:text-[11px]"
                aria-live="polite"
                aria-atomic="true"
              >
                <span className="truncate">{emotionLabel}</span>
                <span className="h-1 w-1 rounded-full bg-[var(--remi-header-subtitle)]/50" />
                <span className="truncate">{connectionStatusLabel}</span>
              </div>
            </div>
          </div>

          <div className="flex min-w-0 items-center justify-end gap-2 sm:flex-none">
            {isDefaultDevUser ? (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowPresetPanel((value) => !value)}
                  className="pointer-events-auto flex h-10 items-center justify-center rounded-full border border-white/10 bg-[rgba(9,15,20,0.28)] px-3 text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--remi-header-chip-text)] shadow-lg shadow-black/5 backdrop-blur-md transition hover:bg-[rgba(9,15,20,0.38)]"
                  aria-expanded={showPresetPanel}
                >
                  Dev
                </button>
                {showPresetPanel ? (
                  <div className="pointer-events-auto absolute right-0 top-[calc(100%+0.75rem)] z-30 w-[min(92vw,22rem)]">
                    <PresetControlPanel
                      connected={connected}
                      onApply={applyDevPreset}
                      onReset={resetDevState}
                      devStatus={devStatus}
                      busy={devCommandPending}
                    />
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <main className={layout.mainShell}>
        {!nsfwEnabled ? (
          <>
            <div className="pointer-events-none fixed inset-x-0 top-0 z-0 h-[22svh] bg-[linear-gradient(180deg,rgba(139,92,246,0.48),rgba(139,92,246,0.18)_62%,transparent)] [clip-path:ellipse(84%_100%_at_50%_0%)] opacity-90 md:absolute md:z-auto" />
            <div className="remi-stage-grid pointer-events-none fixed inset-0 z-0 opacity-30 md:absolute md:z-auto" />
          </>
        ) : null}

        {!nsfwEnabled ? (
          <section className={layout.stageShell}>
            {/* stage floor glow removed — body SVG background shows through */}

            <div className={layout.mobileControlRail}>
              <RemiMobileControlRail
                recording={runtimeState.user.recording}
                performanceModel={performanceModel}
              />
            </div>

            <div className="absolute bottom-4 left-3 z-20 hidden sm:bottom-5 sm:left-5 md:block">
              <VoiceIndicator model={voiceIndicatorModel} />
            </div>

            <CharacterStage
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
              performanceModel={performanceModel}
              className="min-h-0 min-w-0 flex-1"
            />
          </section>
        ) : null}

        <aside className={layout.chatAside}>
          <section className={layout.chatCard}>
            <div className={layout.chatWindowFrame}>
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
                performanceModel={performanceModel}
                awaitingAssistantReply={awaitingAssistantReply}
                immersive={true}
                documentScroll={documentScroll}
              />
            </div>

            <div
              ref={composerRef}
              className={`${documentScroll ? "remi-mobile-composer " : ""}${layout.chatComposerFrame}`}
            >
              {audioLocked ? (
                <div className="mb-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => void unlockAudio()}
                    className="pointer-events-auto rounded-full border border-purple-200/25 bg-purple-400/12 px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-purple-50 shadow-lg shadow-black/10 transition hover:bg-purple-300/18"
                  >
                    启用声音
                  </button>
                </div>
              ) : null}
              <div className={layout.chatComposerDock}>
                <RemiChatComposer
                  onSend={wrappedSendText}
                  onStop={interruptReply}
                  isReplying={
                    typing || waiting || runtimeState.assistant.playbackActive
                  }
                  onMicToggle={toggleMic}
                  disabled={inputDisabled}
                  micDisabled={micDisabled}
                  recording={runtimeState.user.recording}
                  placeholder={inputPlaceholder}
                  setVoiceStyle={setVoiceStyle}
                  ttsEnabled={ttsEnabled}
                  onTtsEnabledChange={setTtsEnabled}
                  voiceStyleOpen={showVoiceStylePicker}
                  onVoiceStyleToggle={() =>
                    setShowVoiceStylePicker((value) => !value)
                  }
                  onVoiceStyleClose={() => setShowVoiceStylePicker(false)}
                />
              </div>
            </div>
          </section>
        </aside>
      </main>

      {showDevtools ? (
        <AvatarDevtoolsPanel
          title="Avatar DevTools"
          className="max-h-[80vh] w-[min(92vw,28rem)]"
          draggable
          performanceModel={performanceModel}
          presenceFixture={presenceFixture}
          onPresenceFixtureChange={setPresenceFixture}
          onClose={() => setShowDevtools(false)}
        />
      ) : null}
    </div>
  );
}
