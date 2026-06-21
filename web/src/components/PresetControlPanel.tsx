"use client";

import { useState } from "react";

type ResetScope = "session" | "relationship" | "all";

type PresetControlPanelProps = {
  connected: boolean;
  onApply: (options: {
    personaPreset?: string;
    relationshipPreset?: string;
  }) => void;
  onReset: (scope: ResetScope) => void;
  busy?: boolean;
  devStatus?: {
    tone: "idle" | "pending" | "success" | "error";
    message: string;
  };
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

const RESET_SCOPE_OPTIONS: Array<{ value: ResetScope; label: string }> = [
  { value: "session", label: "只清本轮会话" },
  { value: "relationship", label: "重置关系层" },
  { value: "all", label: "全部清空" },
];

export function PresetControlPanel({
  connected,
  onApply,
  onReset,
  busy = false,
  devStatus,
}: PresetControlPanelProps) {
  const [open, setOpen] = useState(false);
  const [personaPreset, setPersonaPreset] = useState("warm_companion");
  const [relationshipPreset, setRelationshipPreset] = useState("warming_up");
  const statusTone = devStatus?.tone ?? "idle";
  const statusMessage = devStatus?.message?.trim() ?? "";
  const statusClassName =
    statusTone === "error"
      ? "border-red-400/20 bg-red-500/10 text-red-100"
      : statusTone === "success"
        ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100"
        : statusTone === "pending"
          ? "border-amber-400/20 bg-amber-500/10 text-amber-100"
          : "border-white/10 bg-white/[0.04] text-[var(--remi-dim)]";

  return (
    <section className="rounded-[1.35rem] border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-md">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-left transition hover:bg-white/[0.06] disabled:cursor-default disabled:opacity-60"
        aria-expanded={open}
        disabled={!connected}
      >
        <div className="min-w-0">
          <div className="text-sm font-medium text-[var(--foreground)]">
            关系 / 人格预设
          </div>
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
              <span className="text-[11px] text-[var(--remi-dim)]">
                人格预设
              </span>
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
              <span className="text-[11px] text-[var(--remi-dim)]">
                关系预设
              </span>
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

          <div className="mt-3 grid gap-3">
            <button
              type="button"
              disabled={!connected || busy}
              onClick={() =>
                onApply({
                  personaPreset,
                  relationshipPreset,
                })
              }
              className="h-11 rounded-xl bg-gradient-to-br from-[var(--remi-accent)] to-[var(--remi-accent-dim)] px-4 text-sm font-semibold text-[#042f2e] shadow-md shadow-teal-500/15 transition hover:opacity-95 disabled:cursor-default disabled:opacity-40"
            >
              {busy ? "发送中…" : "仅应用预设"}
            </button>

            <p className="text-[11px] leading-5 text-[var(--remi-dim)]">
              上方只会应用当前人格 /
              关系模板，不会清空数据库，也不会删除当前消息历史。
            </p>
          </div>

          <div className="mt-4 border-t border-white/10 pt-3">
            <div className="text-[11px] font-medium text-[var(--foreground)]">
              纯清空
            </div>
            <p className="mt-1 text-[11px] leading-5 text-[var(--remi-dim)]">
              下面按钮才会真清空。不会自动回写任何人格或关系预设。 `重置关系层`
              会删关系状态、V2 episodes 和消息历史。 `全部清空`
              会把当前用户打回白纸：连同持久 facts memory 一起删掉。
            </p>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {RESET_SCOPE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                disabled={!connected || busy}
                onClick={() => onReset(option.value)}
                className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] text-[var(--remi-dim)] transition hover:bg-white/[0.08] hover:text-[var(--foreground)] disabled:cursor-default disabled:opacity-40"
              >
                {option.label}
              </button>
            ))}
          </div>

          {statusMessage ? (
            <div
              role="status"
              aria-live="polite"
              className={`mt-3 rounded-xl border px-3 py-2 text-[11px] leading-5 ${statusClassName}`}
            >
              {statusMessage}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
