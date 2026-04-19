import type { AvatarEngine } from "@/types/avatar";
import type { AvatarRuntimeEntry } from "@/lib/avatar/characterRegistry";

export type CharacterStageEntry =
  | ({
      kind: "runtime";
    } & AvatarRuntimeEntry)
  | { kind: "portrait" };

export function resolveCharacterStageEntry(
  chain: AvatarRuntimeEntry[],
  failedEngines: AvatarEngine[],
): CharacterStageEntry {
  const next = chain.find((entry) => !failedEngines.includes(entry.engine));
  if (!next) return { kind: "portrait" };
  return {
    kind: "runtime",
    ...next,
  };
}
