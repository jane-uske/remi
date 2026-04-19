"use client";

import { useEffect, useMemo, useState } from "react";
import { RemiAccountMenu } from "@/components/RemiAccountMenu";
import { RemiIdentityAvatar } from "@/components/RemiIdentityAvatar";
import { AvatarDevtoolsPanel } from "@/components/AvatarDevtoolsPanel";
import { CharacterStage } from "@/components/CharacterStage";
import { ChatWindow } from "@/components/ChatWindow";
import { InputBar } from "@/components/InputBar";
import { PresetControlPanel } from "@/components/PresetControlPanel";
import { VoiceIndicator } from "@/components/VoiceIndicator";
import { useRemiWebAuth } from "@/components/RemiAuthProvider";
import { remiChatLayoutClasses } from "@/components/remiChatLayout";
import { useRemiChat, type RemiConnectionPhase } from "@/hooks/useRemiChat";
import { getEmotionLabel } from "@/lib/emotionLabels";
import {
  buildConversationPerformanceModel,
  createDefaultConversationPresenceFixture,
} from "@/lib/presence/conversationPerformanceModel";
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
    personaPreset,
    runtimeState,
    avatarRenderModel,
    inputPlaceholder,
    lipSignalRef,
    hasMic,
    isDefaultDevUser,
    currentUserId,
    wsTargetLabel,
    sendText,
    updatePersonaPreset,
    loadMoreHistory,
    applyDevPreset,
    applyDevVolcVoiceType,
    resetDevState,
    devStatus,
    devCommandPending,
    toggleMic,
  } = useRemiChat();
  const [showDevtools, setShowDevtools] = useState(false);
  const [showPresetPanel, setShowPresetPanel] = useState(false);
  const [presenceFixture, setPresenceFixture] = useState(
    createDefaultConversationPresenceFixture,
  );

  const chatWindowStatus = useMemo(
    () => selectChatWindowStatus(runtimeState),
    [runtimeState],
  );
  const voiceIndicatorModel = useMemo(
    () => selectVoiceIndicatorModel(runtimeState),
    [runtimeState],
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

  const inputDisabled = !connected || runtimeState.user.recording;
  const micDisabled = !connected || !hasMic;
  const connectionStatusLabel = remiConnectionStatusText(connectionPhase, reconnectInSec);
  const connectionCompactLabel = remiConnectionCompactText(
    connectionPhase,
    reconnectInSec,
  );
  const emotionLabel = getEmotionLabel(emotion);

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
    <div className={remiChatLayoutClasses.appShell}>
      <header className={remiChatLayoutClasses.headerShell}>
        <div className="pointer-events-none absolute inset-x-0 top-0 z-0 h-20 bg-[linear-gradient(180deg,rgba(33,160,191,0.16),rgba(33,160,191,0.08)_44%,transparent)] blur-2xl sm:h-24" />
        <div className={remiChatLayoutClasses.headerInner}>
          <div className="flex min-w-0 items-center gap-3">
            <RemiIdentityAvatar className="h-11 w-11 shrink-0" />
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

          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2 sm:flex-none">
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
                      onApplyVolcVoiceType={applyDevVolcVoiceType}
                      onReset={resetDevState}
                      devStatus={devStatus}
                      busy={devCommandPending}
                    />
                  </div>
                ) : null}
              </div>
            ) : null}

            <RemiAccountMenu
              emotionLabel={emotionLabel}
              currentUserId={currentUserId}
              isDefaultDevUser={isDefaultDevUser}
              wsTargetLabel={wsTargetLabel}
              personaPreset={personaPreset}
              canSignOut={remiAuth.canSignOut}
              onSignOut={remiAuth.signOut}
              onUpdatePersonaPreset={updatePersonaPreset}
            />
          </div>
        </div>
      </header>

      <main className={remiChatLayoutClasses.mainShell}>
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[22svh] bg-[linear-gradient(180deg,rgba(17,132,160,0.52),rgba(17,132,160,0.22)_62%,transparent)] [clip-path:ellipse(84%_100%_at_50%_0%)] opacity-90" />
        <div className="remi-stage-grid pointer-events-none absolute inset-0 opacity-30" />

        <section className={remiChatLayoutClasses.stageShell}>
          <div className="pointer-events-none absolute inset-x-[10%] bottom-[10%] h-24 rounded-[50%] bg-[radial-gradient(circle,rgba(116,224,238,0.18),transparent_72%)] blur-3xl md:bottom-[8%]" />

          <div className="absolute bottom-4 left-3 z-20 sm:bottom-5 sm:left-5">
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

        <aside className={remiChatLayoutClasses.chatAside}>
          <section className={remiChatLayoutClasses.chatCard}>
            <div className={remiChatLayoutClasses.chatWindowFrame}>
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
              />
            </div>

            <div className={remiChatLayoutClasses.chatComposerFrame}>
              <div className={remiChatLayoutClasses.chatComposerDock}>
                <InputBar
                  onSend={sendText}
                  onMicToggle={toggleMic}
                  disabled={inputDisabled}
                  micDisabled={micDisabled}
                  recording={runtimeState.user.recording}
                  placeholder={inputPlaceholder}
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
