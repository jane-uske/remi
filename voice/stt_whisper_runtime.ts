import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

import { createLogger } from "../infra/logger";

type WhisperLogger = {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
};

type SpawnFn = typeof spawn;
type FetchFn = typeof fetch;

export type WhisperServerConfig = {
  useServer: boolean;
  host: string;
  port: number;
  inferencePath: string;
  baseUrl: string;
  inferenceUrl: string;
  autostart: boolean;
  cooldownMs: number;
  readyTimeoutMs: number;
  requestTimeoutMs: number;
  previewEnabled: boolean;
  cmd: string;
  model: string | null;
  lang: string;
  prompt: string | null;
  extraArgs: string[];
};

type WhisperServerState = {
  proc: ChildProcess | null;
  startPromise: Promise<void> | null;
  failedUntil: number;
};

export type WhisperServerRuntimeDeps = {
  env?: NodeJS.ProcessEnv;
  spawn?: SpawnFn;
  fetch?: FetchFn;
  logger?: WhisperLogger;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export type WhisperTranscribeFallback = () => Promise<string>;

export type WhisperServerRuntime = {
  readConfig(): WhisperServerConfig;
  canUseServer(): boolean;
  canPreview(): boolean;
  warm(): Promise<boolean>;
  shutdown(): Promise<void>;
  transcribeWebm(audio: Buffer): Promise<string>;
  transcribeWav(wav: Buffer, sampleRate: number): Promise<string>;
  previewWav(wav: Buffer, sourceRate: number, externalSignal?: AbortSignal): Promise<string | null>;
  previewPcm(pcm: Buffer, sampleRate: number, maxWindowMs?: number, externalSignal?: AbortSignal): Promise<string | null>;
  transcribePreferServer(wav: Buffer, cliFallback: WhisperTranscribeFallback, externalSignal?: AbortSignal): Promise<string>;
};

const defaultLogger = createLogger("stt");

export function readWhisperServerConfig(env: NodeJS.ProcessEnv = process.env): WhisperServerConfig {
  const useServerRaw = (env.whisper_use_server ?? env.WHISPER_USE_SERVER ?? "1").trim();
  const useServer = useServerRaw !== "0" && useServerRaw.toLowerCase() !== "false";

  const host = (env.whisper_server_host ?? env.WHISPER_SERVER_HOST ?? "127.0.0.1").trim();

  const portRaw = env.whisper_server_port ?? env.WHISPER_SERVER_PORT ?? "8080";
  const parsedPort = Number(portRaw);
  const port = Number.isFinite(parsedPort) && parsedPort > 0 ? Math.floor(parsedPort) : 8080;

  const inferencePathRaw = (env.whisper_server_request_path ?? env.WHISPER_SERVER_REQUEST_PATH ?? "/inference").trim();
  const inferencePath = inferencePathRaw ? (inferencePathRaw.startsWith("/") ? inferencePathRaw : `/${inferencePathRaw}`) : "/inference";

  const baseUrlRaw = (env.whisper_server_url ?? env.WHISPER_SERVER_URL ?? "").trim();
  const baseUrl = baseUrlRaw ? baseUrlRaw.replace(/\/+$/, "") : `http://${host}:${port}`;

  const autostartRaw = (env.whisper_server_autostart ?? env.WHISPER_SERVER_AUTOSTART ?? "1").trim();
  const autostart = autostartRaw !== "0" && autostartRaw.toLowerCase() !== "false";

  const retryCooldownRaw = env.whisper_server_retry_cooldown_ms ?? env.WHISPER_SERVER_RETRY_COOLDOWN_MS ?? "30000";
  const retryCooldown = Number(retryCooldownRaw);
  const cooldownMs = Number.isFinite(retryCooldown) && retryCooldown >= 0 ? retryCooldown : 30_000;

  const readyTimeoutRaw = env.whisper_server_ready_timeout_ms ?? env.WHISPER_SERVER_READY_TIMEOUT_MS ?? "5000";
  const readyTimeout = Number(readyTimeoutRaw);
  const readyTimeoutMs = Number.isFinite(readyTimeout) && readyTimeout >= 500 ? readyTimeout : 5000;

  const requestTimeoutRaw = env.whisper_server_request_timeout_ms ?? env.WHISPER_SERVER_REQUEST_TIMEOUT_MS ?? "8000";
  const requestTimeout = Number(requestTimeoutRaw);
  const requestTimeoutMs = Number.isFinite(requestTimeout) && requestTimeout >= 1000 ? requestTimeout : 8000;

  const previewRaw = (env.stt_preview_enabled ?? env.STT_PREVIEW_ENABLED ?? "1").trim();
  const previewEnabled = previewRaw !== "0" && previewRaw.toLowerCase() !== "false";

  const cmd = (env.whisper_server_cmd ?? env.WHISPER_SERVER_CMD ?? "whisper-server").trim() || "whisper-server";
  const model = (env.whisper_model ?? "").trim() || null;
  const lang = (env.whisper_lang ?? "zh").trim() || "zh";
  const prompt = (env.whisper_prompt ?? "").trim() || null;
  const extraArgsRaw = env.whisper_server_extra_args ?? env.WHISPER_SERVER_EXTRA_ARGS ?? "";
  const extraArgs = extraArgsRaw.split(/\s+/).filter(Boolean);

  return {
    useServer,
    host,
    port,
    inferencePath,
    baseUrl,
    inferenceUrl: `${baseUrl}${inferencePath}`,
    autostart,
    cooldownMs,
    readyTimeoutMs,
    requestTimeoutMs,
    previewEnabled,
    cmd,
    model,
    lang,
    prompt,
    extraArgs,
  };
}

export function buildWhisperServerArgs(config: WhisperServerConfig): string[] {
  if (!config.model) {
    throw new Error("STT 未配置：请设置 whisper_model 指向 ggml 模型文件");
  }
  const args = [
    "-m",
    config.model,
    "-l",
    config.lang,
    "--host",
    config.host,
    "--port",
    String(config.port),
    "--inference-path",
    config.inferencePath,
    "--convert",
  ];
  if (config.prompt) args.push("--prompt", config.prompt);
  if (config.extraArgs.length > 0) args.push(...config.extraArgs);
  return args;
}

export function createWhisperServerRuntime(deps: WhisperServerRuntimeDeps = {}): WhisperServerRuntime {
  const env = deps.env ?? process.env;
  const spawnFn = deps.spawn ?? spawn;
  const fetchFn = deps.fetch ?? fetch;
  const logger = deps.logger ?? defaultLogger;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const state: WhisperServerState = {
    proc: null,
    startPromise: null,
    failedUntil: 0,
  };

  function config(): WhisperServerConfig {
    return readWhisperServerConfig(env);
  }

  function canUseServer(): boolean {
    return config().useServer;
  }

  function canPreview(): boolean {
    const current = config();
    return current.useServer && current.previewEnabled;
  }

  function tmpPath(ext: string): string {
    return path.join(
      os.tmpdir(),
      `rem-stt-${now()}-${Math.random().toString(36).slice(2)}.${ext}`,
    );
  }

  function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
    const header = Buffer.alloc(44);
    const dataLen = pcm.length;

    header.write("RIFF", 0);
    header.writeUInt32LE(36 + dataLen, 4);
    header.write("WAVE", 8);
    header.write("fmt ", 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write("data", 36);
    header.writeUInt32LE(dataLen, 40);

    return Buffer.concat([header, pcm]);
  }

  function slicePcmWindow(pcm: Buffer, sampleRate: number, maxWindowMs?: number): Buffer {
    if (pcm.length === 0) return pcm;
    const windowMs = Number.isFinite(maxWindowMs) && (maxWindowMs as number) > 0
      ? (maxWindowMs as number)
      : 0;
    if (windowMs <= 0) return pcm;
    const keepBytes = Math.floor((sampleRate * 2 * windowMs) / 1000);
    if (keepBytes <= 0 || pcm.length <= keepBytes) return pcm;
    return pcm.subarray(pcm.length - keepBytes);
  }

  function run(cmd: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawnFn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (d) => {
        stdout += d.toString();
      });
      child.stderr?.on("data", (d) => {
        stderr += d.toString();
      });
      child.on("error", (err) =>
        reject(new Error(`${cmd} 启动失败: ${(err as Error).message}`)),
      );
      child.on("close", (code) => {
        if (code === 0) resolve(stdout);
        else reject(new Error(stderr || `${cmd} 退出码 ${code}`));
      });
    });
  }

  async function waitWhisperServerReady(): Promise<void> {
    const current = config();
    const deadline = now() + current.readyTimeoutMs;
    while (now() < deadline) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 800);
        const res = await fetchFn(current.baseUrl, { method: "GET", signal: controller.signal });
        clearTimeout(timer);
        if (res.ok) return;
      } catch {
        // retry until timeout
      }
      await sleep(120);
    }
    throw new Error("whisper-server readiness timeout");
  }

  async function ensureWhisperServerReady(): Promise<boolean> {
    const current = config();
    if (!current.useServer) return false;
    if (!current.autostart) return true;
    const nowTs = now();
    if (state.failedUntil > nowTs) return false;
    if (state.proc && state.proc.exitCode === null) return true;
    if (state.startPromise) {
      try {
        await state.startPromise;
        return true;
      } catch {
        return false;
      }
    }

    const args = buildWhisperServerArgs(current);
    state.startPromise = (async () => {
      let stderrTail = "";
      await new Promise<void>((resolve, reject) => {
        const proc = spawnFn(current.cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
        state.proc = proc;

        proc.stderr?.on("data", (d) => {
          stderrTail = (stderrTail + d.toString()).slice(-4000);
        });

        proc.once("error", (err) => {
          state.proc = null;
          reject(err);
        });

        proc.on("exit", (code, signal) => {
          state.proc = null;
          if (code !== 0 && code !== null) {
            logger.warn("whisper-server exited", { code, signal });
          }
        });

        void waitWhisperServerReady()
          .then(() => {
            logger.info("whisper-server ready", { url: current.inferenceUrl });
            resolve();
          })
          .catch((err) => {
            try {
              proc.kill("SIGKILL");
            } catch {
              // best effort
            }
            state.proc = null;
            reject(err);
          });
      }).catch((err) => {
        throw new Error(
          `whisper-server 启动失败: ${(err as Error).message}${stderrTail ? ` | ${stderrTail.slice(-300)}` : ""}`,
        );
      });
    })();

    try {
      await state.startPromise;
      return true;
    } catch (err) {
      state.failedUntil = now() + current.cooldownMs;
      logger.warn("whisper-server unavailable, fallback to whisper-cli", {
        error: (err as Error).message,
        cooldownMs: current.cooldownMs,
      });
      return false;
    } finally {
      state.startPromise = null;
    }
  }

  async function transcribeWithWhisperServer(wav: Buffer, externalSignal?: AbortSignal): Promise<string> {
    const current = config();
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "audio.wav");
    form.append("response_format", "json");
    const tempRaw = env.stt_temperature;
    if (tempRaw !== undefined && tempRaw !== "") form.append("temperature", String(tempRaw));
    if (current.prompt) form.append("prompt", current.prompt);

    const controller = new AbortController();
    const abortFromExternal = () => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort();
      } else {
        externalSignal.addEventListener("abort", abortFromExternal, { once: true });
      }
    }
    const timer = setTimeout(() => controller.abort(), current.requestTimeoutMs);
    try {
      const res = await fetchFn(current.inferenceUrl, {
        method: "POST",
        body: form,
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
      }
      const bodyText = (await res.text()).trim();
      if (!bodyText) return "";
      try {
        const parsed = JSON.parse(bodyText) as { text?: string };
        return (parsed.text || "").trim();
      } catch {
        return bodyText.trim();
      }
    } finally {
      clearTimeout(timer);
      if (externalSignal) {
        externalSignal.removeEventListener("abort", abortFromExternal);
      }
    }
  }

  async function transcribePreviewWithWhisperServer(
    wav: Buffer,
    externalSignal?: AbortSignal,
  ): Promise<string | null> {
    try {
      const ready = await ensureWhisperServerReady();
      if (!ready) return null;
      return await transcribeWithWhisperServer(wav, externalSignal);
    } catch (err) {
      logger.debug("whisper-server preview unavailable", {
        error: (err as Error).message,
      });
      return null;
    }
  }

  async function whisperTranscribeCli(wavPath: string): Promise<string> {
    const current = config();
    if (!current.model) {
      throw new Error("STT 未配置：请设置 whisper_model 指向 ggml 模型文件");
    }

    const cmd = (env.whisper_cmd ?? "whisper-cli").trim() || "whisper-cli";
    const args = [
      "-m",
      current.model,
      "-f",
      wavPath,
      "-l",
      current.lang,
      "--no-timestamps",
    ];

    if (current.prompt) {
      args.push("--prompt", current.prompt);
    }

    const extraArgs = (env.whisper_extra_args ?? "").split(/\s+/).filter(Boolean);
    if (extraArgs.length > 0) {
      args.push(...extraArgs);
    }

    let raw: string;
    try {
      raw = await run(cmd, args);
    } catch {
      await sleep(350);
      raw = await run(cmd, args);
    }

    return raw
      .replace(/^\[.*?\]\s*/gm, "")
      .replace(/\[BLANK_AUDIO\]/g, "")
      .trim();
  }

  async function transcribePreferServer(
    wav: Buffer,
    cliFallback: WhisperTranscribeFallback,
    externalSignal?: AbortSignal,
  ): Promise<string> {
    const current = config();
    if (current.useServer) {
      try {
        const ready = await ensureWhisperServerReady();
        if (ready) {
          return await transcribeWithWhisperServer(wav, externalSignal);
        }
      } catch (err) {
        logger.warn("whisper-server request failed, fallback to whisper-cli", {
          error: (err as Error).message,
        });
      }
    }
    return cliFallback();
  }

  async function transcribeWebm(audio: Buffer): Promise<string> {
    const current = config();
    if (!current.model) {
      throw new Error("STT 未配置：请设置 whisper_model 指向 ggml 模型文件");
    }

    const webm = tmpPath("webm");
    const wav = tmpPath("wav");
    fs.writeFileSync(webm, audio);

    try {
      await run("ffmpeg", [
        "-i",
        webm,
        "-ar",
        "16000",
        "-ac",
        "1",
        "-f",
        "wav",
        wav,
        "-y",
        "-loglevel",
        "error",
      ]);
      return await transcribePreferServer(
        fs.readFileSync(wav),
        () => whisperTranscribeCli(wav),
      );
    } finally {
      try {
        fs.unlinkSync(webm);
      } catch {
        // best effort
      }
      try {
        fs.unlinkSync(wav);
      } catch {
        // best effort
      }
    }
  }

  async function transcribeWav(wav: Buffer, sampleRate: number): Promise<string> {
    const current = config();
    if (!current.model) {
      throw new Error("STT 未配置：请设置 whisper_model 指向 ggml 模型文件");
    }

    const wavPath = tmpPath("wav");
    fs.writeFileSync(wavPath, wav);

    if (sampleRate !== 16000) {
      const resampled = tmpPath("wav");
      try {
        await run("ffmpeg", [
          "-i",
          wavPath,
          "-ar",
          "16000",
          "-ac",
          "1",
          "-f",
          "wav",
          resampled,
          "-y",
          "-loglevel",
          "error",
        ]);
        fs.unlinkSync(wavPath);
        const text = await transcribePreferServer(
          fs.readFileSync(resampled),
          () => whisperTranscribeCli(resampled),
        );
        fs.unlinkSync(resampled);
        return text;
      } catch (err) {
        try {
          fs.unlinkSync(resampled);
        } catch {
          // best effort
        }
        throw err;
      }
    }

    try {
      return await transcribePreferServer(
        fs.readFileSync(wavPath),
        () => whisperTranscribeCli(wavPath),
      );
    } finally {
      try {
        fs.unlinkSync(wavPath);
      } catch {
        // best effort
      }
    }
  }

  async function previewWav(wav: Buffer, sourceRate: number, externalSignal?: AbortSignal): Promise<string | null> {
    const current = config();
    if (!current.model) return null;
    const wavPath = tmpPath("wav");
    fs.writeFileSync(wavPath, wav);
    try {
      if (sourceRate !== 16000) {
        const resampled = tmpPath("wav");
        try {
          await run("ffmpeg", [
            "-i",
            wavPath,
            "-ar",
            "16000",
            "-ac",
            "1",
            "-f",
            "wav",
            resampled,
            "-y",
            "-loglevel",
            "error",
          ]);
          fs.unlinkSync(wavPath);
          const text = await transcribePreviewWithWhisperServer(fs.readFileSync(resampled), externalSignal);
          fs.unlinkSync(resampled);
          return text;
        } catch {
          try {
            fs.unlinkSync(resampled);
          } catch {
            // best effort
          }
          return null;
        }
      }
      return await transcribePreviewWithWhisperServer(fs.readFileSync(wavPath), externalSignal);
    } finally {
      try {
        fs.unlinkSync(wavPath);
      } catch {
        // best effort
      }
    }
  }

  async function previewPcm(pcm: Buffer, sampleRate: number, maxWindowMs?: number, externalSignal?: AbortSignal): Promise<string | null> {
    const current = config();
    if (!current.previewEnabled || !current.useServer) return null;
    const sliced = slicePcmWindow(pcm, sampleRate, maxWindowMs);
    if (sliced.length < sampleRate) return "";
    return await previewWav(pcmToWav(sliced, sampleRate), sampleRate, externalSignal);
  }

  async function warm(): Promise<boolean> {
    return ensureWhisperServerReady();
  }

  async function shutdown(): Promise<void> {
    const proc = state.proc;
    state.proc = null;
    state.startPromise = null;
    state.failedUntil = 0;
    if (!proc || proc.exitCode !== null) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          // best effort
        }
        resolve();
      }, 1500);
      proc.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      try {
        proc.kill("SIGTERM");
      } catch {
        clearTimeout(timer);
        resolve();
      }
    });
  }

  return {
    readConfig: config,
    canUseServer,
    canPreview,
    warm,
    shutdown,
    transcribeWebm,
    transcribeWav,
    previewWav,
    previewPcm,
    transcribePreferServer,
  };
}

export const whisperServerRuntime = createWhisperServerRuntime();
