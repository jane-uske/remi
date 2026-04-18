import type { RelationalStance } from "../persona";
import type { ResponsePolicy } from "../brain/turn_interpreter";
import type { AdultSceneState } from "../brain/adult_mode";

export type TtsUsageKind =
  | "reply"
  | "thinking_filler"
  | "backchannel"
  | "interrupt_reaction";

export interface TtsRequestContext {
  connId?: string;
  generationId?: number;
  usage?: TtsUsageKind;
  adultSceneState?: AdultSceneState | null;
  relationalStance?: RelationalStance;
  responsePolicy?: Pick<
    ResponsePolicy,
    "openingMove" | "directness" | "warmth" | "questionBudget"
  > | null;
}
