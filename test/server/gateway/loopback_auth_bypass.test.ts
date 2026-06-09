import assert from "assert";

import { isLocalLoopbackRequestParts } from "../../../server/gateway";

describe("gateway loopback auth bypass", () => {
  it("treats Docker-published localhost and lvh.me requests as local", () => {
    assert.equal(isLocalLoopbackRequestParts("127.0.0.1:3000", "172.18.0.1"), true);
    assert.equal(isLocalLoopbackRequestParts("localhost:3000", "172.18.0.1"), true);
    assert.equal(isLocalLoopbackRequestParts("lvh.me:3000", "172.18.0.1"), true);
  });

  it("does not treat arbitrary public hosts as local", () => {
    assert.equal(isLocalLoopbackRequestParts("app-rem.remi.run", "172.18.0.1"), false);
    assert.equal(isLocalLoopbackRequestParts("lvh.me:3000", "203.0.113.10"), false);
  });
});
