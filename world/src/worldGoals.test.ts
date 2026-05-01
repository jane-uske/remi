import { describe, expect, it } from "vitest";

import {
  createWorldGoalState,
  getWorldGoalLines,
  updateWorldGoalState,
} from "./worldGoals";
import { createWorldEvent } from "./worldEvents";

describe("worldGoals", () => {
  it("tracks the first-session expansion loop from local world events", () => {
    let state = createWorldGoalState();

    state = updateWorldGoalState(
      state,
      createWorldEvent({
        actorId: "player",
        type: "player_expanded_land",
        locationLabel: "the front shore",
      }),
    );
    state = updateWorldGoalState(
      state,
      createWorldEvent({
        actorId: "player",
        type: "player_placed_object",
        objectKind: "pink_flower",
        locationLabel: "the shore path",
      }),
    );
    state = updateWorldGoalState(
      state,
      createWorldEvent({
        actorId: "player",
        type: "player_placed_object",
        objectKind: "lamp",
        locationLabel: "the shore path",
      }),
    );

    expect(getWorldGoalLines(state)).toEqual([
      { complete: true, text: "Fill one shoreline patch" },
      { complete: true, text: "Plant a flower on new land" },
      { complete: true, text: "Light the expanded edge" },
    ]);
  });

  it("does not count shore decoration before the island has been expanded", () => {
    const state = updateWorldGoalState(
      createWorldGoalState(),
      createWorldEvent({
        actorId: "player",
        type: "player_placed_object",
        objectKind: "lamp",
        locationLabel: "the shore path",
      }),
    );

    expect(getWorldGoalLines(state)).toEqual([
      { complete: false, text: "Fill one shoreline patch" },
      { complete: false, text: "Plant a flower on new land" },
      { complete: false, text: "Light the expanded edge" },
    ]);
  });
});
