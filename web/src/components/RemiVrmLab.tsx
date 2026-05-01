"use client";

import Link from "next/link";
import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";

import { AvatarDevtoolsPanel } from "@/components/AvatarDevtoolsPanel";
import { InputBar } from "@/components/InputBar";
import { Remi3DAvatar } from "@/components/Remi3DAvatar";
import { useRemiWebAuth } from "@/components/RemiAuthProvider";
import { useRemiChat } from "@/hooks/useRemiChat";
import { getDefaultVrmUrl } from "@/lib/avatar/modelUrls";
import { getEmotionLabel } from "@/lib/emotionLabels";
import {
  buildRemiVrmLabStatus,
  resolveVrmLabModelUrl,
} from "@/components/remiVrmLabModel";
import type { ChatMessage } from "@/types/chat";
import type { AvatarFrameState, RemiState } from "@/types/avatar";
import type { RemiAvatarRuntimeModel } from "../../../runtime";

function mapSdkPhaseToRemiState(phase: RemiAvatarRuntimeModel["phase"]): RemiState {
  switch (phase) {
    case "speaking":
      return "speaking";
    case "listening":
    case "interrupted":
      return "listening";
    case "thinking":
      return "thinking";
    case "idle":
    default:
      return "idle";
  }
}

function connectionDotClass(connected: boolean): string {
  return connected ? "bg-[var(--remi-accent)]" : "bg-amber-300";
}

function messageTone(role: ChatMessage["role"]): string {
  switch (role) {
    case "user":
      return "border-sky-300/20 bg-sky-400/10";
    case "rem":
      return "border-[var(--remi-accent)]/20 bg-[var(--remi-accent)]/10";
    case "error":
      return "border-rose-300/25 bg-rose-400/10";
    default:
      return "border-white/10 bg-white/[0.04]";
  }
}

function messageRoleLabel(role: ChatMessage["role"]): string {
  switch (role) {
    case "user":
      return "You";
    case "rem":
      return "Remi";
    case "error":
      return "Error";
    default:
      return "System";
  }
}

export function RemiVrmLab() {
  const router = useRouter();
  const auth = useRemiWebAuth();
  const {
    emotion,
    avatarFrame,
    avatarIntent,
    connected,
    connectionPhase,
    messages,
    streamingText,
    sttPartialText,
    runtimeState,
    sdkAvatarRuntimeModel,
    avatarRenderModel,
    avatarAction,
    inputPlaceholder,
    recording,
    lipSignalRef,
    hasMic,
    sendText,
    toggleMic,
  } = useRemiChat();

  useEffect(() => {
    if (!auth.clerkEnabled) return;
    if (!auth.ready) return;
    if (!auth.signedIn) {
      router.replace("/sign-in");
    }
  }, [auth.clerkEnabled, auth.ready, auth.signedIn, router]);

  const labStatus = useMemo(
    () => buildRemiVrmLabStatus(sdkAvatarRuntimeModel),
    [sdkAvatarRuntimeModel],
  );
  const recentMessages = useMemo(
    () => messages.filter((message) => message.role !== "sys").slice(-6),
    [messages],
  );
  const modelUrl = useMemo(() => resolveVrmLabModelUrl(getDefaultVrmUrl()), []);
  const sdkFrame = sdkAvatarRuntimeModel.avatarFrame as AvatarFrameState | null;
  const activeFrame = sdkFrame ?? avatarFrame;
  const activeIntent = sdkAvatarRuntimeModel.avatarIntent ?? avatarIntent;
  const activeEmotion = sdkAvatarRuntimeModel.emotion || emotion;
  const remiState = mapSdkPhaseToRemiState(sdkAvatarRuntimeModel.phase);
  const inputDisabled = !connected || runtimeState.user.recording;
  const micDisabled = !connected || !hasMic;

  if (auth.clerkEnabled && (!auth.ready || !auth.signedIn)) {
    return null;
  }

  return (
    <main className="min-h-dvh bg-[linear-gradient(180deg,#061015_0%,#081018_46%,#05070b_100%)] text-[var(--foreground)]">
      <div className="mx-auto flex min-h-dvh w-full max-w-[1500px] flex-col gap-4 px-4 py-4 sm:px-5">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[var(--remi-dim)]">
              <span className={`h-2 w-2 rounded-full ${connectionDotClass(connected)}`} />
              <span>{connectionPhase}</span>
              <span>VRM real chain</span>
            </div>
            <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">
              Remi VRM 验证
            </h1>
          </div>
          <Link
            href="/"
            className="inline-flex h-10 items-center rounded-full border border-white/10 bg-white/[0.04] px-4 text-sm text-[var(--foreground)] transition hover:border-[var(--remi-accent)] hover:bg-white/[0.08]"
          >
            返回聊天页
          </Link>
        </header>

        <section className="grid min-h-0 flex-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_25rem]">
          <div className="relative flex h-[min(70dvh,48rem)] min-h-[34rem] overflow-hidden border border-white/10 bg-black/20 lg:h-[calc(100dvh-7.5rem)]">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(circle_at_50%_0%,rgba(74,222,128,0.16),transparent_64%)]" />
            <div className="pointer-events-none absolute inset-x-[16%] bottom-[8%] h-28 bg-[radial-gradient(ellipse,rgba(45,212,191,0.16),transparent_70%)] blur-2xl" />
            <Remi3DAvatar
              emotion={activeEmotion}
              remiState={remiState}
              turnState={sdkAvatarRuntimeModel.turnState ?? "confirmed_end"}
              avatarIntent={activeIntent}
              avatarFrame={activeFrame}
              renderModel={avatarRenderModel}
              actionSignal={avatarAction}
              lipSignalRef={lipSignalRef}
              variant="stage"
              engine="vrm"
              modelUrl={modelUrl}
              className="relative min-h-0 min-w-0 flex-1"
            />
            <div className="pointer-events-none absolute left-4 top-4 max-w-[min(36rem,calc(100%-2rem))] border border-white/10 bg-black/40 px-3 py-2 text-xs text-[var(--remi-dim)] backdrop-blur-md">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[var(--foreground)]">{getEmotionLabel(activeEmotion)}</span>
                <span>{labStatus.phaseLabel}</span>
                <span>{labStatus.intentLabel}</span>
              </div>
              <div className="mt-1">{labStatus.lipSyncLabel}</div>
            </div>
          </div>

          <aside className="flex min-h-0 flex-col gap-3 lg:max-h-[calc(100dvh-7.5rem)] lg:overflow-y-auto">
            <section className="border border-white/10 bg-white/[0.04] p-3">
              <h2 className="text-sm font-semibold">SDK Avatar Model</h2>
              <dl className="mt-3 grid grid-cols-1 gap-2 text-xs">
                <div className="border border-white/10 bg-black/20 p-2">
                  <dt className="text-[var(--remi-dim)]">phase</dt>
                  <dd className="mt-1 font-medium">{labStatus.phaseLabel}</dd>
                </div>
                <div className="border border-white/10 bg-black/20 p-2">
                  <dt className="text-[var(--remi-dim)]">turn</dt>
                  <dd className="mt-1 font-medium">{labStatus.turnLabel}</dd>
                </div>
                <div className="border border-white/10 bg-black/20 p-2">
                  <dt className="text-[var(--remi-dim)]">intent</dt>
                  <dd className="mt-1 break-words font-medium">{labStatus.intentLabel}</dd>
                </div>
                <div className="border border-white/10 bg-black/20 p-2">
                  <dt className="text-[var(--remi-dim)]">lip sync</dt>
                  <dd className="mt-1 break-words font-medium">{labStatus.lipSyncLabel}</dd>
                </div>
              </dl>
            </section>

            <section className="border border-white/10 bg-white/[0.04] p-3">
              <h2 className="text-sm font-semibold">Live Input</h2>
              <div className="mt-3">
                <InputBar
                  onSend={sendText}
                  onMicToggle={toggleMic}
                  disabled={inputDisabled}
                  micDisabled={micDisabled}
                  recording={recording}
                  placeholder={inputPlaceholder}
                />
              </div>
              {sttPartialText ? (
                <p className="mt-2 text-xs text-[var(--remi-dim)]">{sttPartialText}</p>
              ) : null}
              {streamingText ? (
                <p className="mt-2 border border-[var(--remi-accent)]/20 bg-[var(--remi-accent)]/10 p-2 text-sm leading-6">
                  {streamingText}
                </p>
              ) : null}
            </section>

            <section className="min-h-[12rem] border border-white/10 bg-white/[0.04] p-3">
              <h2 className="text-sm font-semibold">Recent Turns</h2>
              <div className="mt-3 space-y-2">
                {recentMessages.length === 0 ? (
                  <p className="text-xs text-[var(--remi-dim)]">等待第一轮真实对话。</p>
                ) : (
                  recentMessages.map((message) => (
                    <div
                      key={message.id}
                      className={`border p-2 text-xs leading-5 ${messageTone(message.role)}`}
                    >
                      <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-[var(--remi-dim)]">
                        {messageRoleLabel(message.role)}
                      </div>
                      <div className="line-clamp-3">{message.text}</div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <AvatarDevtoolsPanel
              title="VRM DevTools"
              className="min-h-[22rem] flex-1"
            />
          </aside>
        </section>
      </div>
    </main>
  );
}
