"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { writeUnlock } from "@/components/app-lock/session-unlock-store";
import { PinSetupFlow } from "@/components/ui/pin-setup-flow";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// Reached only via the emailed verification link (same /auth/callback +
// post_auth_redirect cookie mechanism as ResetPasswordForm) - that session
// already sitting in cookies is what proves this is really the account
// owner, not a staff member sharing the device's browser. Calls
// /api/app-lock/set-owner-pin directly (same endpoint Settings uses,
// doesn't require the old PIN) rather than a bespoke recovery endpoint -
// the identity proof already happened via email, not via re-entering a PIN
// nobody can remember. Never touches the account password.
export function ResetAppPinForm() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flowAttempt, setFlowAttempt] = useState(0);

  async function handleSubmit(pin: string) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/app-lock/set-owner-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save PIN");

      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      // Lands straight into an unlocked Manager session with the PIN they
      // just set, rather than bouncing them to the lock screen to
      // immediately re-type what they just typed.
      if (user) writeUnlock(user.id, "owner");
      window.location.assign("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save PIN");
      setFlowAttempt((a) => a + 1);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <Link href="/" className="mx-auto mb-2 flex h-12 w-12 items-center justify-center">
          <img src="/logo-mark.png" alt="TaxSnap" className="h-12 w-12" />
        </Link>
        <CardTitle className="text-2xl">Set a new Manager PIN</CardTitle>
        <CardDescription>Verified - choose a new 4-digit Manager PIN.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-4">
        <PinSetupFlow key={flowAttempt} onSubmit={handleSubmit} submitting={submitting} />
        {error && (
          <p className="w-full rounded-md bg-destructive/10 p-3 text-center text-sm text-destructive">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
