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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { LineItem } from "@/lib/database.types";
import { lineDescription, lineName } from "@/lib/line-format";
import { UnitSelect } from "@/components/invoices/line-item-fields";

export function LineItemDialog({
  open,
  onOpenChange,
  lineItem,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lineItem?: LineItem | null;
  onSaved: (lineItem: LineItem) => void;
}) {
  const isEditing = !!lineItem;
  // An old saved item (null name) opens with its description as the name and no description.
  const [name, setName] = useState(lineItem ? lineName(lineItem) : "");
  const [description, setDescription] = useState(lineItem ? lineDescription(lineItem) : "");
  const [unit, setUnit] = useState(lineItem?.unit ?? "");
  const [unitPrice, setUnitPrice] = useState(lineItem?.unit_price ?? 0);
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  async function handleSave() {
    if (!name.trim()) {
      toast.error("Enter a name for this item.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(
        isEditing ? `/api/line-items/${lineItem!.id}` : "/api/line-items",
        {
          method: isEditing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, description, unit, unit_price: unitPrice }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        // Every tier is capped at some number of active saved items (see
        // lib/plan-limits.ts) - same upgrade-toast pattern as services.
        if (data.code === "FREE_LIMIT_REACHED") {
          toast.error(data.error, {
            action: { label: "Upgrade", onClick: () => router.push("/billing") },
          });
          return;
        }
        throw new Error(data.error || "Failed to save");
      }

      onSaved(data.lineItem as LineItem);
      toast.success(isEditing ? "Item updated" : "Item added");
      router.refresh();
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
          <DialogTitle>{isEditing ? "Edit saved item" : "New saved item"}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="line-item-name">Name</Label>
            <Input
              id="line-item-name"
              placeholder="e.g. Interior latex paint"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="line-item-description">Description (optional)</Label>
            <textarea
              id="line-item-description"
              rows={2}
              placeholder="e.g. 1 gal, two coats, colour matched"
              className="field-sizing-content min-h-16 w-full resize-none rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-[1fr_auto] items-end gap-2">
            <div className="space-y-2">
              <Label htmlFor="line-item-price">Price per unit</Label>
              <NumberInput
                id="line-item-price"
                step="0.01"
                value={unitPrice}
                onValueChange={setUnitPrice}
              />
            </div>
            <UnitSelect unit={unit} onChange={setUnit} />
          </div>
          <p className="text-xs text-muted-foreground">
            The quantity is entered on each estimate or invoice, since it changes on every job.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEditing ? "Save changes" : "Add item"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
