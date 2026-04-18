require("ts-node/register/transpile-only");

const assert = require("assert").strict;
const path = require("path");
const { once } = require("events");
const { WebSocket } = require("ws");

const gatewayPath = path.resolve(__dirname, "../../../server/gateway");

function setEnv(key, value) {
  const previous = process.env[key];
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
  return () => {
    if (previous === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous;
    }
  };
}

async function withGateway(envSetup, fn) {
  const restoreEnv = envSetup();
  const { createGateway } = require(gatewayPath);
  const server = await createGateway({ onConnection() {} });
  try {
    server.listen(0);
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected an ephemeral port address");
    }
    await fn(address.port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    restoreEnv();
  }
}

async function runHealth() {
  await withGateway(
    () => setEnv("JWT_SECRET", "test-secret"),
    async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-type")?.startsWith("application/json"), true);

      const payload = await res.json();
      assert.equal(payload.ok, true);
      assert.equal(payload.service, "remi");
      assert.equal(typeof payload.uptimeSec, "number");
      assert.equal(Number.isFinite(payload.uptimeSec), true);
    },
  );
}

async function runRateLimit() {
  await withGateway(
    () => setEnv("JWT_SECRET", "test-secret"),
    async (port) => {
      const target = `http://127.0.0.1:${port}/health`;

      for (let i = 0; i < 100; i += 1) {
        const res = await fetch(target);
        assert.equal(res.status, 200);
      }

      const limited = await fetch(target);
      assert.equal(limited.status, 429);
      assert.equal(limited.headers.get("content-type")?.startsWith("application/json"), true);
      const payload = await limited.json();
      assert.deepEqual(payload, { error: "Too many requests" });
    },
  );
}

async function runRateLimitSkipsDevAssets() {
  await withGateway(
    () => setEnv("JWT_SECRET", "test-secret"),
    async (port) => {
      const saturateTarget = `http://127.0.0.1:${port}/health`;

      for (let i = 0; i < 100; i += 1) {
        const res = await fetch(saturateTarget);
        assert.equal(res.status, 200);
      }

      const limited = await fetch(saturateTarget);
      assert.equal(limited.status, 429);

      const favicon = await fetch(`http://127.0.0.1:${port}/favicon.ico`);
      assert.notEqual(favicon.status, 429);

      const nextAsset = await fetch(
        `http://127.0.0.1:${port}/_next/static/chunks/does-not-exist.js`,
      );
      assert.notEqual(nextAsset.status, 429);
    },
  );
}

async function runClerkRootNoToken() {
  await withGateway(
    () => {
      const restores = [
        setEnv("REMI_AUTH_MODE", "clerk"),
        setEnv("JWT_SECRET", undefined),
        setEnv("REMI_AUTH_ALLOW_LOOPBACK_BYPASS", "0"),
      ];
      return () => {
        for (const restore of restores.reverse()) restore();
      };
    },
    async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/`, {
        headers: {
          Host: "app-rem.remi.run",
        },
      });
      assert.equal(res.status, 200);
      const body = await res.text();
      assert.equal(body.includes("Remi AI"), true);
    },
  );
}

async function runWsMobileDevAuth({ headerValue, shouldOpen }) {
  await withGateway(
    () => {
      const restores = [
        setEnv("JWT_SECRET", "jwt-test-secret"),
        setEnv("REMI_ACCESS_PASSWORD", "access-password"),
        setEnv("REMI_MOBILE_DEV_ENABLED", "1"),
        setEnv("REMI_MOBILE_DEV_KEY", "mobile-dev-secret"),
      ];
      return () => {
        for (const restore of restores.reverse()) restore();
      };
    },
    async (port) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
        headers: {
          Host: "remi.test",
          "X-Remi-Mobile-Key": headerValue,
        },
      });

      try {
        if (shouldOpen) {
          await once(ws, "open");
          ws.close();
          await once(ws, "close");
          return;
        }

        const [error] = await once(ws, "error");
        assert.equal(typeof error?.message, "string");
        assert.equal(error.message.includes("401"), true);
      } finally {
        ws.terminate();
      }
    },
  );
}

async function main() {
  const testCase = process.argv[2];
  switch (testCase) {
    case "health":
      await runHealth();
      return;
    case "ws-mobile-allow":
      await runWsMobileDevAuth({ headerValue: "mobile-dev-secret", shouldOpen: true });
      return;
    case "ws-mobile-reject":
      await runWsMobileDevAuth({ headerValue: "wrong-key", shouldOpen: false });
      return;
    case "rate-limit":
      await runRateLimit();
      return;
    case "rate-limit-skips-dev-assets":
      await runRateLimitSkipsDevAssets();
      return;
    case "clerk-root-no-token":
      await runClerkRootNoToken();
      return;
    default:
      throw new Error(`Unknown gateway test case: ${testCase}`);
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error?.stack || error);
    process.exit(1);
  });
