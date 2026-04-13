const assert = require("assert").strict;
const { once } = require("events");

const { createGateway } = require("../../../server/gateway");

describe("/health", () => {
  it("returns a lightweight public health payload", async function () {
    this.timeout(20000);
    const previousJwtSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "test-secret";

    const server = await createGateway({ onConnection() {} });
    try {
      server.listen(0);
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected an ephemeral port address");
      }

      const res = await fetch(`http://127.0.0.1:${address.port}/health`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-type")?.startsWith("application/json"), true);

      const payload = await res.json();
      assert.equal(payload.ok, true);
      assert.equal(payload.service, "remi");
      assert.equal(typeof payload.uptimeSec, "number");
      assert.equal(Number.isFinite(payload.uptimeSec), true);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      if (previousJwtSecret === undefined) {
        delete process.env.JWT_SECRET;
      } else {
        process.env.JWT_SECRET = previousJwtSecret;
      }
    }
  });
});
