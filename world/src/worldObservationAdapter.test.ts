import { describe, expect, it } from "vitest";

import { createWorldEvent } from "./worldEvents";
import { createRemiObservationCandidate } from "./worldObservationAdapter";

describe("worldObservationAdapter", () => {
  it("maps local world events into a Remi-observable boundary object without importing Remi runtime", () => {
    const event = createWorldEvent({
      actorId: "player",
      locationLabel: "the front shore",
      type: "player_expanded_land",
      occurredAt: "2026-04-30T00:00:00.000Z",
    });

    expect(createRemiObservationCandidate(event)).toEqual({
      source: "remi-world-local",
      eventId: event.id,
      occurredAt: "2026-04-30T00:00:00.000Z",
      actorId: "player",
      summary: "You filled a patch of shoreline near the front shore.",
      tags: ["world", "island", "land"],
      memoryCandidate: true,
      emotionalWeight: event.emotionalWeight,
    });
  });
});
