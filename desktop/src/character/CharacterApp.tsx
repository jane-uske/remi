import { useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RemiAuthProvider } from "../shared/DesktopAuthProvider";
import { CharacterStage } from "@/components/CharacterStage";
import { useRemiChat } from "@/hooks/useRemiChat";
import { selectChatWindowStatus } from "@/runtime/remiRuntimeSelectors";

export function CharacterApp() {
  const chat = useRemiChat();
  const {
    emotion,
    runtimeState,
    avatarIntent,
    avatarFrame,
    lipSignalRef,
  } = chat;

  const handleClick = async () => {
    await invoke("toggle_chat_panel");
  };

  return (
    <RemiAuthProvider>
      <div
        data-tauri-drag-region
        onClick={handleClick}
        style={{
          width: "100vw",
          height: "100vh",
          cursor: "pointer",
          background: "transparent",
        }}
      >
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
        />
      </div>
    </RemiAuthProvider>
  );
}
