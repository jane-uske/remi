const assert = require("assert").strict;

const {
  resolveComposeProjectName,
  resolveDevVolumeNames,
  resolveProdVolumeNames,
  resolveDevPort,
  resolveProdPort,
} = require("../../scripts/env_files.cjs");

describe("env file helpers", () => {
  it("defaults dev to port 3001", () => {
    const env = {};

    assert.equal(resolveDevPort(env), 3001);
  });

  it("defaults local prod to port 3000", () => {
    const env = {};

    assert.equal(resolveProdPort(env), 3000);
  });

  it("allows explicit PORT override for both modes", () => {
    const env = { PORT: "4310" };

    assert.equal(resolveDevPort(env), 4310);
    assert.equal(resolveProdPort(env), 4310);
  });

  it("uses separate compose project names for dev and local prod", () => {
    assert.equal(resolveComposeProjectName("dev"), "remi-ai-dev");
    assert.equal(resolveComposeProjectName("prod"), "remi-ai-local-prod");
    assert.notEqual(resolveComposeProjectName("dev"), resolveComposeProjectName("prod"));
  });

  it("allows explicit compose project overrides per mode", () => {
    assert.equal(
      resolveComposeProjectName("dev", { REMI_DEV_COMPOSE_PROJECT: "custom-dev" }),
      "custom-dev",
    );
    assert.equal(
      resolveComposeProjectName("prod", { REMI_PROD_COMPOSE_PROJECT: "custom-prod" }),
      "custom-prod",
    );
  });

  it("resolves stable external volume names with optional overrides", () => {
    assert.deepEqual(resolveDevVolumeNames(), [
      "remi-ai_rem_pgdata",
      "remi-ai_rem_redisdata",
      "remi-ai_rem_root_node_modules",
      "remi-ai_rem_web_node_modules",
      "remi-ai_rem_code_server_config",
    ]);
    assert.deepEqual(resolveProdVolumeNames(), [
      "remi-ai_rem_local_prod_pgdata",
      "remi-ai_rem_local_prod_redisdata",
    ]);
    assert.ok(resolveDevVolumeNames({ REMI_DEV_PG_VOLUME: "custom_pg" }).includes("custom_pg"));
    assert.ok(
      resolveProdVolumeNames({ REMI_LOCAL_PROD_REDIS_VOLUME: "custom_redis" }).includes(
        "custom_redis",
      ),
    );
  });
});
