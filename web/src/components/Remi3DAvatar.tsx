"use client";

import type { MutableRefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { getEmotionLabel } from "@/lib/emotionLabels";
import {
  createAvatarRuntime,
  type AvatarRuntimeAdapter,
  type CreateAvatarRuntimeOptions,
} from "@/lib/rem3d/runtimeAdapter";
import type {
  AvatarActionCommand,
  AvatarEngine,
  AvatarFrameState,
  AvatarIntent,
  AvatarRuntimeLoadState,
  AvatarModelPreset,
  LipSignal,
  RemiState,
  RemiTurnState,
} from "@/types/avatar";
import type { ConversationPerformanceModel } from "@/lib/presence/conversationPerformanceModel";
import type { AvatarRenderModel } from "@/runtime/avatarRenderModel";

export type Remi3DAvatarProps = {
  emotion: string;
  remiState?: RemiState;
  turnState?: RemiTurnState;
  avatarIntent?: AvatarIntent | null;
  avatarFrame?: AvatarFrameState | null;
  renderModel?: AvatarRenderModel | null;
  performanceModel?: ConversationPerformanceModel | null;
  actionSignal?: { action: AvatarActionCommand; nonce: number } | null;
  lipSignalRef: MutableRefObject<LipSignal>;
  className?: string;
  variant?: "card" | "stage";
  engine?: AvatarEngine;
  modelPreset?: AvatarModelPreset;
  modelId?: string;
  modelUrl?: string;
  onRuntimeStateChange?: CreateAvatarRuntimeOptions["onStateChange"];
};

function getEngineLabel(engine: AvatarEngine): string {
  return engine === "live2d" ? "Live2D" : "VRM";
}

export function Remi3DAvatar({
  emotion,
  remiState = "idle",
  turnState = "confirmed_end",
  avatarIntent = null,
  avatarFrame = null,
  renderModel = null,
  performanceModel = null,
  actionSignal = null,
  lipSignalRef,
  className = "",
  variant = "card",
  engine = "vrm",
  modelPreset = "remi",
  modelId,
  modelUrl,
  onRuntimeStateChange,
}: Remi3DAvatarProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<AvatarRuntimeAdapter | null>(null);
  const runtimeStateChangeRef = useRef(onRuntimeStateChange);
  const [state, setState] = useState<AvatarRuntimeLoadState>("loading");
  const [err, setErr] = useState<string | null>(null);

  const isStage = variant === "stage";

  useEffect(() => {
    runtimeStateChangeRef.current = onRuntimeStateChange;
  }, [onRuntimeStateChange]);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;

    const runtime = createAvatarRuntime(el, {
      engine,
      modelPreset,
      modelId,
      modelUrl,
      onStateChange: (next, error) => {
        setState(next);
        setErr(next === "error" ? error ?? "load error" : null);
        runtimeStateChangeRef.current?.(next, error);
      },
    });
    runtime.setLipSignal(lipSignalRef.current);
    runtime.load();
    runtimeRef.current = runtime;

    const ro = new ResizeObserver(() => runtime.resize());
    ro.observe(el);

    return () => {
      ro.disconnect();
      runtime.dispose();
      runtimeRef.current = null;
    };
  }, [engine, lipSignalRef, modelId, modelPreset, modelUrl]);

  useEffect(() => {
    runtimeRef.current?.setEmotion(emotion);
  }, [emotion]);

  useEffect(() => {
    runtimeRef.current?.setState(remiState);
  }, [remiState]);

  useEffect(() => {
    runtimeRef.current?.setTurnState(turnState);
  }, [turnState]);

  useEffect(() => {
    runtimeRef.current?.setIntent(avatarIntent);
  }, [avatarIntent]);

  useEffect(() => {
    runtimeRef.current?.setFrame(avatarFrame);
  }, [avatarFrame]);

  useEffect(() => {
    runtimeRef.current?.setRenderModel(renderModel);
  }, [renderModel]);

  useEffect(() => {
    runtimeRef.current?.setPerformanceModel(performanceModel);
  }, [performanceModel]);

  useEffect(() => {
    if (!actionSignal) return;
    runtimeRef.current?.playAction(actionSignal.action);
  }, [actionSignal]);

  const shell =
    isStage
      ? "relative flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden rounded-none border-0 bg-transparent lg:rounded-2xl"
      : "relative flex min-h-[280px] min-w-[260px] flex-col overflow-hidden rounded-2xl border border-white/15 bg-white/[0.06] backdrop-blur-xl dark:bg-black/20";

  const canvasHost = isStage
    ? "min-h-0 w-full min-w-0 flex-1"
    : "h-[min(42vh,360px)] w-full min-h-[240px]";
  const engineLabel = getEngineLabel(engine);

  return (
    <div className={`${shell} ${className}`}>
      <div
        ref={hostRef}
        className={canvasHost}
        data-avatar-engine={engine}
        data-avatar-load-state={state}
      />

      {state === "loading" && (
        <p className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/25 text-sm text-[var(--remi-dim)] backdrop-blur-sm">
          加载 {engineLabel} 模型中…
        </p>
      )}
      {state === "error" && (
        <p className="absolute inset-x-0 bottom-0 bg-[var(--remi-error-bg)]/95 px-3 py-2 text-center text-xs text-[var(--remi-danger)] backdrop-blur-md">
          {engineLabel} 加载失败：{err}
        </p>
      )}
      {state === "ready" && !isStage && (
        <div className="flex items-center justify-between border-t border-white/10 bg-transparent px-3 py-2 text-xs text-[var(--remi-dim)]">
          <span>当前情绪</span>
          <div className="flex items-center gap-2">
            <span className="font-medium text-[var(--remi-accent)]">
              {getEmotionLabel(emotion)}
            </span>
            <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-[var(--remi-dim)]">
              {engineLabel}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
