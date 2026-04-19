export const THEME_PREFERENCE_STORAGE_KEY = "remi-theme-preference";

export type ThemePreference = "system" | "light" | "dark";

export function normalizeThemePreference(
  value: string | null | undefined,
): ThemePreference {
  return value === "light" || value === "dark" || value === "system"
    ? value
    : "system";
}

export function applyThemePreferenceToDocument(
  documentElement: {
    dataset: Record<string, string | undefined>;
    style?: {
      colorScheme?: string;
    };
  },
  preference: ThemePreference,
): void {
  if (preference === "system") {
    delete documentElement.dataset.theme;
    if (documentElement.style) {
      documentElement.style.colorScheme = "";
    }
    return;
  }

  documentElement.dataset.theme = preference;
  if (documentElement.style) {
    documentElement.style.colorScheme = preference;
  }
}

export function readStoredThemePreference(storage: Pick<Storage, "getItem">): ThemePreference {
  return normalizeThemePreference(storage.getItem(THEME_PREFERENCE_STORAGE_KEY));
}

export function persistThemePreference(
  storage: Pick<Storage, "setItem">,
  preference: ThemePreference,
): void {
  storage.setItem(THEME_PREFERENCE_STORAGE_KEY, preference);
}
