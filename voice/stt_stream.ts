import { EventEmitter } from "events";
import OpenAI from "openai";
import { withRetry } from "../utils/retry";
import fs from "fs";
import os from "os";
import path from "path";

import { whisperServerRuntime } from "./stt_whisper_runtime";

type SttProvider = "openai" | "whisper-cpp";

function getProvider(): SttProvider {
  const p = (process.env.stt_provider || "openai").toLowerCase();
  return p === "whisper-cpp" ? "whisper-cpp" : "openai";
}

export async function warmWhisperServer(): Promise<boolean> {
  if (getProvider() !== "whisper-cpp") return false;
  return whisperServerRuntime.warm();
}

export async function shutdownWhisperServer(): Promise<void> {
  await whisperServerRuntime.shutdown();
}

/**
 * Streaming STT that supports two input modes:
 *
 *   1. Legacy (WebM):  feed(chunk) → end()
 *   2. Full-duplex (PCM):  feedPcm(chunk) → endPcm()
 *
 * Events:
 *   "partial"  (status: string)
 *   "final"    (text: string)
 *   "error"    (err: Error)
 */
export class SttStream extends EventEmitter {
  /* ── WebM mode (legacy) ── */
  private chunks: Buffer[] = [];
  private totalBytes = 0;

  /* ── PCM mode (full-duplex) ── */
  private pcmChunks: Buffer[] = [];
  private pcmBytes = 0;
  private sampleRate = 16000;
  private previewAbort: AbortController | null = null;

  private client: OpenAI | null = null;

  constructor() {
    super();
    if (getProvider() === "openai") {
      const apiKey = process.env.stt_key;
      const baseURL = process.env.stt_base_url;
      if (apiKey && baseURL) {
        this.client = new OpenAI({ apiKey, baseURL, timeout: 30_000 });
      }
    }
  }

  get configured(): boolean {
    if (getProvider() === "whisper-cpp") return Boolean(process.env.whisper_model);
    return this.client !== null;
  }

  /* ======== WebM mode (backward-compat) ======== */

  feed(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.totalBytes += chunk.length;
    this.emit("partial", `录音中… ${(this.totalBytes / 1024).toFixed(0)} KB`);
  }

  async end(): Promise<string> {
    const audio = Buffer.concat(this.chunks);
    this.resetWebm();
    if (audio.length === 0) return "";

    const text =
      getProvider() === "whisper-cpp"
        ? await this.transcribeLocalWebm(audio)
        : await this.transcribeOpenAIWebm(audio);

    this.emit("final", text);
    return text;
  }

  /* ======== PCM mode (full-duplex) ======== */

  setSampleRate(rate: number): void {
    this.sampleRate = rate;
  }

  feedPcm(chunk: Buffer): void {
    this.pcmChunks.push(chunk);
    this.pcmBytes += chunk.length;

    const durationMs = (this.pcmBytes / 2 / this.sampleRate) * 1000;
    this.emit("partial", `录音中… ${(durationMs / 1000).toFixed(1)}s`);
  }

  /** Transcribe accumulated PCM and reset buffer. */
  async endPcm(): Promise<string> {
    this.cancelPreview();
    const pcm = Buffer.concat(this.pcmChunks);
    this.resetPcm();
    if (pcm.length < minimumPcmBytes(this.sampleRate)) return "";

    const wav = pcmToWav(pcm, this.sampleRate);
    const text =
      getProvider() === "whisper-cpp"
        ? await this.transcribeLocalWav(wav)
        : await this.transcribeOpenAIWav(wav);

    this.emit("final", text);
    return text;
  }

  /** Discard accumulated PCM without transcribing. */
  cancelPcm(): void {
    this.resetPcm();
  }

  cancelPreview(): void {
    if (!this.previewAbort) return;
    try {
      this.previewAbort.abort();
    } catch {
      // best effort
    }
    this.previewAbort = null;
  }

  get pcmDurationMs(): number {
    return (this.pcmBytes / 2 / this.sampleRate) * 1000;
  }

  canPreviewPcm(): boolean {
    if (getProvider() !== "whisper-cpp") return false;
    return whisperServerRuntime.canPreview();
  }

  /**
   * Preview transcription from current PCM buffer without consuming/resetting it.
   * Returns null when preview is unavailable (provider/path not supported).
   */
  async previewPcm(maxWindowMs?: number): Promise<string | null> {
    if (!this.canPreviewPcm()) return null;
    const pcm = this.snapshotPcm(maxWindowMs);
    if (pcm.length < this.sampleRate) return "";
    this.cancelPreview();
    const previewAbort = new AbortController();
    this.previewAbort = previewAbort;
    try {
      return await whisperServerRuntime.previewPcm(pcm, this.sampleRate, maxWindowMs, previewAbort.signal);
    } finally {
      if (this.previewAbort === previewAbort) {
        this.previewAbort = null;
      }
    }
  }

  /**
   * Preview transcription from a caller-provided PCM snapshot.
   * Does not mutate internal PCM buffer used by endPcm().
   */
  async previewPcmBuffer(pcm: Buffer, sampleRate: number, maxWindowMs?: number): Promise<string | null> {
    if (!this.canPreviewPcm()) return null;
    const rate = Number.isFinite(sampleRate) && sampleRate > 0 ? Math.floor(sampleRate) : this.sampleRate;
    const sliced = this.slicePcmWindow(pcm, rate, maxWindowMs);
    if (sliced.length < rate) return "";
    this.cancelPreview();
    const previewAbort = new AbortController();
    this.previewAbort = previewAbort;
    try {
      return await whisperServerRuntime.previewPcm(sliced, rate, maxWindowMs, previewAbort.signal);
    } finally {
      if (this.previewAbort === previewAbort) {
        this.previewAbort = null;
      }
    }
  }

  /* ======== Transcription backends ======== */

  /** Only adds language / temperature / prompt when env is set — matches original minimal API body and avoids breaking some OpenAI-compatible providers. */
  private openAiTranscriptionBody(): {
    model: string;
    language?: string;
    temperature?: number;
    prompt?: string;
  } {
    const prompt = process.env.whisper_prompt || process.env.stt_prompt;
    const lang = process.env.stt_language || process.env.whisper_lang;
    const tempRaw = process.env.stt_temperature;

    const body: {
      model: string;
      language?: string;
      temperature?: number;
      prompt?: string;
    } = {
      model: process.env.stt_model || "whisper-1",
    };

    if (lang) body.language = lang;
    if (prompt) body.prompt = prompt;
    if (tempRaw !== undefined && tempRaw !== "") {
      const t = Math.min(1, Math.max(0, Number(tempRaw)));
      if (Number.isFinite(t)) body.temperature = t;
    }

    return body;
  }

  // -- OpenAI, WebM input --
  private async transcribeOpenAIWebm(audio: Buffer): Promise<string> {
    if (!this.client) throw new Error("STT 未配置：请设置 stt_key 和 stt_base_url");

    const tmp = tmpPath("webm");
    fs.writeFileSync(tmp, audio);
    try {
      const res = await withRetry(
        () =>
          this.client!.audio.transcriptions.create({
            file: fs.createReadStream(tmp),
            ...this.openAiTranscriptionBody(),
          }),
        { retries: 1 },
      );
      return res.text;
    } finally {
      fs.unlinkSync(tmp);
    }
  }

  // -- OpenAI, WAV input --
  private async transcribeOpenAIWav(wav: Buffer): Promise<string> {
    if (!this.client) throw new Error("STT 未配置：请设置 stt_key 和 stt_base_url");

    const tmp = tmpPath("wav");
    fs.writeFileSync(tmp, wav);
    try {
      const res = await withRetry(
        () =>
          this.client!.audio.transcriptions.create({
            file: fs.createReadStream(tmp),
            ...this.openAiTranscriptionBody(),
          }),
        { retries: 1 },
      );
      return res.text;
    } finally {
      fs.unlinkSync(tmp);
    }
  }

  // -- Local whisper-cpp, WebM input (needs ffmpeg) --
  private async transcribeLocalWebm(audio: Buffer): Promise<string> {
    return whisperServerRuntime.transcribeWebm(audio);
  }

  // -- Local whisper-cpp, WAV input (already PCM, may need resample) --
  private async transcribeLocalWav(wav: Buffer): Promise<string> {
    return whisperServerRuntime.transcribeWav(wav, this.sampleRate);
  }

  /* ======== Helpers ======== */

  private resetWebm(): void {
    this.chunks = [];
    this.totalBytes = 0;
  }

  private resetPcm(): void {
    this.pcmChunks = [];
    this.pcmBytes = 0;
  }

  private snapshotPcm(maxWindowMs?: number): Buffer {
    if (this.pcmChunks.length === 0) return Buffer.alloc(0);
    const all = Buffer.concat(this.pcmChunks);
    return this.slicePcmWindow(all, this.sampleRate, maxWindowMs);
  }

  private slicePcmWindow(pcm: Buffer, sampleRate: number, maxWindowMs?: number): Buffer {
    if (pcm.length === 0) return pcm;
    const windowMs = Number.isFinite(maxWindowMs) && (maxWindowMs as number) > 0
      ? (maxWindowMs as number)
      : 0;
    if (windowMs <= 0) return pcm;
    const keepBytes = Math.floor((sampleRate * 2 * windowMs) / 1000);
    if (keepBytes <= 0 || pcm.length <= keepBytes) return pcm;
    return pcm.subarray(pcm.length - keepBytes);
  }

  reset(): void {
    this.cancelPreview();
    this.resetWebm();
    this.resetPcm();
  }
}

/* ── Utilities ── */

function tmpPath(ext: string): string {
  return path.join(
    os.tmpdir(),
    `rem-stt-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`,
  );
}

function minimumPcmBytes(sampleRate: number): number {
  const raw = process.env.stt_min_pcm_ms || process.env.STT_MIN_PCM_MS || process.env.VAD_MIN_UTTERANCE_MS || "220";
  const ms = Number(raw);
  const safeMs = Number.isFinite(ms) && ms > 0 ? ms : 220;
  return Math.ceil(sampleRate * 2 * safeMs / 1000);
}

/** Wrap raw PCM (16-bit LE mono) in a WAV container. */
function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  const dataLen = pcm.length;

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataLen, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);            // fmt chunk size
  header.writeUInt16LE(1, 20);             // PCM
  header.writeUInt16LE(1, 22);             // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32);             // block align
  header.writeUInt16LE(16, 34);            // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(dataLen, 40);

  return Buffer.concat([header, pcm]);
}
