"use client";

import type { ComponentProps } from "react";
import { useEffect, useMemo, useState } from "react";
import { Remi3DAvatar } from "@/components/Remi3DAvatar";
import { RemiPortraitAvatar } from "@/components/RemiPortraitAvatar";
import type { ConversationPerformanceModel } from "@/lib/presence/conversationPerformanceModel";
import { getDefaultCharacterSpec, buildCharacterFallbackChain } from "@/lib/avatar/characterRegistry";
import { resolveCharacterStageEntry } from "@/lib/avatar/characterStageState";
import { toLegacyRemState } from "@/runtime/remiRuntimeSelectors";
import type {
  AvatarCharacterSpec,
  AvatarEngine,
  AvatarRuntimeLoadState,
} from "@/types/avatar";

type PortraitProps = ComponentProps<typeof RemiPortraitAvatar>;

export type CharacterStageProps = PortraitProps & {
  characterSpec?: AvatarCharacterSpec | null;
  performanceModel?: ConversationPerformanceModel | null;
};

export function CharacterStage({
  characterSpec,
  className = "",
  runtimeState,
  performanceModel = null,
  ...portraitProps
}: CharacterStageProps) {
  const activeCharacterSpec = useMemo(
    () => characterSpec ?? getDefaultCharacterSpec(),
    [characterSpec],
  );
  const fallbackChain = useMemo(
    () => buildCharacterFallbackChain(activeCharacterSpec),
    [activeCharacterSpec],
  );
  const [failedEngines, setFailedEngines] = useState<AvatarEngine[]>([]);
  const [loadState, setLoadState] =
    useState<AvatarRuntimeLoadState>("loading");
  const [lastRuntimeError, setLastRuntimeError] = useState<string | null>(null);

  useEffect(() => {
    setFailedEngines([]);
    setLoadState("loading");
    setLastRuntimeError(null);
  }, [activeCharacterSpec]);

  const stageEntry = useMemo(
    () => resolveCharacterStageEntry(fallbackChain, failedEngines),
    [failedEngines, fallbackChain],
  );

  const stageEngine =
    stageEntry.kind === "runtime" ? stageEntry.engine : ("portrait" as const);

  useEffect(() => {
    if (stageEntry.kind === "runtime") {
      setLoadState("loading");
    }
  }, [stageEntry]);

  return (
    <div
      className={`relative min-h-0 min-w-0 flex-1 self-stretch ${className}`}
      data-character-engine={stageEngine}
      data-character-stage-state={loadState}
      data-character-last-error={lastRuntimeError ?? ""}
      data-conversation-phase={performanceModel?.phase ?? ""}
      data-language-beat-channel={performanceModel?.languageBeat.channel ?? "none"}
    >
      {lastRuntimeError ? (
        <div className="pointer-events-none absolute left-3 top-3 z-20 max-w-[18rem] rounded-2xl border border-amber-200/30 bg-black/45 px-3 py-2 text-[11px] leading-5 text-amber-50 backdrop-blur-sm">
          Live2D fallback: {lastRuntimeError}
        </div>
      ) : null}

      {stageEntry.kind === "runtime" ? (
        <Remi3DAvatar
          key={`${stageEntry.engine}:${stageEntry.modelId ?? "default"}:${stageEntry.modelUrl}`}
          emotion={portraitProps.emotion}
          remiState={runtimeState ? toLegacyRemState(runtimeState) : "idle"}
          turnState={portraitProps.turnState}
          avatarIntent={portraitProps.avatarIntent}
          avatarFrame={portraitProps.avatarFrame}
          renderModel={portraitProps.renderModel}
          performanceModel={performanceModel}
          lipSignalRef={portraitProps.lipSignalRef}
          className="min-h-0 min-w-0 flex-1"
          variant="stage"
          engine={stageEntry.engine}
          modelId={stageEntry.modelId}
          modelUrl={stageEntry.modelUrl}
          onRuntimeStateChange={(nextState, error) => {
            setLoadState(nextState);
            if (nextState === "error") {
              setLastRuntimeError(error ?? `${stageEntry.engine} load error`);
              setFailedEngines((current) =>
                current.includes(stageEntry.engine)
                  ? current
                  : [...current, stageEntry.engine],
              );
            }
          }}
        />
      ) : (
        <RemiPortraitAvatar
          {...portraitProps}
          runtimeState={runtimeState}
          performanceModel={performanceModel}
          className="min-h-0 min-w-0 flex-1"
        />
      )}
    </div>
  );
}
