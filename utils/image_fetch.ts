/**
 * Fetch a ComfyUI-proxied image and return it as a data URL for vision model consumption.
 *
 * ComfyUI images are served at `/api/comfyui/view?filename=...&subfolder=...&type=output`
 * which is proxied by the Remi gateway.  This utility fetches them from the local server
 * (or directly from ComfyUI) and converts to base64 data URLs.
 */
import { getConfig } from "../server/config";
import { createLogger } from "../infra/logger";

const logger = createLogger("image_fetch");

const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4 MB
const FETCH_TIMEOUT_MS = 10_000;

/**
 * Fetch an image URL and return a data URL (data:image/png;base64,...).
 *
 * @param imageUrl    - relative or absolute URL (e.g. `/api/comfyui/view?...`)
 * @param serverBase  - base URL of the local server for resolving relative paths
 * @returns data URL string, or null on failure
 */
export async function fetchImageAsBase64(
  imageUrl: string,
  serverBase?: string,
): Promise<string | null> {
  try {
    // Resolve relative URLs against the local server
    let fullUrl = imageUrl;
    if (imageUrl.startsWith("/")) {
      const base = serverBase ?? `http://127.0.0.1:${getConfig().REMI_PORT}`;
      fullUrl = `${base}${imageUrl}`;
    }

    const res = await fetch(fullUrl, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!res.ok) {
      logger.warn("image fetch failed", { url: fullUrl, status: res.status });
      return null;
    }

    const contentLength = parseInt(res.headers.get("content-length") ?? "0", 10);
    if (contentLength > MAX_IMAGE_BYTES) {
      logger.warn("image too large", { url: fullUrl, bytes: contentLength });
      return null;
    }

    const arrayBuf = await res.arrayBuffer();
    if (arrayBuf.byteLength > MAX_IMAGE_BYTES) {
      logger.warn("image too large after download", { url: fullUrl, bytes: arrayBuf.byteLength });
      return null;
    }

    const contentType = res.headers.get("content-type") ?? "image/png";
    const base64 = Buffer.from(arrayBuf).toString("base64");
    return `data:${contentType};base64,${base64}`;
  } catch (err) {
    logger.warn("image fetch error", {
      url: imageUrl,
      error: (err as Error).message,
    });
    return null;
  }
}

/** Extract the first image URL from markdown `![alt](url)` syntax. */
export function extractFirstImageUrl(text: string): string | null {
  const match = text.match(/!\[[^\]]*\]\(([^)]+)\)/);
  return match?.[1] ?? null;
}
