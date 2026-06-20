export function shouldAwaitPlaybackDrain(args: {
  voiceActive: boolean;
  playbackSeenForGeneration: boolean;
}): boolean {
  return args.voiceActive || args.playbackSeenForGeneration;
}

export function shouldFinalizeDeferredChatEnd(args: {
  awaitingPlaybackDrain: boolean;
  awaitingTtsEnd?: boolean;
  voiceActive: boolean;
}): boolean {
  if (args.awaitingTtsEnd) return false;
  return args.awaitingPlaybackDrain && !args.voiceActive;
}
