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
import type { PayType, StylistPublic } from "@/lib/database.types";

const PAY_TYPES: PayType[] = ["commission", "hourly", "salary"];

export function StylistDialog({
  open,
  onOpenChange,
  stylist,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stylist?: StylistPublic | null;
  onSaved: (stylist: StylistPublic) => void;
}) {
  const isEditing = !!stylist;
  const [name, setName] = useState(stylist?.name ?? "");
  const [payType, setPayType] = useState<PayType>(stylist?.pay_type ?? "commission");
  // commission_rate is stored as a fraction (0.15) but edited as a percent (15).
  const [ratePercent, setRatePercent] = useState((stylist?.commission_rate ?? 0) * 100);
  const [saving, setSaving] = useState(false);

  // PIN state is deliberately separate from the fields above - it saves via
  // its own action (POST /api/stylists/[id]/set-pin), not bundled into
  // "Save changes", since PIN validation/errors are a different concern
  // from the stylist's other fields.
  // Never needs a setter - the dialog closes immediately on a successful
  // PIN save/reset (see handleSavePin) and remounts fresh next open (keyed
  // by stylist id in StylistList), so this only ever reflects the value at
  // mount time.
  const [hasPin] = useState(stylist?.has_pin ?? false);
  // Starts open when there's no PIN yet (nothing to hide behind a button),
  // closed (showing "PIN is set") when one already exists - reset reveals
  // the same two-field form rather than showing entry fields by default,
  // so the dialog doesn't look like it's asking to re-enter an existing PIN.
  const [pinSectionOpen, setPinSectionOpen] = useState(!(stylist?.has_pin ?? false));
  const [pin1, setPin1] = useState("");
  const [pin2, setPin2] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinSaving, setPinSaving] = useState(false);

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

      onSaved(data.stylist as StylistPublic);
      toast.success(isEditing ? "Stylist updated" : "Stylist added");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  function cancelPinReset() {
    setPinSectionOpen(false);
    setPin1("");
    setPin2("");
    setPinError(null);
  }

  async function handleSavePin() {
    if (pin1.length !== 4 || pin2.length !== 4) {
      setPinError("Enter a 4-digit PIN in both fields.");
      return;
    }
    if (pin1 !== pin2) {
      setPinError("PINs don't match.");
      return;
    }

    setPinError(null);
    setPinSaving(true);
    try {
      const res = await fetch(`/api/stylists/${stylist!.id}/set-pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: pin1 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save PIN");

      // set-pin only returns { success: true }, not the row - has_pin is
      // the only field that changed, so flip it locally rather than
      // round-tripping the stylist just to read it back.
      onSaved({ ...stylist!, has_pin: true });
      toast.success(hasPin ? "PIN reset" : "PIN saved");
      // Closes the whole dialog rather than collapsing back to "PIN is
      // set" and leaving it open - with two independent save actions
      // ("Save PIN" here vs. "Save changes" for name/rate below), leaving
      // it open after a PIN save reads as "did my PIN just get cleared,
      // since the fields are blank now" the moment the owner glances at
      // Save changes still sitting there. Closing removes the ambiguity
      // outright instead of trying to explain it away.
      onOpenChange(false);
    } catch (err) {
      setPinError(err instanceof Error ? err.message : "Failed to save PIN");
    } finally {
      setPinSaving(false);
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

          {isEditing && stylist && (
            <div className="space-y-2 border-t border-border pt-4">
              <Label>Payout PIN</Label>

              {hasPin && !pinSectionOpen && (
                <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2">
                  <span className="text-sm text-muted-foreground">PIN is set</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setPinSectionOpen(true)}
                  >
                    Reset PIN
                  </Button>
                </div>
              )}

              {(!hasPin || pinSectionOpen) && (
                <div className="space-y-2 rounded-lg border border-border p-3">
                  <p className="text-xs text-muted-foreground">
                    {hasPin
                      ? "Set a new 4-digit PIN - the old one stops working immediately."
                      : "Used to confirm payouts with this stylist."}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label htmlFor="stylist-pin-1" className="text-xs">
                        New PIN
                      </Label>
                      <Input
                        id="stylist-pin-1"
                        inputMode="numeric"
                        maxLength={4}
                        value={pin1}
                        onChange={(e) => {
                          setPin1(e.target.value.replace(/\D/g, "").slice(0, 4));
                          setPinError(null);
                        }}
                        className="text-center tracking-[0.3em]"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="stylist-pin-2" className="text-xs">
                        Confirm PIN
                      </Label>
                      <Input
                        id="stylist-pin-2"
                        inputMode="numeric"
                        maxLength={4}
                        value={pin2}
                        onChange={(e) => {
                          setPin2(e.target.value.replace(/\D/g, "").slice(0, 4));
                          setPinError(null);
                        }}
                        className="text-center tracking-[0.3em]"
                      />
                    </div>
                  </div>
                  {pinError && <p className="text-xs text-destructive">{pinError}</p>}
                  <div className="flex justify-end gap-2">
                    {hasPin && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={cancelPinReset}
                        disabled={pinSaving}
                      >
                        Cancel
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleSavePin}
                      disabled={pinSaving || pin1.length !== 4 || pin2.length !== 4}
                    >
                      {pinSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                      Save PIN
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
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
