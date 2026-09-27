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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toIsoDate } from "@/lib/date-range";
import type { Renter, RentPaymentWithRenter } from "@/lib/database.types";

export function LogRentPaymentDialog({
  open,
  onOpenChange,
  renter,
  payment,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Renter this payment is against - only used to seed the default amount
  // and to POST a new payment. Ignored when editing an existing payment
  // (its own renter_id never changes here - see payment below).
  renter?: Renter | null;
  // Set when editing an existing log row instead of creating a new one.
  payment?: RentPaymentWithRenter | null;
  onSaved: (payment: RentPaymentWithRenter) => void;
}) {
  const isEditing = !!payment;
  const [paidDate, setPaidDate] = useState(payment?.paid_date ?? toIsoDate(new Date()));
  const [amount, setAmount] = useState(payment?.amount ?? renter?.rental_rate ?? 0);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (amount <= 0) {
      toast.error("Enter an amount greater than $0.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(
        isEditing ? `/api/rent-payments/${payment!.id}` : "/api/rent-payments",
        {
          method: isEditing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            isEditing
              ? { paid_date: paidDate, amount }
              : { renter_id: renter!.id, paid_date: paidDate, amount },
          ),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");

      onSaved(data.payment as RentPaymentWithRenter);
      toast.success(isEditing ? "Payment updated" : "Payment logged");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit payment" : `Log payment · ${renter?.name}`}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="rent-paid-date">Date</Label>
            <Input
              id="rent-paid-date"
              type="date"
              value={paidDate}
              onChange={(e) => setPaidDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rent-amount">Amount</Label>
            <NumberInput id="rent-amount" value={amount} onValueChange={setAmount} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEditing ? "Save changes" : "Log payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
