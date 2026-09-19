import type { ThemePreference } from "./database.types";

export const THEME_STORAGE_KEY = "theme";

export function resolveIsDark(preference: ThemePreference): boolean {
  if (preference === "dark") return true;
  if (preference === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

// Applied by both the blocking pre-paint script (src/app/layout.tsx, a
// raw inline string kept in sync with this by hand - it runs before any
// React/module code exists) and everywhere else client-side that needs
// to reflect a preference change immediately (ThemeSync, useTheme).
export function applyTheme(preference: ThemePreference) {
  document.documentElement.classList.toggle("dark", resolveIsDark(preference));
}

export function readStoredPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    // localStorage can throw (private browsing, blocked site data) - fall
    // through to the default.
  }
  return "light";
}

export function writeStoredPreference(preference: ThemePreference) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Same as above - a failed write just means this device won't
    // remember the choice locally; the account-level value (profiles.
    // theme_preference) is still the durable source of truth.
  }
}
