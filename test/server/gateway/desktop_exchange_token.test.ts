const assert = require("assert").strict;
const path = require("path");
const { generateKeyPairSync } = require("crypto");
const jwt = require("jsonwebtoken");

const handlerPath = path.resolve(
  __dirname,
  "../../../server/gateway/desktop_auth.ts",
);
const configPath = path.resolve(__dirname, "../../../server/config/index.ts");
const identityPath = path.resolve(
  __dirname,
  "../../../infra/user_identity.ts",
);

// validateEnv() mutates process.env when it expands legacy aliases (e.g.
// JWT_SECRET → REMI_AUTH_JWT_SECRET), so always drive the *canonical* var here
// and neutralize the alias to keep cases isolated.
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
  // Config caches its first read; refresh it so this test's env takes effect.
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

function mockReq({ method = "POST", authorization } = {}) {
  return {
    method,
    headers: authorization ? { authorization } : {},
  };
}

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    ended: false,
    setHeader(key, value) {
      this.headers[String(key).toLowerCase()] = value;
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

function makeClerkKeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  return {
    privateKey,
    publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

describe("POST /api/desktop/exchange-token", () => {
  it("exchanges a valid Clerk token for a 24h legacy JWT carrying the storage user id", async () => {
    const { privateKey, publicPem } = makeClerkKeyPair();
    const clerkToken = jwt.sign(
      { sub: "user_clerk_abc", email: "remi@example.com" },
      privateKey,
      { algorithm: "RS256", expiresIn: "1h" },
    );

    await withEnv(
      {
        REMI_AUTH_MODE: "clerk",
        CLERK_JWT_KEY: publicPem,
        JWT_SECRET: undefined,
        REMI_AUTH_JWT_SECRET: "legacy-secret",
      },
      async () => {
        const { handleDesktopExchangeToken } = require(handlerPath);
        const { authPrincipalToStorageUserId } = require(identityPath);
        const req = mockReq({ authorization: `Bearer ${clerkToken}` });
        const res = mockRes();
        await handleDesktopExchangeToken(req, res);

        assert.equal(res.statusCode, 200);
        const body = res.json();
        assert.equal(body.expiresIn, 24 * 60 * 60);

        // The legacy token must carry the *storage* id of the Clerk principal,
        // not the raw Clerk userId — otherwise desktop and web diverge.
        const expectedStorageId = authPrincipalToStorageUserId({
          provider: "clerk",
          subject: "user_clerk_abc",
          email: "remi@example.com",
        });
        const decoded = jwt.verify(body.token, "legacy-secret");
        assert.equal(decoded.id, expectedStorageId);
      },
    );
  });

  it("makes the desktop (legacy) token resolve to the SAME storage user id as the web (Clerk) token", async () => {
    const { privateKey, publicPem } = makeClerkKeyPair();
    const clerkToken = jwt.sign(
      { sub: "user_clerk_shared", email: "remi@example.com" },
      privateKey,
      { algorithm: "RS256", expiresIn: "1h" },
    );

    await withEnv(
      {
        REMI_AUTH_MODE: "clerk",
        CLERK_JWT_KEY: publicPem,
        JWT_SECRET: undefined,
        REMI_AUTH_JWT_SECRET: "legacy-secret",
      },
      async () => {
        const { handleDesktopExchangeToken } = require(handlerPath);
        const { resolveRequestUserIdentity } = require(identityPath);

        // 1) Exchange the Clerk token for the desktop's legacy token.
        const res = mockRes();
        await handleDesktopExchangeToken(
          mockReq({ authorization: `Bearer ${clerkToken}` }),
          res,
        );
        const { token: desktopToken } = res.json();

        // 2) Resolve the storage identity the way a real WS connection does,
        //    for the web (Clerk) token and the desktop (legacy) token.
        const webIdentity = resolveRequestUserIdentity({
          headers: { authorization: `Bearer ${clerkToken}` },
          url: "/ws",
        });
        const desktopIdentity = resolveRequestUserIdentity({
          headers: { authorization: `Bearer ${desktopToken}` },
          url: "/ws",
        });

        assert.equal(webIdentity.authPrincipal.provider, "clerk");
        assert.equal(desktopIdentity.authPrincipal.provider, "legacy_jwt");
        // The whole point: one shared chat history across devices.
        assert.equal(
          desktopIdentity.storageUserId,
          webIdentity.storageUserId,
        );
      },
    );
  });

  it("rejects a legacy token — only a real Clerk session may mint a desktop credential", async () => {
    const legacyToken = jwt.sign({ id: "legacy-user" }, "legacy-secret", {
      expiresIn: "1h",
    });

    await withEnv(
      {
        REMI_AUTH_MODE: "clerk",
        CLERK_JWT_KEY: undefined,
        JWT_SECRET: undefined,
        REMI_AUTH_JWT_SECRET: "legacy-secret",
      },
      async () => {
        const { handleDesktopExchangeToken } = require(handlerPath);
        const req = mockReq({ authorization: `Bearer ${legacyToken}` });
        const res = mockRes();
        await handleDesktopExchangeToken(req, res);

        assert.equal(res.statusCode, 401);
        assert.equal(res.json().error, "Clerk authentication required");
      },
    );
  });

  it("returns 401 when no bearer token is present", async () => {
    await withEnv(
      {
        REMI_AUTH_MODE: "clerk",
        JWT_SECRET: undefined,
        REMI_AUTH_JWT_SECRET: "legacy-secret",
      },
      async () => {
        const { handleDesktopExchangeToken } = require(handlerPath);
        const req = mockReq({ authorization: undefined });
        const res = mockRes();
        await handleDesktopExchangeToken(req, res);

        assert.equal(res.statusCode, 401);
        assert.equal(res.json().error, "Missing bearer token");
      },
    );
  });

  it("returns 405 for non-POST methods", async () => {
    await withEnv(
      {
        REMI_AUTH_MODE: "clerk",
        JWT_SECRET: undefined,
        REMI_AUTH_JWT_SECRET: "legacy-secret",
      },
      async () => {
        const { handleDesktopExchangeToken } = require(handlerPath);
        const req = mockReq({ method: "GET" });
        const res = mockRes();
        await handleDesktopExchangeToken(req, res);

        assert.equal(res.statusCode, 405);
      },
    );
  });

  it("returns 500 when the legacy signing secret is not configured", async () => {
    const { privateKey, publicPem } = makeClerkKeyPair();
    const clerkToken = jwt.sign({ sub: "user_clerk_xyz" }, privateKey, {
      algorithm: "RS256",
      expiresIn: "1h",
    });

    await withEnv(
      {
        REMI_AUTH_MODE: "clerk",
        CLERK_JWT_KEY: publicPem,
        JWT_SECRET: undefined,
        REMI_AUTH_JWT_SECRET: undefined,
      },
      async () => {
        const { handleDesktopExchangeToken } = require(handlerPath);
        const req = mockReq({ authorization: `Bearer ${clerkToken}` });
        const res = mockRes();
        await handleDesktopExchangeToken(req, res);

        assert.equal(res.statusCode, 500);
        assert.equal(res.json().error, "Token exchange not configured");
      },
    );
  });
});
