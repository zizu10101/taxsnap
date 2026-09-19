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
import type { ContractChange, Job } from "@/lib/database.types";

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

// Adjusts an already-progress-billed job's contract value by logging a
// permanent change-order entry (+/- amount, required reason, date) -
// distinct from StartProgressBillingDialog, which only ever sets the
// value once on a job that doesn't have one yet. contract_value itself
// is still updated (by the delta, server-side), but only ever through
// this log now - see POST /api/jobs/[id]/contract-changes. There's no
// edit/delete for a logged entry, by design - a mistake gets corrected
// with a new offsetting entry, not by rewriting this one.
export function LogContractChangeDialog({
  open,
  onOpenChange,
  jobId,
  currentValue,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  currentValue: number;
  onSaved: (job: Job, change: ContractChange) => void;
}) {
  const [amount, setAmount] = useState(0);
  const [reason, setReason] = useState("");
  const [changedAt, setChangedAt] = useState(() => toIsoDate(new Date()));
  const [saving, setSaving] = useState(false);

  function reset() {
    setAmount(0);
    setReason("");
    setChangedAt(toIsoDate(new Date()));
  }

  async function handleSave() {
    if (!amount) {
      toast.error("Enter a non-zero amount (positive to add, negative to reduce).");
      return;
    }
    if (!reason.trim()) {
      toast.error("Enter a reason for this change.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}/contract-changes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, reason, changed_at: changedAt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to log change order");
      onSaved(data.job as Job, data.change as ContractChange);
      toast.success("Change order logged");
      reset();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  const previewValue = round2(currentValue + (amount || 0));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Log Change Order</DialogTitle>
          <DialogDescription>
            Adjust the contract value for an approved add-on or scope change.
            This is logged permanently - a mistake gets corrected with a new
            offsetting entry, not by editing this one.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="change-amount">Amount ($) - positive to add, negative to reduce</Label>
            <NumberInput id="change-amount" value={amount} onValueChange={setAmount} />
            <p className="text-xs text-muted-foreground tabular-nums">
              New contract value: {formatCurrency(previewValue)}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="change-reason">Reason</Label>
            <Input
              id="change-reason"
              placeholder="e.g. Client-approved kitchen upgrade"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="change-date">Date</Label>
            <Input
              id="change-date"
              type="date"
              value={changedAt}
              onChange={(e) => setChangedAt(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Log Change
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
