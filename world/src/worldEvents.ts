import {
  WORLD_OBJECT_LABELS,
  type WorldObjectKind,
} from "./worldObjects";

export type WorldEventType =
  | "player_placed_object"
  | "player_removed_object"
  | "player_expanded_land"
  | "player_removed_land";

export interface CreateWorldEventInput {
  actorId: "player";
  type: WorldEventType;
  objectKind?: WorldObjectKind;
  locationLabel: string;
  emotionalWeight?: number;
  occurredAt?: string;
}

export interface WorldEvent {
  id: string;
  actorId: "player";
  type: WorldEventType;
  objectKind?: WorldObjectKind;
  locationLabel: string;
  emotionalWeight: number;
  occurredAt: string;
  memoryCandidate: boolean;
}

const DEFAULT_WEIGHTS: Record<WorldEventType, number> = {
  player_placed_object: 0.72,
  player_removed_object: 0.48,
  player_expanded_land: 0.68,
  player_removed_land: 0.42,
};

export function createWorldEvent(input: CreateWorldEventInput): WorldEvent {
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  const emotionalWeight =
    input.emotionalWeight ?? DEFAULT_WEIGHTS[input.type];

  return {
    id: [
      input.type,
      input.objectKind ?? "none",
      input.locationLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      occurredAt,
    ].join(":"),
    actorId: input.actorId,
    type: input.type,
    objectKind: input.objectKind,
    locationLabel: input.locationLabel,
    emotionalWeight,
    occurredAt,
    memoryCandidate: emotionalWeight >= 0.6,
  };
}

export function shouldPromoteToMemoryCandidate(event: WorldEvent): boolean {
  if (!event.memoryCandidate) {
    return false;
  }

  return (
    event.type === "player_placed_object" ||
    event.type === "player_removed_object" ||
    event.type === "player_expanded_land"
  );
}

export function describeWorldEventForRemi(event: WorldEvent): string {
  const objectLabel = getObjectLabel(event);

  if (event.type === "player_expanded_land") {
    return `You filled a patch of shoreline near ${event.locationLabel}.`;
  }

  if (event.type === "player_removed_land") {
    return `You removed a filled shoreline patch near ${event.locationLabel}.`;
  }

  if (event.type === "player_removed_object") {
    return `You tidied a ${objectLabel} from ${event.locationLabel}.`;
  }

  return `You set a ${objectLabel} ${formatPlacementLocation(
    event.locationLabel,
  )}.`;
}

export function getLocalRemiReaction(event: WorldEvent): string {
  const objectLabel = getObjectLabel(event);

  if (event.type === "player_removed_object") {
    return `I saw you tidy the ${objectLabel} from ${event.locationLabel}. The island feels a little more intentional now.`;
  }

  if (event.type === "player_expanded_land") {
    return `I saw you fill in ${event.locationLabel}. The island has a little more room to breathe now.`;
  }

  if (event.type === "player_removed_land") {
    return `I saw you remove a filled patch near ${event.locationLabel}. Keeping the island shape intentional matters.`;
  }

  if (event.objectKind === "lamp") {
    return `I saw where you placed the lamp ${formatPlacementLocation(
      event.locationLabel,
    )}. It makes this spot feel less temporary.`;
  }

  return `I saw you place the ${objectLabel} ${formatPlacementLocation(
    event.locationLabel,
  )}. The island is starting to feel more like ours.`;
}

function getObjectLabel(event: WorldEvent): string {
  if (!event.objectKind) {
    return "object";
  }

  return WORLD_OBJECT_LABELS[event.objectKind];
}

function formatPlacementLocation(locationLabel: string): string {
  if (locationLabel.startsWith("near ")) {
    return locationLabel;
  }

  if (locationLabel.startsWith("the ")) {
    return `on ${locationLabel}`;
  }

  return `at ${locationLabel}`;
}
