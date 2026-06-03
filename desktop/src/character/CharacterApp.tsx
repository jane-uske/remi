import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { RemiAuthProvider } from "../shared/DesktopAuthProvider";
import { CharacterStage } from "@/components/CharacterStage";
import { useRemiChat } from "@/hooks/useRemiChat";

export function CharacterApp() {
  const chat = useRemiChat();
  const {
    emotion,
    runtimeState,
    avatarIntent,
    avatarFrame,
    lipSignalRef,
  } = chat;

  const handleClick = useCallback(async () => {
    await invoke("toggle_chat_panel");
  }, []);

  const handleDrag = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    await getCurrentWindow().startDragging();
  }, []);

  return (
    <RemiAuthProvider>
      <div style={{ width: "100vw", height: "100vh", background: "transparent", position: "relative" }}>
        {/* Top drag handle — hold to move window */}
        <div
          onMouseDown={handleDrag}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 28,
            cursor: "grab",
            zIndex: 10,
          }}
        />
        {/* Click area — opens chat panel */}
        <div
          onClick={handleClick}
          style={{ width: "100%", height: "100%", cursor: "pointer" }}
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
      </div>
    </RemiAuthProvider>
  );
}
