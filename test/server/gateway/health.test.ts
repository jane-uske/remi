const assert = require("assert").strict;
const path = require("path");
const { spawnSync } = require("child_process");

const gatewayCaseRunner = path.resolve(__dirname, "./gateway_case_runner.cjs");

function runGatewayCase(name) {
  const result = spawnSync(process.execPath, [gatewayCaseRunner, name], {
    cwd: path.resolve(__dirname, "../../.."),
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(detail || `gateway case ${name} failed with code ${result.status}`);
  }
}

describe("/health", () => {
  it("returns a lightweight public health payload", async function () {
    this.timeout(20000);
    assert.doesNotThrow(() => runGatewayCase("health"));
  });
});
