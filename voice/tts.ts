import OpenAI from "openai";
import { spawn, ChildProcess } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { WebSocket } from "ws";
import { randomBytes } from "crypto";
import { getEmotionVoiceParams, type Emotion } from "./tts_emotion";
import {
  buildTtsCacheVariant,
  buildTtsShortCacheKey,
  normalizeTtsTextWithConfig,
  type TtsProvider,
} from "./tts_helpers";
import { resolveVolcTtsConfig, speakWithVolc } from "./tts_volc";
import { createLogger } from "../infra/logger";
import { withRetry } from "../utils/retry";

const logger = createLogger("tts");

let client: OpenAI | null = null;
let warnedTtsDisabled = false;

function getProvider(): TtsProvider {
  const p = (process.env.tts_provider || "edge").toLowerCase();
  if (p === "piper") return "piper";
  if (p === "openai") return "openai";
  if (p === "volc") return "volc";
  return "edge";
}

function isProviderConfigured(provider: TtsProvider): boolean {
  if (provider === "edge") return true;
  if (provider === "piper") return Boolean(getPiperModel());
  if (provider === "volc") return Boolean(resolveVolcTtsConfig());
  return Boolean(process.env.tts_key && process.env.tts_base_url);
}

function getFallbackProvider(primary: TtsProvider): TtsProvider | null {
  const explicit = (process.env.tts_fallback_provider || process.env.TTS_FALLBACK_PROVIDER || "")
    .trim()
    .toLowerCase();
  const candidates = explicit
    ? [explicit]
    : primary === "edge"
      ? ["piper", "openai", "volc"]
      : primary === "openai"
        ? ["piper", "edge", "volc"]
        : primary === "volc"
          ? ["edge", "openai", "piper"]
        : ["edge", "openai"];

  for (const candidate of candidates) {
    if (candidate !== "edge" && candidate !== "piper" && candidate !== "openai" && candidate !== "volc") continue;
    if (candidate === primary) continue;
    if (isProviderConfigured(candidate)) return candidate;
  }
  return null;
}

export interface TtsPcmChunk {
  pcm: Buffer;
  sampleRate: number;
  channels: 1;
  bitsPerSample: 16;
}

/** 短句 TTS 内存缓存（S10）：同 provider + 情绪 + 正文命中则跳过合成 */
const TTS_CACHE_MAX_CHARS = Number(process.env.tts_cache_max_chars ?? 24);
const TTS_CACHE_MAX_ENTRIES = Number(process.env.tts_cache_max_entries ?? 80);
const ttsShortAudioCache = new Map<string, Buffer>();

function getTtsCacheVariant(provider: TtsProvider, emotion: Emotion | undefined): string {
  return buildTtsCacheVariant(provider, emotion, {
    voice:
      provider === "volc"
        ? resolveVolcTtsConfig(emotion)?.voiceType ||
          process.env.volc_tts_voice_type ||
          process.env.VOLC_TTS_VOICE_TYPE ||
          process.env.tts_voice ||
          "zh_female_lingling_uranus_bigtts"
        : process.env.tts_voice || (provider === "openai" ? "alloy" : "zh-CN-XiaoyiNeural"),
    lang:
      provider === "volc"
        ? resolveVolcTtsConfig(emotion)?.resourceId ||
          process.env.volc_tts_resource_id ||
          process.env.VOLC_TTS_RESOURCE_ID ||
          "seed-tts-2.0"
        : process.env.tts_lang || "zh-CN",
    rate:
      provider === "volc"
        ? String(resolveVolcTtsConfig(emotion)?.speechRate ?? 0)
        : process.env.tts_rate || "default",
    pitch:
      provider === "volc"
        ? String(resolveVolcTtsConfig(emotion)?.sampleRate ?? 24_000)
        : process.env.tts_pitch || "default",
    model:
      provider === "volc"
        ? resolveVolcTtsConfig(emotion)?.format || "mp3"
        : process.env.tts_model || "tts-1",
    piperModel: getPiperModel(),
  });
}

function getTtsShortCache(key: string): Buffer | null {
  const buf = ttsShortAudioCache.get(key);
  if (!buf) return null;
  ttsShortAudioCache.delete(key);
  ttsShortAudioCache.set(key, buf);
  return Buffer.from(buf);
}

function setTtsShortCache(key: string, buf: Buffer): void {
  if (ttsShortAudioCache.size >= TTS_CACHE_MAX_ENTRIES) {
    const oldest = ttsShortAudioCache.keys().next().value as string | undefined;
    if (oldest !== undefined) ttsShortAudioCache.delete(oldest);
  }
  ttsShortAudioCache.set(key, Buffer.from(buf));
}

function getClient(): OpenAI | null {
  if (client) return client;
  const apiKey = process.env.tts_key;
  const baseURL = process.env.tts_base_url;
  if (!apiKey || !baseURL) return null;
  client = new OpenAI({ apiKey, baseURL, timeout: 15_000 });
  return client;
}

function getPiperCommand(): string {
  return process.env.piper_cmd || "piper";
}

function getPiperModel(): string | null {
  return process.env.piper_model || null;
}

export function normalizeTtsText(raw: string): string {
  return normalizeTtsTextWithConfig(raw, {
    maxChars: Number(process.env.tts_max_chars || 120),
    stripParenthetical: process.env.tts_strip_parenthetical !== "0",
    stripEmoji: process.env.tts_strip_emoji !== "0",
  });
}

export function isTtsEnabled(): boolean {
  return isProviderConfigured(getProvider());
}

function warnTtsDisabledOnce(provider: TtsProvider): void {
  if (warnedTtsDisabled) return;
  warnedTtsDisabled = true;
  if (provider === "piper") {
    logger.warn("已禁用：tts_provider=piper 但未配置 piper_model");
    return;
  }
  if (provider === "volc") {
    logger.warn(
      "已禁用：请配置 VOLC_TTS_API_KEY、VOLC_TTS_RESOURCE_ID 和 VOLC_TTS_VOICE_TYPE",
    );
    return;
  }
  logger.warn("已禁用：请配置 tts_key 和 tts_base_url，或切到 tts_provider=edge");
}

/* ── Abort helpers ── */

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("TTS aborted", "AbortError");
}

function onAbort(signal: AbortSignal | undefined, fn: () => void): () => void {
  if (!signal) return () => {};
  signal.addEventListener("abort", fn, { once: true });
  return () => signal.removeEventListener("abort", fn);
}

/* ── Providers ── */

async function speakWithOpenAI(
  text: string,
  signal?: AbortSignal,
  emotion?: Emotion,
): Promise<Buffer> {
  const openai = getClient();
  if (!openai) {
    throw new Error("TTS 未配置：请在 .env 中设置 tts_key 和 tts_base_url");
  }

  const model = process.env.tts_model || "tts-1";
  const voice = process.env.tts_voice || "alloy";
  const { speed } = getEmotionVoiceParams(emotion ?? "neutral");

  const response = await openai.audio.speech.create({
    model,
    voice: voice as "alloy",
    input: text,
    speed,
  });

  throwIfAborted(signal);
  const arrayBuffer = await response.arrayBuffer();
  throwIfAborted(signal);
  return Buffer.from(arrayBuffer);
}

const PIPER_TIMEOUT_MS = Number(process.env.piper_timeout || 10_000);

async function speakWithPiper(
  text: string,
  signal?: AbortSignal,
  emotion?: Emotion,
): Promise<Buffer> {
  const model = getPiperModel();
  if (!model) throw new Error("TTS 未配置：请在 .env 中设置 piper_model");

  const outFile = path.join(
    os.tmpdir(),
    `rem-tts-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`,
  );
  const cmd = getPiperCommand();
  const speaker = process.env.piper_speaker;
  const ev = getEmotionVoiceParams(emotion ?? "neutral");
  const lengthScale = process.env.piper_length_scale || String(ev.lengthScale);
  const noiseScale = process.env.piper_noise_scale || String(ev.noiseScale);
  const noiseW = process.env.piper_noise_w_scale;

  const args = ["--model", model, "--output_file", outFile];
  if (speaker) args.push("--speaker", speaker);
  args.push("--length_scale", lengthScale);
  args.push("--noise_scale", noiseScale);
  if (noiseW) args.push("--noise_w", noiseW);

  const t0 = Date.now();

  await new Promise<void>((resolve, reject) => {
    const child: ChildProcess = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    let done = false;

    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      cleanup();
      if (err) reject(err); else resolve();
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error(`piper 超时 (${PIPER_TIMEOUT_MS}ms)`));
    }, PIPER_TIMEOUT_MS);

    const cleanup = onAbort(signal, () => {
      child.kill("SIGKILL");
      finish(new DOMException("TTS aborted", "AbortError"));
    });

    child.stderr!.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (err) => finish(err));
    child.on("close", (code) => {
      if (code === 0) finish();
      else finish(new Error(stderr || `piper 退出码: ${code}`));
    });

    child.stdin!.write(text.trim());
    child.stdin!.end();
  });

  logger.info("piper 合成完成", { duration: Date.now() - t0, text: text.slice(0, 30) });

  try {
    return await fs.readFile(outFile);
  } finally {
    await fs.unlink(outFile).catch(() => {});
  }
}

/* ── Edge TTS (in-memory, no disk I/O) ── */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const edgeDrm = require("node-edge-tts/dist/drm");
const EDGE_CHROMIUM_VER: string = edgeDrm.CHROMIUM_FULL_VERSION;
const EDGE_TOKEN: string = edgeDrm.TRUSTED_CLIENT_TOKEN;
const EDGE_TIMEOUT_MS = Number(process.env.edge_tts_timeout || 10_000);
// Edge consumer 端点当前不再接受 PCM outputFormat，只能先拿支持的 MP3 流再转回 pcm16le。
const EDGE_MP3_FORMAT = "audio-24khz-48kbitrate-mono-mp3";
const EDGE_STREAM_SAMPLE_RATE = 24_000;
const EDGE_STREAM_FFMPEG_CMD =
  process.env.edge_tts_stream_ffmpeg_cmd ??
  process.env.EDGE_TTS_STREAM_FFMPEG_CMD ??
  "ffmpeg";
const EDGE_STREAM_FAILURE_COOLDOWN_MS = Number(
  process.env.edge_tts_stream_failure_cooldown_ms ??
  process.env.EDGE_TTS_STREAM_FAILURE_COOLDOWN_MS ??
  120_000,
);

let edgeStreamBlockedUntil = 0;

function isEdgeStreamTemporarilyBlocked(): boolean {
  return Date.now() < edgeStreamBlockedUntil;
}

function markEdgeStreamFailure(err: Error): void {
  edgeStreamBlockedUntil = Date.now() + EDGE_STREAM_FAILURE_COOLDOWN_MS;
  logger.warn("edge 流式 TTS 已临时降级到 buffered 模式", {
    cooldownMs: EDGE_STREAM_FAILURE_COOLDOWN_MS,
    error: err.message,
  });
}

function markEdgeStreamHealthy(): void {
  edgeStreamBlockedUntil = 0;
}

function edgeGecToken(): string {
  return edgeDrm.generateSecMsGecToken();
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => {
    switch (c) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case "\u0022":
        return "&quot;";
      case "\u0027":
        return "&apos;";
      default:
        return c;
    }
  });
}

/* ── Edge TTS 连接池（M7）：同 voice/lang/rate/pitch/fmt 复用一条 WebSocket ── */

const EDGE_POOL_OFF = process.env.edge_tts_pool === "0";
const EDGE_POOL_IDLE_MS = Number(process.env.edge_tts_pool_idle_ms ?? 45_000);
const EDGE_POOL_MAX_SIZE = Number(process.env.edge_tts_pool_max_size ?? 10);

type EdgePoolSlot = {
  ws: WebSocket;
  lastUsed: number;
  idleTimer?: ReturnType<typeof setTimeout>;
};

const edgePoolSlots = new Map<string, EdgePoolSlot>();
const edgePoolSerial = new Map<string, Promise<unknown>>();

// 全局连接计数器和最大限制
let totalActiveConnections = 0;

function edgeConnKey(
  voice: string,
  lang: string,
  rate: string,
  pitch: string,
  outputFormat: string,
): string {
  return `${voice}\0${lang}\0${rate}\0${pitch}\0${outputFormat}`;
}

function runEdgePooled<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = edgePoolSerial.get(key) ?? Promise.resolve();
  const p = prev.then(() => fn());
  edgePoolSerial.set(key, p.then(() => undefined).catch(() => undefined));
  return p;
}

function scheduleEdgePoolIdleClose(key: string, slot: EdgePoolSlot): void {
  if (slot.idleTimer) clearTimeout(slot.idleTimer);
  slot.idleTimer = setTimeout(() => {
    const s = edgePoolSlots.get(key);
    if (!s || s.ws !== slot.ws) return;
    if (Date.now() - s.lastUsed < EDGE_POOL_IDLE_MS - 500) return;
    try {
      s.ws.close();
    } catch {
      /* ignore */
    }
    edgePoolSlots.delete(key);
  }, EDGE_POOL_IDLE_MS);
}

function evictEdgePoolSlot(key: string): void {
  const s = edgePoolSlots.get(key);
  if (!s) return;
  if (s.idleTimer) clearTimeout(s.idleTimer);
  try {
    s.ws.close();
  } catch {
    /* ignore */
  }
  edgePoolSlots.delete(key);
  totalActiveConnections--;
  logger.debug("TTS 连接池移除", {
    activeCount: totalActiveConnections,
    poolKey: key,
  });
}

function buildEdgeSsml(
  text: string,
  voice: string,
  lang: string,
  rate: string,
  pitch: string,
): string {
  const reqId = randomBytes(16).toString("hex");
  return (
    `X-RequestId:${reqId}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n` +
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${lang}">` +
    `<voice name="${voice}"><prosody rate="${rate}" pitch="${pitch}">${escapeXml(text)}</prosody></voice></speak>`
  );
}

function edgeExtractAudioPayload(data: Buffer): Buffer | null {
  const sep = "Path:audio\r\n";
  const idx = data.indexOf(sep);
  if (idx < 0) return null;
  return data.subarray(idx + sep.length);
}

/**
 * 在已打开的 WebSocket 上仅发送 SSML 并收集一轮音频（连接复用路径）。
 */
function edgeCollectOneTurn(
  ws: WebSocket,
  send: () => void,
  signal: AbortSignal | undefined,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let done = false;

    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", abortHandler);
      ws.off("message", onMessage);
      ws.off("error", onError);
      ws.off("close", onClose);
      if (err) reject(err);
      else resolve(Buffer.concat(chunks));
    };

    const timer = setTimeout(() => {
      finish(new Error(`Edge TTS 超时 (${EDGE_TIMEOUT_MS}ms)`));
    }, EDGE_TIMEOUT_MS);

    const abortHandler = () => finish(new DOMException("TTS aborted", "AbortError"));
    if (signal) signal.addEventListener("abort", abortHandler, { once: true });

    const onMessage = (data: Buffer, isBinary: boolean) => {
      if (done) return;
      if (isBinary) {
        const sep = "Path:audio\r\n";
        const idx = data.indexOf(sep);
        if (idx >= 0) chunks.push(data.subarray(idx + sep.length));
      } else if (data.toString().includes("Path:turn.end")) {
        finish();
      }
    };

    const onError = (err: Error) => finish(err);
    const onClose = () => {
      if (!done) finish(new Error("Edge TTS WebSocket 意外关闭"));
    };

    ws.on("message", onMessage);
    ws.on("error", onError);
    ws.on("close", onClose);

    try {
      send();
    } catch (e) {
      finish(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

function edgeTtsBuffer(
  text: string,
  voice: string,
  lang: string,
  rate: string,
  pitch: string,
  outputFormat: string,
  signal?: AbortSignal,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("TTS aborted", "AbortError"));
      return;
    }

    const majorVer = EDGE_CHROMIUM_VER.split(".")[0];
    const ws = new WebSocket(
      `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${EDGE_TOKEN}&Sec-MS-GEC=${edgeGecToken()}&Sec-MS-GEC-Version=1-${EDGE_CHROMIUM_VER}`,
      {
        headers: {
          Pragma: "no-cache",
          "Cache-Control": "no-cache",
          "User-Agent": `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${majorVer}.0.0.0 Safari/537.36 Edg/${majorVer}.0.0.0`,
          "Accept-Encoding": "gzip, deflate, br",
          "Accept-Language": "en-US,en;q=0.9",
          Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
        },
      },
    );

    const chunks: Buffer[] = [];
    let done = false;

    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", abortHandler);
      try { ws.close(); } catch {}
      if (err) reject(err);
      else resolve(Buffer.concat(chunks));
    };

    const timer = setTimeout(() => {
      finish(new Error(`Edge TTS 超时 (${EDGE_TIMEOUT_MS}ms)`));
    }, EDGE_TIMEOUT_MS);

    const abortHandler = () => finish(new DOMException("TTS aborted", "AbortError"));
    if (signal) signal.addEventListener("abort", abortHandler, { once: true });

    ws.on("open", () => {
      ws.send(
        `Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
        `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"${outputFormat}"}}}}`,
      );
      const reqId = randomBytes(16).toString("hex");
      ws.send(
        `X-RequestId:${reqId}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n` +
        `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${lang}">` +
        `<voice name="${voice}"><prosody rate="${rate}" pitch="${pitch}">${escapeXml(text)}</prosody></voice></speak>`,
      );
    });

    ws.on("message", (data: Buffer, isBinary: boolean) => {
      if (done) return;
      if (isBinary) {
        const sep = "Path:audio\r\n";
        const idx = data.indexOf(sep);
        if (idx >= 0) chunks.push(data.subarray(idx + sep.length));
      } else {
        if (data.toString().includes("Path:turn.end")) finish();
      }
    });

    ws.on("error", (err) => finish(err));
    ws.on("close", () => {
      if (!done) finish(new Error("Edge TTS WebSocket 意外关闭"));
    });
  });
}

/** 首次握手：config + SSML，成功后 **不关闭** WebSocket，供连接池复用。 */
function edgeTtsFirstOpenKeepAlive(
  text: string,
  voice: string,
  lang: string,
  rate: string,
  pitch: string,
  outputFormat: string,
  signal?: AbortSignal,
): Promise<{ buf: Buffer; ws: WebSocket }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("TTS aborted", "AbortError"));
      return;
    }

    const majorVer = EDGE_CHROMIUM_VER.split(".")[0];
    const ws = new WebSocket(
      `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${EDGE_TOKEN}&Sec-MS-GEC=${edgeGecToken()}&Sec-MS-GEC-Version=1-${EDGE_CHROMIUM_VER}`,
      {
        headers: {
          Pragma: "no-cache",
          "Cache-Control": "no-cache",
          "User-Agent": `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${majorVer}.0.0.0 Safari/537.36 Edg/${majorVer}.0.0.0`,
          "Accept-Encoding": "gzip, deflate, br",
          "Accept-Language": "en-US,en;q=0.9",
          Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
        },
      },
    );

    const chunks: Buffer[] = [];
    let done = false;

    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", abortHandler);
      if (err) {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        reject(err);
      } else {
        resolve({ buf: Buffer.concat(chunks), ws });
      }
    };

    const timer = setTimeout(() => {
      finish(new Error(`Edge TTS 超时 (${EDGE_TIMEOUT_MS}ms)`));
    }, EDGE_TIMEOUT_MS);

    const abortHandler = () => finish(new DOMException("TTS aborted", "AbortError"));
    if (signal) signal.addEventListener("abort", abortHandler, { once: true });

    ws.on("open", () => {
      ws.send(
        `Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
          `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"${outputFormat}"}}}}`,
      );
      ws.send(buildEdgeSsml(text, voice, lang, rate, pitch));
    });

    ws.on("message", (data: Buffer, isBinary: boolean) => {
      if (done) return;
      if (isBinary) {
        const sep = "Path:audio\r\n";
        const idx = data.indexOf(sep);
        if (idx >= 0) chunks.push(data.subarray(idx + sep.length));
      } else if (data.toString().includes("Path:turn.end")) {
        finish();
      }
    });

    ws.on("error", (err: Error) => finish(err));
    ws.on("close", () => {
      if (!done) finish(new Error("Edge TTS WebSocket 意外关闭"));
    });
  });
}

async function speakWithEdge(
  text: string,
  signal?: AbortSignal,
  emotion?: Emotion,
): Promise<Buffer> {
  throwIfAborted(signal);
  const t0 = Date.now();

  const voice = process.env.tts_voice || "zh-CN-XiaoyiNeural";
  const lang = process.env.tts_lang || "zh-CN";
  const fmt = EDGE_MP3_FORMAT;

  const resolved = emotion ?? "neutral";
  let rate: string;
  let pitch: string;
  if (resolved === "neutral") {
    rate = process.env.tts_rate || "default";
    pitch = process.env.tts_pitch || "default";
  } else {
    const ev = getEmotionVoiceParams(resolved);
    rate = ev.rate;
    pitch = ev.pitch;
  }

  const poolKey = edgeConnKey(voice, lang, rate, pitch, fmt);

  if (EDGE_POOL_OFF) {
    const buf = await edgeTtsBuffer(text, voice, lang, rate, pitch, fmt, signal);
    logger.info("edge 合成完成", { duration: Date.now() - t0, text: text.slice(0, 30) });
    return buf;
  }

  const buf = await runEdgePooled(poolKey, async () => {
    const slot = edgePoolSlots.get(poolKey);
    if (slot?.ws.readyState === WebSocket.OPEN) {
      try {
        const out = await edgeCollectOneTurn(
          slot.ws,
          () => {
            slot.ws.send(buildEdgeSsml(text, voice, lang, rate, pitch));
          },
          signal,
        );
        slot.lastUsed = Date.now();
        scheduleEdgePoolIdleClose(poolKey, slot);
        logger.debug("edge TTS 连接复用命中");
        return out;
      } catch {
        evictEdgePoolSlot(poolKey);
        totalActiveConnections--;
      }
    }

    // 检查连接数是否已达上限
    if (totalActiveConnections >= EDGE_POOL_MAX_SIZE) {
      logger.warn("TTS 连接池已达最大限制，使用缓冲模式", {
        poolSize: totalActiveConnections,
        maxSize: EDGE_POOL_MAX_SIZE,
      });
      // 已达上限时使用缓冲模式，不使用连接池
      const buf = await edgeTtsBuffer(text, voice, lang, rate, pitch, fmt, signal);
      return buf;
    }

    totalActiveConnections++;
    try {
      const { buf: firstBuf, ws } = await edgeTtsFirstOpenKeepAlive(
        text,
        voice,
        lang,
        rate,
        pitch,
        fmt,
        signal,
      );
      // 添加关闭时的清理逻辑
      ws.on("close", () => {
        totalActiveConnections--;
        logger.debug("TTS 连接关闭", {
          activeCount: totalActiveConnections,
          poolKey,
        });
      });
      edgePoolSlots.set(poolKey, { ws, lastUsed: Date.now() });
      const placed = edgePoolSlots.get(poolKey);
      if (placed) scheduleEdgePoolIdleClose(poolKey, placed);
      logger.debug("TTS 连接创建", {
        activeCount: totalActiveConnections,
        poolKey,
      });
      return firstBuf;
    } catch (err) {
      totalActiveConnections--;
      logger.warn("TTS 连接创建失败", {
        error: (err as Error).message,
        activeCount: totalActiveConnections,
      });
      throw err;
    }
  });

  logger.info("edge 合成完成", { duration: Date.now() - t0, text: text.slice(0, 30) });
  return buf;
}

async function speakWithProvider(
  provider: TtsProvider,
  text: string,
  signal?: AbortSignal,
  emotion?: Emotion,
): Promise<Buffer> {
  if (provider === "edge") return speakWithEdge(text, signal, emotion);
  if (provider === "piper") return speakWithPiper(text, signal, emotion);
  if (provider === "volc") return speakWithVolc(text, signal, emotion);
  return speakWithOpenAI(text, signal, emotion);
}

type EdgeStreamChunkHandler = (chunk: TtsPcmChunk) => void;

function streamEdgePcm(
  text: string,
  signal: AbortSignal | undefined,
  emotion: Emotion | undefined,
  onChunk: EdgeStreamChunkHandler,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("TTS aborted", "AbortError"));
      return;
    }

    const voice = process.env.tts_voice || "zh-CN-XiaoyiNeural";
    const lang = process.env.tts_lang || "zh-CN";

    const resolved = emotion ?? "neutral";
    let rate: string;
    let pitch: string;
    if (resolved === "neutral") {
      rate = process.env.tts_rate || "default";
      pitch = process.env.tts_pitch || "default";
    } else {
      const ev = getEmotionVoiceParams(resolved);
      rate = ev.rate;
      pitch = ev.pitch;
    }

    const majorVer = EDGE_CHROMIUM_VER.split(".")[0];
    const decoder = spawn(
      EDGE_STREAM_FFMPEG_CMD,
      [
        "-loglevel",
        "error",
        "-fflags",
        "nobuffer",
        "-flags",
        "low_delay",
        "-probesize",
        "32",
        "-analyzeduration",
        "0",
        "-f",
        "mp3",
        "-i",
        "pipe:0",
        "-f",
        "s16le",
        "-acodec",
        "pcm_s16le",
        "-ac",
        "1",
        "-ar",
        String(EDGE_STREAM_SAMPLE_RATE),
        "pipe:1",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    const ws = new WebSocket(
      `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${EDGE_TOKEN}&Sec-MS-GEC=${edgeGecToken()}&Sec-MS-GEC-Version=1-${EDGE_CHROMIUM_VER}`,
      {
        headers: {
          Pragma: "no-cache",
          "Cache-Control": "no-cache",
          "User-Agent": `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${majorVer}.0.0.0 Safari/537.36 Edg/${majorVer}.0.0.0`,
          "Accept-Encoding": "gzip, deflate, br",
          "Accept-Language": "en-US,en;q=0.9",
          Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
        },
      },
    );

    let done = false;
    let turnEnded = false;
    let decoderClosed = false;
    let decoderStderr = "";
    let timer: ReturnType<typeof setTimeout>;

    const refreshTimeout = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        finish(new Error(`Edge TTS 流式超时 (${EDGE_TIMEOUT_MS}ms)`));
      }, EDGE_TIMEOUT_MS);
    };

    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", abortHandler);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      if (!decoderClosed && decoder.exitCode === null) {
        try {
          decoder.stdin.destroy();
        } catch {
          /* ignore */
        }
        try {
          decoder.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }
      if (err) reject(err);
      else resolve();
    };

    const abortHandler = () => finish(new DOMException("TTS aborted", "AbortError"));
    if (signal) signal.addEventListener("abort", abortHandler, { once: true });
    refreshTimeout();

    decoder.stdout.on("data", (chunk: Buffer) => {
      if (done || chunk.length === 0) return;
      refreshTimeout();
      try {
        onChunk({
          pcm: Buffer.from(chunk),
          sampleRate: EDGE_STREAM_SAMPLE_RATE,
          channels: 1,
          bitsPerSample: 16,
        });
      } catch (err) {
        finish(err instanceof Error ? err : new Error(String(err)));
      }
    });

    decoder.stderr.on("data", (chunk: Buffer) => {
      if (decoderStderr.length >= 2000) return;
      decoderStderr += chunk.toString();
    });

    decoder.stdin.on("error", (err: Error) => {
      if (done) return;
      if (turnEnded && (err as NodeJS.ErrnoException).code === "EPIPE") return;
      finish(err);
    });

    decoder.on("error", (err) => finish(err));
    decoder.on("close", (code) => {
      decoderClosed = true;
      if (done) return;
      if (!turnEnded) {
        finish(new Error(decoderStderr.trim() || `Edge 流式解码提前退出 (${code ?? "null"})`));
        return;
      }
      if (code !== 0) {
        finish(new Error(decoderStderr.trim() || `ffmpeg 退出码: ${code}`));
        return;
      }
      finish();
    });

    ws.on("open", () => {
      ws.send(
        `Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
          `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"${EDGE_MP3_FORMAT}"}}}}`,
      );
      ws.send(buildEdgeSsml(text, voice, lang, rate, pitch));
    });

    ws.on("message", (data: Buffer, isBinary: boolean) => {
      if (done) return;
      refreshTimeout();
      if (isBinary) {
        const payload = edgeExtractAudioPayload(data);
        if (!payload || payload.length === 0) return;
        if (decoder.stdin.destroyed || decoder.stdin.writableEnded) {
          finish(new Error("Edge 流式解码输入已提前关闭"));
          return;
        }
        decoder.stdin.write(payload);
      } else if (data.toString().includes("Path:turn.end")) {
        turnEnded = true;
        if (!decoder.stdin.destroyed && !decoder.stdin.writableEnded) {
          decoder.stdin.end();
        }
      }
    });

    ws.on("error", (err) => finish(err));
    ws.on("close", (code, reason) => {
      if (done || turnEnded) return;
      const suffix = reason.toString().trim();
      finish(
        new Error(
          suffix
            ? `Edge TTS WebSocket 意外关闭 (${code}: ${suffix})`
            : `Edge TTS WebSocket 意外关闭 (${code})`,
        ),
      );
    });
  });
}

/* ── Public API ── */

export async function textToSpeech(
  text: string,
  signal?: AbortSignal,
  emotion?: Emotion,
): Promise<Buffer> {
  throwIfAborted(signal);
  const ttsText = normalizeTtsText(text);
  const provider = getProvider();
  if (!isTtsEnabled()) {
    warnTtsDisabledOnce(provider);
    throw new Error("TTS_DISABLED");
  }

  const shortKey =
    ttsText.length > 0 && ttsText.length <= TTS_CACHE_MAX_CHARS
      ? buildTtsShortCacheKey(provider, ttsText, emotion, getTtsCacheVariant(provider, emotion))
      : null;
  if (shortKey) {
    const hit = getTtsShortCache(shortKey);
    if (hit) {
      throwIfAborted(signal);
      return hit;
    }
  }

  let actualProvider = provider;
  let buf: Buffer;
  try {
    buf = await withRetry(
      () => speakWithProvider(provider, ttsText, signal, emotion),
      { retries: 1, label: `textToSpeech(${provider})` },
    );
  } catch (err) {
    throwIfAborted(signal);
    const fallback = getFallbackProvider(provider);
    if (!fallback) throw err;
    actualProvider = fallback;
    logger.warn("主 TTS 失败，回退到备用 provider", {
      provider,
      fallback,
      error: (err as Error).message,
    });
    buf = await withRetry(
      () => speakWithProvider(fallback, ttsText, signal, emotion),
      { retries: 0, label: `textToSpeech(${fallback})` },
    );
  }

  if (shortKey) {
    setTtsShortCache(shortKey, buf);
    if (actualProvider !== provider) {
      setTtsShortCache(
        buildTtsShortCacheKey(
          actualProvider,
          ttsText,
          emotion,
          getTtsCacheVariant(actualProvider, emotion),
        ),
        buf,
      );
    }
  }
  return buf;
}

export function canStreamTextToSpeech(): boolean {
  const streamingEnabled =
    process.env.rem_tts_stream === "1" || process.env.REMI_TTS_STREAM === "1";
  return (
    streamingEnabled &&
    getProvider() === "edge" &&
    isTtsEnabled() &&
    !isEdgeStreamTemporarilyBlocked()
  );
}

/** 服务启动时预热 Edge TTS 连接池：提前建立 1-2 个空闲连接，避免首次请求 TLS 握手延迟 */
export async function warmupEdgeTtsConnections(count: number = 2): Promise<void> {
  if (EDGE_POOL_OFF || getProvider() !== "edge" || !isTtsEnabled()) return;
  if (count < 1 || count > 4) count = 2;

  const voice = process.env.tts_voice || "zh-CN-XiaoyiNeural";
  const lang = process.env.tts_lang || "zh-CN";
  const fmt = EDGE_MP3_FORMAT;
  const defaultRate = process.env.tts_rate || "default";
  const defaultPitch = process.env.tts_pitch || "default";

  // 预热默认情绪（neutral）的连接，以及常用情绪如 happy/soft 可选
  const commonEmotions: Emotion[] = ["neutral", "happy"];
  const warmupCount = Math.min(count, commonEmotions.length);

  for (let i = 0; i < warmupCount; i++) {
    const emotion = commonEmotions[i];
    const { rate, pitch } = emotion === "neutral"
      ? { rate: defaultRate, pitch: defaultPitch }
      : getEmotionVoiceParams(emotion);
    const poolKey = edgeConnKey(voice, lang, rate, pitch, fmt);
    if (edgePoolSlots.has(poolKey)) continue;

    try {
      // 合成一个极短的空文本占位，仅用于建立连接
      await runEdgePooled(poolKey, async () => {
        const { ws } = await edgeTtsFirstOpenKeepAlive(
          "嗯",
          voice,
          lang,
          rate,
          pitch,
          fmt,
          undefined
        );
        edgePoolSlots.set(poolKey, { ws, lastUsed: Date.now() });
        const placed = edgePoolSlots.get(poolKey);
        if (placed) scheduleEdgePoolIdleClose(poolKey, placed);
        logger.debug("Edge TTS 连接预热完成", { emotion, poolKey });
      });
    } catch (err) {
      logger.warn("Edge TTS 连接预热失败", { error: (err as Error).message });
    }
  }
}

export async function streamTextToSpeech(
  text: string,
  onChunk: EdgeStreamChunkHandler,
  signal?: AbortSignal,
  emotion?: Emotion,
): Promise<void> {
  throwIfAborted(signal);
  const ttsText = normalizeTtsText(text);
  const provider = getProvider();
  if (!isTtsEnabled()) {
    warnTtsDisabledOnce(provider);
    throw new Error("TTS_DISABLED");
  }
  if (provider !== "edge") {
    throw new Error("TTS_STREAM_UNSUPPORTED_PROVIDER");
  }
  if (isEdgeStreamTemporarilyBlocked()) {
    throw new Error("TTS_STREAM_TEMP_DISABLED");
  }

  try {
    await withRetry(
      () => streamEdgePcm(ttsText, signal, emotion, onChunk),
      { retries: 1, label: "streamTextToSpeech(edge)" },
    );
    markEdgeStreamHealthy();
  } catch (err) {
    if ((err as Error).name !== "AbortError") {
      markEdgeStreamFailure(err as Error);
    }
    throw err;
  }
}
