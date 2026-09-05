"use client";

import { useState } from "react";
import Link from "next/link";
import { PinPad } from "@/components/ui/pin-pad";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { AppLockRole } from "@/lib/database.types";

// A single dial pad, no "are you owner or staff" step first - the backend
// (verify_app_pin) reports which role the PIN matched, or neither. No
// lockout/retry limit here (unlike the stylist payout-confirmation PIN) -
// this gates navigation, not money movement, so a wrong guess is just an
// inline error and a cleared pad.
export function LockScreen({ onUnlock }: { onUnlock: (role: AppLockRole) => void }) {
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped to force-remount the PinPad (clearing its digits) after a wrong
  // guess or an error - the pad has no reset of its own, by design.
  const [padAttempt, setPadAttempt] = useState(0);

  async function handleComplete(pin: string) {
    setVerifying(true);
    setError(null);
    try {
      const res = await fetch("/api/app-lock/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to verify PIN");

      if (data.role === "owner" || data.role === "staff") {
        onUnlock(data.role);
        return;
      }

      setError("Incorrect PIN.");
      setPadAttempt((a) => a + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setPadAttempt((a) => a + 1);
    } finally {
      setVerifying(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-1 items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <img src="/logo-mark.png" alt="TaxSnap" className="mx-auto mb-2 h-12 w-12" />
          <CardTitle className="text-2xl">Enter PIN</CardTitle>
          <CardDescription>Enter your PIN to unlock TaxSnap.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          <PinPad key={padAttempt} onComplete={handleComplete} disabled={verifying} />
          {error && (
            <p className="w-full rounded-md bg-destructive/10 p-3 text-center text-sm text-destructive">
              {error}
            </p>
          )}
          {/* Routes through email verification (ForgotPinForm), not a
              plain "forgot PIN" reset in place - anyone sharing this
              device's already-authenticated browser session (i.e. staff)
              could otherwise reset the Manager PIN themselves with no
              extra proof of identity, which would defeat the point of the
              PIN gate entirely. */}
          <Link
            href="/auth/forgot-pin"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Forgot PIN?
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
