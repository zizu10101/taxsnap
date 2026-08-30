"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AppLockContext } from "./app-lock-context";
import { LockScreen } from "./lock-screen";
import type { AppLockRole } from "@/lib/database.types";

// No idle-timeout/session pattern existed anywhere in the app before this -
// no middleware.ts, no auth/session context, nothing tracking activity
// (checked - the only prior "session" concept is Supabase's own auth
// cookie, which has nothing to do with idle re-locking). This is a
// from-scratch idle timer: reset on any pointer/keyboard/touch activity
// while unlocked, firing after 15 minutes of none. That's a reasonable
// default for a front-counter device that gets set down between customers;
// there's no existing convention to match it against.
const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "touchstart"] as const;

// Staff mode's only reachable route. Nav items to everything else are
// hidden (DashboardHeader, CommissionNav), but this catches direct URL
// entry and back/forward navigation too - "hidden from the nav" shouldn't
// mean "still one address-bar edit away," and that includes /billing, which
// this provider also covers (see the (app) route group in layout.tsx) even
// though it isn't a /dashboard/** path itself.
const STAFF_ALLOWED_PATH = "/dashboard/commission";

export function AppLockProvider({
  hasOwnerPin,
  children,
}: {
  hasOwnerPin: boolean;
  children: React.ReactNode;
}) {
  // The gate never engages for an owner who hasn't opted in by setting a
  // PIN - starting `locked` at `hasOwnerPin` means it's simply always false
  // in that case, no separate "gate enabled" flag needed.
  const [locked, setLocked] = useState(hasOwnerPin);
  const [role, setRole] = useState<AppLockRole | null>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pathname = usePathname();
  const router = useRouter();

  const relock = useCallback(() => {
    setLocked(true);
    setRole(null);
  }, []);

  // Only runs once unlocked - re-locking while already locked is a no-op,
  // so there's nothing to reset while the lock screen itself is showing.
  useEffect(() => {
    if (!hasOwnerPin || locked) return;

    function resetTimer() {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(relock, IDLE_TIMEOUT_MS);
    }

    resetTimer();
    ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, resetTimer));

    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, resetTimer));
    };
  }, [hasOwnerPin, locked, relock]);

  useEffect(() => {
    if (role === "staff" && pathname !== STAFF_ALLOWED_PATH) {
      router.replace(STAFF_ALLOWED_PATH);
    }
  }, [role, pathname, router]);

  if (locked) {
    return (
      <LockScreen
        onUnlock={(unlockedRole) => {
          setRole(unlockedRole);
          setLocked(false);
        }}
      />
    );
  }

  return (
    <AppLockContext.Provider value={{ role, exitStaffMode: relock }}>
      {children}
    </AppLockContext.Provider>
  );
}
