"use client";

import { useState } from "react";
import { InputBar, type InputBarProps } from "@/components/InputBar";
import {
  VoiceStylePicker,
  voiceStyleLabelForId,
  type VoiceStylePickerProps,
} from "@/components/VoiceStylePicker";

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
}: RemiChatComposerProps) {
  const [activePresetId, setActivePresetId] = useState("default");

  return (
    <div className="remi-composer-ground relative w-full min-w-0">
      <div className="relative w-full min-w-0 overflow-visible">
        <VoiceStylePicker
          open={voiceStyleOpen}
          onClose={onVoiceStyleClose}
          activePresetId={activePresetId}
          onPresetChange={setActivePresetId}
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