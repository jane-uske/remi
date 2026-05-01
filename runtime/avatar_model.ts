import type {
  AvatarFrame,
  AvatarIntent,
  RemiTurnState,
  RemiTurnStateReason,
  TtsLipCue,
  TtsLipSyncSource,
} from "../avatar/types";
import type {
  RemiRuntimePhase,
  RemiRuntimePhaseReason,
  RemiRuntimeState,
} from "./protocol";

export type RemiAvatarLipSyncModel = {
  generationId: number | null;
  cues: TtsLipCue[];
  complete: boolean;
  source: TtsLipSyncSource | null;
};

export type RemiAvatarRuntimeModel = {
  phase: RemiRuntimePhase;
  phaseReason: RemiRuntimePhaseReason;
  turnState: RemiTurnState | null;
  turnReason: RemiTurnStateReason | null;
  emotion: string;
  avatarIntent: AvatarIntent | null;
  avatarFrame: AvatarFrame | null;
  lipSync: RemiAvatarLipSyncModel;
};

export function selectRemiAvatarRuntimeModel(
  state: RemiRuntimeState,
): RemiAvatarRuntimeModel {
  return {
    phase: state.phase,
    phaseReason: state.phaseReason,
    turnState: state.turn.serverState,
    turnReason: state.turn.reason,
    emotion: state.affect.emotion,
    avatarIntent: state.affect.avatarIntent,
    avatarFrame: state.affect.avatarFrame,
    lipSync: {
      generationId: state.speech.lipSyncGenerationId,
      cues: state.speech.lipSyncCues,
      complete: state.speech.lipSyncComplete,
      source: state.speech.lipSyncSource,
    },
  };
}
