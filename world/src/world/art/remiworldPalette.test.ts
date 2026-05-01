import { describe, expect, it } from "vitest";

import { remiWorldPalette } from "./remiworldPalette";

describe("remiWorldPalette", () => {
  it("keeps grass muted instead of fluorescent", () => {
    expect(remiWorldPalette.grassBase.g).toBeLessThan(0.54);
    expect(remiWorldPalette.grassBase.r).toBeGreaterThan(0.34);
    expect(remiWorldPalette.grassDark.g).toBeLessThan(0.42);
  });

  it("keeps roof and wood dark but readable", () => {
    expect(remiWorldPalette.roofDark.r).toBeGreaterThan(0.13);
    expect(remiWorldPalette.roofDark.g).toBeGreaterThan(0.07);
    expect(remiWorldPalette.roofDark.b).toBeGreaterThan(0.04);
    expect(remiWorldPalette.woodDark.r).toBeGreaterThan(remiWorldPalette.roofDark.r);
  });

  it("uses warm amber lights and cool purple-blue shadows", () => {
    expect(remiWorldPalette.lanternWarm.r).toBeGreaterThan(0.9);
    expect(remiWorldPalette.lanternWarm.g).toBeGreaterThan(0.55);
    expect(remiWorldPalette.lanternWarm.b).toBeLessThan(0.25);
    expect(remiWorldPalette.shadowTint.b).toBeGreaterThan(remiWorldPalette.shadowTint.r);
  });
});
