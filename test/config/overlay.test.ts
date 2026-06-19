const assert = require("assert").strict;
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  loadOverlay,
  saveOverlay,
  applyOverlayToEnv,
  OVERLAY_WRITABLE_KEYS,
} = require("../../server/config/overlay");

describe("config overlay", () => {
  let dir: string;
  let file: string;
  const prevSettingsFile = process.env.REMI_SETTINGS_FILE;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "remi-overlay-"));
    file = path.join(dir, "remi-settings.json");
    process.env.REMI_SETTINGS_FILE = file;
  });

  afterEach(() => {
    if (prevSettingsFile === undefined) delete process.env.REMI_SETTINGS_FILE;
    else process.env.REMI_SETTINGS_FILE = prevSettingsFile;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns an empty object when the file is missing", () => {
    assert.deepEqual(loadOverlay(), {});
  });

  it("keeps only whitelisted keys and coerces values to strings", () => {
    fs.writeFileSync(
      file,
      JSON.stringify({
        COMFYUI_BASE_URL: "http://localhost:9999",
        COMFYUI_DEFAULT_WIDTH: 768, // number → string
        REMI_NSFW_ENABLED: true, // boolean → string
        REMI_LLM_API_KEY: "should-be-dropped", // not whitelisted
        bogus: "nope",
      }),
    );
    const overlay = loadOverlay();
    assert.equal(overlay.COMFYUI_BASE_URL, "http://localhost:9999");
    assert.equal(overlay.COMFYUI_DEFAULT_WIDTH, "768");
    assert.equal(overlay.REMI_NSFW_ENABLED, "true");
    assert.equal(overlay.REMI_LLM_API_KEY, undefined);
    assert.equal(overlay.bogus, undefined);
  });

  it("applies the overlay onto an env object (overlay wins)", () => {
    fs.writeFileSync(file, JSON.stringify({ COMFYUI_BASE_URL: "http://overlay:1" }));
    const env: Record<string, string | undefined> = {
      COMFYUI_BASE_URL: "http://from-dotenv:2",
    };
    applyOverlayToEnv(env as NodeJS.ProcessEnv);
    assert.equal(env.COMFYUI_BASE_URL, "http://overlay:1");
  });

  it("saveOverlay drops unknown keys and round-trips through the file", () => {
    const saved = saveOverlay({
      COMFYUI_CHECKPOINT: "z-image.safetensors",
      REMI_LLM_API_KEY: "secret", // dropped
    });
    assert.equal(saved.COMFYUI_CHECKPOINT, "z-image.safetensors");
    assert.equal(saved.REMI_LLM_API_KEY, undefined);
    assert.deepEqual(loadOverlay(), { COMFYUI_CHECKPOINT: "z-image.safetensors" });
  });

  it("saveOverlay merges into existing values and deletes on null", () => {
    saveOverlay({ COMFYUI_BASE_URL: "http://a", COMFYUI_CHECKPOINT: "c1" });
    const merged = saveOverlay({ COMFYUI_BASE_URL: "http://b", COMFYUI_CHECKPOINT: null });
    assert.equal(merged.COMFYUI_BASE_URL, "http://b");
    assert.equal(merged.COMFYUI_CHECKPOINT, undefined);
  });

  it("never whitelists secrets", () => {
    assert.ok(!OVERLAY_WRITABLE_KEYS.includes("REMI_LLM_API_KEY"));
    assert.ok(!OVERLAY_WRITABLE_KEYS.includes("REMI_AUTH_JWT_SECRET"));
  });
});
