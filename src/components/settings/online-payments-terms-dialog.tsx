"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ONLINE_PAYMENTS_AGREE_LABEL, ONLINE_PAYMENTS_DISCLOSURE } from "@/lib/online-payments-terms";

// Shown before the owner is sent to Stripe for the first time. The box starts unticked
// every time the dialog opens, and the Connect button stays disabled until it is ticked.
// The server enforces the same rule (POST /api/stripe/connect/start refuses without it),
// so this dialog is the explanation, not the protection.
export function OnlinePaymentsTermsDialog({
  open,
  onOpenChange,
  loading,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  onConfirm: () => void;
}) {
  const [agreed, setAgreed] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (loading) return;
        if (!next) setAgreed(false);
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Before you connect Stripe</DialogTitle>
          <DialogDescription>{ONLINE_PAYMENTS_DISCLOSURE}</DialogDescription>
        </DialogHeader>

        <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border p-3 text-sm">
          <Checkbox
            checked={agreed}
            onCheckedChange={(checked) => setAgreed(checked === true)}
            disabled={loading}
            className="mt-0.5"
          />
          <span className="font-medium">{ONLINE_PAYMENTS_AGREE_LABEL}</span>
        </label>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={!agreed || loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Connect Stripe
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
