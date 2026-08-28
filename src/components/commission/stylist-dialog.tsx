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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PayType, Stylist } from "@/lib/database.types";

const PAY_TYPES: PayType[] = ["commission", "hourly", "salary"];

export function StylistDialog({
  open,
  onOpenChange,
  stylist,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stylist?: Stylist | null;
  onSaved: (stylist: Stylist) => void;
}) {
  const isEditing = !!stylist;
  const [name, setName] = useState(stylist?.name ?? "");
  const [payType, setPayType] = useState<PayType>(stylist?.pay_type ?? "commission");
  // commission_rate is stored as a fraction (0.15) but edited as a percent (15).
  const [ratePercent, setRatePercent] = useState((stylist?.commission_rate ?? 0) * 100);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name.trim()) {
      toast.error("Enter the stylist's name.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(isEditing ? `/api/stylists/${stylist!.id}` : "/api/stylists", {
        method: isEditing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          pay_type: payType,
          commission_rate: ratePercent / 100,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");

      onSaved(data.stylist as Stylist);
      toast.success(isEditing ? "Stylist updated" : "Stylist added");
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
          <DialogTitle>{isEditing ? "Edit stylist" : "New stylist"}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="stylist-name">Name</Label>
            <Input
              id="stylist-name"
              placeholder="e.g. Jamie Torres"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="stylist-pay-type">Pay type</Label>
            <Select
              value={payType}
              onValueChange={(v) => v && setPayType(v as PayType)}
            >
              <SelectTrigger id="stylist-pay-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAY_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="stylist-rate">Commission rate (%)</Label>
            <NumberInput id="stylist-rate" value={ratePercent} onValueChange={setRatePercent} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEditing ? "Save changes" : "Add stylist"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
