const assert = require("assert").strict;
const fs = require("fs");
const path = require("path");

function readEnvFile(fileName) {
  const absolutePath = path.resolve(__dirname, `../../${fileName}`);
  const raw = fs.readFileSync(absolutePath, "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line)) continue;
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    env[match[1]] = match[2].trim();
  }
  return env;
}

describe("local env defaults", () => {
  it("keeps localhost dev on edge TTS with storage configured", () => {
    const env = readEnvFile(".env.localhost");

    assert.equal(env.DATABASE_URL, "postgresql://rem:rem_password@postgres:5432/rem_ai");
    assert.equal(env.REDIS_URL, "redis://redis:6379");
    assert.equal(env.tts_provider, "edge");
  });

  it("keeps local prod on edge TTS with storage configured", () => {
    const env = readEnvFile(".env.local-prod");

    assert.equal(env.DATABASE_URL, "postgresql://rem:rem_password@postgres:5432/rem_ai");
    assert.equal(env.REDIS_URL, "redis://redis:6379");
    assert.equal(env.tts_provider, "edge");
  });
});
