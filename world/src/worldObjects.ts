export type WorldObjectKind =
  | "lamp"
  | "blue_flower"
  | "pink_flower"
  | "wood_block"
  | "stone_block"
  | "land_fill";

export interface WorldObjectDefinition {
  id: WorldObjectKind;
  label: string;
  hotbarLabel: string;
  countLabel: string;
  placeable: boolean;
}

export const WORLD_OBJECTS: readonly WorldObjectDefinition[] = [
  {
    id: "lamp",
    label: "lamp",
    hotbarLabel: "Lantern",
    countLabel: "1",
    placeable: true,
  },
  {
    id: "blue_flower",
    label: "blue flower",
    hotbarLabel: "Blue flower",
    countLabel: "8",
    placeable: true,
  },
  {
    id: "pink_flower",
    label: "pink flower",
    hotbarLabel: "Pink flower",
    countLabel: "3",
    placeable: true,
  },
  {
    id: "wood_block",
    label: "wood block",
    hotbarLabel: "Wood",
    countLabel: "16",
    placeable: true,
  },
  {
    id: "stone_block",
    label: "stone block",
    hotbarLabel: "Stone",
    countLabel: "32",
    placeable: true,
  },
  {
    id: "land_fill",
    label: "land fill",
    hotbarLabel: "Land",
    countLabel: "∞",
    placeable: true,
  },
];

export const WORLD_OBJECT_LABELS: Record<WorldObjectKind, string> =
  WORLD_OBJECTS.reduce(
    (labels, object) => {
      labels[object.id] = object.label;
      return labels;
    },
    {} as Record<WorldObjectKind, string>,
  );

export function getWorldObjectSelectionHint(kind: WorldObjectKind): string {
  if (kind === "land_fill") {
    return "Selected Land. Aim at water touching the shoreline to fill; right-click an empty filled patch to remove.";
  }

  const object = WORLD_OBJECTS.find((candidate) => candidate.id === kind);
  return `Selected ${object?.hotbarLabel ?? kind}. Click the island view, then left click to place.`;
}

export function getWorldObjectControlHint(kind: WorldObjectKind): string {
  if (kind === "land_fill") {
    return "View control enabled. Aim at shoreline water; left click fills land, R removes empty filled land.";
  }

  return "View control enabled. Move mouse, WASD, left click places, Esc exits.";
}
