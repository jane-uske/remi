const assert = require("assert").strict;
const path = require("path");
const { generateKeyPairSync } = require("crypto");
const jwt = require("jsonwebtoken");

const authPath = path.resolve(__dirname, "../../infra/auth.ts");

function withEnv(values, fn) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

describe("infra auth providers", () => {
  afterEach(() => {
    delete require.cache[authPath];
  });

  it("verifies a Clerk session token when clerk auth mode is enabled", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const token = jwt.sign(
      {
        sub: "user_clerk_123",
        email: "remi@example.com",
      },
      privateKey,
      { algorithm: "RS256", expiresIn: "1h" },
    );

    await withEnv(
      {
        REMI_AUTH_MODE: "clerk",
        CLERK_JWT_KEY: publicKey.export({ type: "spki", format: "pem" }).toString(),
        JWT_SECRET: undefined,
      },
      async () => {
        const { verifyToken } = require(authPath);
        const principal = verifyToken(token);
        assert.deepEqual(principal, {
          provider: "clerk",
          subject: "user_clerk_123",
          email: "remi@example.com",
        });
      },
    );
  });

  it("falls back to legacy jwt verification when clerk mode receives a legacy token", async () => {
    const token = jwt.sign({ id: "legacy-user-1" }, "legacy-secret", {
      expiresIn: "1h",
    });

    await withEnv(
      {
        REMI_AUTH_MODE: "clerk",
        CLERK_JWT_KEY: undefined,
        JWT_SECRET: "legacy-secret",
      },
      async () => {
        const { verifyToken } = require(authPath);
        const principal = verifyToken(token);
        assert.deepEqual(principal, {
          provider: "legacy_jwt",
          subject: "legacy-user-1",
          email: null,
        });
      },
    );
  });

  it("returns null for invalid tokens", async () => {
    await withEnv(
      {
        REMI_AUTH_MODE: "legacy_jwt",
        JWT_SECRET: "legacy-secret",
        CLERK_JWT_KEY: undefined,
      },
      async () => {
        const { verifyToken } = require(authPath);
        assert.equal(verifyToken("definitely-not-a-token"), null);
      },
    );
  });
});
