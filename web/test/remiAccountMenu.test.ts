import type {} from "mocha";

const assert = require("node:assert/strict");
const ReactLib = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const {
  PersonaPresetSelectorSection,
  RemiAccountMenu,
  ThemePreferenceSelectorSection,
} = require("../src/components/RemiAccountMenu");

describe("RemiAccountMenu", () => {
  it("renders a compact trigger that keeps detailed identity metadata out of the header", () => {
    const markup = renderToStaticMarkup(
      ReactLib.createElement(RemiAccountMenu, {
        emotionLabel: "中性",
        currentUserId: "default-user",
        isDefaultDevUser: true,
        wsTargetLabel: "ws://localhost:3001/ws",
        personaPreset: "witty_warm",
        canSignOut: false,
        onSignOut: async () => {},
        onUpdatePersonaPreset: () => {},
      }),
    );

    assert.ok(markup.includes("rounded-full"));
    assert.ok(markup.includes("size-11"));
    assert.ok(markup.includes('/avatar/assets/remi-selected-portrait.png'));
    assert.ok(markup.includes("hidden min-w-0 sm:block"));
    assert.ok(!markup.includes("uid:"));
    assert.ok(!markup.includes("ws:"));
  });

  it("renders the persona preset selector section with explanatory copy", () => {
    const markup = renderToStaticMarkup(
      ReactLib.createElement(PersonaPresetSelectorSection, {
        personaPreset: "playful_attached",
        onUpdatePersonaPreset: () => {},
      }),
    );

    assert.ok(markup.includes("表达风格"));
    assert.ok(markup.includes("只改变 Remi 的表达风格，不会重置关系或记忆"));
    assert.ok(markup.includes("活泼黏人"));
    assert.ok(markup.includes('data-persona-preset="playful_attached"'));
  });

  it("renders the theme selector section with system/light/dark options", () => {
    const markup = renderToStaticMarkup(
      ReactLib.createElement(ThemePreferenceSelectorSection, {
        themePreference: "system",
        onUpdateThemePreference: () => {},
      }),
    );

    assert.ok(markup.includes("外观主题"));
    assert.ok(markup.includes("跟随系统"));
    assert.ok(markup.includes("浅色"));
    assert.ok(markup.includes("深色"));
    assert.ok(markup.includes('data-theme-preference="system"'));
  });
});
