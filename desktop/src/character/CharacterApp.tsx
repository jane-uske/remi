import { useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { RemiAuthProvider } from "../shared/DesktopAuthProvider";
import { CharacterStage } from "@/components/CharacterStage";
import { useRemiChat } from "@/hooks/useRemiChat";

// Pointer travel (px) past which a press is treated as a drag rather than a click.
const DRAG_THRESHOLD = 4;

export function CharacterApp() {
  const chat = useRemiChat();
  const {
    emotion,
    runtimeState,
    avatarIntent,
    avatarFrame,
    lipSignalRef,
  } = chat;

  // Track a press so we can tell a click (toggle chat) from a drag (move window).
  const pressRef = useRef<{ x: number; y: number; dragging: boolean } | null>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    pressRef.current = { x: e.clientX, y: e.clientY, dragging: false };
  }, []);

  const handleMouseMove = useCallback(async (e: React.MouseEvent) => {
    const press = pressRef.current;
    if (!press || press.dragging) return;
    const moved =
      Math.abs(e.clientX - press.x) + Math.abs(e.clientY - press.y);
    if (moved > DRAG_THRESHOLD) {
      press.dragging = true;
      await getCurrentWindow().startDragging();
    }
  }, []);

  const handleClick = useCallback(async () => {
    const wasDragging = pressRef.current?.dragging ?? false;
    pressRef.current = null;
    if (wasDragging) return; // released after a drag — don't toggle
    try {
      await invoke("toggle_chat_panel");
    } catch (err) {
      console.error("[character] toggle_chat_panel failed", err);
    }
  }, []);

  return (
    <RemiAuthProvider>
      <div
        style={{
          width: "100vw",
          height: "100vh",
          background: "transparent",
          position: "relative",
          display: "flex",
        }}
      >
        {/* Whole body: drag to move the window, click to toggle the chat panel */}
        <div
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onClick={handleClick}
          style={{
            flex: 1,
            display: "flex",
            minWidth: 0,
            minHeight: 0,
            cursor: "grab",
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
      </div>
    </RemiAuthProvider>
  );
}
