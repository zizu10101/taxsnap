"use client";

import { useEffect, useSyncExternalStore } from "react";
import { applyTheme, readStoredPreference, writeStoredPreference } from "@/lib/theme";
import type { ThemePreference } from "@/lib/database.types";

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener("theme-preference-change", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("theme-preference-change", callback);
  };
}

function getServerSnapshot(): ThemePreference {
  return "light";
}

// Reads the same localStorage value the blocking init script
// (src/app/layout.tsx) already resolved before paint - this is just
// what the rest of the React tree (Settings' theme picker) reads back to
// show the current selection, via useSyncExternalStore per this
// codebase's own established pattern for browser-only values (see
// install-prompt-cards.tsx) rather than useState+useEffect.
export function useTheme(): {
  preference: ThemePreference;
  setPreference: (next: ThemePreference) => void;
} {
  const preference = useSyncExternalStore(subscribe, readStoredPreference, getServerSnapshot);

  function setPreference(next: ThemePreference) {
    writeStoredPreference(next);
    applyTheme(next);
    window.dispatchEvent(new Event("theme-preference-change"));
    fetch("/api/profile/theme", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme_preference: next }),
    }).catch(() => {
      // The class/localStorage already updated optimistically above; a
      // failed PATCH just means this device's choice won't sync to
      // other devices until the next successful save. Not worth a toast
      // for a settings preference.
    });
  }

  return { preference, setPreference };
}

// Mounted once in (app)/layout.tsx with the account's actual
// theme_preference (already fetched there alongside the app-lock
// check) - reconciles a brand-new device (empty localStorage, so the
// blocking script fell back to "light"/system) with the real saved
// preference. A no-op on every device that's already in sync.
export function ThemeSync({ preference }: { preference: ThemePreference }) {
  useEffect(() => {
    if (readStoredPreference() === preference) return;
    writeStoredPreference(preference);
    applyTheme(preference);
    window.dispatchEvent(new Event("theme-preference-change"));
  }, [preference]);

  return null;
}
