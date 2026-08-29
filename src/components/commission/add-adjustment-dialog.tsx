"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Corrects a payout the stylist has already confirmed, without touching
// that payout's own record - the adjustment is its own row, folded into
// whatever payout is created next (see create_payout, 0016_adjustments.sql).
// Confirmed payouts are permanent; this is the only sanctioned way to fix one.
// No onCreated callback: the current (Paid) view isn't affected by a new
// adjustment - it only shows up in the Unpaid tab's pending-adjustments
// list, which already refetches on its own when that tab is opened.
export function AddAdjustmentDialog({
  open,
  onOpenChange,
  stylistId,
  stylistName,
  payoutId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stylistId: string;
  stylistName: string;
  payoutId: string;
}) {
  const [amount, setAmount] = useState(0);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (amount === 0) {
      toast.error("Enter a non-zero amount.");
      return;
    }
    if (!reason.trim()) {
      toast.error("Enter a reason.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/adjustments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stylist_id: stylistId,
          related_payout_id: payoutId,
          amount,
          reason: reason.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save adjustment");

      toast.success("Adjustment recorded - it'll be included in their next payout.");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save adjustment");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add adjustment</DialogTitle>
          <DialogDescription>
            Corrects {stylistName}&apos;s confirmed payout without changing that record - this
            gets folded into their next payout instead.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="adjustment-amount">
              Amount (+ means you owe them more, - means you owe them less)
            </Label>
            <NumberInput
              id="adjustment-amount"
              step="0.01"
              value={amount}
              onValueChange={setAmount}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="adjustment-reason">Reason</Label>
            <Input
              id="adjustment-reason"
              placeholder="e.g. Missed a $15 tip adjustment on Aug 12"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save adjustment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
