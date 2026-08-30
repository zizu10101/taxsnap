"use client";

import { createContext, useContext } from "react";
import type { AppLockRole } from "@/lib/database.types";

export interface AppLockContextValue {
  // null covers both "the owner has never set a PIN, the gate never
  // engaged" and "this session unlocked as the owner" - either way it means
  // full access, so consumers only ever need to special-case 'staff'.
  role: AppLockRole | null;
  // Drops straight back to the lock screen (not into the owner's unlocked
  // view) - re-entering the owner PIN from there is what restores full
  // access. No-op outside a provider (default context value) so components
  // rendered in isolation (tests/storybook) don't crash calling it.
  exitStaffMode: () => void;
}

export const AppLockContext = createContext<AppLockContextValue>({
  role: null,
  exitStaffMode: () => {},
});

export function useAppLock() {
  return useContext(AppLockContext);
}
