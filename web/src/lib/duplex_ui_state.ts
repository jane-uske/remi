export function resolveDuplexInputPlaceholder(input: {
  recording: boolean;
  userSpeaking: boolean;
  awaitingSpeechCommit: boolean;
}): string {
  if (input.userSpeaking) {
    return "正在听…";
  }
  if (input.recording) {
    return input.awaitingSpeechCommit ? "识别中…" : "全双工语音 — 随时说话…";
  }
  return "说点什么…";
}
