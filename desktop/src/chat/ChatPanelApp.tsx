import { useMemo } from "react";
import { RemiAuthProvider } from "../shared/DesktopAuthProvider";
import { useRemiChat } from "@/hooks/useRemiChat";
import { ChatWindow } from "@/components/ChatWindow";
import { InputBar } from "@/components/InputBar";
import { selectChatWindowStatus } from "@/runtime/remiRuntimeSelectors";

export function ChatPanelApp() {
  const chat = useRemiChat();
  const {
    connected,
    connectionPhase,
    messages,
    historyHasMore,
    historyLoadingMore,
    historyMutation,
    historyMutationNonce,
    loadMoreHistory,
    sttPartialText,
    streamingText,
    runtimeState,
    sendText,
    toggleMic,
    hasMic,
    inputPlaceholder,
  } = chat;

  const chatWindowStatus = useMemo(
    () => selectChatWindowStatus(runtimeState),
    [runtimeState],
  );

  const inputDisabled = !connected || runtimeState.user.recording;
  const micDisabled = !connected || !hasMic;

  return (
    <RemiAuthProvider>
      <div className="flex h-screen flex-col" style={{ background: "var(--remi-body-bg, #050a10)" }}>
        {/* Status bar */}
        <header className="flex shrink-0 items-center gap-2 border-b px-4 py-2" style={{ borderColor: "var(--remi-border, #1e293b)" }}>
          <span
            className="h-2 w-2 rounded-full"
            style={{ background: connected ? "#2dd4bf" : "#64748b" }}
          />
          <span className="text-xs" style={{ color: "var(--remi-dim, #94a3b8)" }}>
            {connected ? "Remi Online" : connectionPhase === "connecting" ? "Connecting..." : "Offline"}
          </span>
        </header>

        {/* Messages */}
        <div className="min-h-0 flex-1">
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
        </div>

        {/* Input */}
        <div className="shrink-0 border-t p-3" style={{ borderColor: "var(--remi-border, #1e293b)" }}>
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
    </RemiAuthProvider>
  );
}
