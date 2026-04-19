const assert = require("assert").strict;

const { loadSessionHarness } = require("../../helpers/session_harness");

describe("session client context wiring", () => {
  it("defaults ios_lite sessions to buffered voice when handshake transport is missing", () => {
    const { session, restore } = loadSessionHarness({
      reqUrl: "/ws?client=ios_lite",
    });
    try {
      assert.equal(session.clientFamily, "ios_lite");
      assert.equal(session.getResolvedTtsTransport(), "buffered_voice");
    } finally {
      restore();
    }
  });

  it("keeps explicit handshake transport for ios_lite sessions", () => {
    const { session, restore } = loadSessionHarness({
      reqUrl: "/ws?client=ios_lite&tts_transport=pcm_stream_v1",
    });
    try {
      assert.equal(session.clientFamily, "ios_lite");
      assert.equal(session.getResolvedTtsTransport(), "pcm_stream_v1");
    } finally {
      restore();
    }
  });

  it("keeps auto transport for non-ios sessions", () => {
    const { session, restore } = loadSessionHarness({
      reqUrl: "/ws?client=web",
    });
    try {
      assert.equal(session.clientFamily, "web");
      assert.equal(session.getResolvedTtsTransport(), "auto");
    } finally {
      restore();
    }
  });

  it("stores a valid client timezone and locale on the session context", () => {
    const { ws, session, restore } = loadSessionHarness();
    try {
      ws.emitMessage(
        Buffer.from(
          JSON.stringify({
            type: "client_context",
            timeZone: "America/Los_Angeles",
            locale: "en-US",
          }),
        ),
      );

      assert.equal(session.brain.getClientTimeZone(), "America/Los_Angeles");
      assert.equal(session.brain.getClientLocale(), "en-US");
    } finally {
      restore();
    }
  });

  it("drops invalid client timezones instead of pretending they are usable", () => {
    const { ws, session, restore } = loadSessionHarness();
    try {
      ws.emitMessage(
        Buffer.from(
          JSON.stringify({
            type: "client_context",
            timeZone: "Mars/Base",
            locale: "en-US",
          }),
        ),
      );

      assert.equal(session.brain.getClientTimeZone(), null);
      assert.equal(session.brain.getClientLocale(), "en-US");
    } finally {
      restore();
    }
  });

  it("does not override handshake transport when client_context reports a mismatch", () => {
    const logs = [];
    const { ws, session, restore } = loadSessionHarness({
      reqUrl: "/ws?client=ios_lite&tts_transport=pcm_stream_v1",
      captureLogs: logs,
    });
    try {
      ws.emitMessage(
        Buffer.from(
          JSON.stringify({
            type: "client_context",
            timeZone: "America/Los_Angeles",
            locale: "en-US",
            ttsTransport: "buffered_voice",
          }),
        ),
      );

      assert.equal(session.getResolvedTtsTransport(), "pcm_stream_v1");
      assert.equal(
        logs.some(
          (entry) =>
            entry.level === "warn" &&
            entry.message === "[ClientContext] tts transport mismatch",
        ),
        true,
      );
    } finally {
      restore();
    }
  });

  it("accepts matching web transport from client_context without logging a mismatch", () => {
    const logs = [];
    const { ws, session, restore } = loadSessionHarness({
      reqUrl: "/ws?client=web&tts_transport=pcm_stream_v1",
      captureLogs: logs,
    });
    try {
      ws.emitMessage(
        Buffer.from(
          JSON.stringify({
            type: "client_context",
            timeZone: "Asia/Shanghai",
            locale: "zh-CN",
            ttsTransport: "pcm_stream_v1",
          }),
        ),
      );

      assert.equal(session.getResolvedTtsTransport(), "pcm_stream_v1");
      assert.equal(session.clientContextTtsTransport, "pcm_stream_v1");
      assert.equal(
        logs.some(
          (entry) =>
            entry.level === "warn" &&
            entry.message === "[ClientContext] tts transport mismatch",
        ),
        false,
      );
    } finally {
      restore();
    }
  });
});
