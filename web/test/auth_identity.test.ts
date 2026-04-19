import type {} from "mocha";

const { expect } = require("chai");
const {
  DEFAULT_DEV_USER_ID,
  resolveAuthCapabilities,
  resolveCurrentUserId,
  resolveIsDefaultDevUser,
  resolveMessageStorageKey,
} = require("../src/lib/browserIdentity");
const {
  appendTokenToWsUrl,
  getRemWsUrl,
} = require("../src/lib/wsUrl.ts");

function fakeJwt(payload) {
  const encode = (value) =>
    Buffer.from(JSON.stringify(value))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.`;
}

describe("web auth identity helpers", () => {
  it("prefers Clerk user ids over legacy query tokens", () => {
    const legacyToken = fakeJwt({ id: "legacy-user-1" });
    expect(
      resolveCurrentUserId({
        clerkUserId: "user_clerk_123",
        legacyToken,
      }),
    ).to.equal("user_clerk_123");
  });

  it("keeps the default storage key for the dev user and scopes logged-in users", () => {
    expect(
      resolveMessageStorageKey({
        currentUserId: DEFAULT_DEV_USER_ID,
        isDefaultDevUser: true,
      }),
    ).to.equal("remi-chat-messages-v1");

    expect(
      resolveMessageStorageKey({
        currentUserId: "user_clerk_123",
        isDefaultDevUser: false,
      }),
    ).to.equal("remi-chat-messages-v1:user_clerk_123");
  });

  it("identifies non-dev users when Clerk auth is active", () => {
    expect(
      resolveIsDefaultDevUser({
        clerkUserId: "user_clerk_123",
      }),
    ).to.equal(false);
  });

  it("only exposes sign-out when a real Clerk session is active", () => {
    expect(
      resolveAuthCapabilities({
        clerkEnabled: true,
        clerkSignedIn: true,
      }),
    ).to.deep.equal({
      signedIn: true,
      canSignOut: true,
    });

    expect(
      resolveAuthCapabilities({
        clerkEnabled: true,
        clerkSignedIn: false,
        legacyToken: fakeJwt({ id: "legacy-user-1" }),
      }),
    ).to.deep.equal({
      signedIn: true,
      canSignOut: false,
    });

    expect(
      resolveAuthCapabilities({
        clerkEnabled: false,
        clerkSignedIn: false,
      }),
    ).to.deep.equal({
      signedIn: true,
      canSignOut: false,
    });
  });

  it("appends a session token to the websocket url without changing the target", () => {
    expect(
      appendTokenToWsUrl("wss://remi.run/ws", "token-123"),
    ).to.equal("wss://remi.run/ws?token=token-123");
  });

  it("keeps localhost:3001 on the same port by default", () => {
    const previousWindow = global.window;
    global.window = {
      location: {
        protocol: "http:",
        hostname: "127.0.0.1",
        host: "127.0.0.1:3001",
        port: "3001",
        href: "http://127.0.0.1:3001/",
        search: "",
      },
    };

    try {
      expect(getRemWsUrl()).to.equal(
        "ws://127.0.0.1:3001/ws?client=web&tts_transport=pcm_stream_v1",
      );
    } finally {
      if (previousWindow === undefined) {
        delete global.window;
      } else {
        global.window = previousWindow;
      }
    }
  });
});
