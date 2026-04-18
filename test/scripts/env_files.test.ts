const assert = require("assert").strict;

const {
  resolveDevPort,
  resolveProdPort,
} = require("../../scripts/env_files.cjs");

describe("env file helpers", () => {
  it("defaults dev to port 3001", () => {
    const env = {};

    assert.equal(resolveDevPort(env), 3001);
  });

  it("defaults local prod to port 3000", () => {
    const env = {};

    assert.equal(resolveProdPort(env), 3000);
  });

  it("allows explicit PORT override for both modes", () => {
    const env = { PORT: "4310" };

    assert.equal(resolveDevPort(env), 4310);
    assert.equal(resolveProdPort(env), 4310);
  });
});
