export function shouldAwaitPlaybackDrain(args: {
  voiceActive: boolean;
  playbackSeenForGeneration: boolean;
}): boolean {
  return args.voiceActive || args.playbackSeenForGeneration;
}

export function shouldFinalizeDeferredChatEnd(args: {
  awaitingPlaybackDrain: boolean;
  voiceActive: boolean;
}): boolean {
  return args.awaitingPlaybackDrain && !args.voiceActive;
}
