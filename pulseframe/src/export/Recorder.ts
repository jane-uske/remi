/**
 * Real-time WebM export: captures the live WebGL canvas via captureStream()
 * and muxes in the original audio from the AudioEngine's MediaStream
 * destination. Audio/visual sync is inherent because both are captured live.
 */

export interface RecorderCallbacks {
  onProgress(fraction: number): void;
  onDone(blob: Blob, mimeType: string): void;
  onError(message: string): void;
}

const MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

export class Recorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stopTimer = 0;
  private progressTimer = 0;
  private cancelled = false;

  get active(): boolean {
    return this.recorder !== null;
  }

  start(canvas: HTMLCanvasElement, audioStream: MediaStream, seconds: number, cb: RecorderCallbacks): void {
    if (this.recorder) {
      cb.onError('An export is already in progress');
      return;
    }
    let mimeType = '';
    if (typeof MediaRecorder === 'undefined') {
      cb.onError('MediaRecorder is not supported in this browser');
      return;
    }
    for (const c of MIME_CANDIDATES) {
      if (MediaRecorder.isTypeSupported(c)) {
        mimeType = c;
        break;
      }
    }
    if (!mimeType) {
      cb.onError('This browser cannot record WebM video');
      return;
    }

    let stream: MediaStream;
    try {
      stream = canvas.captureStream(60);
      audioStream.getAudioTracks().forEach((t) => stream.addTrack(t));
    } catch (err) {
      cb.onError(`Could not capture the canvas: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    if (stream.getAudioTracks().length === 0) {
      cb.onError('No audio track available for export');
      return;
    }

    this.cancelled = false;
    this.chunks = [];
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 12_000_000,
        audioBitsPerSecond: 192_000,
      });
    } catch (err) {
      cb.onError(`Could not start the recorder: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    rec.onerror = () => {
      this.cleanup();
      cb.onError('Recording failed unexpectedly');
    };
    rec.onstop = () => {
      const wasCancelled = this.cancelled;
      const parts = this.chunks;
      this.cleanup();
      if (wasCancelled) return;
      const blob = new Blob(parts, { type: mimeType.split(';')[0] });
      if (blob.size === 0) {
        cb.onError('Export produced an empty file');
        return;
      }
      cb.onDone(blob, mimeType);
    };

    const startedAt = performance.now();
    this.recorder = rec;
    rec.start(250);

    this.progressTimer = window.setInterval(() => {
      cb.onProgress(Math.min(1, (performance.now() - startedAt) / (seconds * 1000)));
    }, 120);
    this.stopTimer = window.setTimeout(() => {
      cb.onProgress(1);
      this.stopRecorder();
    }, seconds * 1000);
  }

  cancel(): void {
    if (!this.recorder) return;
    this.cancelled = true;
    this.stopRecorder();
  }

  private stopRecorder(): void {
    window.clearTimeout(this.stopTimer);
    window.clearInterval(this.progressTimer);
    if (this.recorder && this.recorder.state !== 'inactive') {
      try {
        this.recorder.stop();
      } catch {
        this.cleanup();
      }
    }
  }

  private cleanup(): void {
    window.clearTimeout(this.stopTimer);
    window.clearInterval(this.progressTimer);
    this.recorder = null;
    this.chunks = [];
  }
}
