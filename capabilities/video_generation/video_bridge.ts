/**
 * Shell-out bridge to the Python storyboard runner (Z-Image + LTX 2.3).
 *
 * Runs the runner as a child process — no new dependencies, no TCP server.
 * Reads video settings from the runtime overlay (`data/remi-settings.json`).
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

import { createLogger } from "../../infra/logger";
import { getConfig } from "../../server/config";

const logger = createLogger("video_bridge");

/** A progress event parsed from the runner's stderr `@@PROGRESS@@` lines. */
export interface VideoProgress {
  stage: string;
  done: number;
  total: number;
  label: string;
  /** 1-based shot index when the stage is shot-scoped. */
  shot?: number;
  /** done/total as a 0–100 integer, clamped. */
  percent: number;
}

export interface VideoGenerateParams {
  prompt: string;
  runName?: string;
  signal?: AbortSignal;
  /** Called for each progress event streamed from the runner. */
  onProgress?: (p: VideoProgress) => void;
}

const PROGRESS_SENTINEL = "@@PROGRESS@@";

export interface VideoGenerateResult {
  runName: string;
  finalPath: string;
  manifestPath: string;
  referenceImage: string | null;
  shotCount: number;
}

export class VideoGenerationError extends Error {
  constructor(
    message: string,
    readonly kind: "unreachable" | "timeout" | "runner_error" | "aborted",
  ) {
    super(message);
    this.name = "VideoGenerationError";
  }
}

// ── Settings helpers ────────────────────────────────────────────────

interface VideoSettings {
  VIDEO_CHARACTER?: string;
  VIDEO_SCENE?: string;
  VIDEO_STYLE?: string;
  VIDEO_NEGATIVE?: string;
  VIDEO_WIDTH?: string;
  VIDEO_HEIGHT?: string;
  VIDEO_SHOTS?: string;
  VIDEO_FPS?: string;
  VIDEO_REFERENCE_RUN?: string;
}

function readVideoSettings(): VideoSettings {
  try {
    const settingsPath = path.resolve(process.cwd(), "data/remi-settings.json");
    const raw = fs.readFileSync(settingsPath, "utf-8");
    return JSON.parse(raw) as VideoSettings;
  } catch {
    return {};
  }
}

// ── Runner discovery ────────────────────────────────────────────────

const WELL_KNOWN_RUNNER =
  "/Users/rare/ComfyUI-Installs/ComfyUI/ComfyUI/tools/zimage_ltx_storyboard_runner.py";
const WELL_KNOWN_PYTHON =
  "/Users/rare/ComfyUI-Installs/ComfyUI/ComfyUI/.venv/bin/python";

function resolveRunnerPath(): string {
  const cfg = getConfig();
  if (cfg.STORYBOARD_RUNNER_PATH?.trim()) return cfg.STORYBOARD_RUNNER_PATH.trim();
  if (fs.existsSync(WELL_KNOWN_RUNNER)) return WELL_KNOWN_RUNNER;
  throw new VideoGenerationError(
    "Cannot find storyboard runner. Set STORYBOARD_RUNNER_PATH in .env.",
    "unreachable",
  );
}

function resolvePython(): string {
  const cfg = getConfig();
  if (cfg.STORYBOARD_RUNNER_PYTHON?.trim()) return cfg.STORYBOARD_RUNNER_PYTHON.trim();
  if (fs.existsSync(WELL_KNOWN_PYTHON)) return WELL_KNOWN_PYTHON;
  return "python3";
}

// ── Slug helper ─────────────────────────────────────────────────────

function safeSlug(value: string): string {
  const cleaned = value
    .trim()
    .replace(/[^a-zA-Z0-9一-鿿_-]/gu, "_")
    .replace(/__+/g, "_")
    .replace(/^_|_$/g, "");
  return cleaned.slice(0, 48) || `video_${Date.now()}`;
}

// ── Main entry ──────────────────────────────────────────────────────

export async function generateVideo(
  params: VideoGenerateParams,
): Promise<VideoGenerateResult> {
  const config = getConfig();
  const settings = readVideoSettings();
  const runnerPath = resolveRunnerPath();
  const pythonPath = resolvePython();
  const outputDir = config.COMFYUI_SHARED_OUTPUT_DIR;
  const runName = safeSlug(params.runName || params.prompt.slice(0, 32));

  // Build overrides from settings.
  const overrides: Record<string, string> = {};
  if (settings.VIDEO_CHARACTER?.trim()) overrides.character_anchor = settings.VIDEO_CHARACTER.trim();
  if (settings.VIDEO_SCENE?.trim()) overrides.scene = settings.VIDEO_SCENE.trim();
  if (settings.VIDEO_STYLE?.trim()) overrides.global_style = settings.VIDEO_STYLE.trim();
  if (settings.VIDEO_NEGATIVE?.trim()) overrides.negative_prompt = settings.VIDEO_NEGATIVE.trim();

  const width = parseInt(settings.VIDEO_WIDTH || "512", 10) || 512;
  const height = parseInt(settings.VIDEO_HEIGHT || "768", 10) || 768;
  const shots = parseInt(settings.VIDEO_SHOTS || "8", 10) || 8;
  const fps = parseInt(settings.VIDEO_FPS || "8", 10) || 8;

  const args: string[] = [
    runnerPath,
    "--prompt", params.prompt,
    "--planner", "auto",
    "--run-name", runName,
    "--resume",
    "--width", String(width),
    "--height", String(height),
    "--shots", String(Math.min(Math.max(shots, 1), 12)),
    "--fps", String(fps),
    "--shot-duration", "4",
    "--output-dir", outputDir,
    "--input-dir", config.COMFYUI_SHARED_OUTPUT_DIR.replace(/\/output\/?$/, "/input"),
    "--image-timeout", "900",
    "--video-timeout", String(Math.floor(config.COMFYUI_VIDEO_TIMEOUT_MS / 1000)),
  ];

  if (Object.keys(overrides).length > 0) {
    args.push("--overrides-json", JSON.stringify(overrides));
  }

  // If a reference run is selected, point to its manifest for identity reuse.
  const refRun = settings.VIDEO_REFERENCE_RUN?.trim();
  if (refRun) {
    const refManifest = path.join(outputDir, refRun, "manifest.json");
    if (fs.existsSync(refManifest)) {
      // The runner's --resume will reuse the reference image from an existing manifest
      // if the run directory already has one. We copy the reference into the new run.
      try {
        const refData = JSON.parse(fs.readFileSync(refManifest, "utf-8"));
        const refOutput = refData?.reference?.output;
        if (refOutput && fs.existsSync(refOutput)) {
          const targetDir = path.join(outputDir, runName);
          fs.mkdirSync(targetDir, { recursive: true });
          const targetRef = path.join(targetDir, path.basename(refOutput));
          if (!fs.existsSync(targetRef)) {
            fs.copyFileSync(refOutput, targetRef);
          }
          logger.info("copied reference image from previous run", {
            from: refRun,
            to: runName,
          });
        }
      } catch (err) {
        logger.warn("failed to copy reference from previous run", {
          refRun,
          error: (err as Error).message,
        });
      }
    }
  }

  // Forward LLM config from Remi's env so the runner uses the same local model.
  const env = {
    ...process.env,
    REMI_LLM_BASE_URL: config.REMI_LLM_BASE_URL,
    REMI_LLM_MODEL: config.REMI_LLM_MODEL,
    REMI_LLM_API_KEY: config.REMI_LLM_API_KEY,
  };

  logger.info("starting video generation", {
    runName,
    prompt: params.prompt.slice(0, 80),
    width,
    height,
    shots,
    fps,
    overrideKeys: Object.keys(overrides),
    refRun: refRun || null,
  });

  // spawn (not execFile) so we can stream the runner's stderr line-by-line and
  // surface @@PROGRESS@@ events while it runs. stdout is buffered for the final
  // manifest JSON; stderr non-progress lines are kept (capped) for error context.
  return new Promise<VideoGenerateResult>((resolve, reject) => {
    const child = spawn(pythonPath, args, { env });

    let stdout = "";
    const stderrTail: string[] = [];
    const STDERR_TAIL_MAX = 40;
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    // Hard timeout (matches the old execFile timeout: window + 1 min for ffmpeg).
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(() =>
        reject(new VideoGenerationError("video generation timed out", "timeout")),
      );
    }, config.COMFYUI_VIDEO_TIMEOUT_MS + 60_000);

    if (params.signal) {
      if (params.signal.aborted) child.kill("SIGTERM");
      params.signal.addEventListener(
        "abort",
        () => {
          child.kill("SIGTERM");
          finish(() =>
            reject(new VideoGenerationError("video generation aborted", "aborted")),
          );
        },
        { once: true },
      );
    }

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });

    // Parse stderr lines: @@PROGRESS@@ → onProgress; everything else → error tail.
    const rl = readline.createInterface({ input: child.stderr });
    rl.on("line", (line: string) => {
      const trimmed = line.trim();
      if (trimmed.startsWith(PROGRESS_SENTINEL)) {
        if (!params.onProgress) return;
        try {
          const raw = JSON.parse(trimmed.slice(PROGRESS_SENTINEL.length).trim());
          const total = Number(raw.total) || 0;
          const doneUnits = Number(raw.done) || 0;
          const percent = total > 0
            ? Math.min(100, Math.max(0, Math.round((doneUnits / total) * 100)))
            : 0;
          params.onProgress({
            stage: String(raw.stage ?? ""),
            done: doneUnits,
            total,
            label: String(raw.label ?? ""),
            shot: typeof raw.shot === "number" ? raw.shot : undefined,
            percent,
          });
        } catch {
          /* ignore malformed progress line */
        }
        return;
      }
      if (trimmed) {
        stderrTail.push(trimmed);
        if (stderrTail.length > STDERR_TAIL_MAX) stderrTail.shift();
      }
    });

    child.on("error", (err: Error) => {
      finish(() =>
        reject(new VideoGenerationError(
          `Failed to start runner: ${err.message}`,
          "unreachable",
        )),
      );
    });

    child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
      if (params.signal?.aborted) {
        finish(() =>
          reject(new VideoGenerationError("video generation aborted", "aborted")),
        );
        return;
      }
      if (code !== 0) {
        const msg = stderrTail.join("\n").trim() || `runner exited with code ${code}`;
        logger.error("video runner failed", { runName, code, signal, error: msg.slice(0, 500) });
        finish(() =>
          reject(new VideoGenerationError(
            msg.replace(/^ERROR:\s*/im, "").slice(0, 300),
            signal === "SIGTERM" || signal === "SIGKILL" ? "aborted" : "runner_error",
          )),
        );
        return;
      }

      try {
        const manifest = JSON.parse(stdout);
        const finalVideo = manifest.final_video;
        if (!finalVideo || !fs.existsSync(finalVideo)) {
          finish(() =>
            reject(new VideoGenerationError("runner finished but no final video found", "runner_error")),
          );
          return;
        }
        const refImage = manifest.reference?.output ?? null;

        logger.info("video generation complete", {
          runName,
          finalVideo,
          shots: manifest.config?.shots?.length ?? 0,
        });

        finish(() =>
          resolve({
            runName,
            finalPath: finalVideo,
            manifestPath: path.join(outputDir, runName, "manifest.json"),
            referenceImage: refImage && fs.existsSync(refImage) ? refImage : null,
            shotCount: manifest.config?.shots?.length ?? 0,
          }),
        );
      } catch (parseErr) {
        logger.error("failed to parse runner output", {
          runName,
          stdout: stdout.slice(0, 500),
        });
        finish(() =>
          reject(new VideoGenerationError(
            `Runner output was not valid JSON: ${(parseErr as Error).message}`,
            "runner_error",
          )),
        );
      }
    });
  });
}

// ── List past runs ──────────────────────────────────────────────────

export interface VideoRunSummary {
  runName: string;
  prompt: string;
  shotCount: number;
  finalExists: boolean;
  referenceImage: string | null;
  createdAt: string;
}

export function listVideoRuns(): VideoRunSummary[] {
  const config = getConfig();
  const outputDir = config.COMFYUI_SHARED_OUTPUT_DIR;
  if (!fs.existsSync(outputDir)) return [];

  const entries = fs.readdirSync(outputDir, { withFileTypes: true });
  const runs: VideoRunSummary[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(outputDir, entry.name, "manifest.json");
    if (!fs.existsSync(manifestPath)) continue;

    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      const config2 = manifest.config || {};
      const finalVideo = manifest.final_video || "";
      const refImage = manifest.reference?.output || null;
      const stat = fs.statSync(manifestPath);

      runs.push({
        runName: entry.name,
        prompt: config2.prompt || "",
        shotCount: (config2.shots || []).length,
        finalExists: Boolean(finalVideo && fs.existsSync(finalVideo)),
        referenceImage: refImage && fs.existsSync(refImage) ? refImage : null,
        createdAt: stat.mtime.toISOString(),
      });
    } catch {
      // Skip malformed manifests.
    }
  }

  return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
