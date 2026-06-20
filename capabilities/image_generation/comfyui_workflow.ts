import fs from "node:fs";
import path from "node:path";
import { createLogger } from "../../infra/logger";

const logger = createLogger("comfyui_workflow");

/**
 * A single node in a ComfyUI API-format workflow ("Save (API Format)" export).
 * `inputs` mixes literal values with `[nodeId, slot]` connection tuples.
 */
export interface ComfyNode {
  class_type: string;
  inputs: Record<string, unknown>;
  _meta?: { title?: string };
}

export type ComfyWorkflow = Record<string, ComfyNode>;

/**
 * Minimal built-in fallback — only used when no workflow is configured AND
 * auto-discovery finds nothing.  Most local setups will never hit this because
 * {@link discoverWorkflow} picks up templates shipped with Comfy-MCP or the
 * ComfyUI built-in template packs.
 */
export const DEFAULT_COMFYUI_WORKFLOW: ComfyWorkflow = {
  "3": {
    class_type: "KSampler",
    inputs: {
      cfg: 8,
      denoise: 1,
      latent_image: ["5", 0],
      model: ["4", 0],
      negative: ["7", 0],
      positive: ["6", 0],
      sampler_name: "euler",
      scheduler: "normal",
      seed: 8566257,
      steps: 20,
    },
  },
  "4": {
    class_type: "CheckpointLoaderSimple",
    inputs: { ckpt_name: "v1-5-pruned-emaonly.safetensors" },
  },
  "5": {
    class_type: "EmptyLatentImage",
    inputs: { batch_size: 1, height: 512, width: 512 },
  },
  "6": {
    class_type: "CLIPTextEncode",
    inputs: { clip: ["4", 1], text: "a cute illustration" },
  },
  "7": {
    class_type: "CLIPTextEncode",
    inputs: {
      clip: ["4", 1],
      text: "text, watermark, lowres, bad anatomy, worst quality, low quality",
    },
  },
  "8": {
    class_type: "VAEDecode",
    inputs: { samples: ["3", 0], vae: ["4", 2] },
  },
  "9": {
    class_type: "SaveImage",
    inputs: { filename_prefix: "Remi", images: ["8", 0] },
  },
};

function deepClone(workflow: ComfyWorkflow): ComfyWorkflow {
  return JSON.parse(JSON.stringify(workflow)) as ComfyWorkflow;
}

// ── Auto-discovery ────────────────────────────────────────────────────────────

/**
 * Well-known directories where ComfyUI keeps API-format workflow templates.
 * Searched in order; first hit wins.  We only look for `image_*.json` files
 * (skipping video / audio / utility templates).
 */
const COMFYUI_SEARCH_DIRS = [
  // Comfy-MCP custom node ships ready-made API-format workflows:
  "custom_nodes/Comfy-MCP/workflow",
  // Built-in template pack installed via pip into the standalone env:
  "standalone-env/lib/python3.13/site-packages/comfyui_workflow_templates_media_image/templates",
  // User-saved workflows (may be UI-format — we validate before accepting):
  "user/default/workflows",
];

/** Cache: once we discover a workflow it stays for the process lifetime. */
let discoveredWorkflow: ComfyWorkflow | null | undefined; // undefined = not yet tried

function isApiFormatWorkflow(obj: unknown): obj is ComfyWorkflow {
  if (!obj || typeof obj !== "object") return false;
  // API format is a flat Record<nodeId, {class_type, inputs, …}>.
  // UI format has top-level keys like "nodes", "links", "last_node_id".
  if ("nodes" in (obj as Record<string, unknown>)) return false; // UI format
  const values = Object.values(obj as Record<string, unknown>);
  if (values.length === 0) return false;
  return values.some(
    (v) =>
      v && typeof v === "object" && "class_type" in (v as Record<string, unknown>),
  );
}

function hasKSampler(wf: ComfyWorkflow): boolean {
  return Object.values(wf).some((n) =>
    SAMPLER_CLASS_TYPES.has(n.class_type),
  );
}

/**
 * Try to locate the ComfyUI installation directory by inspecting the
 * `COMFYUI_BASE_URL` or common filesystem paths.
 */
function guessComfyUIRoots(): string[] {
  const roots: string[] = [];
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  // Common macOS / Linux install locations
  const candidates = [
    path.join(home, "ComfyUI-Installs/ComfyUI/ComfyUI"),
    path.join(home, "ComfyUI"),
    path.join(home, "comfyui/ComfyUI"),
    "/opt/ComfyUI",
  ];
  for (const dir of candidates) {
    try {
      if (fs.statSync(dir).isDirectory()) roots.push(dir);
    } catch { /* ignore */ }
  }
  return roots;
}

/**
 * Scan the local ComfyUI installation for a usable image-generation workflow
 * in API format.  Returns `null` when nothing is found.
 */
export function discoverWorkflow(): ComfyWorkflow | null {
  if (discoveredWorkflow !== undefined) return discoveredWorkflow;

  const roots = guessComfyUIRoots();
  for (const root of roots) {
    for (const relDir of COMFYUI_SEARCH_DIRS) {
      const dir = path.join(root, relDir);
      let entries: string[];
      try {
        entries = fs.readdirSync(dir);
      } catch {
        continue;
      }
      // Prefer `image_z_image_turbo.json` (fast, modern); fall back to any
      // `image_*.json` that looks like a text-to-image API-format workflow.
      const imageJsons = entries
        .filter((f) => /^image_.*\.json$/i.test(f))
        .sort((a, b) => {
          // Prioritise "turbo" variants — they're faster.
          const aT = /turbo/i.test(a) ? 0 : 1;
          const bT = /turbo/i.test(b) ? 0 : 1;
          return aT - bT || a.localeCompare(b);
        });

      for (const file of imageJsons) {
        const filePath = path.join(dir, file);
        try {
          const raw = fs.readFileSync(filePath, "utf8");
          const parsed = JSON.parse(raw);
          if (isApiFormatWorkflow(parsed) && hasKSampler(parsed)) {
            logger.info("auto-discovered ComfyUI workflow", {
              path: filePath,
              nodes: Object.keys(parsed).length,
            });
            discoveredWorkflow = parsed as ComfyWorkflow;
            return discoveredWorkflow;
          }
        } catch {
          continue;
        }
      }
    }
  }

  logger.info("no ComfyUI workflow template discovered, will use built-in default");
  discoveredWorkflow = null;
  return null;
}

// ── loadWorkflow ──────────────────────────────────────────────────────────────

/**
 * Resolve the workflow template.  Priority:
 *
 * 1. `COMFYUI_WORKFLOW_PATH` env var → user-supplied API-format JSON
 * 2. Auto-discovered workflow from the local ComfyUI installation
 * 3. Built-in hardcoded SD1.5 fallback (unlikely to work on modern setups)
 *
 * The result is always a fresh deep clone — callers may mutate freely.
 */
export function loadWorkflow(workflowPath?: string): ComfyWorkflow {
  // 1. Explicit path from config
  if (workflowPath && workflowPath.trim()) {
    try {
      const raw = fs.readFileSync(workflowPath, "utf8");
      const parsed = JSON.parse(raw) as ComfyWorkflow;
      if (isApiFormatWorkflow(parsed)) {
        return deepClone(parsed);
      }
      logger.warn("COMFYUI_WORKFLOW_PATH is not API-format or is empty, trying auto-discovery", {
        workflowPath,
      });
    } catch (err) {
      logger.warn("failed to read COMFYUI_WORKFLOW_PATH, trying auto-discovery", {
        workflowPath,
        error: (err as Error).message,
      });
    }
  }

  // 2. Auto-discover (host ComfyUI install — works for native dev, not Docker)
  const discovered = discoverWorkflow();
  if (discovered) return deepClone(discovered);

  // 3. Repo-bundled workflows (Docker + portable setups) — z_image_turbo first (dev default)
  for (const name of ["image_z_image_turbo.json", "image_pony_v6_xl.json"]) {
    const bundled = path.join(__dirname, "workflows", name);
    try {
      const raw = fs.readFileSync(bundled, "utf8");
      const parsed = JSON.parse(raw) as ComfyWorkflow;
      if (isApiFormatWorkflow(parsed) && hasKSampler(parsed)) {
        logger.info("using bundled ComfyUI workflow", { path: bundled });
        return deepClone(parsed);
      }
    } catch {
      continue;
    }
  }

  // 4. Hardcoded SD1.5 fallback (legacy; needs v1-5 checkpoint on disk)
  return deepClone(DEFAULT_COMFYUI_WORKFLOW);
}

// ── Workflow patching ─────────────────────────────────────────────────────────

/** The only fields we are ever allowed to write into the fixed workflow. */
export interface WorkflowPatch {
  prompt?: string;
  negativePrompt?: string;
  seed?: number;
  width?: number;
  height?: number;
  checkpoint?: string;
}

const SAMPLER_CLASS_TYPES = new Set([
  "KSampler",
  "KSamplerAdvanced",
  "SamplerCustom",
  "SamplerCustomAdvanced",
]);

const LATENT_CLASS_TYPES = new Set([
  "EmptyLatentImage",
  "EmptySD3LatentImage",
]);

function findNodeIdByClass(
  workflow: ComfyWorkflow,
  classTypes: Set<string>,
): string | null {
  for (const [id, node] of Object.entries(workflow)) {
    if (node && classTypes.has(node.class_type)) return id;
  }
  return null;
}

function linkTarget(value: unknown): string | null {
  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0];
  }
  return null;
}

function clampDimension(value: number): number {
  if (!Number.isFinite(value)) return 1024;
  const rounded = Math.round(value / 8) * 8;
  return Math.min(2048, Math.max(256, rounded));
}

/**
 * Apply a whitelisted patch to a workflow and return a new graph.
 *
 * We resolve which nodes to touch by walking the sampler's connections
 * (`positive` / `negative` / `latent_image`) rather than hardcoding node ids,
 * so a user-supplied workflow with different ids still works.  Works with both
 * classic SD1.5/SDXL workflows (CheckpointLoaderSimple) and modern split-model
 * workflows (UNETLoader + CLIPLoader + VAELoader, e.g. z_image_turbo).
 *
 * Regardless of the graph shape, the only fields ever written are: positive
 * prompt text, sampler seed, latent width/height, and (optionally) negative
 * prompt text and checkpoint/unet name.
 */
export function patchWorkflow(
  workflow: ComfyWorkflow,
  patch: WorkflowPatch,
): { workflow: ComfyWorkflow; warnings: string[] } {
  const next = deepClone(workflow);
  const warnings: string[] = [];

  const samplerId = findNodeIdByClass(next, SAMPLER_CLASS_TYPES);
  const sampler = samplerId ? next[samplerId] : null;

  // ── seed ────────────────────────────────────────────────────────────────
  if (patch.seed !== undefined) {
    if (sampler) {
      if ("seed" in sampler.inputs) {
        sampler.inputs.seed = patch.seed;
      } else if ("noise_seed" in sampler.inputs) {
        sampler.inputs.noise_seed = patch.seed;
      } else {
        sampler.inputs.seed = patch.seed;
      }
    } else {
      warnings.push("no sampler node found, seed not applied");
    }
  }

  // ── positive prompt ───────────────────────────────────────────────────────
  if (patch.prompt !== undefined) {
    const posId = sampler ? linkTarget(sampler.inputs.positive) : null;
    const posNode = posId ? next[posId] : null;
    if (posNode && "text" in posNode.inputs) {
      posNode.inputs.text = patch.prompt;
    } else {
      warnings.push("no positive CLIPTextEncode node found, prompt not applied");
    }
  }

  // ── negative prompt ───────────────────────────────────────────────────────
  // Some workflows (e.g. z_image_turbo) use ConditioningZeroOut for the
  // negative — there is no text field to patch, so we silently skip.
  if (patch.negativePrompt !== undefined) {
    const negId = sampler ? linkTarget(sampler.inputs.negative) : null;
    const negNode = negId ? next[negId] : null;
    if (negNode && "text" in negNode.inputs) {
      negNode.inputs.text = patch.negativePrompt;
    }
    // No warning when the negative node exists but has no text field —
    // that's expected for ConditioningZeroOut-style workflows.
  }

  // ── dimensions ────────────────────────────────────────────────────────────
  if (patch.width !== undefined || patch.height !== undefined) {
    // First try via sampler topology; fall back to scanning for any latent node.
    let latentId = sampler ? linkTarget(sampler.inputs.latent_image) : null;
    let latentNode = latentId ? next[latentId] : null;
    if (!latentNode || !("width" in latentNode.inputs || "height" in latentNode.inputs)) {
      latentId = findNodeIdByClass(next, LATENT_CLASS_TYPES);
      latentNode = latentId ? next[latentId] : null;
    }
    if (latentNode && ("width" in latentNode.inputs || "height" in latentNode.inputs)) {
      if (patch.width !== undefined) latentNode.inputs.width = clampDimension(patch.width);
      if (patch.height !== undefined) latentNode.inputs.height = clampDimension(patch.height);
    } else {
      warnings.push("no latent image node found, dimensions not applied");
    }
  }

  // ── checkpoint / diffusion model (optional) ───────────────────────────────
  if (patch.checkpoint !== undefined && patch.checkpoint.trim()) {
    // Classic: CheckpointLoaderSimple
    const ckptId = findNodeIdByClass(next, new Set(["CheckpointLoaderSimple"]));
    const ckptNode = ckptId ? next[ckptId] : null;
    if (ckptNode && "ckpt_name" in ckptNode.inputs) {
      ckptNode.inputs.ckpt_name = patch.checkpoint.trim();
    } else {
      // Modern split-model: UNETLoader
      const unetId = findNodeIdByClass(next, new Set(["UNETLoader"]));
      const unetNode = unetId ? next[unetId] : null;
      if (unetNode && "unet_name" in unetNode.inputs) {
        unetNode.inputs.unet_name = patch.checkpoint.trim();
      }
      // No warning — if neither exists the workflow manages its own model loading.
    }
  }

  return { workflow: next, warnings };
}
