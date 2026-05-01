import {
  describeWorldEventForRemi,
  shouldPromoteToMemoryCandidate,
  type WorldEvent,
} from "./worldEvents";

export interface RemiObservationCandidate {
  source: "remi-world-local";
  eventId: string;
  occurredAt: string;
  actorId: "player";
  summary: string;
  tags: string[];
  memoryCandidate: boolean;
  emotionalWeight: number;
}

export function createRemiObservationCandidate(
  event: WorldEvent,
): RemiObservationCandidate {
  return {
    source: "remi-world-local",
    eventId: event.id,
    occurredAt: event.occurredAt,
    actorId: event.actorId,
    summary: describeWorldEventForRemi(event),
    tags: getObservationTags(event),
    memoryCandidate: shouldPromoteToMemoryCandidate(event),
    emotionalWeight: event.emotionalWeight,
  };
}

function getObservationTags(event: WorldEvent): string[] {
  const tags = ["world", "island"];

  if (event.type === "player_expanded_land" || event.type === "player_removed_land") {
    tags.push("land");
  }

  if (event.type === "player_placed_object" || event.type === "player_removed_object") {
    tags.push("object");
  }

  if (event.objectKind) {
    tags.push(event.objectKind);
  }

  return tags;
}
