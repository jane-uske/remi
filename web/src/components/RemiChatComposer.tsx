"use client";

import { useCallback, useEffect, useState } from "react";
import { InputBar, type InputBarProps } from "@/components/InputBar";
import {
  VoiceStylePicker,
  voiceStyleLabelForId,
  type VoiceStylePickerProps,
} from "@/components/VoiceStylePicker";
import {
  readStoredVoiceStyle,
  writeStoredVoiceStyle,
} from "@/hooks/useRemiChatHelpers";

export type RemiChatComposerProps = {
  onSend: InputBarProps["onSend"];
  onMicToggle: InputBarProps["onMicToggle"];
  disabled: boolean;
  micDisabled: boolean;
  recording: boolean;
  placeholder: string;
  setVoiceStyle: VoiceStylePickerProps["setVoiceStyle"];
  ttsEnabled?: boolean;
  onTtsEnabledChange?: VoiceStylePickerProps["onTtsEnabledChange"];
  voiceStyleOpen: boolean;
  onVoiceStyleToggle: () => void;
  onVoiceStyleClose: () => void;
  isReplying?: InputBarProps["isReplying"];
  onStop?: InputBarProps["onStop"];
};

export function RemiChatComposer({
  onSend,
  onMicToggle,
  disabled,
  micDisabled,
  recording,
  placeholder,
  setVoiceStyle,
  ttsEnabled = true,
  onTtsEnabledChange,
  voiceStyleOpen,
  onVoiceStyleToggle,
  onVoiceStyleClose,
  isReplying,
  onStop,
}: RemiChatComposerProps) {
  // SSR-safe voice style: render "default" on both server and first client
  // frame (avoid hydration mismatch from reading localStorage during render),
  // then hydrate the persisted value after mount.
  const [activePresetId, setActivePresetId] = useState("default");
  useEffect(() => {
    setActivePresetId(readStoredVoiceStyle());
  }, []);

  const handlePresetChange = useCallback((id: string) => {
    setActivePresetId(id);
    writeStoredVoiceStyle(id);
  }, []);

  return (
    <div className="remi-composer-ground relative w-full min-w-0">
      <div className="relative w-full min-w-0 overflow-visible">
        <VoiceStylePicker
          open={voiceStyleOpen}
          onClose={onVoiceStyleClose}
          activePresetId={activePresetId}
          onPresetChange={handlePresetChange}
          setVoiceStyle={setVoiceStyle}
          ttsEnabled={ttsEnabled}
          onTtsEnabledChange={onTtsEnabledChange}
        />
        <InputBar
          variant="unified"
          onSend={onSend}
          onMicToggle={onMicToggle}
          disabled={disabled}
          micDisabled={micDisabled}
          recording={recording}
          placeholder={placeholder}
          isReplying={isReplying}
          onStop={onStop}
          voiceStyleControl={{
            open: voiceStyleOpen,
            onToggle: onVoiceStyleToggle,
            activeLabel: ttsEnabled
              ? voiceStyleLabelForId(activePresetId)
              : "静音",
          }}
        />
      </div>
    </div>
  );
}