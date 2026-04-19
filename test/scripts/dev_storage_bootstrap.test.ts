const assert = require("assert").strict;
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  loadBootstrapEnv,
  planDevStorageBootstrap,
} = require("../../scripts/dev_storage_bootstrap.cjs");

describe("dev storage bootstrap", () => {
  it("boots postgres and redis by default when local storage is configured", () => {
    const plan = planDevStorageBootstrap({
      DATABASE_URL: "postgresql://rem:rem_password@postgres:5432/rem_ai",
      REDIS_URL: "redis://redis:6379",
    });

    assert.equal(plan.enabled, true);
    assert.deepEqual(plan.services, ["postgres", "redis"]);
    assert.equal(plan.reason, "configured_storage");
  });

  it("allows opting out explicitly", () => {
    const plan = planDevStorageBootstrap({
      DATABASE_URL: "postgresql://rem:rem_password@postgres:5432/rem_ai",
      REDIS_URL: "redis://redis:6379",
      REMI_DEV_AUTO_STORAGE: "0",
    });

    assert.equal(plan.enabled, false);
    assert.deepEqual(plan.services, []);
    assert.equal(plan.reason, "disabled_by_env");
  });

  it("hydrates bootstrap env from a dotenv file", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "remi-dev-storage-"));
    const envFile = path.join(tempDir, ".env.test");
    fs.writeFileSync(
      envFile,
      [
        "DATABASE_URL=postgresql://rem:rem_password@postgres:5432/rem_ai",
        "REDIS_URL=redis://redis:6379",
      ].join("\n"),
    );

    const env = loadBootstrapEnv({}, envFile);
    const plan = planDevStorageBootstrap(env);

    assert.equal(plan.enabled, true);
    assert.deepEqual(plan.services, ["postgres", "redis"]);
  });
});
