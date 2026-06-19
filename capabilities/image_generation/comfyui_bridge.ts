import fs from "node:fs/promises";
import path from "node:path";

import { createLogger } from "../../infra/logger";
import { getConfig } from "../../server/config";
import { loadWorkflow, patchWorkflow, type WorkflowPatch } from "./comfyui_workflow";

const logger = createLogger("comfyui_bridge");

export interface GenerateImageParams {
  prompt: string;
  negativePrompt?: string;
  seed?: number;
  width?: number;
  height?: number;
  checkpoint?: string;
  signal?: AbortSignal;
}

export interface GeneratedImage {
  filename: string;
  subfolder: string;
  type: string;
  /** Direct ComfyUI URL that renders the image (`/view?...`). */
  viewUrl: string;
  /** Absolute path of the copy we saved under COMFYUI_OUTPUT_DIR. */
  localPath: string;
}

export interface GenerateImageResult {
  promptId: string;
  seed: number;
  images: GeneratedImage[];
}

export class ComfyUIError extends Error {
  constructor(
    message: string,
    readonly kind: "unreachable" | "rejected" | "timeout" | "no_output" | "aborted",
  ) {
    super(message);
    this.name = "ComfyUIError";
  }
}

interface HistoryEntry {
  outputs?: Record<
    string,
    {
      images?: { filename: string; subfolder: string; type: string }[];
    }
  >;
  status?: {
    completed?: boolean;
    status_str?: string;
    messages?: Array<[string, Record<string, unknown>]>;
  };
}

function baseUrl(): string {
  return getConfig().COMFYUI_BASE_URL.replace(/\/+$/, "");
}

function randomSeed(): number {
  // Stay well inside Number.MAX_SAFE_INTEGER; ComfyUI accepts large ints.
  return Math.floor(Math.random() * 1_000_000_000_000);
}

function buildViewUrl(image: { filename: string; subfolder: string; type: string }): string {
  const params = new URLSearchParams({
    filename: image.filename,
    subfolder: image.subfolder ?? "",
    type: image.type ?? "output",
  });
  return `${baseUrl()}/view?${params.toString()}`;
}

async function fetchJson<T>(url: string, init: RequestInit, what: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (err) {
    throw new ComfyUIError(
      `ComfyUI ${what} unreachable at ${url}: ${(err as Error).message}`,
      "unreachable",
    );
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new ComfyUIError(
      `ComfyUI ${what} returned ${response.status}: ${body.slice(0, 300)}`,
      "rejected",
    );
  }
  return (await response.json()) as T;
}

async function pollHistory(
  promptId: string,
  deadline: number,
  signal: AbortSignal | undefined,
): Promise<HistoryEntry> {
  const intervalMs = 1000;
  while (Date.now() < deadline) {
    if (signal?.aborted) {
      throw new ComfyUIError("image generation aborted", "aborted");
    }
    const history = await fetchJson<Record<string, HistoryEntry>>(
      `${baseUrl()}/history/${encodeURIComponent(promptId)}`,
      { method: "GET", signal },
      "/history",
    );
    const entry = history[promptId];
    if (!entry) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      continue;
    }
    // Detect execution errors before checking outputs — otherwise we poll
    // until timeout on a prompt that already failed.
    if (entry.status?.status_str === "error") {
      const errorMsg = entry.status.messages
        ?.filter(([type]) => type === "execution_error")
        .map(([, data]) => (data as { exception_message?: string }).exception_message)
        .filter(Boolean)
        .join("; ");
      throw new ComfyUIError(
        errorMsg || "ComfyUI execution failed (unknown error)",
        "rejected",
      );
    }
    if (entry.outputs && Object.keys(entry.outputs).length > 0) {
      return entry;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new ComfyUIError(
    `ComfyUI did not finish within ${getConfig().COMFYUI_TIMEOUT_MS}ms`,
    "timeout",
  );
}

async function downloadImage(
  image: { filename: string; subfolder: string; type: string },
  outputDir: string,
  signal: AbortSignal | undefined,
): Promise<GeneratedImage> {
  const viewUrl = buildViewUrl(image);
  let response: Response;
  try {
    response = await fetch(viewUrl, { method: "GET", signal });
  } catch (err) {
    throw new ComfyUIError(
      `failed to download image from ${viewUrl}: ${(err as Error).message}`,
      "unreachable",
    );
  }
  if (!response.ok) {
    throw new ComfyUIError(`ComfyUI /view returned ${response.status}`, "rejected");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  await fs.mkdir(outputDir, { recursive: true });
  const safeName = image.filename.replace(/[^\w.-]/g, "_");
  const localPath = path.join(outputDir, `${Date.now()}_${safeName}`);
  await fs.writeFile(localPath, bytes);
  return {
    filename: image.filename,
    subfolder: image.subfolder ?? "",
    type: image.type ?? "output",
    viewUrl,
    localPath,
  };
}

/**
 * Submit the workflow (auto-discovered or user-supplied, with a whitelisted
 * patch applied) to the local ComfyUI server, wait for it to finish via
 * `/history`, then download the resulting images to a local folder.
 *
 * Only talks to `COMFYUI_BASE_URL` (default http://127.0.0.1:8188). No cloud.
 */
export async function generateImage(
  params: GenerateImageParams,
): Promise<GenerateImageResult> {
  const config = getConfig();
  const seed = params.seed ?? randomSeed();

  const patch: WorkflowPatch = {
    prompt: params.prompt,
    negativePrompt: params.negativePrompt ?? (config.COMFYUI_DEFAULT_NEGATIVE || undefined),
    seed,
    width: params.width ?? config.COMFYUI_DEFAULT_WIDTH,
    height: params.height ?? config.COMFYUI_DEFAULT_HEIGHT,
    checkpoint: params.checkpoint ?? (config.COMFYUI_CHECKPOINT || undefined),
  };

  const { workflow, warnings } = patchWorkflow(
    loadWorkflow(config.COMFYUI_WORKFLOW_PATH),
    patch,
  );
  if (warnings.length > 0) {
    logger.warn("workflow patch produced warnings", { warnings });
  }

  const submit = await fetchJson<{ prompt_id?: string; error?: unknown }>(
    `${baseUrl()}/prompt`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow }),
      signal: params.signal,
    },
    "/prompt",
  );

  if (!submit.prompt_id) {
    throw new ComfyUIError(
      `ComfyUI rejected the workflow: ${JSON.stringify(submit.error ?? submit).slice(0, 300)}`,
      "rejected",
    );
  }

  logger.info("submitted workflow to ComfyUI", { promptId: submit.prompt_id, seed });

  const deadline = Date.now() + config.COMFYUI_TIMEOUT_MS;
  const entry = await pollHistory(submit.prompt_id, deadline, params.signal);

  const outputDir = path.isAbsolute(config.COMFYUI_OUTPUT_DIR)
    ? config.COMFYUI_OUTPUT_DIR
    : path.resolve(process.cwd(), config.COMFYUI_OUTPUT_DIR);

  const images: GeneratedImage[] = [];
  for (const output of Object.values(entry.outputs ?? {})) {
    for (const image of output.images ?? []) {
      // Skip temp/preview images; keep saved outputs.
      if (image.type && image.type !== "output" && image.type !== "temp") continue;
      images.push(await downloadImage(image, outputDir, params.signal));
    }
  }

  if (images.length === 0) {
    throw new ComfyUIError("ComfyUI finished but produced no images", "no_output");
  }

  logger.info("image generation complete", {
    promptId: submit.prompt_id,
    count: images.length,
  });

  return { promptId: submit.prompt_id, seed, images };
}
