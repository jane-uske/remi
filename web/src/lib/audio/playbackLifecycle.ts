export const PLAYBACK_END_DEBOUNCE_MS = 360;

export function hasPendingPlaybackWork(args: {
  playing: boolean;
  activeSources: number;
  pendingPcmSamples: number;
  hasFlushTimer: boolean;
  scheduledAheadMs: number;
  serverTtsStreaming: boolean;
  msSinceLastEnqueue: number;
  debounceMs?: number;
}): boolean {
  const debounceMs = args.debounceMs ?? PLAYBACK_END_DEBOUNCE_MS;
  return (
    args.playing ||
    args.activeSources > 0 ||
    args.pendingPcmSamples > 0 ||
    args.hasFlushTimer ||
    args.scheduledAheadMs > 10 ||
    args.serverTtsStreaming ||
    args.msSinceLastEnqueue < debounceMs
  );
}