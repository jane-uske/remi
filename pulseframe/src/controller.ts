import * as THREE from 'three';
import { AudioEngine } from './audio/AudioEngine';
import { DEMO_TRACK_NAME, renderDemoTrack } from './audio/demoTrack';
import { createDemoImage } from './assets/demoImage';
import { VisualEngine } from './engine/VisualEngine';
import { DimensionRift } from './engine/scenes/DimensionRift';
import { LiquidChrome } from './engine/scenes/LiquidChrome';
import { ParticleBloom } from './engine/scenes/ParticleBloom';
import { Recorder } from './export/Recorder';
import { deletePreset, savePreset } from './state/presets';
import { getState, pushToast, setState } from './state/store';
import { AspectId, AudioFrame, DEFAULT_PARAMS, SceneId, VisualParams } from './types';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const AUDIO_EXTENSIONS = /\.(mp3|wav|ogg|oga|m4a|aac|flac|webm|opus)$/i;
const MAX_IMAGE_DIM = 2048;
const MAX_FILE_MB = 80;

class Controller {
  readonly audio = new AudioEngine();
  private recorder = new Recorder();
  engine: VisualEngine | null = null;
  private lastAudioFrame: AudioFrame | null = null;

  boot(container: HTMLElement): void {
    if (this.engine) return;
    const state = getState();
    let engine: VisualEngine;
    try {
      engine = new VisualEngine(
        {
          getParams: () => getState().params,
          analyse: (dt, sensitivity) => {
            const frame = this.audio.analyse(dt, sensitivity);
            this.lastAudioFrame = frame;
            return frame;
          },
        },
        state.aspect,
      );
    } catch (err) {
      setState({ webglError: err instanceof Error ? err.message : String(err), booted: true });
      return;
    }
    this.engine = engine;

    engine.registerScene(new DimensionRift());
    engine.registerScene(new LiquidChrome());
    engine.registerScene(new ParticleBloom());
    engine.setScene(state.scene);

    // built-in demo cover (drawn procedurally — nothing to download)
    const demoCanvas = createDemoImage();
    const tex = new THREE.CanvasTexture(demoCanvas);
    engine.setImage(tex, demoCanvas.width / demoCanvas.height);
    setState({ imageThumb: this.makeThumb(demoCanvas, demoCanvas.width, demoCanvas.height) });

    container.appendChild(engine.canvas);
    engine.start();
    setState({ booted: true });

    // built-in demo track (synthesized offline — nothing to download)
    renderDemoTrack()
      .then((buffer) => {
        // don't clobber a track the user uploaded while the demo rendered
        if (getState().audioName === DEMO_TRACK_NAME) {
          this.audio.setBuffer(buffer);
          setState({ audioDuration: buffer.duration });
        }
      })
      .catch(() => {
        pushToast('error', 'Could not prepare the demo track. Upload an audio file to get started.');
      });

    this.installTestHook();
  }

  shutdown(container: HTMLElement): void {
    this.recorder.cancel();
    if (this.engine) {
      if (this.engine.canvas.parentElement === container) container.removeChild(this.engine.canvas);
      this.engine.dispose();
      this.engine = null;
    }
    this.audio.dispose();
    const { lastExport } = getState();
    if (lastExport) URL.revokeObjectURL(lastExport.url);
  }

  /** First user gesture: unlock audio and start playback. */
  async unlockAndPlay(): Promise<void> {
    try {
      await this.audio.unlock();
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Audio could not be started');
      return;
    }
    if (this.audio.duration === 0) {
      // demo may still be rendering — mark unlocked, playback starts on load
      setState({ needsGesture: false });
      pushToast('info', 'Preparing audio — playback will start in a moment');
      const wait = window.setInterval(() => {
        if (this.audio.duration > 0) {
          window.clearInterval(wait);
          this.audio.play();
          setState({ playing: true });
        }
      }, 150);
      return;
    }
    this.audio.play();
    setState({ needsGesture: false, playing: true });
  }

  async togglePlay(): Promise<void> {
    const s = getState();
    if (s.exportStatus !== 'idle') {
      pushToast('info', 'Playback is locked while exporting');
      return;
    }
    if (s.needsGesture || !this.audio.unlocked) {
      await this.unlockAndPlay();
      return;
    }
    if (this.audio.playing) {
      this.audio.pause();
      setState({ playing: false });
    } else {
      this.audio.play();
      setState({ playing: true });
    }
  }

  seek(t: number): void {
    if (getState().exportStatus !== 'idle') return;
    this.audio.seek(t);
  }

  setVolume(v: number): void {
    this.audio.setVolume(v);
  }

  setScene(scene: SceneId): void {
    this.engine?.setScene(scene);
    setState({ scene });
  }

  setAspect(aspect: AspectId): void {
    if (getState().exportStatus !== 'idle') {
      pushToast('info', 'Canvas ratio is locked while exporting');
      return;
    }
    this.engine?.setAspect(aspect);
    setState({ aspect });
  }

  setParam(key: keyof VisualParams, value: number): void {
    setState({ params: { ...getState().params, [key]: value } });
  }

  resetParams(): void {
    setState({ params: { ...DEFAULT_PARAMS } });
  }

  randomizeParams(): void {
    const r = (min: number, max: number) => min + Math.random() * (max - min);
    setState({
      params: {
        intensity: r(0.35, 0.95),
        beatSensitivity: r(0.35, 0.8),
        motionSpeed: r(0.25, 0.85),
        depth: r(0.3, 0.95),
        glow: r(0.2, 0.9),
        chromatic: r(0.1, 0.85),
        cameraMotion: r(0.25, 0.95),
      },
    });
  }

  savePreset(name: string): void {
    const s = getState();
    setState({ presets: savePreset(s.presets, name, s.scene, s.params) });
    pushToast('success', 'Preset saved');
  }

  applyPreset(id: string): void {
    const preset = getState().presets.find((p) => p.id === id);
    if (!preset) return;
    this.setScene(preset.scene);
    setState({ params: { ...preset.params } });
  }

  deletePreset(id: string): void {
    setState({ presets: deletePreset(getState().presets, id) });
  }

  getAudioFrame(): AudioFrame | null {
    return this.lastAudioFrame;
  }

  getTime(): number {
    return this.audio.getTime();
  }

  async handleFiles(files: FileList | File[]): Promise<void> {
    for (const file of Array.from(files)) {
      if (IMAGE_TYPES.has(file.type)) {
        await this.loadImageFile(file);
      } else if (file.type.startsWith('audio/') || AUDIO_EXTENSIONS.test(file.name)) {
        await this.loadAudioFile(file);
      } else {
        pushToast('error', `“${file.name}” is not a supported file. Use JPG, PNG, WebP images or MP3/WAV/OGG/M4A/FLAC audio.`);
      }
    }
  }

  async loadImageFile(file: File): Promise<void> {
    if (getState().exportStatus !== 'idle') {
      pushToast('info', 'Media is locked while exporting');
      return;
    }
    if (!IMAGE_TYPES.has(file.type)) {
      pushToast('error', `“${file.name}” is not a supported image. Use JPG, PNG or WebP.`);
      return;
    }
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      pushToast('error', `Image is too large (max ${MAX_FILE_MB} MB)`);
      return;
    }
    setState({ loadingImage: true });
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (!w || !h) throw new Error('empty image');
      let source: HTMLImageElement | HTMLCanvasElement = img;
      if (Math.max(w, h) > MAX_IMAGE_DIM) {
        const scale = MAX_IMAGE_DIM / Math.max(w, h);
        const c = document.createElement('canvas');
        c.width = Math.round(w * scale);
        c.height = Math.round(h * scale);
        const cx = c.getContext('2d');
        if (!cx) throw new Error('canvas unavailable');
        cx.drawImage(img, 0, 0, c.width, c.height);
        source = c;
      }
      const tex = new THREE.Texture(source);
      tex.needsUpdate = true;
      this.engine?.setImage(tex, w / h);
      setState({ imageName: file.name, imageDims: `${w} × ${h}`, imageThumb: this.makeThumb(source, w, h) });
    } catch {
      pushToast('error', `Could not read “${file.name}”. The image may be corrupted or in an unsupported format.`);
    } finally {
      URL.revokeObjectURL(url);
      setState({ loadingImage: false });
    }
  }

  async loadAudioFile(file: File): Promise<void> {
    if (getState().exportStatus !== 'idle') {
      pushToast('info', 'Media is locked while exporting');
      return;
    }
    if (!(file.type.startsWith('audio/') || AUDIO_EXTENSIONS.test(file.name))) {
      pushToast('error', `“${file.name}” is not a supported audio file. Use MP3, WAV, OGG, M4A or FLAC.`);
      return;
    }
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      pushToast('error', `Audio file is too large (max ${MAX_FILE_MB} MB)`);
      return;
    }
    setState({ loadingAudio: true });
    try {
      const data = await file.arrayBuffer();
      const buffer = await this.audio.decode(data);
      this.audio.setBuffer(buffer);
      setState({
        audioName: file.name,
        audioDuration: buffer.duration,
        playing: this.audio.playing,
      });
    } catch {
      pushToast('error', `Could not decode “${file.name}”. The browser does not support this audio format or the file is damaged.`);
    } finally {
      setState({ loadingAudio: false });
    }
  }

  async startExport(): Promise<void> {
    const s = getState();
    if (!this.engine) return;
    if (s.exportStatus !== 'idle' || this.recorder.active) return;
    if (this.audio.duration === 0) {
      pushToast('error', 'No audio loaded yet — wait for the demo track or upload one.');
      return;
    }
    if (document.hidden) {
      pushToast('error', 'Keep this tab visible while exporting — recording captures the live canvas.');
      return;
    }
    try {
      await this.audio.unlock();
    } catch {
      pushToast('error', 'Audio could not be started for the export.');
      return;
    }
    // export always records from the top of the track for a clean cover clip
    this.audio.seek(0);
    if (!this.audio.playing) this.audio.play();
    setState({ needsGesture: false, playing: true, exportStatus: 'recording', exportProgress: 0 });

    this.recorder.start(this.engine.canvas, this.audio.getExportStream(), s.exportSeconds, {
      onProgress: (fraction) => setState({ exportProgress: fraction }),
      onDone: (blob, mimeType) => {
        const prev = getState().lastExport;
        if (prev) URL.revokeObjectURL(prev.url);
        setState({
          exportStatus: 'idle',
          exportProgress: 0,
          lastExport: {
            url: URL.createObjectURL(blob),
            sizeBytes: blob.size,
            seconds: s.exportSeconds,
            mimeType,
          },
        });
        pushToast('success', `Export finished (${(blob.size / (1024 * 1024)).toFixed(1)} MB WebM)`);
      },
      onError: (message) => {
        setState({ exportStatus: 'idle', exportProgress: 0 });
        pushToast('error', message);
      },
    });
  }

  cancelExport(): void {
    if (!this.recorder.active) return;
    this.recorder.cancel();
    setState({ exportStatus: 'idle', exportProgress: 0 });
    pushToast('info', 'Export cancelled');
  }

  private makeThumb(source: HTMLImageElement | HTMLCanvasElement, w: number, h: number): string | null {
    try {
      const t = document.createElement('canvas');
      const size = 128;
      const scale = size / Math.max(w, h);
      t.width = Math.max(1, Math.round(w * scale));
      t.height = Math.max(1, Math.round(h * scale));
      const cx = t.getContext('2d');
      if (!cx) return null;
      cx.drawImage(source, 0, 0, t.width, t.height);
      return t.toDataURL('image/jpeg', 0.72);
    } catch {
      return null;
    }
  }

  private installTestHook(): void {
    (window as unknown as Record<string, unknown>).__pulseframe = {
      getState,
      sampleBrightness: () => this.engine?.sampleBrightness() ?? -1,
      getAudioFrame: () => {
        const f = this.lastAudioFrame;
        if (!f) return null;
        return { level: f.level, low: f.low, mid: f.mid, high: f.high, beat: f.beat, beatCount: f.beatCount, playing: f.playing };
      },
      controller: this,
    };
  }
}

export const controller = new Controller();
