import type {} from "mocha";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

describe("next config", () => {
  it("uses a dedicated distDir in development so build artifacts cannot clobber a live dev server", () => {
    const webDir = path.resolve(__dirname, "..");
    const output = execFileSync(
      process.execPath,
      [
        "-e",
        "import('./next.config.mjs').then((m) => console.log(JSON.stringify(m.default)))",
      ],
      {
        cwd: webDir,
        env: {
          ...process.env,
          NODE_ENV: "development",
        },
        encoding: "utf8",
      },
    ).trim();

    const config = JSON.parse(output);
    assert.equal(config.distDir, ".next-dev");
  });

  it("keeps the default build distDir outside development", () => {
    const webDir = path.resolve(__dirname, "..");
    const output = execFileSync(
      process.execPath,
      [
        "-e",
        "import('./next.config.mjs').then((m) => console.log(JSON.stringify(m.default)))",
      ],
      {
        cwd: webDir,
        env: {
          ...process.env,
          NODE_ENV: "production",
        },
        encoding: "utf8",
      },
    ).trim();

    const config = JSON.parse(output);
    assert.equal(config.distDir, undefined);
  });

  it("honors the active dev env file for client-facing NEXT_PUBLIC vars", () => {
    const webDir = path.resolve(__dirname, "..");
    const envFile = path.resolve(webDir, "..", ".env.localhost");
    const output = execFileSync(
      process.execPath,
      [
        "-e",
        "import('./next.config.mjs').then(() => console.log(JSON.stringify({ ws: process.env.NEXT_PUBLIC_WS_URL, auth: process.env.NEXT_PUBLIC_REMI_AUTH_MODE })))",
      ],
      {
        cwd: webDir,
        env: {
          ...process.env,
          NODE_ENV: "development",
          REMI_ACTIVE_ENV_FILE: envFile,
        },
        encoding: "utf8",
      },
    ).trim();

    const loadedEnv = JSON.parse(output);
    assert.equal(loadedEnv.ws, "ws://localhost:3001/ws");
    assert.equal(loadedEnv.auth, "disabled");
  });

  it("allows 127.0.0.1 to request dev assets", () => {
    const webDir = path.resolve(__dirname, "..");
    const output = execFileSync(
      process.execPath,
      [
        "-e",
        "import('./next.config.mjs').then((m) => console.log(JSON.stringify(m.default)))",
      ],
      {
        cwd: webDir,
        env: {
          ...process.env,
          NODE_ENV: "development",
        },
        encoding: "utf8",
      },
    ).trim();

    const config = JSON.parse(output);
    assert.ok(Array.isArray(config.allowedDevOrigins));
    assert.ok(config.allowedDevOrigins.includes("127.0.0.1"));
  });
});
