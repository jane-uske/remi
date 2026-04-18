const assert = require("assert").strict;
const path = require("path");
const jwt = require("jsonwebtoken");

const modulePath = path.resolve(__dirname, "../../infra/user_identity.ts");

function fakeReq(url = "/", headers = {}) {
  return {
    url,
    headers,
  };
}

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

describe("request user identity resolution", () => {
  afterEach(() => {
    delete require.cache[modulePath];
  });

  it("uses a deterministic storage id for clerk principals", async () => {
    const {
      authPrincipalToStorageUserId,
    } = require(modulePath);
    const a = authPrincipalToStorageUserId({
      provider: "clerk",
      subject: "user_abc",
      email: null,
    });
    const b = authPrincipalToStorageUserId({
      provider: "clerk",
      subject: "user_abc",
      email: "other@example.com",
    });
    const c = authPrincipalToStorageUserId({
      provider: "clerk",
      subject: "user_other",
      email: null,
    });

    assert.equal(a, b);
    assert.notEqual(a, c);
  });

  it("resolves clerk auth principals from bearer tokens", async () => {
    const token = jwt.sign({ id: "legacy-user-2" }, "legacy-secret", {
      expiresIn: "1h",
    });

    await withEnv(
      {
        REMI_AUTH_MODE: "legacy_jwt",
        JWT_SECRET: "legacy-secret",
      },
      async () => {
        const { resolveRequestUserIdentity } = require(modulePath);
        const resolved = resolveRequestUserIdentity(
          fakeReq("/", { authorization: `Bearer ${token}` }),
        );
        assert.equal(resolved.authPrincipal?.provider, "legacy_jwt");
        assert.equal(resolved.authPrincipal?.subject, "legacy-user-2");
        assert.equal(resolved.storageUserId, resolved.authPrincipalStorageUserId);
      },
    );
  });

  it("falls back to the dev user without a token", () => {
    const { DEV_STORAGE_USER_ID, resolveRequestUserIdentity } = require(modulePath);
    const resolved = resolveRequestUserIdentity(fakeReq());
    assert.equal(resolved.authPrincipal, null);
    assert.equal(resolved.storageUserId, DEV_STORAGE_USER_ID);
  });
});
