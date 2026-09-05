"use client";

import type { AppLockRole } from "@/lib/database.types";

// Backs the app-lock "unlocked" state with sessionStorage instead of pure
// React state, so an unlock survives an AppLockProvider remount. Root
// cause: (app)/dashboard's shared layout calls supabase.auth.getUser() on
// every navigation, which makes a live network round trip to Supabase's
// Auth API to revalidate the token (that's the whole point of getUser()
// over getSession()) - on top of the identical call proxy.ts's middleware
// already made for the same request. If that second call is ever slow or
// transiently errors, the layout renders `<>{children}</>` instead of
// `<AppLockProvider>` for that one request; the next successful navigation
// then mounts a brand-new AppLockProvider instance. A plain
// `useState(hasOwnerPin)` has no way to tell that apart from a real fresh
// session, so it re-initializes to locked - even though the actual
// Supabase session never expired. sessionStorage persists across that kind
// of remount (and across a hard reload, which is the same "session" for a
// front-counter device left open between customers), so a remount can
// rehydrate the real unlocked state instead of guessing true.
//
// Deliberately not a real cookie/server session: the PIN gate is UI-only
// (see lock-screen.tsx's own comment - it's not a money-movement gate),
// and sessionStorage's built-in "gone when the tab closes" behavior is
// exactly the "once per session start" boundary being asked for here.
//
// useSyncExternalStore, not useState+useEffect (see CLAUDE.md's own
// convention for this exact class of problem): sessionStorage can't be
// read during SSR, and a naive effect-driven sync would both trip the
// react-hooks/set-state-in-effect rule and flash the lock screen once on
// every hydration before correcting itself.
export interface UnlockRecord {
  userId: string;
  role: AppLockRole;
  lastActivityAt: number;
}

const STORAGE_KEY = "taxsnap:app-lock";

// Matches AppLockProvider's pre-existing idle window - exported so both
// files share one definition instead of two copies drifting apart. Kept
// short deliberately: an unlocked Manager session on a shared front-counter
// device is a real handoff risk if a staff member (or anyone) picks it up
// while the owner has stepped away - the manual "Lock now" button
// (DashboardHeader) is the primary defense, this is just the fallback for
// when nobody remembers to tap it.
export const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

const listeners = new Set<() => void>();

function emitChange() {
  listeners.forEach((listener) => listener());
}

function readRecord(): UnlockRecord | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as UnlockRecord) : null;
  } catch {
    // Private-browsing storage lockouts, corrupted JSON, etc. - treat as
    // "no persisted session" rather than throwing.
    return null;
  }
}

function writeRecord(record: UnlockRecord | null) {
  try {
    if (record) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Same as above - continuing without persistence just degrades back to
    // the old component-memory-only behavior, not a crash.
  }
  emitChange();
}

export function subscribeUnlock(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Returns just the role (or null), a primitive - so
// useSyncExternalStore's Object.is comparison correctly bails out of
// re-rendering on every touchUnlock() write instead of thrashing on a new
// object reference each time activity is recorded.
export function getUnlockSnapshot(userId: string): AppLockRole | null {
  const record = readRecord();
  if (!record || record.userId !== userId) return null;
  if (Date.now() - record.lastActivityAt > IDLE_TIMEOUT_MS) return null;
  return record.role;
}

// SSR (and the very first client render, pre-hydration) can never know
// sessionStorage's contents - always "no persisted session", same as the
// previous `useState(hasOwnerPin)` default of locked-if-gated.
export function getServerUnlockSnapshot(): AppLockRole | null {
  return null;
}

export function writeUnlock(userId: string, role: AppLockRole) {
  writeRecord({ userId, role, lastActivityAt: Date.now() });
}

// Called on every tracked activity event while unlocked - keeps the
// persisted record's clock in step with the in-memory idle timer so a
// remount mid-session doesn't see a stale timestamp and treat a genuinely
// active session as idle-expired.
export function touchUnlock(userId: string) {
  const record = readRecord();
  if (!record || record.userId !== userId) return;
  writeRecord({ ...record, lastActivityAt: Date.now() });
}

export function clearUnlock() {
  writeRecord(null);
}
