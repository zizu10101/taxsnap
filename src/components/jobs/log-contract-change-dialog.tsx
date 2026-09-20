"use client";

import { useMemo, useState } from "react";
import { BookmarkPlus, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import type { ContractChange, Job, LineItem } from "@/lib/database.types";

interface ChangeItemDraft {
  description: string;
  quantity: number;
  unit_price: number;
  /** Save this item to the reusable saved-items list on submit. */
  saveForReuse?: boolean;
}

const EMPTY_ITEM: ChangeItemDraft = { description: "", quantity: 1, unit_price: 0 };
const INSERT_SAVED_PLACEHOLDER = "__pick_saved_item__";

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

export interface EditingChange {
  id: string;
  reason: string;
  changedAt: string;
  amount: number;
  items: { description: string; quantity: number; unit_price: number }[];
}

// Logs a change order against an already-progress-billed job with real
// line items (same shape/UI as the invoice builder's own - saved-item
// picker, "save for next time"), or edits one that hasn't been billed
// yet. contract_value is adjusted server-side (POST applies the total,
// PATCH applies the delta between old and new total) - see
// api/jobs/[id]/contract-changes. Once billed_document_id is set, a
// change order is permanent: the parent only ever passes editingChange
// for one that's still unbilled.
export function LogContractChangeDialog({
  open,
  onOpenChange,
  jobId,
  currentContractValue,
  savedLineItems,
  editingChange = null,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  currentContractValue: number;
  savedLineItems: LineItem[];
  editingChange?: EditingChange | null;
  onSaved: (job: Job, change: ContractChange) => void;
}) {
  const isEditing = !!editingChange;

  function initialItems(): ChangeItemDraft[] {
    return editingChange?.items?.length
      ? editingChange.items.map((i) => ({
          description: i.description,
          quantity: i.quantity,
          unit_price: i.unit_price,
        }))
      : [{ ...EMPTY_ITEM }];
  }

  const [reason, setReason] = useState(editingChange?.reason ?? "");
  const [changedAt, setChangedAt] = useState(editingChange?.changedAt ?? toIsoDate(new Date()));
  const [items, setItems] = useState<ChangeItemDraft[]>(initialItems);
  const [insertPick, setInsertPick] = useState(INSERT_SAVED_PLACEHOLDER);
  const [saving, setSaving] = useState(false);

  function reset() {
    setReason(editingChange?.reason ?? "");
    setChangedAt(editingChange?.changedAt ?? toIsoDate(new Date()));
    setItems(initialItems());
  }

  const savedItemSelectItems = useMemo(() => {
    const map: Record<string, string> = { [INSERT_SAVED_PLACEHOLDER]: "Insert a saved item..." };
    for (const item of savedLineItems) {
      map[item.id] = `${item.description} — ${formatCurrency(item.unit_price)}`;
    }
    return map;
  }, [savedLineItems]);

  function updateItem(index: number, patch: Partial<ChangeItemDraft>) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }

  function insertSavedItem(id: string | null) {
    const saved = savedLineItems.find((i) => i.id === id);
    if (!saved) return;
    setItems((prev) => {
      const emptyIndex = prev.findIndex((i) => !i.description.trim());
      const filled = { description: saved.description, quantity: 1, unit_price: saved.unit_price };
      if (emptyIndex === -1) return [...prev, filled];
      return prev.map((i, idx) => (idx === emptyIndex ? filled : i));
    });
    setInsertPick(INSERT_SAVED_PLACEHOLDER);
  }

  const total = round2(
    items.reduce((sum, i) => sum + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0), 0),
  );
  const previewValue = round2(currentContractValue - (editingChange?.amount ?? 0) + total);

  async function handleSave() {
    if (!reason.trim()) {
      toast.error("Enter a reason for this change.");
      return;
    }
    const cleanItems = items.filter((i) => i.description.trim());
    if (cleanItems.length === 0) {
      toast.error("Add at least one line item.");
      return;
    }
    if (total === 0) {
      toast.error("The line items must total a non-zero amount.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(
        isEditing
          ? `/api/jobs/${jobId}/contract-changes/${editingChange.id}`
          : `/api/jobs/${jobId}/contract-changes`,
        {
          method: isEditing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reason,
            changed_at: changedAt,
            items: cleanItems.map((i) => ({
              description: i.description,
              quantity: i.quantity,
              unit_price: i.unit_price,
            })),
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save change order");

      const toSave = cleanItems.filter((i) => i.saveForReuse);
      for (const item of toSave) {
        fetch("/api/line-items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ description: item.description, unit_price: item.unit_price }),
        }).catch(() => {});
      }

      onSaved(data.job as Job, data.change as ContractChange);
      toast.success(isEditing ? "Change order updated" : "Change order logged");
      onOpenChange(false);
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Change Order" : "Log Change Order"}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Adjust this change order - only possible before it's billed."
              : "Log an approved add-on or scope change with real line items, just like an invoice."}{" "}
            Permanent once billed - a mistake after that point gets corrected with a
            new offsetting entry, not by editing this one.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="change-reason">Reason</Label>
            <Input
              id="change-reason"
              placeholder="e.g. Add a deck"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label>Line items</Label>
              {savedLineItems.length > 0 && (
                <Select
                  value={insertPick}
                  onValueChange={insertSavedItem}
                  items={savedItemSelectItems}
                >
                  <SelectTrigger className="h-8 w-auto max-w-[200px] text-xs">
                    <BookmarkPlus className="h-3.5 w-3.5" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {savedLineItems.map((saved) => (
                      <SelectItem key={saved.id} value={saved.id}>
                        {saved.description} — {formatCurrency(saved.unit_price)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            {items.map((item, i) => {
              const lineTotal = (Number(item.quantity) || 0) * (Number(item.unit_price) || 0);
              return (
                <div key={i} className="space-y-1.5 rounded-lg border p-2.5">
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder="Description (e.g. Deck framing)"
                      className="flex-1"
                      value={item.description}
                      onChange={(e) => updateItem(i, { description: e.target.value })}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0"
                      onClick={() => setItems((prev) => prev.filter((_, idx) => idx !== i))}
                      title="Remove line item"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-1.5 text-sm">
                    <NumberInput
                      placeholder="Qty"
                      className="w-16"
                      value={item.quantity}
                      onValueChange={(quantity) => updateItem(i, { quantity })}
                    />
                    <span className="text-muted-foreground">×</span>
                    <NumberInput
                      placeholder="Price"
                      className="w-24"
                      value={item.unit_price}
                      onValueChange={(unit_price) => updateItem(i, { unit_price })}
                    />
                    <span className="text-muted-foreground">=</span>
                    <span className="ml-auto shrink-0 font-semibold tabular-nums">
                      {formatCurrency(lineTotal)}
                    </span>
                  </div>
                  {item.description.trim() && (
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Checkbox
                        checked={!!item.saveForReuse}
                        onCheckedChange={(checked) =>
                          updateItem(i, { saveForReuse: !!checked })
                        }
                      />
                      Save for next time
                    </label>
                  )}
                </div>
              );
            })}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setItems((prev) => [...prev, { ...EMPTY_ITEM }])}
            >
              <Plus className="h-4 w-4" />
              Add line item
            </Button>
          </div>

          <div className="space-y-1 rounded-lg bg-muted/40 p-3 text-sm">
            <div className="flex items-center justify-between font-semibold">
              <span>Total ({total >= 0 ? "add" : "reduce"})</span>
              <span className="tabular-nums">{formatCurrency(total)}</span>
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>New contract value</span>
              <span className="tabular-nums">{formatCurrency(previewValue)}</span>
            </div>
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
            {isEditing ? "Save changes" : "Log Change"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
