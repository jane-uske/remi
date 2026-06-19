import type { IncomingMessage, ServerResponse } from "node:http";

import { createLogger } from "../../infra/logger";
import { getConfig, resetConfig } from "../config";
import {
  OVERLAY_WRITABLE_KEYS,
  loadOverlay,
  saveOverlay,
} from "../config/overlay";

const logger = createLogger("settings_api");

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

/**
 * Current effective values for the overlay-writable subset — i.e. what the
 * settings page should display. Reads the validated config so defaults and
 * `.env` show through even when the overlay hasn't set them.
 */
function effectiveSettings(): Record<string, unknown> {
  const cfg = getConfig() as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of OVERLAY_WRITABLE_KEYS) {
    out[key] = cfg[key];
  }
  return out;
}

/**
 * GET  /api/settings  → { settings, overlayKeys }
 * POST /api/settings  → save a whitelisted patch to the overlay file, hot-apply
 *                       via resetConfig(), and return the new effective values.
 */
export async function handleSettingsApi(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method === "GET") {
    sendJson(res, 200, {
      settings: effectiveSettings(),
      overlayKeys: Object.keys(loadOverlay()),
    });
    return;
  }

  if (req.method === "POST") {
    let patch: unknown;
    try {
      patch = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { error: "Invalid JSON body" });
      return;
    }
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      sendJson(res, 400, { error: "Body must be a JSON object" });
      return;
    }
    try {
      const saved = saveOverlay(patch as Record<string, unknown>);
      resetConfig(); // hot-apply: next getConfig() re-reads with the overlay
      logger.info("settings updated via API", { keys: Object.keys(saved) });
      sendJson(res, 200, {
        ok: true,
        settings: effectiveSettings(),
        overlayKeys: Object.keys(saved),
      });
    } catch (err) {
      logger.error("failed to save settings overlay", {
        error: (err as Error).message,
      });
      sendJson(res, 500, { error: "Failed to persist settings" });
    }
    return;
  }

  sendJson(res, 405, { error: "Method not allowed" });
}

async function pingService(
  url: string,
  timeoutMs: number,
): Promise<{ up: boolean; latencyMs: number; error?: string }> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Any HTTP response (even 4xx) means the server is up and listening.
    await fetch(url, { method: "GET", signal: controller.signal });
    return { up: true, latencyMs: Date.now() - started };
  } catch (err) {
    return {
      up: false,
      latencyMs: Date.now() - started,
      error: (err as Error).name === "AbortError" ? "timeout" : "unreachable",
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET /api/health/services → live up/down for the local ComfyUI and mlx-audio
 * servers, so the settings page can show a green/red status pill.
 */
export async function handleServiceHealth(
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const cfg = getConfig();
  const comfyBase = cfg.COMFYUI_BASE_URL.replace(/\/+$/, "");
  const mlxBase = cfg.REMI_TTS_MLX_URL.replace(/\/+$/, "");
  const timeoutMs = 2500;

  const [comfyui, mlx] = await Promise.all([
    pingService(`${comfyBase}/system_stats`, timeoutMs),
    pingService(`${mlxBase}/`, timeoutMs),
  ]);

  sendJson(res, 200, {
    comfyui: { url: comfyBase, enabled: cfg.COMFYUI_ENABLED, ...comfyui },
    mlx: {
      url: mlxBase,
      enabled: cfg.REMI_TTS_PROVIDER === "mlx",
      ...mlx,
    },
  });
}
