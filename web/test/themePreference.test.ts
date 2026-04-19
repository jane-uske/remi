import type {} from "mocha";

const assert = require("node:assert/strict");
const {
  applyThemePreferenceToDocument,
  normalizeThemePreference,
  THEME_PREFERENCE_STORAGE_KEY,
} = require("../src/lib/theme/themePreference");

describe("themePreference", () => {
  it("normalizes invalid preferences back to system", () => {
    assert.equal(normalizeThemePreference("dark"), "dark");
    assert.equal(normalizeThemePreference("light"), "light");
    assert.equal(normalizeThemePreference("system"), "system");
    assert.equal(normalizeThemePreference("unknown"), "system");
    assert.equal(normalizeThemePreference(null), "system");
  });

  it("applies explicit light/dark and clears data-theme for system", () => {
    const documentElement = {
      dataset: {},
      style: {},
    };

    applyThemePreferenceToDocument(documentElement, "dark");
    assert.equal(documentElement.dataset.theme, "dark");

    applyThemePreferenceToDocument(documentElement, "light");
    assert.equal(documentElement.dataset.theme, "light");

    applyThemePreferenceToDocument(documentElement, "system");
    assert.equal(documentElement.dataset.theme, undefined);
  });

  it("uses a stable localStorage key", () => {
    assert.equal(THEME_PREFERENCE_STORAGE_KEY, "remi-theme-preference");
  });
});
