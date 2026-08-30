"use client";

import { useState } from "react";
import { PinPad } from "@/components/ui/pin-pad";

// Shared "enter new PIN, then confirm it" flow for every PIN *setup* screen
// (stylist PIN setup, app-lock owner/staff PIN setup) - two sequential
// PinPads rather than the old side-by-side "New PIN"/"Confirm PIN" text
// fields, matching this app's existing step-based UI pattern (e.g.
// Commission Logger's Service -> Stylist -> Name flow) instead of a
// two-input grid a dial pad doesn't fit into.
//
// A mismatched confirmation is handled locally, right here (bounce back to
// the "enter" step) - that's a same-component reaction to a user action,
// not a resync from external props, so plain state is fine. A
// *server-rejected* PIN (INVALID_PIN/PIN_CONFLICT) is the caller's problem
// to report and recover from: the caller changes this component's own
// `key` to force a full remount back to a blank first step, the same
// remount-by-key convention every reset in this codebase already follows,
// rather than this component watching an `error` prop in an effect.
export function PinSetupFlow({
  onSubmit,
  submitting = false,
}: {
  onSubmit: (pin: string) => void;
  submitting?: boolean;
}) {
  const [step, setStep] = useState<"enter" | "confirm">("enter");
  const [firstPin, setFirstPin] = useState("");
  const [mismatch, setMismatch] = useState(false);
  const [attempt, setAttempt] = useState(0);

  function handleEnterComplete(pin: string) {
    setFirstPin(pin);
    setMismatch(false);
    setStep("confirm");
  }

  function handleConfirmComplete(pin: string) {
    if (pin !== firstPin) {
      setMismatch(true);
      setFirstPin("");
      setStep("enter");
      setAttempt((a) => a + 1);
      return;
    }
    onSubmit(pin);
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <p className="text-sm font-medium text-muted-foreground">
        {step === "enter" ? "Enter new PIN" : "Confirm new PIN"}
      </p>
      <PinPad
        key={step === "enter" ? `enter-${attempt}` : `confirm-${attempt}`}
        onComplete={step === "enter" ? handleEnterComplete : handleConfirmComplete}
        disabled={submitting}
      />
      {mismatch && (
        <p className="text-sm text-destructive">PINs didn&apos;t match. Try again.</p>
      )}
    </div>
  );
}
