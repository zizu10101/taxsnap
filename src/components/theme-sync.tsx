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

// The theme actually being displayed right now, as distinct from the
// raw stored preference - when preference is "system" this is whatever
// the OS currently resolves to, not "system" itself. A header toggle
// needs this (which icon to show, which direction "switch" means),
// where Settings' three-way picker only ever needed the raw preference.
function subscribeToResolvedTheme(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener("theme-preference-change", callback);
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("theme-preference-change", callback);
    media.removeEventListener("change", callback);
  };
}

function getResolvedTheme(): "light" | "dark" {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function getServerResolvedTheme(): "light" | "dark" {
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
  resolvedTheme: "light" | "dark";
  setPreference: (next: ThemePreference) => void;
} {
  const preference = useSyncExternalStore(subscribe, readStoredPreference, getServerSnapshot);
  const resolvedTheme = useSyncExternalStore(
    subscribeToResolvedTheme,
    getResolvedTheme,
    getServerResolvedTheme,
  );

  function setPreference(next: ThemePreference) {
    writeStoredPreference(next);
    applyTheme(next);
    window.dispatchEvent(new Event("theme-preference-change"));
    fetch("/api/profile/theme", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme_preference: next }),
      // Without this, a toggle immediately followed by navigating away or
      // closing the tab can abort the request mid-flight before the PATCH
      // completes - the local class/localStorage already changed
      // (looks like it worked), but the DB write silently never lands,
      // so a new device/session reverts to the stale saved value.
      // keepalive lets the browser finish the request after the
      // document that started it is gone (verified: reproduced the drop
      // by toggling then immediately closing the tab, confirmed via a
      // direct DB check that theme_preference hadn't changed).
      keepalive: true,
    }).catch(() => {
      // The class/localStorage already updated optimistically above; a
      // failed PATCH just means this device's choice won't sync to
      // other devices until the next successful save. Not worth a toast
      // for a settings preference.
    });
  }

  return { preference, resolvedTheme, setPreference };
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
