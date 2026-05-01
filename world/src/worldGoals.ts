import { type WorldEvent } from "./worldEvents";

export interface WorldGoalState {
  shorelineExpanded: boolean;
  flowerPlantedOnNewLand: boolean;
  expandedEdgeLit: boolean;
}

export interface WorldGoalLine {
  complete: boolean;
  text: string;
}

export function createWorldGoalState(): WorldGoalState {
  return {
    shorelineExpanded: false,
    flowerPlantedOnNewLand: false,
    expandedEdgeLit: false,
  };
}

export function updateWorldGoalState(
  state: WorldGoalState,
  event: WorldEvent,
): WorldGoalState {
  const hasExpanded = state.shorelineExpanded || event.type === "player_expanded_land";
  return {
    shorelineExpanded: hasExpanded,
    flowerPlantedOnNewLand:
      state.flowerPlantedOnNewLand ||
      (event.type === "player_placed_object" &&
        hasExpanded &&
        isFlowerKind(event.objectKind) &&
        isShoreLocation(event.locationLabel)),
    expandedEdgeLit:
      state.expandedEdgeLit ||
      (event.type === "player_placed_object" &&
        hasExpanded &&
        event.objectKind === "lamp" &&
        isShoreLocation(event.locationLabel)),
  };
}

export function getWorldGoalLines(state: WorldGoalState): WorldGoalLine[] {
  return [
    {
      complete: state.shorelineExpanded,
      text: "Fill one shoreline patch",
    },
    {
      complete: state.flowerPlantedOnNewLand,
      text: "Plant a flower on new land",
    },
    {
      complete: state.expandedEdgeLit,
      text: "Light the expanded edge",
    },
  ];
}

function isFlowerKind(kind: WorldEvent["objectKind"]): boolean {
  return kind === "blue_flower" || kind === "pink_flower";
}

function isShoreLocation(locationLabel: string): boolean {
  return locationLabel.includes("shore");
}
