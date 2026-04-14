const assert = require("assert").strict;
const { once } = require("events");
const { WebSocket } = require("ws");

function loadCreateGateway() {
  const modulePath = require.resolve("../../../server/gateway");
  delete require.cache[modulePath];
  return require("../../../server/gateway").createGateway;
}

function restoreEnv(key, previous) {
  if (previous === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = previous;
  }
}

describe("gateway ws mobile dev auth", () => {
  it("allows websocket upgrade with mobile dev key header when JWT and access gate are enabled", async function () {
    this.timeout(20000);
    const prevJwt = process.env.JWT_SECRET;
    const prevAccess = process.env.REMI_ACCESS_PASSWORD;
    const prevMobileEnabled = process.env.REMI_MOBILE_DEV_ENABLED;
    const prevMobileKey = process.env.REMI_MOBILE_DEV_KEY;

    process.env.JWT_SECRET = "jwt-test-secret";
    process.env.REMI_ACCESS_PASSWORD = "access-password";
    process.env.REMI_MOBILE_DEV_ENABLED = "1";
    process.env.REMI_MOBILE_DEV_KEY = "mobile-dev-secret";

    const createGateway = loadCreateGateway();
    const server = await createGateway({ onConnection() {} });
    let ws = null;
    try {
      server.listen(0);
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected an ephemeral port address");
      }

      ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws`, {
        headers: {
          Host: "remi.test",
          "X-Rem-Mobile-Key": "mobile-dev-secret",
        },
      });
      await once(ws, "open");
      ws.close();
      await once(ws, "close");
    } finally {
      ws?.terminate();
      await new Promise((resolve) => server.close(resolve));
      restoreEnv("JWT_SECRET", prevJwt);
      restoreEnv("REMI_ACCESS_PASSWORD", prevAccess);
      restoreEnv("REMI_MOBILE_DEV_ENABLED", prevMobileEnabled);
      restoreEnv("REMI_MOBILE_DEV_KEY", prevMobileKey);
    }
  });

  it("rejects websocket upgrade when mobile key is wrong", async function () {
    this.timeout(20000);
    const prevJwt = process.env.JWT_SECRET;
    const prevAccess = process.env.REMI_ACCESS_PASSWORD;
    const prevMobileEnabled = process.env.REMI_MOBILE_DEV_ENABLED;
    const prevMobileKey = process.env.REMI_MOBILE_DEV_KEY;

    process.env.JWT_SECRET = "jwt-test-secret";
    process.env.REMI_ACCESS_PASSWORD = "access-password";
    process.env.REMI_MOBILE_DEV_ENABLED = "1";
    process.env.REMI_MOBILE_DEV_KEY = "mobile-dev-secret";

    const createGateway = loadCreateGateway();
    const server = await createGateway({ onConnection() {} });
    let ws = null;
    try {
      server.listen(0);
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected an ephemeral port address");
      }

      ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws`, {
        headers: {
          Host: "remi.test",
          "X-Remi-Mobile-Key": "wrong-key",
        },
      });
      const [error] = await once(ws, "error");
      assert.equal(typeof error?.message, "string");
      assert.equal(error.message.includes("401"), true);
      ws.close();
    } finally {
      ws?.terminate();
      await new Promise((resolve) => server.close(resolve));
      restoreEnv("JWT_SECRET", prevJwt);
      restoreEnv("REMI_ACCESS_PASSWORD", prevAccess);
      restoreEnv("REMI_MOBILE_DEV_ENABLED", prevMobileEnabled);
      restoreEnv("REMI_MOBILE_DEV_KEY", prevMobileKey);
    }
  });
});
