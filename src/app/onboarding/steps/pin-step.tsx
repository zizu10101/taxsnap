"use client";

import { useState } from "react";
import { toast } from "sonner";
import { PinSetupFlow } from "@/components/ui/pin-setup-flow";
import { OnboardingStepShell } from "../onboarding-step-shell";
import { ProLockCard } from "../pro-lock-card";

// Shared body for both the Owner PIN and Staff PIN steps - same
// PinSetupFlow component Settings uses, same set-owner-pin/set-staff-pin
// endpoints, just parameterized by which one. No separate "Continue" button
// here: PinSetupFlow auto-submits on the confirm step's 4th digit, and a
// successful save advances the wizard itself - "Skip for now" (from the
// shared shell) is the only other way forward.
//
// Pro-gated in onboarding specifically (per the free-tier salon spec),
// even though the underlying app-lock PIN itself isn't Pro-gated anywhere
// else in the app (Settings lets any tier set one) - these two steps are
// treated as part of the Pro payout-protection story here, not as general
// app-lock setup.
export function PinStep({
  stepNumber,
  title,
  description,
  endpoint,
  savedMessage,
  isPro,
  onNext,
}: {
  stepNumber: number;
  title: string;
  description: string;
  endpoint: string;
  savedMessage: string;
  isPro: boolean;
  onNext: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped to force-remount PinSetupFlow back to its blank "enter" step
  // after the server rejects a PIN - same convention as AppLockSettings.
  const [flowAttempt, setFlowAttempt] = useState(0);

  async function handleSubmit(pin: string) {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save PIN");
      toast.success(savedMessage);
      onNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save PIN");
      setFlowAttempt((a) => a + 1);
    } finally {
      setSaving(false);
    }
  }

  return (
    <OnboardingStepShell
      stepNumber={stepNumber}
      title={title}
      description={description}
      onSkip={onNext}
    >
      {isPro ? (
        <div className="flex flex-col items-center gap-3">
          <PinSetupFlow key={flowAttempt} onSubmit={handleSubmit} submitting={saving} />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      ) : (
        <ProLockCard message="Upgrade to Pro to unlock payouts and PIN protection." />
      )}
    </OnboardingStepShell>
  );
}
