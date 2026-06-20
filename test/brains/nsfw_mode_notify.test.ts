import type {} from "mocha";

const assert = require("node:assert/strict");
const { WebSocket } = require("ws");

const {
  bindNsfwNotifier,
  unbindNsfwNotifier,
  setNsfw,
  sendNsfwModeState,
  isNsfwEnabled,
  clearNsfw,
} = require("../../brains/nsfw_mode");

describe("nsfw_mode notifier", () => {
  it("broadcasts nsfw_mode_state when setNsfw toggles", () => {
    const sent: string[] = [];
    const ws = {
      readyState: WebSocket.OPEN,
      send: (payload: string) => {
        sent.push(payload);
      },
    };
    const connId = `conn-nsfw-notify-${Date.now()}`;

    bindNsfwNotifier(connId, ws);
    assert.equal(isNsfwEnabled(connId), false);

    setNsfw(connId, true);
    assert.equal(isNsfwEnabled(connId), true);
    assert.equal(sent.length, 1);
    assert.deepEqual(JSON.parse(sent[0]!), {
      type: "nsfw_mode_state",
      enabled: true,
    });

    setNsfw(connId, true);
    assert.equal(sent.length, 1);

    setNsfw(connId, false);
    assert.equal(sent.length, 2);
    assert.deepEqual(JSON.parse(sent[1]!), {
      type: "nsfw_mode_state",
      enabled: false,
    });

    clearNsfw(connId);
    unbindNsfwNotifier(connId);
  });

  it("sendNsfwModeState reports the current session flag", () => {
    const sent: string[] = [];
    const ws = {
      readyState: WebSocket.OPEN,
      send: (payload: string) => {
        sent.push(payload);
      },
    };
    const connId = `conn-nsfw-snapshot-${Date.now()}`;

    bindNsfwNotifier(connId, ws);
    setNsfw(connId, true);
    sent.length = 0;

    sendNsfwModeState(connId);
    assert.deepEqual(JSON.parse(sent[0]!), {
      type: "nsfw_mode_state",
      enabled: true,
    });

    clearNsfw(connId);
    unbindNsfwNotifier(connId);
  });
});