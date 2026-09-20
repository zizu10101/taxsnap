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

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

interface Allocation {
  drawId: string;
  documentNumber: number;
  drawNumber: number | null;
  amountApplied: number;
  newStatus: string;
}

// Records one payment against the CONTRACT as a whole rather than a
// specific draw - the server fans it out oldest-unpaid-draw-first (see
// POST /api/jobs/[id]/allocate-payment), so this is for the common case
// of a client paying down several draws' held-back balance at once
// without opening each draw individually.
export function RecordContractPaymentDialog({
  open,
  onOpenChange,
  jobId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState(0);
  const [paidDate, setPaidDate] = useState(() => toIsoDate(new Date()));
  const [method, setMethod] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  function reset() {
    setAmount(0);
    setPaidDate(toIsoDate(new Date()));
    setMethod("");
    setNote("");
  }

  async function handleSave() {
    if (!amount || amount <= 0) {
      toast.error("Enter a payment amount greater than $0.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}/allocate-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, paid_date: paidDate, method, note }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to record payment");

      const allocations = data.allocations as Allocation[];
      const summary = allocations
        .map(
          (a) =>
            `${formatCurrency(a.amountApplied)} to Draw #${a.drawNumber ?? "?"}`,
        )
        .join(", ");
      toast.success(
        allocations.length > 0
          ? `Payment applied: ${summary}`
          : "Payment recorded",
      );
      reset();
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

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
          <DialogTitle>Record Payment</DialogTitle>
          <DialogDescription>
            Applied across outstanding draws oldest-first, until fully allocated or
            draws run out - no need to open each one individually.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="contract-payment-amount">Amount ($)</Label>
            <NumberInput id="contract-payment-amount" value={amount} onValueChange={setAmount} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="contract-payment-date">Date</Label>
            <Input
              id="contract-payment-date"
              type="date"
              value={paidDate}
              onChange={(e) => setPaidDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="contract-payment-method">Method (optional)</Label>
            <Input
              id="contract-payment-method"
              placeholder="e.g. E-transfer"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="contract-payment-note">Note (optional)</Label>
            <Input
              id="contract-payment-note"
              placeholder="e.g. Held-back balance on draws 1-2"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Record Payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
