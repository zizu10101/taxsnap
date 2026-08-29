"use client";

import { Dialog, DialogContent } from "@/components/ui/dialog";
import { PayoutPinStep, PayoutNoPinStep } from "@/components/commission/payout-confirm-steps";
import type { StylistPublic } from "@/lib/database.types";

// The "Confirm later" path for a payout that was already created unconfirmed
// (skipped, or no PIN was set at the time) - reuses the exact same PIN/no-PIN
// steps as the Mark-as-Paid creation flow, since a payout id always exists
// here already. Nothing to create, dismissing just closes either way.
export function ConfirmPayoutDialog({
  open,
  onOpenChange,
  stylist,
  payoutId,
  onConfirmed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stylist: StylistPublic;
  payoutId: string;
  onConfirmed: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {stylist.has_pin ? (
          <PayoutPinStep
            stylistId={stylist.id}
            stylistName={stylist.name}
            payoutId={payoutId}
            dismissLabel="Skip for now"
            onDismiss={() => onOpenChange(false)}
            onConfirmed={() => {
              onConfirmed();
              onOpenChange(false);
            }}
          />
        ) : (
          <PayoutNoPinStep
            stylistName={stylist.name}
            dismissLabel="Proceed without confirmation"
            onDismiss={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
