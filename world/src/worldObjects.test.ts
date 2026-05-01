import { describe, expect, it } from "vitest";

import {
  WORLD_OBJECTS,
  getWorldObjectControlHint,
  getWorldObjectSelectionHint,
} from "./worldObjects";

describe("worldObjects", () => {
  it("defines the MVP hotbar objects in the intended order", () => {
    expect(WORLD_OBJECTS.map((object) => object.id)).toEqual([
      "lamp",
      "blue_flower",
      "pink_flower",
      "wood_block",
      "stone_block",
      "land_fill",
    ]);
  });

  it("keeps every hotbar item placeable on the island", () => {
    for (const object of WORLD_OBJECTS) {
      expect(object.placeable).toBe(true);
      expect(object.hotbarLabel.length).toBeGreaterThan(0);
    }
  });

  it("uses land-specific affordance text for shoreline expansion", () => {
    expect(getWorldObjectSelectionHint("land_fill")).toContain(
      "water touching the shoreline",
    );
    expect(getWorldObjectControlHint("land_fill")).toContain("fills land");
    expect(getWorldObjectSelectionHint("lamp")).toContain("left click to place");
  });
});
