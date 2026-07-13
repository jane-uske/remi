import { AudioFrame } from '../types';

/**
 * Owns the WebAudio graph: buffer playback → master gain → analyser → speakers,
 * with a parallel MediaStream destination used during export so the recording
 * contains the original audio.
 *
 * Analysis runs once per render frame (pulled by the visual engine, never
 * pushed through React state). Features are smoothed with attack/release
 * envelopes; beats are detected on the low band with an adaptive threshold.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private exportDest: MediaStreamAudioDestinationNode | null = null;

  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private startCtxTime = 0;
  private startOffset = 0;
  playing = false;

  private freqData = new Uint8Array(1024);

  // smoothed features
  private sLevel = 0;
  private sLow = 0;
  private sMid = 0;
  private sHigh = 0;

  // adaptive per-band normalizers (raw byte-FFT bands sit at very different
  // absolute levels — sustained bass reads ~0.9, treble ~0.1 — so each band is
  // rescaled against its own running floor/ceiling to recover full dynamics)
  private normLow = { floor: 0.2, ceil: 0.6 };
  private normMid = { floor: 0.1, ceil: 0.4 };
  private normHigh = { floor: 0.02, ceil: 0.2 };

  // beat detection via low-band spectral flux (onset), robust to sustained bass
  private prevLow = 0;
  private fluxAvg = 0;
  private fluxDev = 0.02;
  private beatEnv = 0;
  private beatCount = 0;
  private lastBeatTime = -10;

  private frame: AudioFrame = {
    level: 0,
    low: 0,
    mid: 0,
    high: 0,
    beat: 0,
    beatCount: 0,
    beatHit: false,
    spectrum: this.freqData,
    playing: false,
  };

  ensureContext(): AudioContext {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) throw new Error('WebAudio is not supported in this browser');
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 1;
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.45;
      this.master.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
      this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
      this.frame.spectrum = this.freqData;
    }
    return this.ctx;
  }

  /** Must be called from a user gesture to satisfy autoplay policies. */
  async unlock(): Promise<void> {
    const ctx = this.ensureContext();
    if (ctx.state === 'suspended') await ctx.resume();
  }

  get unlocked(): boolean {
    return this.ctx?.state === 'running';
  }

  get duration(): number {
    return this.buffer?.duration ?? 0;
  }

  async decode(data: ArrayBuffer): Promise<AudioBuffer> {
    const ctx = this.ensureContext();
    return ctx.decodeAudioData(data);
  }

  /** Replace the active track. Keeps playing state; restarts from 0. */
  setBuffer(buffer: AudioBuffer): void {
    const wasPlaying = this.playing;
    this.stopSource();
    this.buffer = buffer;
    this.startOffset = 0;
    this.resetAnalysis();
    if (wasPlaying) this.play();
  }

  private stopSource(): void {
    if (this.source) {
      this.source.onended = null;
      try {
        this.source.stop();
      } catch {
        /* already stopped */
      }
      this.source.disconnect();
      this.source = null;
    }
    this.playing = false;
  }

  play(): void {
    const ctx = this.ensureContext();
    if (!this.buffer || !this.master) return;
    this.stopSource();
    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    src.loop = true;
    src.connect(this.master);
    this.startOffset = this.startOffset % this.buffer.duration;
    src.start(0, this.startOffset);
    this.startCtxTime = ctx.currentTime;
    this.source = src;
    this.playing = true;
  }

  pause(): void {
    if (!this.playing || !this.ctx) return;
    this.startOffset = this.getTime();
    this.stopSource();
  }

  seek(t: number): void {
    if (!this.buffer) return;
    const clamped = Math.max(0, Math.min(t, this.buffer.duration - 0.01));
    const wasPlaying = this.playing;
    this.stopSource();
    this.startOffset = clamped;
    if (wasPlaying) this.play();
  }

  getTime(): number {
    if (!this.buffer) return 0;
    if (!this.playing || !this.ctx) return this.startOffset;
    return (this.ctx.currentTime - this.startCtxTime + this.startOffset) % this.buffer.duration;
  }

  /** Audio-only stream carrying the master mix, for MediaRecorder muxing. */
  getExportStream(): MediaStream {
    const ctx = this.ensureContext();
    if (!this.exportDest) {
      this.exportDest = ctx.createMediaStreamDestination();
      this.master!.connect(this.exportDest);
    }
    return this.exportDest.stream;
  }

  private resetAnalysis(): void {
    this.sLevel = this.sLow = this.sMid = this.sHigh = 0;
    this.normLow = { floor: 0.2, ceil: 0.6 };
    this.normMid = { floor: 0.1, ceil: 0.4 };
    this.normHigh = { floor: 0.02, ceil: 0.2 };
    this.prevLow = 0;
    this.fluxAvg = 0;
    this.fluxDev = 0.02;
    this.beatEnv = 0;
    this.lastBeatTime = -10;
  }

  /**
   * Rescale a raw band value against its own slowly-tracked floor/ceiling so
   * each band uses the full 0..1 range regardless of absolute level. The floor
   * drops fast toward quiet passages and rises slowly; the ceiling rises fast
   * on peaks and decays slowly. Result: bass that sits at a sustained 0.9 still
   * pulses across the full range instead of pinning at 1.0.
   */
  private normBand(raw: number, s: { floor: number; ceil: number }, dt: number): number {
    if (raw < s.floor) s.floor = raw;
    else s.floor += (raw - s.floor) * (1 - Math.exp(-dt / 4.0));
    if (raw > s.ceil) s.ceil = raw;
    else s.ceil += (raw - s.ceil) * (1 - Math.exp(-dt / 2.5));
    const span = Math.max(s.ceil - s.floor, 0.04);
    return Math.max(0, Math.min(1, (raw - s.floor) / span));
  }

  private bandAverage(fromHz: number, toHz: number): number {
    if (!this.ctx || !this.analyser) return 0;
    const binHz = this.ctx.sampleRate / this.analyser.fftSize;
    const from = Math.max(1, Math.floor(fromHz / binHz));
    const to = Math.min(this.freqData.length - 1, Math.ceil(toHz / binHz));
    if (to <= from) return 0;
    let sum = 0;
    for (let i = from; i <= to; i++) sum += this.freqData[i];
    return sum / ((to - from + 1) * 255);
  }

  private smooth(current: number, target: number, dt: number): number {
    const tau = target > current ? 0.035 : 0.16;
    return current + (target - current) * (1 - Math.exp(-dt / tau));
  }

  /**
   * Pull one analysis frame. `sensitivity` 0..1 — higher fires beats more easily.
   * Returns an internally reused object; consume immediately.
   */
  analyse(dt: number, sensitivity: number): AudioFrame {
    const f = this.frame;
    f.beatHit = false;
    f.playing = this.playing;

    if (!this.ctx || !this.analyser || !this.playing || this.ctx.state !== 'running') {
      // decay toward silence so visuals settle instead of freezing
      this.sLevel = this.smooth(this.sLevel, 0, dt);
      this.sLow = this.smooth(this.sLow, 0, dt);
      this.sMid = this.smooth(this.sMid, 0, dt);
      this.sHigh = this.smooth(this.sHigh, 0, dt);
      this.beatEnv *= Math.exp(-dt * 7);
      f.level = this.sLevel;
      f.low = this.sLow;
      f.mid = this.sMid;
      f.high = this.sHigh;
      f.beat = this.beatEnv;
      f.beatCount = this.beatCount;
      return f;
    }

    this.analyser.getByteFrequencyData(this.freqData);

    const rawLow = this.bandAverage(25, 160);
    const rawMid = this.bandAverage(160, 2000);
    const rawHigh = this.bandAverage(2000, 9500);

    // per-band adaptive normalization -> full dynamic range for the visuals
    const low = this.normBand(rawLow, this.normLow, dt);
    const mid = this.normBand(rawMid, this.normMid, dt);
    const high = this.normBand(rawHigh, this.normHigh, dt);
    const level = Math.min(1, low * 0.5 + mid * 0.35 + high * 0.35);

    this.sLow = this.smooth(this.sLow, low, dt);
    this.sMid = this.smooth(this.sMid, mid, dt);
    this.sHigh = this.smooth(this.sHigh, high, dt);
    this.sLevel = this.smooth(this.sLevel, level, dt);

    // beat detection via positive spectral flux on the raw low band: a kick's
    // attack produces a sharp rise even when bass sustains between hits
    const flux = Math.max(0, rawLow - this.prevLow);
    this.prevLow = rawLow;
    const k = 1 - Math.exp(-dt / 0.5);
    this.fluxAvg += (flux - this.fluxAvg) * k;
    this.fluxDev += (Math.abs(flux - this.fluxAvg) - this.fluxDev) * k;
    const threshold = this.fluxAvg + this.fluxDev * (1.9 - 1.4 * sensitivity) + 0.004;
    const now = this.ctx.currentTime;
    const refractory = 0.18;
    if (flux > threshold && rawLow > 0.08 && now - this.lastBeatTime > refractory) {
      this.lastBeatTime = now;
      this.beatEnv = 1;
      this.beatCount++;
      f.beatHit = true;
    } else {
      this.beatEnv *= Math.exp(-dt * 7);
    }

    f.level = this.sLevel;
    f.low = this.sLow;
    f.mid = this.sMid;
    f.high = this.sHigh;
    f.beat = this.beatEnv;
    f.beatCount = this.beatCount;
    return f;
  }

  setVolume(v: number): void {
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(Math.max(0, Math.min(1, v)), this.ctx.currentTime, 0.03);
    }
  }

  dispose(): void {
    this.stopSource();
    this.exportDest?.disconnect();
    this.exportDest = null;
    void this.ctx?.close();
    this.ctx = null;
  }
}
