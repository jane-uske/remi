import type {} from "mocha";

const assert = require("node:assert/strict");
const ReactLib = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const {
  DEFAULT_USER_PERSONA_PRESET,
  PersonaPresetSelectorSection,
  USER_PERSONA_PRESET_OPTIONS,
  normalizeUserPersonaPreset,
  resolveUserPersonaPresetChange,
} = require("../src/components/RemiAccountMenu");

describe("USER_PERSONA_PRESET_OPTIONS", () => {
  it("matches the canonical user-facing preset list", () => {
    assert.deepEqual(USER_PERSONA_PRESET_OPTIONS, [
      { value: "witty_warm", label: "温柔机灵" },
      { value: "relaxed_roast", label: "松弛吐槽" },
      { value: "playful_attached", label: "活泼黏人" },
      { value: "calm_healing", label: "冷静治愈" },
    ]);
  });
});

describe("normalizeUserPersonaPreset", () => {
  it("falls back for null or invalid presets", () => {
    assert.equal(
      normalizeUserPersonaPreset(null),
      DEFAULT_USER_PERSONA_PRESET,
    );
    assert.equal(
      normalizeUserPersonaPreset("not_real"),
      DEFAULT_USER_PERSONA_PRESET,
    );
  });

  it("preserves canonical preset ids", () => {
    assert.equal(
      normalizeUserPersonaPreset("playful_attached"),
      "playful_attached",
    );
  });
});

describe("resolveUserPersonaPresetChange", () => {
  it("treats re-selecting the same normalized preset as a no-op", () => {
    assert.equal(resolveUserPersonaPresetChange(null, "witty_warm"), null);
    assert.equal(
      resolveUserPersonaPresetChange("playful_attached", "playful_attached"),
      null,
    );
  });

  it("ignores invalid next preset ids", () => {
    assert.equal(
      resolveUserPersonaPresetChange("playful_attached", "not_real"),
      null,
    );
  });

  it("returns the next preset when selecting a different canonical option", () => {
    assert.equal(
      resolveUserPersonaPresetChange("playful_attached", "calm_healing"),
      "calm_healing",
    );
  });
});

describe("PersonaPresetSelectorSection", () => {
  it("renders using the normalized fallback preset", () => {
    const markup = renderToStaticMarkup(
      ReactLib.createElement(PersonaPresetSelectorSection, {
        personaPreset: "not_real",
        onUpdatePersonaPreset: () => {},
      }),
    );

    assert.ok(
      markup.includes(`data-persona-preset="${DEFAULT_USER_PERSONA_PRESET}"`),
    );
  });

  it("only calls onUpdatePersonaPreset for a different canonical option", () => {
    const calls: string[] = [];
    const noopChange = {
      target: { value: "witty_warm" },
    };
    const realChange = {
      target: { value: "calm_healing" },
    };

    const element = PersonaPresetSelectorSection({
      personaPreset: null,
      onUpdatePersonaPreset: (presetId: string) => {
        calls.push(presetId);
      },
    });

    element.props.children[0].props.children[1].props.onChange(noopChange);
    element.props.children[0].props.children[1].props.onChange(realChange);

    assert.deepEqual(calls, ["calm_healing"]);
  });
});
