"use client";

import { useMemo, useState } from "react";
import {
  Briefcase,
  Loader2,
  Pencil,
  Plus,
  Receipt as ReceiptIcon,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
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
import { TAX_CATEGORIES } from "@/lib/tax-categories";
import type { Receipt, ReceiptItem } from "@/lib/database.types";

const EMPTY_ITEM: ReceiptItem = { name: "", amount: 0 };

// Sentinel values for the job Select, mirroring the client picker's
// "+ Add new client" inline-create pattern in document-builder.tsx. Native
// <input list>/<datalist> autocomplete doesn't render as a real dropdown on
// most mobile browsers - it just looks like a plain text box - so this uses
// the app's own Select for a picker that actually works on phones.
const NO_JOB = "__no_job__";
const NEW_JOB = "__new_job__";

function initialJobMode(jobName: string, existingJobs: string[]): string {
  if (!jobName) return NO_JOB;
  if (existingJobs.includes(jobName)) return jobName;
  return NEW_JOB;
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function formatDate(dateStr: string) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function itemsOf(receipt: Receipt): ReceiptItem[] {
  return Array.isArray(receipt.items) ? receipt.items : [];
}

interface EditForm {
  merchant_name: string;
  transaction_date: string;
  tax_category: string;
  total_amount: number;
  tax_amount: number;
  items: ReceiptItem[];
  job_name: string;
}

function toForm(receipt: Receipt): EditForm {
  const items = itemsOf(receipt);
  return {
    merchant_name: receipt.merchant_name,
    transaction_date: receipt.transaction_date,
    tax_category: receipt.tax_category,
    total_amount: receipt.total_amount,
    tax_amount: receipt.tax_amount,
    items: items.length ? items : [{ ...EMPTY_ITEM }],
    job_name: receipt.job_name ?? "",
  };
}

// Keyed by receipt.id from the parent so editing state resets cleanly
// whenever the dialog is pointed at a different receipt.
function ReceiptSummaryContent({
  receipt,
  existingJobs,
  onOpenChange,
  onDeleted,
  onUpdated,
}: {
  receipt: Receipt;
  existingJobs: string[];
  onOpenChange: (open: boolean) => void;
  onDeleted: (id: string) => void;
  onUpdated: (receipt: Receipt) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState<EditForm>(() => toForm(receipt));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [jobMode, setJobMode] = useState<string>(() =>
    initialJobMode(form.job_name, existingJobs),
  );
  const [newJobName, setNewJobName] = useState<string>(() =>
    jobMode === NEW_JOB ? form.job_name : "",
  );

  const jobSelectItems = useMemo(() => {
    const map: Record<string, string> = { [NO_JOB]: "No job", [NEW_JOB]: "+ Add new job" };
    for (const job of existingJobs) map[job] = job;
    return map;
  }, [existingJobs]);

  function handleJobModeChange(value: string) {
    setJobMode(value);
    if (value === NO_JOB) {
      setForm({ ...form, job_name: "" });
    } else if (value === NEW_JOB) {
      setForm({ ...form, job_name: newJobName });
    } else {
      setForm({ ...form, job_name: value });
    }
  }

  function handleNewJobNameChange(value: string) {
    setNewJobName(value);
    setForm({ ...form, job_name: value });
  }

  function updateItem(index: number, patch: Partial<ReceiptItem>) {
    setForm({
      ...form,
      items: form.items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/receipts/${receipt.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchant_name: form.merchant_name,
          transaction_date: form.transaction_date,
          total_amount: form.total_amount,
          tax_amount: form.tax_amount,
          tax_category: form.tax_category,
          items: form.items.filter((i) => i.name.trim()),
          job_name: form.job_name,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save changes");

      onUpdated(data.receipt as Receipt);
      toast.success("Receipt updated");
      setIsEditing(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/receipts/${receipt.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete receipt");
      }
      onDeleted(receipt.id);
      toast.success("Receipt deleted");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setDeleting(false);
    }
  }

  if (isEditing) {
    const subtotal = form.total_amount - form.tax_amount;

    return (
      <>
        <DialogHeader>
          <DialogTitle>Edit receipt</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="edit-merchant">Merchant</Label>
            <Input
              id="edit-merchant"
              value={form.merchant_name}
              onChange={(e) =>
                setForm({ ...form, merchant_name: e.target.value })
              }
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-date">Date</Label>
              <Input
                id="edit-date"
                type="date"
                value={form.transaction_date}
                onChange={(e) =>
                  setForm({ ...form, transaction_date: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-category">Category</Label>
              <Select
                value={form.tax_category}
                onValueChange={(v) => v && setForm({ ...form, tax_category: v })}
              >
                <SelectTrigger id="edit-category" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TAX_CATEGORIES.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-total">Total ($)</Label>
              <NumberInput
                id="edit-total"
                step="0.01"
                value={form.total_amount}
                onValueChange={(total_amount) =>
                  setForm({ ...form, total_amount })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-tax">Sales tax ($)</Label>
              <NumberInput
                id="edit-tax"
                step="0.01"
                value={form.tax_amount}
                onValueChange={(tax_amount) => setForm({ ...form, tax_amount })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Items purchased</Label>
            {form.items.map((item, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  placeholder="Item"
                  className="flex-1"
                  value={item.name}
                  onChange={(e) => updateItem(i, { name: e.target.value })}
                />
                <NumberInput
                  step="0.01"
                  placeholder="Price"
                  className="w-24"
                  value={item.amount}
                  onValueChange={(amount) => updateItem(i, { amount })}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  onClick={() =>
                    setForm({
                      ...form,
                      items: form.items.filter((_, idx) => idx !== i),
                    })
                  }
                  disabled={form.items.length === 1}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setForm({ ...form, items: [...form.items, { ...EMPTY_ITEM }] })
              }
            >
              <Plus className="h-4 w-4" />
              Add item
            </Button>
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-job">Job (optional)</Label>
            <Select
              items={jobSelectItems}
              value={jobMode}
              onValueChange={(v) => v && handleJobModeChange(v)}
            >
              <SelectTrigger id="edit-job" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_JOB}>No job</SelectItem>
                <SelectItem value={NEW_JOB}>+ Add new job</SelectItem>
                {existingJobs.map((job) => (
                  <SelectItem key={job} value={job}>
                    {job}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {jobMode === NEW_JOB && (
              <Input
                placeholder="e.g. 123 Main St or Job #4521"
                value={newJobName}
                onChange={(e) => handleNewJobNameChange(e.target.value)}
              />
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Subtotal {formatCurrency(subtotal)} + tax{" "}
            {formatCurrency(form.tax_amount)} = total{" "}
            {formatCurrency(form.total_amount)}
          </p>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              const reverted = toForm(receipt);
              setForm(reverted);
              setJobMode(initialJobMode(reverted.job_name, existingJobs));
              setNewJobName(reverted.job_name);
              setIsEditing(false);
            }}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save changes
          </Button>
        </DialogFooter>
      </>
    );
  }

  const items = itemsOf(receipt);
  const subtotal = receipt.total_amount - receipt.tax_amount;

  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          <ReceiptIcon className="h-3.5 w-3.5" />
          Receipt Summary
        </div>
        <DialogTitle className="text-xl">{receipt.merchant_name}</DialogTitle>
        <div className="flex items-center justify-between pt-1">
          <span className="text-sm text-muted-foreground">
            {formatDate(receipt.transaction_date)}
          </span>
          <Badge variant="secondary">{receipt.tax_category}</Badge>
        </div>
        {receipt.job_name && (
          <div className="flex items-center gap-1.5 pt-1 text-sm text-muted-foreground">
            <Briefcase className="h-3.5 w-3.5" />
            {receipt.job_name}
          </div>
        )}
      </DialogHeader>

      <div className="rounded-lg border">
        <div className="space-y-1.5 p-4">
          <p className="text-xs text-muted-foreground">Items purchased</p>
          {items.length > 0 ? (
            <ul className="space-y-1 text-sm">
              {items.map((item, i) => (
                <li key={i} className="flex items-center justify-between gap-3">
                  <span className="truncate">{item.name}</span>
                  <span className="shrink-0 tabular-nums">
                    {formatCurrency(item.amount)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">—</p>
          )}
        </div>

        <Separator />

        <div className="space-y-2 p-4 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="tabular-nums">{formatCurrency(subtotal)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Sales tax</span>
            <span className="tabular-nums">
              {formatCurrency(receipt.tax_amount)}
            </span>
          </div>
        </div>

        <Separator />

        <div className="flex items-center justify-between p-4">
          <span className="font-semibold">Total</span>
          <span className="text-lg font-semibold tabular-nums">
            {formatCurrency(receipt.total_amount)}
          </span>
        </div>
      </div>

      <DialogFooter>
        <Button
          variant="outline"
          onClick={handleDelete}
          disabled={deleting}
          className="text-destructive hover:text-destructive"
        >
          {deleting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
          Delete
        </Button>
        <Button variant="outline" onClick={() => setIsEditing(true)}>
          <Pencil className="h-4 w-4" />
          Edit
        </Button>
        <Button onClick={() => onOpenChange(false)}>Close</Button>
      </DialogFooter>
    </>
  );
}

export function ReceiptDetailDialog({
  receipt,
  existingJobs = [],
  onOpenChange,
  onDeleted,
  onUpdated,
}: {
  receipt: Receipt | null;
  existingJobs?: string[];
  onOpenChange: (open: boolean) => void;
  onDeleted: (id: string) => void;
  onUpdated: (receipt: Receipt) => void;
}) {
  return (
    <Dialog open={!!receipt} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        {receipt && (
          <ReceiptSummaryContent
            key={receipt.id}
            receipt={receipt}
            existingJobs={existingJobs}
            onOpenChange={onOpenChange}
            onDeleted={onDeleted}
            onUpdated={onUpdated}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
