"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PinPad } from "@/components/ui/pin-pad";

export function AccountantLoginForm({ token }: { token: string }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped after a rejected PIN to remount the pad blank (the same
  // remount-by-key reset PinPad's own docs prescribe).
  const [attempt, setAttempt] = useState(0);

  async function handlePin(pin: string) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/accountant-portal/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, pin }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Couldn't sign in. Try again.");
        setAttempt((a) => a + 1);
        setSubmitting(false);
        return;
      }
      router.replace("/accountant/reports");
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
      setAttempt((a) => a + 1);
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3 py-6">
        <p className="text-center text-sm font-medium text-muted-foreground">Enter the PIN</p>
        <PinPad key={attempt} onComplete={handlePin} disabled={submitting} />
        {submitting && (
          <div className="flex justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {error && (
          <p role="alert" className="text-center text-sm text-destructive">
            {error}
          </p>
        )}
        <p className="pt-2 text-center text-xs text-muted-foreground">
          Don&apos;t have the PIN? Ask the business owner.
        </p>
      </CardContent>
    </Card>
  );
}
