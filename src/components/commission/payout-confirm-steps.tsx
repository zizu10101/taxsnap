"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PinPad } from "@/components/ui/pin-pad";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// The actual PIN entry/verify/confirm step - identical whether reached from
// the Mark-as-Paid creation flow (MarkAsPaidDialog) or the later "Confirm"
// action on an already-unconfirmed payout (ConfirmPayoutDialog), since a
// payout id always exists by the time either flow renders this step.
// dismissLabel/onDismiss are caller-controlled because what "giving up for
// now" means differs: MarkAsPaidDialog's payout already exists at this
// point too, but ConfirmPayoutDialog's onDismiss never has to create
// anything - both just close, but the wording ("Skip for now" today, in
// both callers) is worth keeping as a prop rather than hardcoding here.
export function PayoutPinStep({
  stylistId,
  stylistName,
  payoutId,
  dismissLabel,
  onDismiss,
  onConfirmed,
}: {
  stylistId: string;
  stylistName: string;
  payoutId: string;
  dismissLabel: string;
  onDismiss: () => void;
  onConfirmed: () => void;
}) {
  const [verifying, setVerifying] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  // Bumped to force-remount the PinPad (clearing its digits) after a wrong
  // guess or an error - the pad has no reset of its own, by design.
  const [padAttempt, setPadAttempt] = useState(0);

  async function handleVerifyPin(pin: string) {
    setVerifying(true);
    setPinError(null);
    try {
      const res = await fetch(`/api/stylists/${stylistId}/verify-pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const data = await res.json();

      if (res.status === 429 && data.code === "PIN_LOCKED") {
        setLocked(true);
        setPinError(data.error);
        return;
      }
      if (!res.ok) throw new Error(data.error || "Failed to verify PIN");
      if (!data.valid) {
        setPinError("Incorrect PIN. Try again.");
        setPadAttempt((a) => a + 1);
        return;
      }

      const confirmRes = await fetch(`/api/payouts/${payoutId}/confirm`, { method: "PATCH" });
      const confirmData = await confirmRes.json();
      if (!confirmRes.ok) throw new Error(confirmData.error || "Failed to confirm payout");

      onConfirmed();
    } catch (err) {
      setPinError(err instanceof Error ? err.message : "Failed to verify PIN");
      setPadAttempt((a) => a + 1);
    } finally {
      setVerifying(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Confirm with {stylistName}</DialogTitle>
        <DialogDescription>
          Hand the device to {stylistName} to confirm this payout.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col items-center gap-3">
        <PinPad
          key={padAttempt}
          onComplete={handleVerifyPin}
          disabled={verifying || locked}
        />
        {pinError && (
          <div className="space-y-2 text-center">
            <p className="text-sm text-destructive">{pinError}</p>
            {locked && (
              <Button
                variant="outline"
                size="sm"
                render={<Link href="/dashboard/commission/stylists" />}
                nativeButton={false}
              >
                Reset PIN in Stylist settings
              </Button>
            )}
          </div>
        )}
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onDismiss}>
          {dismissLabel}
        </Button>
      </DialogFooter>
    </>
  );
}

// Shown instead of the PIN step when the stylist has never set one up.
// Purely presentational - dismissLoading only ever applies to
// MarkAsPaidDialog's caller, which may still need to create the payout on
// dismiss (ConfirmPayoutDialog's dismiss never does, its payout already
// exists, so it never passes this).
export function PayoutNoPinStep({
  stylistName,
  dismissLabel,
  dismissLoading,
  onDismiss,
}: {
  stylistName: string;
  dismissLabel: string;
  dismissLoading?: boolean;
  onDismiss: () => void;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>No PIN set for {stylistName}</DialogTitle>
        <DialogDescription>
          Set one up in Stylist settings first, or proceed without confirmation for now - the
          payout is saved correctly either way, it just won&apos;t be marked confirmed.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter className="sm:justify-between">
        <Button variant="ghost" onClick={onDismiss} disabled={dismissLoading}>
          {dismissLoading && <Loader2 className="h-4 w-4 animate-spin" />}
          {dismissLabel}
        </Button>
        <Button render={<Link href="/dashboard/commission/stylists" />} nativeButton={false}>
          Set up PIN
        </Button>
      </DialogFooter>
    </>
  );
}
