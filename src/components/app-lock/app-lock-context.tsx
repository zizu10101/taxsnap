"use client";

import { createContext, useContext } from "react";
import type { AppLockRole } from "@/lib/database.types";

export interface AppLockContextValue {
  // null covers both "the owner has never set a PIN, the gate never
  // engaged" and "this session unlocked as the owner" - either way it means
  // full access, so consumers only ever need to special-case 'staff'.
  role: AppLockRole | null;
  // Whether the gate is configured at all for this account - lets a
  // consumer like DashboardHeader's Manager/Staff toggle hide itself
  // entirely rather than offering a switch that can never actually lock
  // anything (relock() only has an effect while this is true - see
  // AppLockProvider's `locked` derivation).
  hasOwnerPin: boolean;
  // Drops back to the lock screen, regardless of which mode is currently
  // active - the Manager/Staff toggle in DashboardHeader calls this for
  // either direction of the switch, since a PIN re-entry is what actually
  // grants the new mode (there's no way to just flip `role` without it).
  // No-op outside a provider (default context value) so components
  // rendered in isolation (tests/storybook) don't crash calling it.
  relock: () => void;
}

export const AppLockContext = createContext<AppLockContextValue>({
  role: null,
  hasOwnerPin: false,
  relock: () => {},
});

export function useAppLock() {
  return useContext(AppLockContext);
}
