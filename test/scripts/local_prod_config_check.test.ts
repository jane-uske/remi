const assert = require("assert").strict;

const { evaluateLocalProdConfig, inferAuthMode } = require("../../scripts/local_prod_config_check.cjs");

describe("local prod config check", () => {
  const baseEnv = {
    key: "test-key",
    base_url: "https://example.com/v1",
    model: "gpt-test",
    POSTGRES_PASSWORD: "strong-password",
  };

  it("fails clerk mode when the frontend is not also configured for clerk", () => {
    const result = evaluateLocalProdConfig({
      ...baseEnv,
      REMI_AUTH_MODE: "clerk",
      CLERK_SECRET_KEY: "sk_test_123",
      CLERK_JWT_KEY: "-----BEGIN PUBLIC KEY-----\\nabc\\n-----END PUBLIC KEY-----",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_123",
    });

    assert.equal(result.hasError, true);
    assert.ok(
      result.messages.includes(
        "MISS env: NEXT_PUBLIC_REMI_AUTH_MODE must be 'clerk' when REMI_AUTH_MODE=clerk",
      ),
    );
  });

  it("passes a complete clerk configuration and warns about the legacy access gate", () => {
    const result = evaluateLocalProdConfig({
      ...baseEnv,
      REMI_AUTH_MODE: "clerk",
      CLERK_SECRET_KEY: "sk_test_123",
      CLERK_JWT_KEY: "-----BEGIN PUBLIC KEY-----\\nabc\\n-----END PUBLIC KEY-----",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_123",
      NEXT_PUBLIC_REMI_AUTH_MODE: "clerk",
      REMI_ACCESS_PASSWORD: "preview-only",
    });

    assert.equal(result.hasError, false);
    assert.ok(result.messages.includes("OK   env: NEXT_PUBLIC_REMI_AUTH_MODE=clerk"));
    assert.ok(
      result.messages.includes(
        "WARN gate: REMI_ACCESS_PASSWORD is set; main Clerk domain should not stack the shared-password gate",
      ),
    );
  });

  it("passes runtime-only clerk config without CLERK_SECRET_KEY and warns that some server integrations may still need it", () => {
    const result = evaluateLocalProdConfig({
      ...baseEnv,
      REMI_AUTH_MODE: "clerk",
      CLERK_JWT_KEY: "-----BEGIN PUBLIC KEY-----\\nabc\\n-----END PUBLIC KEY-----",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_123",
      NEXT_PUBLIC_REMI_AUTH_MODE: "clerk",
    });

    assert.equal(result.hasError, false);
    assert.ok(
      result.messages.includes(
        "WARN env: CLERK_SECRET_KEY is empty; current runtime only needs CLERK_JWT_KEY, but future server-side Clerk API calls will require it",
      ),
    );
  });

  it("passes legacy_jwt mode when JWT_SECRET is present", () => {
    const result = evaluateLocalProdConfig({
      ...baseEnv,
      REMI_AUTH_MODE: "legacy_jwt",
      JWT_SECRET: "super-secret",
    });

    assert.equal(result.hasError, false);
    assert.ok(result.messages.includes("OK   env: JWT_SECRET is set"));
  });

  it("infers disabled auth when no auth variables are present and rejects it for local production", () => {
    const result = evaluateLocalProdConfig(baseEnv);

    assert.equal(inferAuthMode(baseEnv), "disabled");
    assert.equal(result.hasError, true);
    assert.ok(
      result.messages.includes(
        "MISS env: REMI_AUTH_MODE=disabled is not acceptable for local production; use 'legacy_jwt' or 'clerk'",
      ),
    );
  });

  it("fails when DATABASE_URL and POSTGRES_PASSWORD drift apart", () => {
    const result = evaluateLocalProdConfig({
      ...baseEnv,
      DATABASE_URL: "postgresql://rem:one-password@postgres:5432/rem_ai",
      POSTGRES_PASSWORD: "another-password",
      REMI_AUTH_MODE: "legacy_jwt",
      JWT_SECRET: "super-secret",
    });

    assert.equal(result.hasError, true);
    assert.ok(
      result.messages.includes(
        "MISS env: DATABASE_URL password does not match POSTGRES_PASSWORD; local-prod app/db credentials will drift",
      ),
    );
  });

  it("allows the default local postgres password when the app credentials stay aligned", () => {
    const result = evaluateLocalProdConfig({
      ...baseEnv,
      DATABASE_URL: "postgresql://rem:rem_password@postgres:5432/rem_ai",
      POSTGRES_PASSWORD: "rem_password",
      REMI_AUTH_MODE: "legacy_jwt",
      JWT_SECRET: "super-secret",
    });

    assert.equal(result.hasError, false);
    assert.ok(
      result.messages.includes(
        "WARN env: POSTGRES_PASSWORD is the local default 'rem_password'; acceptable for isolated local-prod only",
      ),
    );
  });

  it("fails whisper-cpp local-prod config when remote server mode is enabled without a server url", () => {
    const result = evaluateLocalProdConfig({
      ...baseEnv,
      REMI_AUTH_MODE: "legacy_jwt",
      JWT_SECRET: "super-secret",
      stt_provider: "whisper-cpp",
      whisper_use_server: "1",
      whisper_server_autostart: "0",
    });

    assert.equal(result.hasError, true);
    assert.ok(
      result.messages.includes(
        "MISS env: whisper_server_url is required when whisper-cpp local-prod disables autostart",
      ),
    );
  });
});
