"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AppLockContext } from "./app-lock-context";
import { LockScreen } from "./lock-screen";
import {
  IDLE_TIMEOUT_MS,
  clearUnlock,
  getServerUnlockSnapshot,
  getUnlockSnapshot,
  subscribeUnlock,
  touchUnlock,
  writeUnlock,
} from "./session-unlock-store";

const ACTIVITY_EVENTS = ["pointerdown", "keydown", "touchstart"] as const;

// Staff mode's only reachable route. Nav items to everything else are
// hidden (DashboardHeader, CommissionNav), but this catches direct URL
// entry and back/forward navigation too - "hidden from the nav" shouldn't
// mean "still one address-bar edit away," and that includes /billing, which
// this provider also covers (see the (app) route group in layout.tsx) even
// though it isn't a /dashboard/** path itself.
const STAFF_ALLOWED_PATH = "/dashboard/commission";

export function AppLockProvider({
  userId,
  hasOwnerPin,
  children,
}: {
  userId: string;
  hasOwnerPin: boolean;
  children: React.ReactNode;
}) {
  // Backed by sessionStorage (see session-unlock-store.ts), not local
  // useState - a plain `useState(hasOwnerPin)` only survives as long as
  // this exact component instance stays mounted, and the parent (app)
  // layout can remount it well within a single real owner session (see
  // that store file's comment for the concrete trigger). role === null
  // covers both "the owner has never set a PIN, the gate never engaged"
  // and "no valid persisted unlock for this user right now."
  const role = useSyncExternalStore(
    subscribeUnlock,
    () => getUnlockSnapshot(userId),
    getServerUnlockSnapshot,
  );
  const locked = hasOwnerPin && role === null;
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pathname = usePathname();
  const router = useRouter();

  const relock = useCallback(() => {
    clearUnlock();
  }, []);

  // Only runs once unlocked - re-locking while already locked is a no-op,
  // so there's nothing to reset while the lock screen itself is showing.
  useEffect(() => {
    if (!hasOwnerPin || locked) return;

    function resetTimer() {
      // Keeps the persisted record's clock in step with this in-memory
      // timer, so a remount mid-session reads a fresh timestamp instead of
      // treating an actually-active session as idle-expired.
      touchUnlock(userId);
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(relock, IDLE_TIMEOUT_MS);
    }

    resetTimer();
    ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, resetTimer));

    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, resetTimer));
    };
  }, [hasOwnerPin, locked, relock, userId]);

  useEffect(() => {
    if (role === "staff" && pathname !== STAFF_ALLOWED_PATH) {
      router.replace(STAFF_ALLOWED_PATH);
    }
  }, [role, pathname, router]);

  if (locked) {
    return <LockScreen onUnlock={(unlockedRole) => writeUnlock(userId, unlockedRole)} />;
  }

  return (
    <AppLockContext.Provider value={{ role, hasOwnerPin, relock }}>
      {children}
    </AppLockContext.Provider>
  );
}
