import type {} from "mocha";

const assert = require("node:assert/strict");
const {
  isLiveClerkPublishableKey,
  isLoopbackHostname,
  resolveClerkRuntimePolicy,
} = require("../src/lib/authMode");

describe("web auth mode runtime policy", () => {
  it("recognizes loopback hosts and live Clerk keys", () => {
    assert.equal(isLoopbackHostname("localhost"), true);
    assert.equal(isLoopbackHostname("127.0.0.1"), true);
    assert.equal(isLoopbackHostname("app-rem.remi.run"), false);

    assert.equal(isLiveClerkPublishableKey("pk_live_example"), true);
    assert.equal(isLiveClerkPublishableKey("pk_test_example"), false);
  });

  it("falls back to local dev auth on loopback when using a live Clerk key", () => {
    assert.deepEqual(
      resolveClerkRuntimePolicy({
        hostname: "localhost",
        mode: "clerk",
        publishableKey: "pk_live_example",
      }),
      {
        clerkEnabled: false,
      },
    );
  });

  it("keeps Clerk enabled on the canonical host", () => {
    assert.deepEqual(
      resolveClerkRuntimePolicy({
        hostname: "app-rem.remi.run",
        pathname: "/",
        mode: "clerk",
        publishableKey: "pk_live_example",
      }),
      {
        clerkEnabled: true,
      },
    );
  });
});
