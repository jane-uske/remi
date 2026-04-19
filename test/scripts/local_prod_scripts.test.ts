const assert = require("assert").strict;
const fs = require("fs");
const path = require("path");

function readRepoFile(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, `../../${relativePath}`), "utf8");
}

function readPackageScripts() {
  const pkg = JSON.parse(readRepoFile("package.json"));
  return pkg.scripts || {};
}

describe("local prod script wiring", () => {
  it("splits local prod start/build/rebuild commands", () => {
    const scripts = readPackageScripts();

    assert.equal(scripts["prod:local:start"], "./scripts/start-local-prod.sh");
    assert.equal(scripts["prod:local:build"], "./scripts/build-local-prod.sh");
    assert.equal(scripts["prod:local:rebuild"], "./scripts/rebuild-local-prod.sh");
  });

  it("starts local prod without forcing a rebuild", () => {
    const script = readRepoFile("scripts/start-local-prod.sh");

    assert.equal(script.includes("up -d --no-build"), true);
    assert.equal(script.includes("--build"), false);
  });

  it("provides explicit build and rebuild entrypoints", () => {
    const buildScript = readRepoFile("scripts/build-local-prod.sh");
    const rebuildScript = readRepoFile("scripts/rebuild-local-prod.sh");

    assert.equal(buildScript.includes("docker compose"), true);
    assert.equal(buildScript.includes(" build app"), true);
    assert.equal(rebuildScript.includes("./scripts/build-local-prod.sh"), true);
    assert.equal(rebuildScript.includes("./scripts/start-local-prod.sh"), true);
  });

  it("keeps heavy local artifacts out of docker build context", () => {
    const dockerignore = readRepoFile(".dockerignore");

    for (const pattern of ["node_modules", "web/.next", "web/.next-dev", ".git", "artifacts", "dist"]) {
      assert.equal(
        dockerignore.includes(pattern),
        true,
        `expected .dockerignore to exclude ${pattern}`,
      );
    }
  });
});
