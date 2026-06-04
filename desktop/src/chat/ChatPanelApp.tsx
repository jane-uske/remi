import { useMemo } from "react";
import {
  RemiAuthProvider,
  openDesktopSignIn,
  useRemiWebAuth,
} from "../shared/DesktopAuthProvider";
import { useRemiChat } from "@/hooks/useRemiChat";
import { ChatWindow } from "@/components/ChatWindow";
import { InputBar } from "@/components/InputBar";
import { selectChatWindowStatus } from "@/runtime/remiRuntimeSelectors";

export function ChatPanelApp() {
  return (
    <RemiAuthProvider>
      <ChatPanel />
    </RemiAuthProvider>
  );
}

function SignInPrompt() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-sm" style={{ color: "var(--remi-dim, #94a3b8)" }}>
        登录后即可在这台电脑上同步你的 Remi 与记忆。
      </p>
      <button
        type="button"
        onClick={() => void openDesktopSignIn()}
        className="rounded-md px-4 py-2 text-sm font-medium"
        style={{ background: "#2dd4bf", color: "#04141a" }}
      >
        用邮箱登录
      </button>
    </div>
  );
}

function ChatPanel() {
  const auth = useRemiWebAuth();
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
  const showSignIn = auth.ready && !auth.signedIn;

  return (
    <div
      className="flex h-screen flex-col"
      style={{
        background: "rgba(5, 10, 16, 0.78)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
      }}
    >
      {/* Status bar */}
      <header className="flex shrink-0 items-center gap-2 border-b px-4 py-2" style={{ borderColor: "var(--remi-border, #1e293b)" }}>
        <span
          className="h-2 w-2 rounded-full"
          style={{ background: connected ? "#2dd4bf" : "#64748b" }}
        />
        <span className="text-xs" style={{ color: "var(--remi-dim, #94a3b8)" }}>
          {showSignIn
            ? "未登录"
            : connected
              ? "Remi Online"
              : connectionPhase === "connecting"
                ? "Connecting..."
                : "Offline"}
        </span>
      </header>

      {showSignIn ? (
        <SignInPrompt />
      ) : (
        <>
          {/* Messages */}
          <div className="flex min-h-0 flex-1 flex-col">
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
        </>
      )}
    </div>
  );
}
