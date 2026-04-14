"use client";

import { useMemo, useState } from "react";

type ResetScope = "session" | "relationship" | "all";

type PresetControlPanelProps = {
  connected: boolean;
  onApply: (options: {
    personaPreset?: string;
    relationshipPreset?: string;
    resetScope?: ResetScope;
  }) => void;
  onReset: (scope: ResetScope) => void;
};

export const PERSONA_PRESETS = [
  { value: "warm_companion", label: "温柔陪伴型" },
  { value: "playful", label: "活泼黏人型" },
  { value: "calm_healer", label: "冷静治愈型" },
  { value: "tsundere_care", label: "嘴硬但在乎型" },
  { value: "close_friend", label: "轻松朋友型" },
];

export const RELATIONSHIP_PRESETS = [
  { value: "first_meet", label: "初见" },
  { value: "warming_up", label: "刚熟" },
  { value: "familiar", label: "熟悉" },
  { value: "close", label: "亲密" },
  { value: "long_term", label: "长期陪伴" },
];

const RESET_SCOPE_OPTIONS: Array<{ value: ResetScope; label: string; help: string }> = [
  { value: "session", label: "只清本轮会话", help: "清掉当前草稿、消息和打断状态。" },
  { value: "relationship", label: "重置关系层", help: "清掉关系、episode、主动策略。" },
  { value: "all", label: "全部清空", help: "清掉会话状态 + 关系系统状态，不清除持久事实记忆。" },
];

export function PresetControlPanel({
  connected,
  onApply,
  onReset,
}: PresetControlPanelProps) {
  const [open, setOpen] = useState(false);
  const [personaPreset, setPersonaPreset] = useState("warm_companion");
  const [relationshipPreset, setRelationshipPreset] = useState("warming_up");
  const [resetScope, setResetScope] = useState<ResetScope>("session");

  const resetHelp = useMemo(
    () => RESET_SCOPE_OPTIONS.find((option) => option.value === resetScope)?.help ?? "",
    [resetScope],
  );

  return (
    <section className="border-b border-white/10 bg-black/10 px-3 py-2 backdrop-blur-md min-[480px]:px-4 sm:px-5">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-left transition hover:bg-white/[0.06] disabled:cursor-default disabled:opacity-60"
        aria-expanded={open}
        disabled={!connected}
      >
        <div className="min-w-0">
          <div className="text-sm font-medium text-[var(--foreground)]">关系 / 人格预设</div>
          <div className="text-[11px] text-[var(--remi-dim)]">
            开发测试用：快速切人格、切关系阶段、重置污染状态
          </div>
        </div>
        <span className="text-xs text-[var(--remi-dim)]" aria-hidden>
          {open ? "收起" : "展开"}
        </span>
      </button>

      {open ? (
        <div className="mt-2 rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-sm text-[var(--foreground)]">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-[var(--remi-dim)]">人格预设</span>
              <select
                value={personaPreset}
                onChange={(e) => setPersonaPreset(e.target.value)}
                className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none"
              >
                {PERSONA_PRESETS.map((preset) => (
                  <option key={preset.value} value={preset.value}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-[var(--remi-dim)]">关系预设</span>
              <select
                value={relationshipPreset}
                onChange={(e) => setRelationshipPreset(e.target.value)}
                className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none"
              >
                {RELATIONSHIP_PRESETS.map((preset) => (
                  <option key={preset.value} value={preset.value}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-[var(--remi-dim)]">应用前重置范围</span>
              <select
                value={resetScope}
                onChange={(e) => setResetScope(e.target.value as ResetScope)}
                className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none"
              >
                {RESET_SCOPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              disabled={!connected}
              onClick={() =>
                onApply({
                  personaPreset,
                  relationshipPreset,
                  resetScope,
                })
              }
              className="h-11 rounded-xl bg-gradient-to-br from-[var(--remi-accent)] to-[var(--remi-accent-dim)] px-4 text-sm font-semibold text-[#042f2e] shadow-md shadow-teal-500/15 transition hover:opacity-95 disabled:cursor-default disabled:opacity-40"
            >
              应用预设
            </button>
          </div>

          <p className="mt-2 text-[11px] leading-5 text-[var(--remi-dim)]">{resetHelp}</p>

          <div className="mt-3 flex flex-wrap gap-2">
            {RESET_SCOPE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                disabled={!connected}
                onClick={() => onReset(option.value)}
                className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] text-[var(--remi-dim)] transition hover:bg-white/[0.08] hover:text-[var(--foreground)] disabled:cursor-default disabled:opacity-40"
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
