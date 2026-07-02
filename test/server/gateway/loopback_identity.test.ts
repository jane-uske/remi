const assert = require("assert").strict;
const path = require("path");
const { EventEmitter } = require("events");
const jwt = require("jsonwebtoken");

const handlerPath = path.resolve(
  __dirname,
  "../../../server/gateway/loopback_identity.ts",
);
const configPath = path.resolve(__dirname, "../../../server/config/index.ts");

// See test/server/gateway/desktop_exchange_token.test.ts for why resetConfig()
// is required around env mutation in these tests.
async function withEnv(values, fn) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  require(configPath).resetConfig();
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    require(configPath).resetConfig();
  }
}

function mockReq({
  method = "POST",
  host = "127.0.0.1:3000",
  remoteAddress = "127.0.0.1",
  body,
} = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.headers = { host };
  req.socket = { remoteAddress };
  // Fire the body asynchronously so handlers that attach listeners
  // synchronously (as readJsonBody does) still receive the data.
  if (body !== undefined) {
    process.nextTick(() => {
      req.emit("data", Buffer.from(JSON.stringify(body)));
      req.emit("end");
    });
  } else {
    process.nextTick(() => req.emit("end"));
  }
  return req;
}

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    ended: false,
    writeHead(status, headers) {
      this.statusCode = status;
      Object.assign(this.headers, headers ?? {});
    },
    end(chunk) {
      if (chunk) this.body += chunk;
      this.ended = true;
    },
    json() {
      return JSON.parse(this.body);
    },
  };
}

describe("POST /api/loopback-identity", () => {
  it("mints a legacy JWT for a UUID device id from a loopback request", async () => {
    await withEnv(
      {
        REMI_AUTH_ALLOW_LOOPBACK_BYPASS: "1",
        JWT_SECRET: undefined,
        REMI_AUTH_JWT_SECRET: "legacy-secret",
      },
      async () => {
        const { handleLoopbackIdentity } = require(handlerPath);
        const deviceId = "11111111-1111-4111-8111-111111111111";
        const req = mockReq({ body: { deviceId } });
        const res = mockRes();
        await handleLoopbackIdentity(req, res);

        assert.equal(res.statusCode, 200);
        const responseBody = res.json();
        assert.equal(responseBody.expiresIn, 24 * 60 * 60);
        const decoded = jwt.verify(responseBody.token, "legacy-secret");
        assert.equal(decoded.id, deviceId);
      },
    );
  });

  it("is idempotent — the same device id always mints a token for the same subject", async () => {
    await withEnv(
      {
        REMI_AUTH_ALLOW_LOOPBACK_BYPASS: "1",
        JWT_SECRET: undefined,
        REMI_AUTH_JWT_SECRET: "legacy-secret",
      },
      async () => {
        const { handleLoopbackIdentity } = require(handlerPath);
        const deviceId = "22222222-2222-4222-8222-222222222222";

        const res1 = mockRes();
        await handleLoopbackIdentity(mockReq({ body: { deviceId } }), res1);
        const res2 = mockRes();
        await handleLoopbackIdentity(mockReq({ body: { deviceId } }), res2);

        const decoded1 = jwt.verify(res1.json().token, "legacy-secret");
        const decoded2 = jwt.verify(res2.json().token, "legacy-secret");
        assert.equal(decoded1.id, decoded2.id);
        assert.equal(decoded1.id, deviceId);
      },
    );
  });

  it("rejects requests from a non-loopback host even with a valid deviceId", async () => {
    await withEnv(
      {
        REMI_AUTH_ALLOW_LOOPBACK_BYPASS: "1",
        JWT_SECRET: undefined,
        REMI_AUTH_JWT_SECRET: "legacy-secret",
      },
      async () => {
        const { handleLoopbackIdentity } = require(handlerPath);
        const deviceId = "33333333-3333-4333-8333-333333333333";
        const req = mockReq({
          host: "ai.remi.run",
          remoteAddress: "203.0.113.10",
          body: { deviceId },
        });
        const res = mockRes();
        await handleLoopbackIdentity(req, res);

        assert.equal(res.statusCode, 403);
      },
    );
  });

  it("rejects when REMI_AUTH_ALLOW_LOOPBACK_BYPASS is disabled, even on loopback", async () => {
    await withEnv(
      {
        REMI_AUTH_ALLOW_LOOPBACK_BYPASS: "0",
        JWT_SECRET: undefined,
        REMI_AUTH_JWT_SECRET: "legacy-secret",
      },
      async () => {
        const { handleLoopbackIdentity } = require(handlerPath);
        const deviceId = "44444444-4444-4444-8444-444444444444";
        const req = mockReq({ body: { deviceId } });
        const res = mockRes();
        await handleLoopbackIdentity(req, res);

        assert.equal(res.statusCode, 403);
      },
    );
  });

  it("rejects a non-UUID deviceId", async () => {
    await withEnv(
      {
        REMI_AUTH_ALLOW_LOOPBACK_BYPASS: "1",
        JWT_SECRET: undefined,
        REMI_AUTH_JWT_SECRET: "legacy-secret",
      },
      async () => {
        const { handleLoopbackIdentity } = require(handlerPath);
        const req = mockReq({ body: { deviceId: "not-a-uuid" } });
        const res = mockRes();
        await handleLoopbackIdentity(req, res);

        assert.equal(res.statusCode, 400);
      },
    );
  });

  it("returns 405 for non-POST methods", async () => {
    await withEnv(
      {
        REMI_AUTH_ALLOW_LOOPBACK_BYPASS: "1",
        JWT_SECRET: undefined,
        REMI_AUTH_JWT_SECRET: "legacy-secret",
      },
      async () => {
        const { handleLoopbackIdentity } = require(handlerPath);
        const req = mockReq({ method: "GET" });
        const res = mockRes();
        await handleLoopbackIdentity(req, res);

        assert.equal(res.statusCode, 405);
      },
    );
  });

  it("returns 500 when the legacy signing secret is not configured", async () => {
    await withEnv(
      {
        REMI_AUTH_ALLOW_LOOPBACK_BYPASS: "1",
        JWT_SECRET: undefined,
        REMI_AUTH_JWT_SECRET: undefined,
      },
      async () => {
        const { handleLoopbackIdentity } = require(handlerPath);
        const deviceId = "55555555-5555-4555-8555-555555555555";
        const req = mockReq({ body: { deviceId } });
        const res = mockRes();
        await handleLoopbackIdentity(req, res);

        assert.equal(res.statusCode, 500);
      },
    );
  });

  it("resolves the minted token to the SAME storage user id it was minted for", async () => {
    await withEnv(
      {
        REMI_AUTH_ALLOW_LOOPBACK_BYPASS: "1",
        REMI_AUTH_MODE: "clerk",
        JWT_SECRET: undefined,
        REMI_AUTH_JWT_SECRET: "legacy-secret",
      },
      async () => {
        const { handleLoopbackIdentity } = require(handlerPath);
        const identityPath = path.resolve(
          __dirname,
          "../../../infra/user_identity.ts",
        );
        const { resolveRequestUserIdentity } = require(identityPath);

        const deviceId = "66666666-6666-4666-8666-666666666666";
        const res = mockRes();
        await handleLoopbackIdentity(mockReq({ body: { deviceId } }), res);
        const { token } = res.json();

        const identity = resolveRequestUserIdentity({
          headers: { authorization: `Bearer ${token}` },
          url: "/api/chat",
        });
        assert.equal(identity.authPrincipal.provider, "legacy_jwt");
        // normalizeToStorageUserId passes a well-formed UUID through untouched.
        assert.equal(identity.storageUserId, deviceId);
      },
    );
  });
});
