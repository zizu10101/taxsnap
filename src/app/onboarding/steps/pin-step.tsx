"use client";

import { useState } from "react";
import { toast } from "sonner";
import { PinSetupFlow } from "@/components/ui/pin-setup-flow";
import { OnboardingStepShell } from "../onboarding-step-shell";

// Shared body for both the Owner PIN and Staff PIN steps - same
// PinSetupFlow component Settings uses, same set-owner-pin/set-staff-pin
// endpoints, just parameterized by which one. No separate "Continue" button
// here: PinSetupFlow auto-submits on the confirm step's 4th digit, and a
// successful save advances the wizard itself - "Skip for now" (from the
// shared shell) is the only other way forward.
export function PinStep({
  stepNumber,
  title,
  description,
  endpoint,
  savedMessage,
  onNext,
}: {
  stepNumber: number;
  title: string;
  description: string;
  endpoint: string;
  savedMessage: string;
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
      <div className="flex flex-col items-center gap-3">
        <PinSetupFlow key={flowAttempt} onSubmit={handleSubmit} submitting={saving} />
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </OnboardingStepShell>
  );
}
