"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { AvatarDevtoolsPanel } from "@/components/AvatarDevtoolsPanel";
import { Remi3DAvatar } from "@/components/Remi3DAvatar";
import { getEmotionLabel } from "@/lib/emotionLabels";
import { deriveAvatarIntent } from "@/lib/rem3d/avatarIntent";
import { pushAvatarDevtoolsLog } from "@/lib/rem3d/devtoolsStore";
import type {
  AvatarActionCommand,
  AvatarFrameState,
  AvatarIntent,
  AvatarModelPreset,
  LipSignal,
  RemiState,
} from "@/types/avatar";

type EmotionKey = "neutral" | "happy" | "curious" | "shy" | "sad";

type ActionPreset = {
  label: string;
  action: AvatarActionCommand["action"];
  hint: string;
};

const EMOTIONS: Array<{
  key: EmotionKey;
  title: string;
  note: string;
}> = [
  { key: "neutral", title: "中性", note: "稳定待机" },
  { key: "happy", title: "开心", note: "整体更轻快" },
  { key: "curious", title: "好奇", note: "眼神更往上" },
  { key: "shy", title: "害羞", note: "收一点，偏柔" },
  { key: "sad", title: "不高兴", note: "收拢，偏低" },
];

const ACTIONS: ActionPreset[] = [
  { label: "点头", action: "nod", hint: "肯定 / 赞同" },
  { label: "摇头", action: "shake_head", hint: "否定 / 拒绝" },
  { label: "挥手", action: "wave", hint: "打招呼" },
  { label: "歪头", action: "tilt_head", hint: "思考 / 迟疑" },
  { label: "耸肩", action: "shrug", hint: "不确定" },
  { label: "挑眉", action: "eyebrow_raise", hint: "惊讶" },
];

const STATES: Array<{ value: RemiState; title: string; note: string }> = [
  { value: "idle", title: "待机", note: "轻呼吸、慢摆动" },
  { value: "listening", title: "倾听", note: "让出话权" },
  { value: "thinking", title: "思考", note: "略微收紧" },
  { value: "speaking", title: "说话", note: "口型与微动作" },
];

const MODEL_PRESET: AvatarModelPreset = "remi";

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function createActionNonce(): number {
  return Date.now() + Math.floor(Math.random() * 1000);
}

function pickMoodCopy(emotion: EmotionKey): string {
  switch (emotion) {
    case "happy":
      return "更轻、更亮，适合做上扬感。";
    case "curious":
      return "眼神偏上，动作更像在追问。";
    case "shy":
      return "动作收一点，避免过强。";
    case "sad":
      return "往下收，保留皱眉感。";
    default:
      return "保持中性，适合作为基线。";
  }
}

export function Remi3DDemo() {
  const lipSignalRef = useRef<LipSignal>({
    envelope: 0,
    active: false,
    viseme: null,
  });
  const speakingStartRef = useRef<number | null>(null);

  const [emotion, setEmotion] = useState<EmotionKey>("happy");
  const [remiState, setRemiState] = useState<RemiState>("idle");
  const [selectedAction, setSelectedAction] = useState<ActionPreset>(ACTIONS[0]);
  const [actionSignal, setActionSignal] = useState<{
    action: AvatarActionCommand;
    nonce: number;
  } | null>(null);
  const [demoSpeaking, setDemoSpeaking] = useState(true);
  const [demoPhrase, setDemoPhrase] = useState(
    "我在这里，先试一下开心时的上扬感，再切回皱眉和思考。",
  );
  const [lipEnvelope, setLipEnvelope] = useState(0);
  const [runtimeState, setRuntimeState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [runtimeError, setRuntimeError] = useState<string | null>(null);

  const emotionMeta = useMemo(
    () => EMOTIONS.find((item) => item.key === emotion) ?? EMOTIONS[0],
    [emotion],
  );

  const faceOverlay = useMemo<AvatarFrameState["face"]>(
    () =>
      emotion === "happy"
        ? {
            mouthSmile: 0.55,
            eyeSquintL: 0.14,
            eyeSquintR: 0.14,
          }
        : emotion === "sad"
          ? {
              browDownL: 0.62,
              browDownR: 0.62,
              mouthFrown: 0.38,
              eyeOpenL: 0.88,
              eyeOpenR: 0.88,
            }
          : emotion === "curious"
            ? {
                browUpL: 0.42,
                browUpR: 0.42,
                mouthOpen: 0.12,
              }
            : emotion === "shy"
              ? {
                  mouthSmile: 0.18,
                  eyeSquintL: 0.1,
                  eyeSquintR: 0.1,
                  browUpL: 0.08,
                  browUpR: 0.08,
                }
              : {},
    [emotion],
  );

  const avatarFrame: AvatarFrameState = {
    face: faceOverlay,
    lipSync: lipSignalRef.current.viseme
      ? {
          time: Date.now(),
          viseme: lipSignalRef.current.viseme.name,
          weight: lipSignalRef.current.viseme.weight,
        }
      : undefined,
    lipSyncAtMs: lipSignalRef.current.viseme ? Date.now() : undefined,
    emotion,
  };

  const avatarIntent = useMemo<AvatarIntent>(
    () =>
      deriveAvatarIntent({
        emotion,
        action: null,
        face: faceOverlay ?? null,
        source: "debug",
        reason: "demo-controls",
      }),
    [emotion, faceOverlay],
  );

  useEffect(() => {
    pushAvatarDevtoolsLog("system", "demo mounted", {
      surface: "/demo",
      modelPreset: MODEL_PRESET,
    });
  }, []);

  useEffect(() => {
    pushAvatarDevtoolsLog("intent", "demo emotion", {
      emotion,
      intent: avatarIntent,
    });
  }, [avatarIntent, emotion]);

  useEffect(() => {
    pushAvatarDevtoolsLog("system", "demo state", {
      remiState,
      demoSpeaking,
    });
  }, [demoSpeaking, remiState]);

  useEffect(() => {
    const active = demoSpeaking && remiState === "speaking";
    let raf = 0;

    if (!active) {
      Object.assign(lipSignalRef.current, {
        envelope: 0,
        active: false,
        viseme: null,
      });
      setLipEnvelope(0);
      speakingStartRef.current = null;
      return () => {
        if (raf) cancelAnimationFrame(raf);
      };
    }

    const tick = (now: number) => {
      const startAt = speakingStartRef.current ?? now;
      if (speakingStartRef.current == null) {
        speakingStartRef.current = now;
      }

      const t = (now - startAt) / 1000;
      const base = 0.08;
      const syllable = Math.sin(t * 7.2) * 0.5 + 0.5;
      const flutter = Math.sin(t * 13.4 + 0.7) * 0.5 + 0.5;
      const breath = Math.sin(t * 2.4 + 1.1) * 0.5 + 0.5;
      const nextEnvelope = clamp01(base + syllable * 0.42 + flutter * 0.22 + breath * 0.08);

      Object.assign(lipSignalRef.current, {
        envelope: nextEnvelope,
        active: true,
        viseme:
          nextEnvelope > 0.52
            ? { name: "aa", weight: nextEnvelope }
            : nextEnvelope > 0.24
              ? { name: "oh", weight: nextEnvelope * 0.85 }
              : null,
      });
      setLipEnvelope(nextEnvelope);
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, [demoSpeaking, remiState]);

  const stageMotion = useMemo(() => {
    const lift =
      emotion === "happy"
        ? -10
        : emotion === "sad"
          ? 5
          : emotion === "curious"
            ? -3
            : emotion === "shy"
              ? 2
              : 0;
    const scale =
      1 +
      (emotion === "happy" ? 0.015 : 0) +
      (demoSpeaking ? lipEnvelope * 0.014 : 0) -
      (emotion === "sad" ? 0.01 : 0);
    const sway =
      emotion === "happy"
        ? -0.4
        : emotion === "curious"
          ? 0.2
          : emotion === "shy"
            ? 0.15
            : 0;
    return {
      transform: `translate3d(0, ${lift}px, 0) scale(${scale}) rotate(${sway}deg)`,
    };
  }, [demoSpeaking, emotion, lipEnvelope]);

  const emotionGlow =
    emotion === "happy"
      ? "from-emerald-400/40 via-teal-400/18 to-transparent"
      : emotion === "curious"
        ? "from-violet-400/38 via-purple-400/18 to-transparent"
        : emotion === "shy"
          ? "from-amber-300/28 via-rose-300/12 to-transparent"
          : emotion === "sad"
            ? "from-slate-400/30 via-sky-500/10 to-transparent"
            : "from-white/20 via-white/8 to-transparent";

  const outerRing =
    remiState === "speaking" && demoSpeaking
      ? "ring-[var(--remi-accent)]/55 shadow-[0_0_0_1px_rgba(168, 85, 247,0.2),0_24px_80px_rgba(168, 85, 247,0.18)]"
      : emotion === "happy"
        ? "ring-emerald-300/40 shadow-[0_24px_70px_rgba(16,185,129,0.12)]"
        : emotion === "sad"
          ? "ring-sky-300/25 shadow-[0_24px_60px_rgba(139, 92, 246,0.1)]"
          : "ring-white/10 shadow-[0_24px_60px_rgba(255,255,255,0.06)]";

  const stateNote =
    remiState === "speaking" && demoSpeaking
      ? "假口型开启，后续 runtime 接通后会直接驱动嘴型。"
      : remiState === "listening"
        ? "倾听态优先，适合看 Remi 让出话权。"
        : remiState === "thinking"
          ? "思考态会更收一点。"
          : "待机态保留轻微呼吸和摆动。";

  const handleTriggerAction = (preset: ActionPreset) => {
    setSelectedAction(preset);
    pushAvatarDevtoolsLog("intent", "demo action trigger", {
      action: preset.action,
      hint: preset.hint,
    });
    setActionSignal({
      action: {
        action: preset.action,
        intensity: preset.action === "wave" ? 0.85 : 0.7,
        duration: preset.action === "wave" ? 1000 : 700,
      },
      nonce: createActionNonce(),
    });
  };

  return (
    <main className="relative isolate min-h-dvh overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(168, 85, 247,0.16),_transparent_34%),radial-gradient(circle_at_top_right,_rgba(139, 92, 246,0.14),_transparent_28%),linear-gradient(180deg,_#120822_0%,_#08040f_100%)] px-4 py-4 text-[var(--foreground)] sm:px-6 sm:py-6">
      <div className="pointer-events-none absolute inset-0 opacity-60 [background-image:linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] [background-size:42px_42px]" />

      <div className="relative mx-auto grid w-full max-w-7xl gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.55fr)]">
        <section className="relative overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.04] shadow-[0_18px_80px_rgba(0,0,0,0.38)] backdrop-blur-2xl">
          <div className={`absolute inset-x-0 top-0 h-40 bg-gradient-to-b ${emotionGlow}`} />
          <div className="relative flex h-full min-h-[68vh] flex-col p-4 sm:p-5">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-[var(--remi-dim)]">
                  Remi 3D Demo
                </p>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
                  开心会往上跳，不高兴会皱眉
                </h1>
              </div>
              <div className={`rounded-full border px-3 py-1.5 text-xs ${outerRing} bg-black/20 backdrop-blur-md`}>
                <span className="text-[var(--remi-dim)]">运行态</span>
                <span className="ml-2 font-medium text-[var(--remi-accent)]">
                  {runtimeState}
                </span>
              </div>
            </div>

            <div className={`relative flex min-h-[56vh] flex-1 overflow-hidden rounded-[24px] border border-white/10 bg-black/25 p-2 ${outerRing}`}>
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.08),transparent_62%)]" />
              <div className="absolute inset-x-10 bottom-0 h-32 rounded-full bg-gradient-to-t from-black/35 to-transparent blur-3xl" />

              <div className="relative flex min-h-0 min-w-0 flex-1" style={stageMotion}>
                <Remi3DAvatar
                  emotion={emotion}
                  remiState={remiState}
                  avatarIntent={avatarIntent}
                  avatarFrame={avatarFrame}
                  actionSignal={actionSignal}
                  lipSignalRef={lipSignalRef}
                  variant="stage"
                  modelPreset={MODEL_PRESET}
                  className="min-h-0 min-w-0 flex-1"
                  onRuntimeStateChange={(next, error) => {
                    setRuntimeState(next);
                    setRuntimeError(error ?? null);
                  }}
                />
              </div>

              <div className="pointer-events-none absolute left-4 right-4 top-4 flex items-start justify-between gap-3">
                <div className="rounded-2xl border border-white/10 bg-black/35 px-3 py-2 text-xs text-[var(--remi-dim)] backdrop-blur-md">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-[var(--remi-accent)]" />
                    <span>{getEmotionLabel(emotion)}</span>
                    <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em]">
                      {remiState}
                    </span>
                  </div>
                  <p className="mt-2 max-w-[36rem] text-[11px] leading-5 text-[var(--foreground)]/70">
                    {stateNote}
                  </p>
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/35 px-3 py-2 text-xs text-[var(--remi-dim)] backdrop-blur-md">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-[var(--remi-accent)]/80" />
                    <span>口型信号</span>
                  </div>
                  <div className="mt-2 flex items-end gap-1.5" aria-label="lip signal bars">
                    {[0.25, 0.52, 0.74, 1].map((scale, index) => (
                      <span
                        key={index}
                        className="w-2 rounded-full bg-[var(--remi-accent)] transition-all duration-100"
                        style={{
                          height: `${Math.max(8, 10 + lipEnvelope * 34 * scale)}px`,
                          opacity: demoSpeaking ? 0.62 + lipEnvelope * 0.38 : 0.28,
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div className="pointer-events-none absolute bottom-4 left-4 right-4">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/35 px-4 py-3 text-xs text-[var(--remi-dim)] backdrop-blur-md">
                  <div>
                    <div className="font-medium text-[var(--foreground)]">
                      {demoPhrase}
                    </div>
                    <div className="mt-1 text-[11px]">
                      当前 envelope: {lipEnvelope.toFixed(2)}{" "}
                      {demoSpeaking ? "· 模拟说话中" : "· 口型已静止"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full border border-white/10 px-3 py-1 text-[10px] uppercase tracking-[0.16em]">
                      {emotionMeta.key}
                    </span>
                    <span className="rounded-full border border-white/10 px-3 py-1 text-[10px] uppercase tracking-[0.16em]">
                      {getEmotionLabel(emotion)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {runtimeState === "error" && runtimeError ? (
              <div className="mt-3 rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
                3D 运行失败: {runtimeError}
              </div>
            ) : null}
          </div>
        </section>

        <aside className="flex min-h-[68vh] flex-col gap-4 rounded-[28px] border border-white/10 bg-white/[0.04] p-4 shadow-[0_18px_80px_rgba(0,0,0,0.3)] backdrop-blur-2xl sm:p-5">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-[var(--remi-dim)]">
              Control Deck
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight">
              情绪 / 状态 / 动作
            </h2>
          </div>

          <div className="space-y-3">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium">情绪</span>
                <span className="text-[11px] text-[var(--remi-dim)]">
                  {pickMoodCopy(emotion)}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {EMOTIONS.map((item) => {
                  const active = item.key === emotion;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setEmotion(item.key)}
                      aria-pressed={active}
                      className={`rounded-xl border px-3 py-2 text-left text-sm transition ${
                        active
                          ? "border-[var(--remi-accent)] bg-[var(--remi-accent)]/15 text-[var(--foreground)] shadow-[0_0_0_1px_rgba(168, 85, 247,0.24)]"
                          : "border-white/10 bg-white/[0.03] text-[var(--remi-dim)] hover:border-white/20 hover:bg-white/[0.06]"
                      }`}
                    >
                      <div className="font-medium">{item.title}</div>
                      <div className="mt-1 text-[11px] leading-4 opacity-80">
                        {item.note}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium">状态</span>
                <button
                  type="button"
                  onClick={() => setDemoSpeaking((value) => !value)}
                  className={`rounded-full border px-3 py-1 text-[11px] transition ${
                    demoSpeaking
                      ? "border-[var(--remi-accent)] bg-[var(--remi-accent)]/15 text-[var(--foreground)]"
                      : "border-white/10 bg-white/[0.03] text-[var(--remi-dim)]"
                  }`}
                >
                  {demoSpeaking ? "假口型开" : "假口型关"}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {STATES.map((item) => {
                  const active = remiState === item.value;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setRemiState(item.value)}
                      aria-pressed={active}
                      className={`rounded-xl border px-3 py-3 text-left transition ${
                        active
                          ? "border-[var(--remi-accent)] bg-[var(--remi-accent)]/15 text-[var(--foreground)]"
                          : "border-white/10 bg-white/[0.03] text-[var(--remi-dim)] hover:border-white/20 hover:bg-white/[0.06]"
                      }`}
                    >
                      <div className="text-sm font-medium">{item.title}</div>
                      <div className="mt-1 text-[11px] opacity-80">{item.note}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium">动作</span>
                <span className="text-[11px] text-[var(--remi-dim)]">
                  点一下发给 `Remi3DAvatar`
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {ACTIONS.map((item) => {
                  const active = selectedAction.action === item.action;
                  return (
                    <button
                      key={item.action}
                      type="button"
                      onClick={() => handleTriggerAction(item)}
                      className={`rounded-xl border px-3 py-3 text-left transition ${
                        active
                          ? "border-[var(--remi-accent)] bg-[var(--remi-accent)]/15 text-[var(--foreground)]"
                          : "border-white/10 bg-white/[0.03] text-[var(--remi-dim)] hover:border-white/20 hover:bg-white/[0.06]"
                      }`}
                    >
                      <div className="text-sm font-medium">{item.label}</div>
                      <div className="mt-1 text-[11px] opacity-80">{item.hint}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium">演示文案</span>
                <span className="text-[11px] text-[var(--remi-dim)]">
                  只影响 demo 提示
                </span>
              </div>
              <textarea
                value={demoPhrase}
                onChange={(event) => setDemoPhrase(event.target.value)}
                rows={4}
                className="min-h-[100px] w-full resize-y rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--remi-dim)] focus:border-[var(--remi-accent)]"
                placeholder="输入一段 demo 文案"
              />
            </div>
          </div>

          <div className="mt-auto rounded-2xl border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))] p-4">
            <div className="flex items-center justify-between text-xs text-[var(--remi-dim)]">
              <span>现场读数</span>
              <span className="font-medium text-[var(--remi-accent)]">
                {lipEnvelope.toFixed(2)}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                <div className="text-[11px] text-[var(--remi-dim)]">Emotion</div>
                <div className="mt-1 font-medium">{getEmotionLabel(emotion)}</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                <div className="text-[11px] text-[var(--remi-dim)]">State</div>
                <div className="mt-1 font-medium">{remiState}</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                <div className="text-[11px] text-[var(--remi-dim)]">Action</div>
                <div className="mt-1 font-medium">{selectedAction.label}</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                <div className="text-[11px] text-[var(--remi-dim)]">Model</div>
                <div className="mt-1 font-medium">`{MODEL_PRESET}`</div>
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1">
            <AvatarDevtoolsPanel
              title="Demo DevTools"
              className="h-full min-h-[24rem]"
            />
          </div>
        </aside>
      </div>
    </main>
  );
}
