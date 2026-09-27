"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Renter, RateCadence } from "@/lib/database.types";

// "weekly"/"monthly" (the stored value) differ in case from their
// displayed labels - needs an explicit items prop on Select, same
// reasoning as date-range-filter.tsx's RANGE_PRESET_LABELS.
const RATE_CADENCE_LABELS: Record<RateCadence, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
};

export function RenterDialog({
  open,
  onOpenChange,
  renter,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  renter?: Renter | null;
  onSaved: (renter: Renter) => void;
}) {
  const isEditing = !!renter;
  const [name, setName] = useState(renter?.name ?? "");
  const [rate, setRate] = useState(renter?.rental_rate ?? 0);
  const [cadence, setCadence] = useState<RateCadence>(renter?.rate_cadence ?? "monthly");
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  async function handleSave() {
    if (!name.trim()) {
      toast.error("Enter the renter's name.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(isEditing ? `/api/renters/${renter!.id}` : "/api/renters", {
        method: isEditing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, rental_rate: rate, rate_cadence: cadence }),
      });
      const data = await res.json();
      if (!res.ok) {
        // Every tier gets a capped number of active renters (see
        // lib/plan-limits.ts) - same upgrade-toast pattern used for
        // services/products/employees.
        if (data.code === "FREE_LIMIT_REACHED") {
          toast.error(data.error, {
            action: { label: "Upgrade", onClick: () => router.push("/billing") },
          });
          return;
        }
        throw new Error(data.error || "Failed to save");
      }

      onSaved(data.renter as Renter);
      toast.success(isEditing ? "Renter updated" : "Renter added");
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
          <DialogTitle>{isEditing ? "Edit renter" : "New renter"}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="renter-name">Name</Label>
            <Input
              id="renter-name"
              placeholder="e.g. Alex Rivera"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="renter-rate">Rental rate</Label>
            <NumberInput id="renter-rate" value={rate} onValueChange={setRate} />
          </div>
          <div className="space-y-2">
            <Label>Cadence</Label>
            <Select
              items={RATE_CADENCE_LABELS}
              value={cadence}
              onValueChange={(v) => setCadence(v as RateCadence)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Informational only - nothing is calculated from this automatically.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEditing ? "Save changes" : "Add renter"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
