import { strict as assert } from "node:assert";
import { describe, it, afterEach } from "mocha";
import { resetConfig, getConfig } from "../../../server/config";

describe("server/config", () => {
  afterEach(() => {
    resetConfig();
  });

  it("validates with all defaults (no env vars set)", () => {
    const cfg = getConfig();
    assert.equal(cfg.REMI_PORT, 3001);
    assert.equal(cfg.VAD_UTTERANCE_GAP_MS, 180);
    assert.equal(cfg.DUPLEX_IDLE_GUARD_AFTER_MS, 8000);
    assert.equal(cfg.VOICE_BACKCHANNEL_STABLE_MS, 1100);
    assert.equal(cfg.REMI_IOS_DUPLEX_INPUT_GAIN, 6);
  });

  it("coerces numeric strings", () => {
    process.env.VAD_PRE_ROLL_MS = "320";
    resetConfig();
    const cfg = getConfig();
    assert.equal(cfg.VAD_PRE_ROLL_MS, 320);
    delete process.env.VAD_PRE_ROLL_MS;
  });

  it("applies legacy aliases", () => {
    delete process.env.REMI_LLM_API_KEY;
    process.env.key = "test-key-123";
    resetConfig();
    const cfg = getConfig();
    assert.equal(cfg.REMI_LLM_API_KEY, "test-key-123");
    delete process.env.key;
    delete process.env.REMI_LLM_API_KEY;
  });

  it("returns optional VAD detector vars as undefined when not set", () => {
    const cfg = getConfig();
    assert.equal(cfg.VAD_THRESHOLD, undefined);
    assert.equal(cfg.VAD_MIN_SPEECH_FRAMES, undefined);
    assert.equal(cfg.VAD_MIN_ACTIVE_RATIO, undefined);
  });

  it("parses optional VAD detector vars when set", () => {
    process.env.VAD_THRESHOLD = "0.05";
    process.env.VAD_MIN_ACTIVE_RATIO = "0.25";
    resetConfig();
    const cfg = getConfig();
    assert.equal(cfg.VAD_THRESHOLD, 0.05);
    assert.equal(cfg.VAD_MIN_ACTIVE_RATIO, 0.25);
    delete process.env.VAD_THRESHOLD;
    delete process.env.VAD_MIN_ACTIVE_RATIO;
  });

  it("boolean string coercion works", () => {
    process.env.REMI_SLOW_BRAIN_ENABLED = "0";
    resetConfig();
    const cfg = getConfig();
    assert.equal(cfg.REMI_SLOW_BRAIN_ENABLED, false);
    delete process.env.REMI_SLOW_BRAIN_ENABLED;
  });

  it("parses family-memory integration env vars", () => {
    process.env.REMI_FAMILY_MEMORY_ENABLED = "1";
    process.env.REMI_FAMILY_MEMORY_SERVICE_URL = "http://127.0.0.1:3456";
    process.env.REMI_FAMILY_MEMORY_AI_TOKEN = "family-token";
    resetConfig();
    const cfg = getConfig();
    assert.equal(cfg.REMI_FAMILY_MEMORY_ENABLED, true);
    assert.equal(cfg.REMI_FAMILY_MEMORY_SERVICE_URL, "http://127.0.0.1:3456");
    assert.equal(cfg.REMI_FAMILY_MEMORY_AI_TOKEN, "family-token");
    delete process.env.REMI_FAMILY_MEMORY_ENABLED;
    delete process.env.REMI_FAMILY_MEMORY_SERVICE_URL;
    delete process.env.REMI_FAMILY_MEMORY_AI_TOKEN;
  });
});
