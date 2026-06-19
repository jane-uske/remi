"use client";

import { useEffect, useRef, useState } from "react";
import { RemiIdentityAvatar } from "@/components/RemiIdentityAvatar";
import { RemiSettingsPanel } from "@/components/RemiSettingsPanel";
import {
  applyThemePreferenceToDocument,
  normalizeThemePreference,
  persistThemePreference,
  readStoredThemePreference,
  type ThemePreference,
} from "@/lib/theme/themePreference";

export const USER_PERSONA_PRESET_OPTIONS = [
  { value: "remi_core", label: "Remi" },
  { value: "witty_warm", label: "温柔机灵" },
  { value: "relaxed_roast", label: "松弛吐槽" },
  { value: "playful_attached", label: "活泼黏人" },
  { value: "calm_healing", label: "冷静治愈" },
] as const;

export type UserPersonaPresetId =
  (typeof USER_PERSONA_PRESET_OPTIONS)[number]["value"];

export const DEFAULT_USER_PERSONA_PRESET: UserPersonaPresetId =
  USER_PERSONA_PRESET_OPTIONS[0].value;

type RemiAccountMenuProps = {
  emotionLabel: string;
  currentUserId: string;
  isDefaultDevUser: boolean;
  wsTargetLabel: string;
  personaPreset: string | null;
  canSignOut: boolean;
  onSignOut: () => Promise<void>;
  onUpdatePersonaPreset: (presetId: string) => void;
  defaultOpen?: boolean;
  triggerMode?: "compact" | "avatar-only";
};

type PersonaPresetSelectorSectionProps = {
  personaPreset: string | null;
  onUpdatePersonaPreset: (presetId: string) => void;
};

type ThemePreferenceSelectorSectionProps = {
  themePreference: ThemePreference;
  onUpdateThemePreference: (preference: ThemePreference) => void;
};

export function normalizeUserPersonaPreset(
  presetId: string | null | undefined,
): UserPersonaPresetId {
  const normalized = presetId?.trim();
  if (
    normalized &&
    USER_PERSONA_PRESET_OPTIONS.some((preset) => preset.value === normalized)
  ) {
    return normalized as UserPersonaPresetId;
  }
  return DEFAULT_USER_PERSONA_PRESET;
}

export function resolveUserPersonaPresetChange(
  currentPreset: string | null | undefined,
  nextPreset: string | null | undefined,
): UserPersonaPresetId | null {
  const normalizedNext = nextPreset?.trim();
  if (
    !normalizedNext ||
    !USER_PERSONA_PRESET_OPTIONS.some((preset) => preset.value === normalizedNext)
  ) {
    return null;
  }

  const normalizedCurrent = normalizeUserPersonaPreset(currentPreset);
  if (normalizedNext === normalizedCurrent) return null;
  return normalizedNext as UserPersonaPresetId;
}

function accountModeLabel(input: {
  isDefaultDevUser: boolean;
  canSignOut: boolean;
}): string {
  if (input.canSignOut) return "clerk-user";
  if (input.isDefaultDevUser) return "default-user";
  return "token-user";
}

export function RemiAccountMenu({
  emotionLabel,
  currentUserId,
  isDefaultDevUser,
  wsTargetLabel,
  personaPreset: _personaPreset,
  canSignOut,
  onSignOut,
  onUpdatePersonaPreset: _onUpdatePersonaPreset,
  defaultOpen = false,
  triggerMode = "compact",
}: RemiAccountMenuProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [themePreference, setThemePreference] = useState<ThemePreference>("system");
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const nextPreference = readStoredThemePreference(window.localStorage);
    setThemePreference(nextPreference);
    applyThemePreferenceToDocument(document.documentElement, nextPreference);
  }, []);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  const modeLabel = accountModeLabel({
    isDefaultDevUser,
    canSignOut,
  });
  const userLabel =
    currentUserId.length > 18
      ? `${currentUserId.slice(0, 8)}…${currentUserId.slice(-4)}`
      : currentUserId;
  const compactPrimaryLabel = canSignOut ? userLabel : "当前会话";
  const secondaryLabel = canSignOut
    ? "已登录"
    : isDefaultDevUser
      ? "开发身份"
      : "临时入口";
  const handleThemePreferenceChange = (nextPreference: ThemePreference) => {
    setThemePreference(nextPreference);
    if (typeof window === "undefined") return;
    persistThemePreference(window.localStorage, nextPreference);
    applyThemePreferenceToDocument(document.documentElement, nextPreference);
  };

  const menuAnchorClass = triggerMode === "avatar-only" ? "left-0" : "right-0";

  return (
    <>
    <div ref={rootRef} className="relative flex max-w-full">
      {triggerMode === "avatar-only" ? (
        <button
          type="button"
          className="group flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[color:var(--remi-account-trigger-border)] bg-[var(--remi-account-trigger-bg)] shadow-lg shadow-black/10 backdrop-blur-md transition hover:bg-[var(--remi-account-trigger-hover)]"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <RemiIdentityAvatar className="size-full border-white/18 shadow-lg shadow-cyan-950/10" />
        </button>
      ) : (
        <button
          type="button"
          className="group flex h-12 min-w-0 max-w-fit items-center gap-1.5 rounded-full border border-[color:var(--remi-account-trigger-border)] bg-[var(--remi-account-trigger-bg)] px-1.5 py-1.5 text-left shadow-lg shadow-black/10 backdrop-blur-md transition hover:bg-[var(--remi-account-trigger-hover)] sm:min-w-[11rem] sm:gap-3 sm:pr-3.5"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <RemiIdentityAvatar className="size-11 shrink-0 border-white/18 shadow-lg shadow-cyan-950/10" />
          <div className="hidden min-w-0 sm:block">
            <h1 className="truncate whitespace-nowrap text-sm font-semibold tracking-tight text-[var(--remi-account-trigger-title)]">
              {compactPrimaryLabel}
            </h1>
            <p className="mt-0.5 truncate whitespace-nowrap text-[11px] text-[var(--remi-account-trigger-subtitle)]">
              {secondaryLabel}
            </p>
          </div>
          <span
            aria-hidden
            className="hidden text-[11px] text-[var(--remi-account-trigger-subtitle)] sm:inline"
          >
            {open ? "收起" : "展开"}
          </span>
        </button>
      )}

      {open ? (
        <div
          role="menu"
          className={`absolute top-[calc(100%+0.75rem)] z-20 w-[min(88vw,22rem)] overflow-hidden rounded-3xl border border-[color:var(--remi-account-menu-border)] bg-[var(--remi-account-menu-bg)] shadow-2xl shadow-black/35 backdrop-blur-xl ${menuAnchorClass}`}
        >
          <div className="border-b border-white/10 px-4 py-4">
            <p className="text-xs uppercase tracking-[0.22em] text-[var(--remi-dim)]">
              Account
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] text-[var(--foreground)]">
                {modeLabel}
              </span>
              <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] text-[var(--foreground)]">
                uid: {currentUserId}
              </span>
              {wsTargetLabel ? (
                <span className="max-w-full truncate rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] text-[var(--foreground)]">
                  ws: {wsTargetLabel}
                </span>
              ) : null}
              <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] text-[var(--foreground)]">
                emotion: {emotionLabel}
              </span>
            </div>
          </div>

          <ThemePreferenceSelectorSection
            themePreference={themePreference}
            onUpdateThemePreference={handleThemePreferenceChange}
          />

          <div className="space-y-2 px-3 py-3">
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-3 text-sm text-[var(--foreground)] transition hover:border-white/20 hover:bg-white/[0.08]"
              onClick={() => {
                setOpen(false);
                setSettingsOpen(true);
              }}
            >
              <span>服务设置</span>
              <span className="text-xs text-[var(--remi-dim)]">生图 · 语音 · 成人模式</span>
            </button>
            {canSignOut ? (
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-3 text-sm text-[var(--foreground)] transition hover:border-white/20 hover:bg-white/[0.08] disabled:cursor-wait disabled:opacity-60"
                disabled={signingOut}
                onClick={async () => {
                  setSigningOut(true);
                  try {
                    await onSignOut();
                  } finally {
                    setSigningOut(false);
                    setOpen(false);
                  }
                }}
              >
                <span>{signingOut ? "Signing out…" : "Sign out"}</span>
                <span className="text-xs text-[var(--remi-dim)]">
                  Leave session
                </span>
              </button>
            ) : (
              <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-[var(--remi-dim)]">
                当前入口未托管正式 Clerk 会话，不能从这里执行真实登出。
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
    <RemiSettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}

export function PersonaPresetSelectorSection({
  personaPreset,
  onUpdatePersonaPreset,
}: PersonaPresetSelectorSectionProps) {
  const selectedPersonaPreset = normalizeUserPersonaPreset(personaPreset);

  return (
    <div
      className="border-b border-white/10 px-4 py-4"
      data-persona-preset={selectedPersonaPreset}
    >
      <label className="flex flex-col gap-2">
        <span className="text-xs uppercase tracking-[0.22em] text-[var(--remi-dim)]">
          表达风格
        </span>
        <select
          aria-label="Remi 表达风格"
          value={selectedPersonaPreset}
          onChange={(event) => {
            const nextPreset = resolveUserPersonaPresetChange(
              personaPreset,
              event.target.value,
            );
            if (!nextPreset) return;
            onUpdatePersonaPreset(nextPreset);
          }}
          className="rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-3 text-sm text-[var(--foreground)] outline-none transition hover:border-white/20 hover:bg-white/[0.08]"
        >
          {USER_PERSONA_PRESET_OPTIONS.map((preset) => (
            <option key={preset.value} value={preset.value}>
              {preset.label}
            </option>
          ))}
        </select>
      </label>
      <p className="mt-3 text-xs leading-5 text-[var(--remi-dim)]">
        只改变 Remi 的表达风格，不会重置关系或记忆。
      </p>
    </div>
  );
}

export function ThemePreferenceSelectorSection({
  themePreference,
  onUpdateThemePreference,
}: ThemePreferenceSelectorSectionProps) {
  const selectedThemePreference = normalizeThemePreference(themePreference);

  return (
    <div
      className="border-b border-white/10 px-4 py-4"
      data-theme-preference={selectedThemePreference}
    >
      <label className="flex flex-col gap-2">
        <span className="text-xs uppercase tracking-[0.22em] text-[var(--remi-dim)]">
          外观主题
        </span>
        <select
          aria-label="Remi 外观主题"
          value={selectedThemePreference}
          onChange={(event) => {
            onUpdateThemePreference(
              normalizeThemePreference(event.target.value),
            );
          }}
          className="rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-3 text-sm text-[var(--foreground)] outline-none transition hover:border-white/20 hover:bg-white/[0.08]"
        >
          <option value="system">跟随系统</option>
          <option value="light">浅色</option>
          <option value="dark">深色</option>
        </select>
      </label>
      <p className="mt-3 text-xs leading-5 text-[var(--remi-dim)]">
        只切换当前页面外观，不改变对话、人格或记忆。
      </p>
    </div>
  );
}
