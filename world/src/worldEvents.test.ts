import { describe, expect, it } from "vitest";

import {
  createWorldEvent,
  describeWorldEventForRemi,
  getLocalRemiReaction,
  shouldPromoteToMemoryCandidate,
} from "./worldEvents";

describe("worldEvents", () => {
  it("turns placed objects into Remi-observable events", () => {
    const event = createWorldEvent({
      actorId: "player",
      locationLabel: "near Remi's porch",
      objectKind: "lamp",
      type: "player_placed_object",
    });

    expect(describeWorldEventForRemi(event)).toBe(
      "You set a lamp near Remi's porch.",
    );
    expect(shouldPromoteToMemoryCandidate(event)).toBe(true);
  });

  it("keeps low-weight proximity out of memory candidates", () => {
    const event = createWorldEvent({
      actorId: "player",
      emotionalWeight: 0.2,
      locationLabel: "island path",
      objectKind: "blue_flower",
      type: "player_placed_object",
    });

    expect(shouldPromoteToMemoryCandidate(event)).toBe(false);
  });

  it("keeps local Remi reactions restrained and world-aware", () => {
    const event = createWorldEvent({
      actorId: "player",
      locationLabel: "the east shore",
      objectKind: "stone_block",
      type: "player_removed_object",
    });

    expect(getLocalRemiReaction(event)).toBe(
      "I saw you tidy the stone block from the east shore. The island feels a little more intentional now.",
    );
  });

  it("describes local shoreline expansion without treating it as object placement", () => {
    const event = createWorldEvent({
      actorId: "player",
      locationLabel: "the garden shoreline",
      type: "player_expanded_land",
    });

    expect(describeWorldEventForRemi(event)).toBe(
      "You filled a patch of shoreline near the garden shoreline.",
    );
    expect(shouldPromoteToMemoryCandidate(event)).toBe(true);
  });

  it("describes local land removal as world editing, not object tidying", () => {
    const event = createWorldEvent({
      actorId: "player",
      locationLabel: "the front shore",
      type: "player_removed_land",
    });

    expect(describeWorldEventForRemi(event)).toBe(
      "You removed a filled shoreline patch near the front shore.",
    );
    expect(shouldPromoteToMemoryCandidate(event)).toBe(false);
  });
});
