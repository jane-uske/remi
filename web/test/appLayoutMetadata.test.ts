import type {} from "mocha";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
describe("app layout metadata", () => {
  it("declares remi app icon assets", () => {
    const layoutPath = path.resolve(__dirname, "..", "src", "app", "layout.tsx");
    const source = fs.readFileSync(layoutPath, "utf8");

    assert.ok(source.includes("icons: {"));
    assert.ok(source.includes('url: "/favicon.ico"'));
    assert.ok(source.includes('url: "/icon.png"'));
    assert.ok(source.includes('url: "/apple-icon.png"'));
  });

  it("injects the Safari focus zoom patch next to the theme bootstrap", () => {
    const layoutPath = path.resolve(__dirname, "..", "src", "app", "layout.tsx");
    const source = fs.readFileSync(layoutPath, "utf8");

    assert.ok(source.includes("buildSafariFocusZoomPatchScript"));
    assert.ok(source.includes("safariFocusZoomPatch"));
    assert.ok(source.includes("dangerouslySetInnerHTML={{ __html: safariFocusZoomPatch }}"));
  });

  it("declares Safari theme-color tags so the browser chrome can inherit the app palette", () => {
    const layoutPath = path.resolve(__dirname, "..", "src", "app", "layout.tsx");
    const source = fs.readFileSync(layoutPath, "utf8");

    assert.ok(source.includes('name="theme-color"'));
    assert.ok(source.includes("prefers-color-scheme: dark"));
    assert.ok(source.includes("prefers-color-scheme: light"));
  });

  it("ships favicon and app icon files", () => {
    const root = path.resolve(__dirname, "..", "src", "app");
    assert.equal(fs.existsSync(path.join(root, "favicon.ico")), true);
    assert.equal(fs.existsSync(path.join(root, "icon.png")), true);
    assert.equal(fs.existsSync(path.join(root, "apple-icon.png")), true);
  });

  it("declares installable PWA metadata and service worker registration", () => {
    const layoutPath = path.resolve(__dirname, "..", "src", "app", "layout.tsx");
    const manifestPath = path.resolve(__dirname, "..", "src", "app", "manifest.ts");
    const swPath = path.resolve(__dirname, "..", "public", "sw.js");
    const layoutSource = fs.readFileSync(layoutPath, "utf8");
    const manifestSource = fs.readFileSync(manifestPath, "utf8");

    assert.ok(layoutSource.includes("appleWebApp"));
    assert.ok(layoutSource.includes("RemiPwaRegister"));
    assert.ok(manifestSource.includes('display: "standalone"'));
    assert.ok(manifestSource.includes('short_name: "Remi"'));
    assert.equal(fs.existsSync(swPath), true);
  });
});
